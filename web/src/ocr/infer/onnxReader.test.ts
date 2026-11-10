// @vitest-environment node
// The ONNX reader end to end on the synthetic samples of clueTemplate.test.ts:
// prepare() classifies through the real model, then read() is checked against
// each crop's expected clue.
import { generate } from '../../play/generator/generate';
import { distort } from '../render/distort';
import type { DistortSpec } from '../render/distort';
import { renderPuzzle } from '../render/synth';
import { deriveCages } from '../pipeline/cages';
import type { ClueCrop } from '../pipeline/cages';
import { scanPhoto } from '../pipeline/run';
import { warpToBoard } from '../pipeline/warp';
import type { OcrImage } from '../types';
import { characterCanvases, isPreparedClueReader, loadClassifier, onnxReaderFrom } from './onnxReader';
import type { PreparedClueReader } from './onnxReader';

const SAMPLES: { name: string; boardSize: number; distortion: Omit<DistortSpec, 'seed'> }[] = [
  { name: 'kenken-4x4-clean', boardSize: 4, distortion: { tag: 'clean' } },
  { name: 'kenken-5x5-clean', boardSize: 5, distortion: { tag: 'clean' } },
  { name: 'kenken-6x6-clean', boardSize: 6, distortion: { tag: 'clean' } },
  { name: 'kenken-4x4-noise', boardSize: 4, distortion: { tag: 'noise', noise: 0.25, blur: 1 } },
  { name: 'kenken-5x5-glare', boardSize: 5, distortion: { tag: 'glare', glare: 0.8 } },
  { name: 'kenken-6x6-perspective', boardSize: 6, distortion: { tag: 'perspective', rotation: 6, perspective: 0.06 } },
];

function cropsOf(sample: (typeof SAMPLES)[number]): ClueCrop[] {
  const puzzle = generate(`synth-export-${sample.boardSize}x${sample.boardSize}`, sample.boardSize);
  const rendered = renderPuzzle(puzzle, { tag: sample.distortion.tag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...sample.distortion, seed: sample.name });
  return deriveCages(warpToBoard(image, corners), rendered.label).clueCrops;
}

// prepare() normally collects crops by running scan(); here the scan just hands
// the reader this sample's crops.
function scanOver(crops: readonly ClueCrop[]): typeof scanPhoto {
  return (_image, reader) => {
    crops.forEach(({ crop }) => reader.read(crop));
    return { lowConfidenceCages: [], errors: [] };
  };
}

const NO_IMAGE: OcrImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) };

let reader: PreparedClueReader;

beforeAll(async () => {
  reader = onnxReaderFrom(await loadClassifier(new URL('../models/char.onnx', import.meta.url)));
});

describe('the ONNX clue reader', () => {
  it('is a prepared reader named onnx', () => {
    expect(isPreparedClueReader(reader)).toBe(true);
    expect(reader.name).toBe('onnx');
  });

  it('declines a crop it was not prepared for rather than guessing', () => {
    const fresh = onnxReaderFrom(() => Promise.reject(new Error('never called')));
    const [{ crop }] = cropsOf(SAMPLES[0]);
    expect(characterCanvases(crop)).not.toBeNull();
    expect(fresh.read(crop)).toBeNull();
  });

  it('never reads a clue wrongly, and reads most of them', async () => {
    let exact = 0;
    let total = 0;
    const wrong: string[] = [];
    for (const sample of SAMPLES) {
      const crops = cropsOf(sample);
      await reader.prepare(NO_IMAGE, scanOver(crops));
      for (const { letter, crop, expected } of crops) {
        total++;
        const result = reader.read(crop);
        if (result === null) continue;
        const operator = result.operator ?? '';
        if (result.target === expected!.target && operator === expected!.operator) exact++;
        else wrong.push(`${sample.name} ${letter}: expected ${expected!.target}${expected!.operator}, got ${result.target}${operator}`);
      }
    }
    console.log(`onnx reader: ${exact}/${total} clues exact, ${wrong.length} wrong`);
    expect(wrong).toEqual([]);
    expect(exact / total).toBeGreaterThanOrEqual(0.9);
  });
});
