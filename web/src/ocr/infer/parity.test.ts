// @vitest-environment node
// Browser-side inference vs the Python/onnxruntime reference (clue_golden.json,
// written by training/export_onnx.py): the same 50 golden crops through this
// repo's preprocess path and onnxruntime-web must agree with it. jsdom's
// import.meta.url is not a file URL, hence the node environment; there
// onnxruntime-web resolves to its node build, which runs the same wasm kernels.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { binarize } from '../pipeline/binarize';
import type { OcrImage } from '../types';
import { loadClassifier, MODEL_CLASSES } from './onnxReader';
import type { CharacterPrediction } from './onnxReader';
import { CANVAS_SIZE, canvasToInput, characterCanvas } from './preprocess';

interface GoldenEntry {
  file: string;
  class: string;
  expected: string;
  probabilities: number[];
  argmax: number;
}

interface Golden {
  classes: string[];
  entries: GoldenEntry[];
}

const FIXTURES = new URL('./__fixtures__/', import.meta.url);
const golden: Golden = JSON.parse(readFileSync(new URL('clue_golden.json', FIXTURES), 'utf8'));

// The card's floors.
const MIN_AGREEMENT = 48;
const MAX_PROBABILITY_DELTA = 0.02;

// Decodes an 8-bit RGBA (colour type 6), non-interlaced PNG; enough for the crops.
function decodePng(bytes: Uint8Array): OcrImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [bitDepth, colourType, , , interlace] = body.subarray(8, 13);
      if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) throw new Error('unsupported PNG');
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = new Uint8ClampedArray(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[y * stride + x - 4] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      data[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width, height, data };
}

// Dark ink on white paper: RGB inverted, alpha kept.
function printed(image: OcrImage): OcrImage {
  const data = image.data.map((value, index) => (index % 4 === 3 ? value : 255 - value));
  return { ...image, data };
}

describe('ONNX parity with the Python reference', () => {
  it('uses the model class order', () => {
    expect(golden.classes).toEqual(MODEL_CLASSES);
    expect(golden.entries).toHaveLength(50);
  });

  it('agrees with clue_golden.json on at least 48 of 50 crops, probabilities within 0.02', async () => {
    const classify = await loadClassifier(new URL('../models/char.onnx', import.meta.url));

    let agreed = 0;
    let maxDelta = 0;
    const disagreements: string[] = [];
    for (const entry of golden.entries) {
      const image = decodePng(readFileSync(new URL(`clue_crops/${entry.file}`, FIXTURES)));
      expect([image.width, image.height]).toEqual([CANVAS_SIZE, CANVAS_SIZE]);

      // A crop is light ink (255) on 0, the reverse of print; binarize() takes
      // dark pixels as ink, so it sees the crop as the photo would show it.
      const { ink } = binarize(printed(image));
      const canvas = characterCanvas(ink, image.width, image.height, { start: 0, end: CANVAS_SIZE - 1 });
      expect(canvas).not.toBeNull();
      // The crop already is a character canvas, so rebuilding it is the identity.
      for (let i = 0; i < canvas!.length; i++) expect(canvas![i]).toBe(image.data[i * 4]);

      const prediction: CharacterPrediction = await classify(canvasToInput(canvas!));
      expect(prediction.probabilities).toHaveLength(golden.classes.length);
      if (prediction.char === entry.class) agreed++;
      else disagreements.push(`${entry.file}: predicted ${prediction.char}, golden ${entry.class}`);
      prediction.probabilities.forEach((probability, index) => {
        maxDelta = Math.max(maxDelta, Math.abs(probability - entry.probabilities[index]));
      });
    }

    console.log(`parity: ${agreed}/${golden.entries.length} agree with the golden class; max |probability delta| = ${maxDelta.toExponential(3)}`);
    if (disagreements.length > 0) console.log(disagreements.join('\n'));
    expect(agreed).toBeGreaterThanOrEqual(MIN_AGREEMENT);
    expect(maxDelta).toBeLessThanOrEqual(MAX_PROBABILITY_DELTA);
  });
});
