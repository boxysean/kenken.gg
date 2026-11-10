// @vitest-environment node
// The ticket-2 fixture PNGs are re-rendered rather than decoded (the repo has
// no PNG decoder): the renderer and distort are deterministic, so the bytes are
// those of the committed files, and the corners are checked against each label.
// Runs under node, not jsdom: jsdom's import.meta.url is not a file URL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../../play/generator/generate';
import { distort } from '../render/distort';
import { renderPuzzle } from '../render/synth';
import type { OcrImage, OcrLabel } from '../types';
import { measureStrokeWidth, readGrid } from './grid';
import type { EdgeReading } from './grid';
import { warpToBoard } from './warp';

const FIXTURES = fileURLToPath(new URL('../../../e2e/__fixtures__/raw-samples/', import.meta.url));

const SAMPLES = [
  { name: 'kenken-4x4-clean', boardSize: 4, distortion: { tag: 'clean' as const } },
  { name: 'kenken-5x5-clean', boardSize: 5, distortion: { tag: 'clean' as const } },
  { name: 'kenken-6x6-clean', boardSize: 6, distortion: { tag: 'clean' as const } },
  { name: 'kenken-4x4-noise', boardSize: 4, distortion: { tag: 'noise' as const, noise: 0.25, blur: 1 } },
  { name: 'kenken-5x5-glare', boardSize: 5, distortion: { tag: 'glare' as const, glare: 0.8 } },
  { name: 'kenken-6x6-perspective', boardSize: 6, distortion: { tag: 'perspective' as const, rotation: 6, perspective: 0.06 } },
];

function loadFixture(sample: (typeof SAMPLES)[number]): { flat: OcrImage; label: OcrLabel } {
  const puzzle = generate(`synth-export-${sample.boardSize}x${sample.boardSize}`, sample.boardSize);
  const rendered = renderPuzzle(puzzle, { tag: sample.distortion.tag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...sample.distortion, seed: sample.name });
  const label: OcrLabel = JSON.parse(readFileSync(`${FIXTURES}${sample.name}.json`, 'utf8'));
  // The reconstruction must be the committed fixture: corners match the label's.
  for (const key of ['tl', 'tr', 'br', 'bl'] as const) {
    expect(Math.hypot(corners[key].x - label.corners[key].x, corners[key].y - label.corners[key].y)).toBeLessThan(1e-6);
  }
  return { flat: warpToBoard(image, corners), label };
}

// The label's answer for an edge: a cage wall when the letters either side differ.
function isCageWall(label: OcrLabel, edge: EdgeReading): boolean {
  const letters = label.cageLetters.map((row) => row.split(' '));
  return edge.dir === 'v'
    ? letters[edge.row][edge.col - 1] !== letters[edge.row][edge.col]
    : letters[edge.row - 1][edge.col] !== letters[edge.row][edge.col];
}

describe('readGrid', () => {
  for (const sample of SAMPLES) {
    it(`infers the board size of ${sample.name}`, () => {
      const { flat, label } = loadFixture(sample);
      const grid = readGrid(flat);
      expect(grid.boardSize).toBe(label.boardSize);
      expect(grid.lineX).toHaveLength(grid.boardSize + 1);
      expect(grid.lineY).toHaveLength(grid.boardSize + 1);
    });
  }

  it('measures widths that separate into a thin and a thick class matching the cage walls', () => {
    const { flat, label } = loadFixture(SAMPLES[2]);
    const { edges } = readGrid(flat);
    const thick = edges.filter((edge) => edge.isThick).map((edge) => edge.thicknessPx);
    const thin = edges.filter((edge) => !edge.isThick).map((edge) => edge.thicknessPx);
    expect(edges.every((edge) => Number.isFinite(edge.thicknessPx))).toBe(true);
    // Two clusters: both occupied, and every thick width beyond every thin one.
    expect(thick.length).toBeGreaterThan(0);
    expect(thin.length).toBeGreaterThan(0);
    expect(Math.min(...thick)).toBeGreaterThan(Math.max(...thin));
    expect(thick.length).toBe(edges.filter((edge) => isCageWall(label, edge)).length);
  });
});

describe('measureStrokeWidth', () => {
  const SIZE = 128;

  // A solid strip of `width` px starting at `start` across the whole mask.
  function strip(dir: 'v' | 'h', start: number, width: number): Uint8Array {
    const ink = new Uint8Array(SIZE * SIZE);
    for (let t = 0; t < SIZE; t++) {
      for (let offset = start; offset < start + width; offset++) {
        ink[dir === 'v' ? t * SIZE + offset : offset * SIZE + t] = 1;
      }
    }
    return ink;
  }

  for (const width of [2, 3, 4, 6, 8]) {
    for (const dir of ['v', 'h'] as const) {
      it(`reads a ${width} px ${dir === 'v' ? 'vertical' : 'horizontal'} strip`, () => {
        const start = 60;
        const centre = start + width / 2;
        const measured = measureStrokeWidth(strip(dir, start, width), SIZE, SIZE, dir, centre, 20, 100);
        expect(Math.abs(measured - width)).toBeLessThanOrEqual(0.5);
      });
    }
  }

  it('reads a strip whose centre is at a half-pixel offset', () => {
    // A 3 px strip over pixels 40..42 has its centre at 41.5.
    const measured = measureStrokeWidth(strip('v', 40, 3), SIZE, SIZE, 'v', 41.5, 0, SIZE);
    expect(Math.abs(measured - 3)).toBeLessThanOrEqual(0.5);
  });

  it('returns NaN when no stroke is near the line', () => {
    expect(measureStrokeWidth(strip('v', 10, 4), SIZE, SIZE, 'v', 80, 0, SIZE)).toBeNaN();
  });
});
