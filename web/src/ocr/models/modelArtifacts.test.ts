// @vitest-environment node
// Guards the committed character-model artifacts written by training/export_onnx.py:
// the ONNX model, the golden probabilities and the golden crops they were computed
// on. It only reads files, so it fails when one goes missing or changes shape, not
// when the model gets worse. Runs under node: jsdom's import.meta.url is not a file URL.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLASSES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', 'x', '/'];

const MAX_MODEL_BYTES = 2 * 1024 * 1024;
const GOLDEN_COUNT = 50;

interface GoldenEntry {
  file: string;
  class: string;
  expected: string;
  seed: string;
  styleTag: string;
  probabilities: number[];
  argmax: string;
}

interface Golden {
  classes: string[];
  entries: GoldenEntry[];
}

const modelUrl = new URL('./char.onnx', import.meta.url);
const goldenUrl = new URL('../infer/__fixtures__/clue_golden.json', import.meta.url);
const cropsDirectory = fileURLToPath(new URL('../infer/__fixtures__/clue_crops/', import.meta.url));

describe('char.onnx', () => {
  it('is committed, non-empty and under 2 MB', () => {
    expect(existsSync(modelUrl), 'web/src/ocr/models/char.onnx is missing; run training/export_onnx.py').toBe(true);
    const { size } = statSync(modelUrl);
    expect(size, 'char.onnx is empty').toBeGreaterThan(0);
    expect(size, `char.onnx is ${size} bytes, over the 2 MB budget`).toBeLessThan(MAX_MODEL_BYTES);
  });
});

describe('clue_golden.json', () => {
  const golden: Golden = JSON.parse(readFileSync(goldenUrl, 'utf8'));

  it('uses the model classes, in order', () => {
    expect(golden.classes, 'golden classes differ from the model classes').toEqual(CLASSES);
  });

  it(`has exactly ${GOLDEN_COUNT} well-formed entries`, () => {
    expect(golden.entries.length, 'golden entry count').toBe(GOLDEN_COUNT);
    for (const entry of golden.entries) {
      expect(entry.probabilities.length, `${entry.file}: one probability per class`).toBe(CLASSES.length);
      expect(CLASSES, `${entry.file}: class "${entry.class}" is not a model class`).toContain(entry.class);
      expect(entry.expected, `${entry.file}: expected and class disagree`).toBe(entry.class);
      expect(CLASSES, `${entry.file}: argmax "${entry.argmax}" is not a model class`).toContain(entry.argmax);
      const highest = entry.probabilities.indexOf(Math.max(...entry.probabilities));
      expect(entry.argmax, `${entry.file}: argmax is not the highest probability`).toBe(CLASSES[highest]);
    }
  });

  it('has every crop it names, and no others', () => {
    for (const entry of golden.entries) {
      const path = `${cropsDirectory}${entry.file}`;
      expect(existsSync(path), `golden crop ${entry.file} is missing`).toBe(true);
      expect(statSync(path).size, `golden crop ${entry.file} is empty`).toBeGreaterThan(0);
    }
    const pngs = readdirSync(cropsDirectory).filter((name) => name.endsWith('.png'));
    expect(pngs.length, 'PNG count in the golden crops directory').toBe(GOLDEN_COUNT);
  });
});
