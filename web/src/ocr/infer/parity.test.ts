// @vitest-environment node
// Browser-side inference vs the Python/onnxruntime reference (clue_golden.json,
// written by training/export_onnx.py): the same 50 golden crops through this
// repo's preprocess path and onnxruntime-web must agree with it. jsdom's
// import.meta.url is not a file URL, hence the node environment; there
// onnxruntime-web resolves to its node build, which runs the same wasm kernels.
import { readFileSync } from 'node:fs';
import { binarize } from '../pipeline/binarize';
import { decodePng } from '../render/png';
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
