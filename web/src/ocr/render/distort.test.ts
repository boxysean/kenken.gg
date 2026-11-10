import { generate } from '../../play/generator/generate';
import type { OcrImage, Point, Quad } from '../types';
import { distort, distortedCorners } from './distort';
import type { DistortSpec } from './distort';
import { DEFAULT_SYNTH_STYLE, boardGeometry, renderPuzzle } from './synth';

const puzzle = generate('distort-fixture', 5);
const clean = renderPuzzle(puzzle);
const geometry = boardGeometry(puzzle.boardSize, DEFAULT_SYNTH_STYLE);

// Byte comparison; toEqual on megabyte typed arrays is very slow.
function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

function luminance(image: OcrImage, x: number, y: number): number {
  const offset = (y * image.width + x) * 4;
  return 0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2];
}

// Fraction of pixels in the given rects that a fixed 128 threshold classifies
// the same way as the clean render, split by what the clean pixel was.
function thresholdAccuracy(image: OcrImage, rects: { x: number; y: number; width: number; height: number }[]) {
  let ink = 0;
  let inkCorrect = 0;
  let paper = 0;
  let paperCorrect = 0;
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const dark = luminance(image, x, y) < 128;
        if (luminance(clean.image, x, y) < 128) {
          ink++;
          if (dark) inkCorrect++;
        } else {
          paper++;
          if (!dark) paperCorrect++;
        }
      }
    }
  }
  return { ink: inkCorrect / ink, paper: paperCorrect / paper };
}

const clueRegions = (() => {
  const seen = new Set<string>();
  const regions = [];
  const letters = puzzle.boardStrings.map((row) => row.split(' '));
  for (let r = 0; r < puzzle.boardSize; r++) {
    for (let c = 0; c < puzzle.boardSize; c++) {
      if (seen.has(letters[r][c])) continue;
      seen.add(letters[r][c]);
      regions.push(geometry.clueRegion(r, c));
    }
  }
  return regions;
})();

function run(spec: DistortSpec) {
  return distort(clean.image, clean.label.corners, spec);
}

function quadCentre(quad: Quad): Point {
  // Intersection of the diagonals tl-br and tr-bl.
  const { tl, tr, br, bl } = quad;
  const d1 = { x: br.x - tl.x, y: br.y - tl.y };
  const d2 = { x: bl.x - tr.x, y: bl.y - tr.y };
  const t = ((tr.x - tl.x) * d2.y - (tr.y - tl.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
  return { x: tl.x + t * d1.x, y: tl.y + t * d1.y };
}

describe('distort', () => {
  const heavy: DistortSpec = { seed: 'heavy', tag: 'perspective', rotation: 8, perspective: 0.08, glare: 0.6, noise: 0.3, blur: 1 };

  it('is deterministic for a seed and spec', () => {
    const first = run(heavy);
    const second = run(heavy);
    expect(sameBytes(second.image.data, first.image.data)).toBe(true);
    expect(second.corners).toEqual(first.corners);
  });

  it('differs between seeds', () => {
    const first = run(heavy);
    const second = run({ ...heavy, seed: 'other' });
    expect(sameBytes(second.image.data, first.image.data)).toBe(false);
  });

  it('leaves a clean spec untouched', () => {
    const result = run({ seed: 'anything', tag: 'clean' });
    expect(result.image.width).toBe(clean.image.width);
    expect(result.image.height).toBe(clean.image.height);
    expect(sameBytes(result.image.data, clean.image.data)).toBe(true);
    expect(result.corners).toEqual(clean.label.corners);
  });

  it('keeps geometry for photometric-only specs', () => {
    const result = run({ seed: 'photo', tag: 'noise', noise: 0.2 });
    expect([result.image.width, result.image.height]).toEqual([clean.image.width, clean.image.height]);
    expect(result.corners).toEqual(clean.label.corners);
    expect(distortedCorners(clean.image, clean.label.corners, { seed: 'photo', tag: 'noise', noise: 0.2 })).toEqual(clean.label.corners);
  });

  it.each([
    ['rotation', { rotation: 10 }],
    ['perspective', { perspective: 0.1 }],
    ['both', { rotation: 6, perspective: 0.06, noise: 0.2 }],
  ])('carries the same corners distortedCorners computes (%s)', (_, options) => {
    for (const seed of ['one', 'two', 'three']) {
      const spec: DistortSpec = { seed, tag: 'perspective', ...options };
      const result = run(spec);
      expect(distortedCorners(clean.image, clean.label.corners, spec)).toEqual(result.corners);

      // The board stays roughly centred, as it was in the clean render.
      const centre = quadCentre(result.corners);
      const edge = puzzle.boardSize * DEFAULT_SYNTH_STYLE.cellPitch;
      expect(Math.abs(centre.x - result.image.width / 2)).toBeLessThan(0.15 * edge);
      expect(Math.abs(centre.y - result.image.height / 2)).toBeLessThan(0.15 * edge);

      // Every corner is inside the output image, and there is ink at each corner.
      for (const corner of [result.corners.tl, result.corners.tr, result.corners.br, result.corners.bl]) {
        expect(corner.x).toBeGreaterThan(0);
        expect(corner.y).toBeGreaterThan(0);
        expect(corner.x).toBeLessThan(result.image.width);
        expect(corner.y).toBeLessThan(result.image.height);
        expect(luminance(result.image, Math.floor(corner.x), Math.floor(corner.y))).toBeLessThan(128);
      }
    }
  });

  it('preserves the tl/tr/br/bl corner ordering', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const { corners } = run({ seed, tag: 'perspective', rotation: 10, perspective: 0.1 });
      // Clockwise in image coordinates (y down): positive signed area.
      const points = [corners.tl, corners.tr, corners.br, corners.bl];
      let area = 0;
      for (let index = 0; index < 4; index++) {
        const p = points[index];
        const q = points[(index + 1) % 4];
        area += p.x * q.y - q.x * p.y;
      }
      expect(area).toBeGreaterThan(0);
      expect(corners.tl.x + corners.tl.y).toBeLessThan(corners.br.x + corners.br.y);
      expect(corners.tr.x - corners.tr.y).toBeGreaterThan(corners.bl.x - corners.bl.y);
    }
  });

  it.each([
    ['glare', { glare: 1 }, 1],
    ['light noise', { noise: 0.25 }, 0.999],
    ['heavy noise', { noise: 0.5 }, 0.95],
    ['glare and light noise', { glare: 0.6, noise: 0.15 }, 0.99],
  ])('stays binarizable at threshold 128 (%s)', (_, options, accuracy) => {
    for (const seed of ['x', 'y']) {
      const { image } = run({ seed, tag: 'noise', ...options });
      let below = 0;
      let above = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (luminance(image, x, y) < 128) below++;
          else above++;
        }
      }
      expect(below).toBeGreaterThan(0);
      expect(above).toBeGreaterThan(below);
      const result = thresholdAccuracy(image, clueRegions);
      expect(result.ink).toBeGreaterThanOrEqual(accuracy);
      expect(result.paper).toBeGreaterThanOrEqual(accuracy);
    }
  });
});
