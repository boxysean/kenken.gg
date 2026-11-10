"""Exports the trained character model to ONNX and writes the golden parity data for the browser.

Reads the checkpoint written by train_char.py, appends a softmax and exports the result to
web/src/ocr/models/char.onnx at opset 13, which onnxruntime-web supports. The export is checked
with onnx.checker and compared against the torch model on every validation crop under
onnxruntime CPU; the script exits non-zero if they differ by more than MAX_DIFFERENCE.

It then picks a class-balanced golden set from the validation split, copies those crops into
web/src/ocr/infer/__fixtures__/clue_crops/ and records the ONNX model's probabilities for each
in clue_golden.json, so ticket 10's in-browser inference can be held to the same numbers.
The input contract is train_char.py's: (N, 1, 16, 16) NCHW float32, pixel/255.
"""

import argparse
import json
import os
import shutil
import sys

import numpy as np
import onnx
import onnxruntime
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_char import CLASSES, IMAGE_SIZE, REPO_ROOT, CharNet, load_crop, load_manifest  # noqa: E402

MAX_DIFFERENCE = 1e-4


def golden_crops(val_crops: list[dict], count: int) -> list[dict]:
    """Up to count val crops: round-robin over CLASSES in order, then any left, sorted by file."""
    queues = {name: sorted((crop for crop in val_crops if crop['class'] == name), key=lambda crop: crop['file']) for name in CLASSES}
    chosen: list[dict] = []
    while len(chosen) < count and any(queues.values()):
        for name in CLASSES:
            if len(chosen) < count and queues[name]:
                chosen.append(queues[name].pop(0))
    taken = {crop['file'] for crop in chosen}
    rest = sorted((crop for crop in val_crops if crop['file'] not in taken), key=lambda crop: crop['file'])
    return chosen + rest[: count - len(chosen)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--checkpoint', default='training/checkpoints/char.pt')
    parser.add_argument('--data', default='training/data')
    parser.add_argument('--out', default='web/src/ocr/models/char.onnx')
    parser.add_argument('--golden-dir', default='web/src/ocr/infer/__fixtures__/clue_crops')
    parser.add_argument('--golden-json', default='web/src/ocr/infer/__fixtures__/clue_golden.json')
    parser.add_argument('--opset', type=int, default=13)
    parser.add_argument('--count', type=int, default=50)
    args = parser.parse_args()

    torch.set_num_threads(3)
    checkpoint = torch.load(args.checkpoint, map_location='cpu')
    assert checkpoint['classes'] == CLASSES, f'checkpoint classes {checkpoint["classes"]} are not {CLASSES}'
    net = CharNet()
    net.load_state_dict(checkpoint['state_dict'])
    # CharNet returns logits; the exported graph ends in this softmax, so its output IS probabilities.
    model = torch.nn.Sequential(net, torch.nn.Softmax(dim=1)).eval()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    torch.onnx.export(
        model,
        (torch.zeros(1, 1, IMAGE_SIZE, IMAGE_SIZE),),
        args.out,
        # The TorchScript exporter: it honours dynamic_axes and writes opset 13 as asked.
        dynamo=False,
        opset_version=args.opset,
        input_names=['input'],
        output_names=['probabilities'],
        do_constant_folding=True,
        dynamic_axes={'input': {0: 'batch'}, 'probabilities': {0: 'batch'}},
    )
    onnx.checker.check_model(onnx.load(args.out))
    session = onnxruntime.InferenceSession(args.out, providers=['CPUExecutionProvider'])

    val_crops = [crop for crop in load_manifest(args.data) if crop['split'] == 'val']
    assert val_crops, 'no val crops in the manifest'
    images = np.stack([load_crop(os.path.join(REPO_ROOT, crop['file'])) for crop in val_crops])[:, None]
    with torch.no_grad():
        expected = model(torch.from_numpy(images)).numpy()
    (actual,) = session.run(['probabilities'], {'input': images})
    difference = float(np.abs(expected - actual).max())
    print(f'torch/onnx max abs difference over {len(val_crops)} val crops: {difference:.3e}')
    if not difference <= MAX_DIFFERENCE:
        sys.exit(f'onnx output differs from torch by {difference:.3e}, more than {MAX_DIFFERENCE:.0e}')

    # Delete the PNGs of an older run first so stale crops never linger.
    os.makedirs(args.golden_dir, exist_ok=True)
    for name in os.listdir(args.golden_dir):
        if name.endswith('.png'):
            os.remove(os.path.join(args.golden_dir, name))
    entries = []
    for crop in golden_crops(val_crops, args.count):
        name = os.path.basename(crop['file'])
        shutil.copyfile(os.path.join(REPO_ROOT, crop['file']), os.path.join(args.golden_dir, name))
        image = load_crop(os.path.join(args.golden_dir, name))[None, None]
        (probabilities,) = session.run(['probabilities'], {'input': image})
        entries.append(
            {
                'file': name,
                'class': crop['class'],
                'expected': crop['class'],
                'seed': crop['seed'],
                'styleTag': crop['styleTag'],
                'probabilities': [round(float(p), 6) for p in probabilities[0]],
                'argmax': CLASSES[int(probabilities[0].argmax())],
            }
        )
    entries.sort(key=lambda entry: entry['file'])

    golden = {
        'generatedBy': 'training/export_onnx.py',
        'model': 'web/src/ocr/models/char.onnx',
        'opset': args.opset,
        'classes': CLASSES,
        'input': {
            'size': IMAGE_SIZE,
            'channels': 1,
            'layout': 'NCHW',
            'valueScale': 'pixel/255',
            'note': 'RGB channels of the 16x16 PNG carry the ink value; feed pixel/255 as float32',
        },
        'note': "probabilities are the exported ONNX model's softmax output, computed here under onnxruntime CPU",
        'entries': entries,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.golden_json)), exist_ok=True)
    with open(args.golden_json, 'w', encoding='utf-8') as f:
        f.write(json.dumps(golden, indent=2) + '\n')

    correct = sum(entry['argmax'] == entry['class'] for entry in entries)
    print(f'wrote {args.out}: {os.path.getsize(args.out)} bytes, opset {args.opset}')
    print(f'wrote {args.golden_json}: {len(entries)} entries, crops in {args.golden_dir}')
    print(f'golden argmax accuracy: {correct / len(entries) * 100:.2f}% ({correct}/{len(entries)})')
    print(f'max torch/onnx difference: {difference:.3e}')


if __name__ == '__main__':
    main()
