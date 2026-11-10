"""Trains the clue-character classifier on the crops written by web/scripts/export-crops.ts.

The data is training/data/manifest.json plus the 16x16 PNGs it lists. Each crop is one
character of a clue: a digit or an operator, one of CLASSES. The manifest's own split is
used as is: crops with split 'train' train the model, crops with split 'val' score it.

Input contract, shared with export_onnx.py and the browser: the crop's RGB channels carry
the ink value (0 = paper, 255 = ink). It is read with Image.open(path).convert('L'), cast
to float32 and divided by 255, and fed as a (1, 1, 16, 16) NCHW tensor.

Training runs on CPU only and is deterministic for a fixed seed: a rerun with the same
seed on the same data prints the same final accuracy.
"""

import argparse
import json
import os

import numpy as np
import torch
from PIL import Image

CLASSES: list[str] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', 'x', '/']

IMAGE_SIZE = 16
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Augmentation applied to training batches only.
MAX_ROTATION_DEGREES = 8.0
NOISE_SIGMA = 0.05
BRIGHTNESS_RANGE = (0.85, 1.15)


class CharNet(torch.nn.Module):
    """A small CPU CNN: (N, 1, 16, 16) ink values in [0, 1] to (N, len(CLASSES)) logits.

    The softmax is not part of this module, so training can use CrossEntropyLoss on the
    logits; export_onnx.py appends it to the exported graph.
    """

    def __init__(self) -> None:
        super().__init__()
        self.features = torch.nn.Sequential(
            torch.nn.Conv2d(1, 16, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.MaxPool2d(2),  # 16x8x8
            torch.nn.Conv2d(16, 32, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.MaxPool2d(2),  # 32x4x4
            torch.nn.Conv2d(32, 64, 3, padding=1),
            torch.nn.ReLU(),  # 64x4x4
        )
        self.head = torch.nn.Sequential(
            torch.nn.Flatten(),
            torch.nn.Linear(64 * 4 * 4, 64),
            torch.nn.ReLU(),
            torch.nn.Linear(64, len(CLASSES)),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(x))


def load_crop(path: str) -> np.ndarray:
    """One crop as a (16, 16) float32 array in [0, 1], 1 = ink. See the input contract above."""
    return np.asarray(Image.open(path).convert('L'), dtype=np.float32) / 255.0


def load_manifest(data_dir: str) -> list[dict]:
    """The manifest's crop entries; their file paths are relative to the repo root."""
    with open(os.path.join(data_dir, 'manifest.json'), encoding='utf-8') as f:
        return json.load(f)['crops']


def load_split(crops: list[dict], split: str) -> tuple[np.ndarray, np.ndarray]:
    """Images (N, 16, 16) and class indices (N,) for the crops in one split, in manifest order."""
    chosen = [crop for crop in crops if crop['split'] == split]
    assert chosen, f'no {split} crops in the manifest'
    images = np.stack([load_crop(os.path.join(REPO_ROOT, crop['file'])) for crop in chosen])
    labels = np.array([CLASSES.index(crop['class']) for crop in chosen], dtype=np.int64)
    return images, labels


def augment(images: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A randomly rotated, noised and brightness-jittered copy of a (N, 16, 16) batch."""
    out = np.empty_like(images)
    angles = rng.uniform(-MAX_ROTATION_DEGREES, MAX_ROTATION_DEGREES, size=len(images))
    for i, (image, angle) in enumerate(zip(images, angles)):
        # Mode 'F' keeps the float values; NEAREST with fill 0 adds no new ink values.
        rotated = Image.fromarray(image, mode='F').rotate(float(angle), resample=Image.NEAREST, fillcolor=0)
        out[i] = np.asarray(rotated, dtype=np.float32)
    out = np.clip(out + rng.normal(0.0, NOISE_SIGMA, size=out.shape).astype(np.float32), 0.0, 1.0)
    factors = rng.uniform(*BRIGHTNESS_RANGE, size=(len(out), 1, 1)).astype(np.float32)
    return np.clip(out * factors, 0.0, 1.0)


def to_tensor(images: np.ndarray) -> torch.Tensor:
    """(N, 16, 16) to the (N, 1, 16, 16) NCHW float32 tensor the model takes."""
    return torch.from_numpy(np.ascontiguousarray(images, dtype=np.float32)).unsqueeze(1)


def count_correct(model: CharNet, images: np.ndarray, labels: np.ndarray) -> int:
    """How many of the images the model classifies correctly, unaugmented."""
    model.eval()
    with torch.no_grad():
        predicted = model(to_tensor(images)).argmax(dim=1).numpy()
    return int((predicted == labels).sum())


def class_counts(labels: np.ndarray) -> str:
    counts = np.bincount(labels, minlength=len(CLASSES))
    return ' '.join(f'{name}:{count}' for name, count in zip(CLASSES, counts))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--data', default='training/data')
    parser.add_argument('--epochs', type=int, default=30)
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--checkpoint', default='training/checkpoints/char.pt')
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(3)
    torch.use_deterministic_algorithms(True)
    rng = np.random.default_rng(args.seed)

    crops = load_manifest(args.data)
    train_images, train_labels = load_split(crops, 'train')
    val_images, val_labels = load_split(crops, 'val')
    print(f'train: {len(train_images)} crops  {class_counts(train_labels)}')
    print(f'val:   {len(val_images)} crops  {class_counts(val_labels)}')

    model = CharNet()
    print(f'CharNet: {sum(p.numel() for p in model.parameters())} parameters')
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    loss_fn = torch.nn.CrossEntropyLoss()

    val_correct = 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = rng.permutation(len(train_images))
        total_loss = 0.0
        train_correct = 0
        for start in range(0, len(order), args.batch_size):
            batch = order[start : start + args.batch_size]
            inputs = to_tensor(augment(train_images[batch], rng))
            targets = torch.from_numpy(train_labels[batch])
            optimizer.zero_grad()
            logits = model(inputs)
            loss = loss_fn(logits, targets)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(batch)
            train_correct += int((logits.argmax(dim=1) == targets).sum())
        val_correct = count_correct(model, val_images, val_labels)
        print(
            f'epoch {epoch:2d}  train loss {total_loss / len(order):.4f}  '
            f'train acc {train_correct / len(order) * 100:.2f}%  '
            f'val acc {val_correct / len(val_images) * 100:.2f}%'
        )

    val_accuracy = val_correct / len(val_images)
    os.makedirs(os.path.dirname(os.path.abspath(args.checkpoint)), exist_ok=True)
    torch.save(
        {'state_dict': model.state_dict(), 'classes': CLASSES, 'val_accuracy': val_accuracy, 'epochs': args.epochs, 'seed': args.seed},
        args.checkpoint,
    )
    print(f'saved {args.checkpoint}')
    print(f'FINAL val accuracy: {val_accuracy * 100:.2f}% ({val_correct}/{len(val_images)})')


if __name__ == '__main__':
    main()
