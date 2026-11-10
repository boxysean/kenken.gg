// @vitest-environment node
// Inputs are built exactly as in cages.test.ts: the ticket-2 fixtures are
// re-rendered and re-distorted (the repo has no PNG decoder), flattened, and cut
// into clue crops by deriveCages with the label attached, so every crop carries
// its expected clue. Runs under node: jsdom has no canvas and no file URLs.
import labelsJson from '../__fixtures__/labels.json?raw';
import { generate } from '../../play/generator/generate';
import type { PlayPuzzle } from '../../play/types';
import { labelToBoard } from '../labelToBoard';
import { distort } from '../render/distort';
import { renderPuzzle } from '../render/synth';
import type { Clue, OcrImage, OcrLabel } from '../types';
import { deriveCages } from './cages';
import type { ClueCrop } from './cages';
import { readAll } from './clueReader';
import type { CageReading, ClueReading } from './clueReader';
import { CLUE_CONFIDENCE_THRESHOLD, templateClueReader } from './clueTemplate';
import { warpToBoard } from './warp';

const CLEAN = [
  { name: 'kenken-4x4-clean', boardSize: 4, distortion: { tag: 'clean' as const } },
  { name: 'kenken-5x5-clean', boardSize: 5, distortion: { tag: 'clean' as const } },
  { name: 'kenken-6x6-clean', boardSize: 6, distortion: { tag: 'clean' as const } },
];
const DISTORTED = [
  { name: 'kenken-4x4-noise', boardSize: 4, distortion: { tag: 'noise' as const, noise: 0.25, blur: 1 } },
  { name: 'kenken-5x5-glare', boardSize: 5, distortion: { tag: 'glare' as const, glare: 0.8 } },
  { name: 'kenken-6x6-perspective', boardSize: 6, distortion: { tag: 'perspective' as const, rotation: 6, perspective: 0.06 } },
];
const SAMPLES = [...CLEAN, ...DISTORTED];
type Sample = (typeof SAMPLES)[number];

const cropCache = new Map<string, ClueCrop[]>();
function cropsOf(sample: Sample): ClueCrop[] {
  let crops = cropCache.get(sample.name);
  if (crops === undefined) {
    const puzzle = generate(`synth-export-${sample.boardSize}x${sample.boardSize}`, sample.boardSize);
    const rendered = renderPuzzle(puzzle, { tag: sample.distortion.tag });
    const { image, corners } = distort(rendered.image, rendered.label.corners, { ...sample.distortion, seed: sample.name });
    crops = deriveCages(warpToBoard(image, corners), rendered.label).clueCrops;
    cropCache.set(sample.name, crops);
  }
  return crops;
}

function isExact(result: ClueReading | null, expected: Clue): boolean {
  return (
    result !== null &&
    result.target === expected.target &&
    (expected.operator === '' ? result.operator === null : result.operator === expected.operator)
  );
}

function describeReading({ letter, expected, result }: CageReading): string {
  const got = result === null ? 'null' : `${result.target}${result.operator ?? ''} @${result.confidence.toFixed(3)}`;
  return `${letter}: expected ${expected!.target}${expected!.operator}, got ${got}`;
}

function tally(samples: readonly Sample[]): { exact: number; total: number; misses: string[] } {
  let exact = 0;
  let total = 0;
  const misses: string[] = [];
  for (const sample of samples) {
    for (const reading of readAll(cropsOf(sample), templateClueReader)) {
      total++;
      if (isExact(reading.result, reading.expected!)) exact++;
      else misses.push(`${sample.name} ${describeReading(reading)}`);
    }
  }
  return { exact, total, misses };
}

function blank(width: number, height: number): OcrImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

// Deterministic garbage: a 32-bit LCG's high byte as grey per pixel.
function noiseCrop(width: number, height: number, seed: number): OcrImage {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed >>> 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const grey = state >>> 24;
    data[offset] = data[offset + 1] = data[offset + 2] = grey;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

// Paints black rectangles onto a white crop.
function withBoxes(width: number, height: number, boxes: readonly [number, number, number, number][]): OcrImage {
  const image = blank(width, height);
  for (const [x0, y0, w, h] of boxes) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) image.data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return image;
}

describe('templateClueReader', () => {
  it('reports the per-fixture exact counts', () => {
    const counts = SAMPLES.map((sample) => {
      const { exact, total } = tally([sample]);
      return { name: sample.name, exact, total };
    });
    console.log('clue reads per fixture:', JSON.stringify(counts));
    for (const { name, total } of counts) expect(total, name).toBeGreaterThan(0);
  });

  it('reads >= 95% of the clean fixture clues exactly', () => {
    const { exact, total, misses } = tally(CLEAN);
    expect(exact / total, `clean: ${exact}/${total} = ${(exact / total).toFixed(3)}\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.95);
  });

  it('reads >= 85% of the distorted fixture clues exactly', () => {
    const { exact, total, misses } = tally(DISTORTED);
    expect(exact / total, `distorted: ${exact}/${total} = ${(exact / total).toFixed(3)}\n${misses.join('\n')}`).toBeGreaterThanOrEqual(
      0.85,
    );
  });

  it('is right on >= 99% of the reads it is confident about', () => {
    let confident = 0;
    let right = 0;
    const wrong: string[] = [];
    for (const sample of SAMPLES) {
      for (const reading of readAll(cropsOf(sample), templateClueReader)) {
        if (reading.result === null || reading.result.confidence < CLUE_CONFIDENCE_THRESHOLD) continue;
        confident++;
        if (isExact(reading.result, reading.expected!)) right++;
        else wrong.push(`${sample.name} ${describeReading(reading)}`);
      }
    }
    expect(confident).toBeGreaterThan(0);
    expect(right / confident, `${right}/${confident} confident reads exact\n${wrong.join('\n')}`).toBeGreaterThanOrEqual(0.99);
  });

  it('returns confidences within [threshold, 1] for every non-null read', () => {
    for (const sample of SAMPLES) {
      for (const { result } of readAll(cropsOf(sample), templateClueReader)) {
        if (result === null) continue;
        expect(result.confidence).toBeGreaterThanOrEqual(CLUE_CONFIDENCE_THRESHOLD);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  describe('single-cell cages', () => {
    const fixtures = JSON.parse(labelsJson) as { valid: { name: string; label: OcrLabel }[] };

    for (const { name, label } of fixtures.valid) {
      it(`${name}: every clue, and every 1x1 cage as a constant`, () => {
        const conversion = labelToBoard(label);
        const puzzle: PlayPuzzle = {
          ...conversion,
          solution: [],
          difficulty: { cageSizeHistogram: [], singleCellCages: 0, forcedCells: 0 },
          seed: name,
        };
        const rendered = renderPuzzle(puzzle);
        const derived = deriveCages(warpToBoard(rendered.image, rendered.label.corners), label);
        const readings = readAll(derived.clueCrops, templateClueReader);

        const singles = readings.filter(({ expected }) => expected!.operator === '');
        expect(singles.length).toBeGreaterThan(0);
        for (const reading of singles) {
          expect(reading.result, describeReading(reading)).not.toBeNull();
          expect(reading.result!.operator, describeReading(reading)).toBeNull();
          expect(reading.result!.target, describeReading(reading)).toBe(reading.expected!.target);
        }
        for (const reading of readings) {
          if (reading.result !== null) expect(isExact(reading.result, reading.expected!), describeReading(reading)).toBe(true);
        }
      });
    }
  });

  describe('declines unusable crops', () => {
    it('returns null for a blank crop', () => {
      expect(templateClueReader.read(blank(40, 40))).toBeNull();
    });

    it('returns null for an empty crop', () => {
      expect(templateClueReader.read({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
    });

    it('returns null for pseudorandom noise', () => {
      for (const seed of [1, 2, 3, 42, 2024]) expect(templateClueReader.read(noiseCrop(60, 50, seed)), `seed ${seed}`).toBeNull();
    });

    it('returns null for solid blobs that are not glyphs', () => {
      expect(templateClueReader.read(withBoxes(60, 50, [[10, 10, 20, 20]]))).toBeNull();
      expect(templateClueReader.read(withBoxes(60, 50, [[5, 10, 12, 12], [25, 10, 12, 12], [42, 15, 6, 6]]))).toBeNull();
    });

    it('returns null when the text is clipped by the crop border', () => {
      const crop = cropsOf(CLEAN[0])[0].crop;
      expect(templateClueReader.read(crop)).not.toBeNull();
      const { width, height, data } = crop;
      const isDark = (x: number, y: number): boolean => data[(y * width + x) * 4] < 128;
      let left = 0;
      while (!Array.from({ length: height }, (_, y) => isDark(left, y)).some(Boolean)) left++;
      // Cut a few pixels into the first glyph: what is left of it touches the right border.
      const cut = left + 4;
      const clipped = new Uint8ClampedArray(cut * height * 4);
      for (let y = 0; y < height; y++) clipped.set(data.subarray(y * width * 4, (y * width + cut) * 4), y * cut * 4);
      expect(templateClueReader.read({ width: cut, height, data: clipped })).toBeNull();
    });
  });

  it('is deterministic', () => {
    const crop = cropsOf(DISTORTED[0])[0].crop;
    expect(templateClueReader.read(crop)).toEqual(templateClueReader.read(crop));
    const first = SAMPLES.map((sample) => readAll(cropsOf(sample), templateClueReader).map(({ letter, result }) => ({ letter, result })));
    const second = SAMPLES.map((sample) => readAll(cropsOf(sample), templateClueReader).map(({ letter, result }) => ({ letter, result })));
    expect(second).toEqual(first);
  });

  it('readAll preserves crop order, letters and expected clues', () => {
    const crops = cropsOf(CLEAN[1]);
    const readings = readAll(crops, templateClueReader);
    expect(readings.map(({ letter, crop, expected }) => ({ letter, crop, expected }))).toEqual(
      crops.map(({ letter, crop, expected }) => ({ letter, crop, expected })),
    );
  });
});
