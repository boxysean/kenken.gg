import { generate } from '../../play/generator/generate';
import { distort, distortedCorners } from '../render/distort';
import { DEFAULT_SYNTH_STYLE, renderPuzzle } from '../render/synth';
import type { OcrImage, Point, Quad } from '../types';
import { applyHomography, invertHomography, quadCorners, solveHomography } from './geometry';
import { FLAT_IMAGE_PX, warpToBoard } from './warp';

// Byte comparison; toEqual on megabyte typed arrays is very slow.
function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

function isDark(image: OcrImage, x: number, y: number): boolean {
  const offset = (y * image.width + x) * 4;
  return 0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2] < 128;
}

function pixel(image: OcrImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

// The dark run within [from, to] along a row (or a column), as continuous
// coordinates: pixel i covers [i, i + 1).
function darkRun(image: OcrImage, from: number, to: number, at: (t: number) => [number, number]): { start: number; end: number } | null {
  let first = -1;
  let last = -1;
  for (let t = Math.max(0, from); t <= Math.min(FLAT_IMAGE_PX - 1, to); t++) {
    if (!isDark(image, ...at(t))) continue;
    if (first < 0) first = t;
    last = t;
  }
  return first < 0 ? null : { start: first, end: last + 1 };
}

const SEARCH_PX = 6;

describe('warpToBoard', () => {
  describe('grid lines after warping a board by its label corners', () => {
    const cases = [
      { name: 'clean 4x4', boardSize: 4, damage: null },
      { name: 'clean 6x6', boardSize: 6, damage: null },
      { name: 'mildly rotated and skewed 5x5', boardSize: 5, damage: { rotation: 5, perspective: 0.05 } },
    ] as const;

    for (const { name, boardSize, damage } of cases) {
      it(`puts every grid line of a ${name} board at i * ${FLAT_IMAGE_PX} / n within 1 px`, () => {
        const seed = `warp-grid-${boardSize}`;
        const rendered = renderPuzzle(generate(seed, boardSize));
        const { image, corners } =
          damage === null
            ? { image: rendered.image, corners: rendered.label.corners }
            : distort(rendered.image, rendered.label.corners, { seed, tag: 'perspective', ...damage });
        const flat = warpToBoard(image, corners);
        const pitch = FLAT_IMAGE_PX / boardSize;
        // The frame's outer half falls outside the square, so only its inner half is visible.
        const halfFrame = (DEFAULT_SYNTH_STYLE.thickWidth / 2) * (FLAT_IMAGE_PX / (boardSize * DEFAULT_SYNTH_STYLE.cellPitch));

        for (let index = 0; index <= boardSize; index++) {
          const expected = index * pitch;
          for (let cell = 0; cell < boardSize; cell++) {
            // Cross each line low and right in a cell, clear of the clue in its top-left corner.
            const across = Math.floor((cell + 0.8) * pitch);
            const runs = {
              vertical: darkRun(flat, Math.floor(expected) - SEARCH_PX, Math.floor(expected) + SEARCH_PX, (t) => [t, across]),
              horizontal: darkRun(flat, Math.floor(expected) - SEARCH_PX, Math.floor(expected) + SEARCH_PX, (t) => [across, t]),
            };
            for (const [direction, run] of Object.entries(runs)) {
              const where = `${direction} line ${index}, cell ${cell}: ${JSON.stringify(run)}`;
              expect(run, where).not.toBeNull();
              if (run === null) continue;
              if (index === 0) {
                expect(run.start, where).toBe(0);
                expect(Math.abs(run.end - halfFrame), where).toBeLessThanOrEqual(1);
              } else if (index === boardSize) {
                expect(run.end, where).toBe(FLAT_IMAGE_PX);
                expect(Math.abs(run.start - (FLAT_IMAGE_PX - halfFrame)), where).toBeLessThanOrEqual(1);
              } else {
                expect(Math.abs((run.start + run.end) / 2 - expected), where).toBeLessThanOrEqual(1);
              }
            }
          }
        }
      });
    }

    it(`always outputs ${FLAT_IMAGE_PX} x ${FLAT_IMAGE_PX} RGBA with opaque alpha`, () => {
      const rendered = renderPuzzle(generate('warp-alpha', 5));
      const translucent: OcrImage = { ...rendered.image, data: new Uint8ClampedArray(rendered.image.data) };
      for (let offset = 3; offset < translucent.data.length; offset += 4) translucent.data[offset] = 7;
      const flat = warpToBoard(translucent, rendered.label.corners);
      expect(flat.width).toBe(FLAT_IMAGE_PX);
      expect(flat.height).toBe(FLAT_IMAGE_PX);
      expect(flat.data.length).toBe(FLAT_IMAGE_PX * FLAT_IMAGE_PX * 4);
      let opaque = true;
      for (let offset = 3; offset < flat.data.length; offset += 4) opaque &&= flat.data[offset] === 255;
      expect(opaque).toBe(true);
    });
  });

  it('is a byte-for-byte no-op when the quad is the whole 1024 x 1024 image', () => {
    const { image } = renderPuzzle(generate('warp-identity', 4), { cellPitch: 240, margin: 32 });
    expect([image.width, image.height]).toEqual([FLAT_IMAGE_PX, FLAT_IMAGE_PX]);
    const quad: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: FLAT_IMAGE_PX, y: 0 },
      br: { x: FLAT_IMAGE_PX, y: FLAT_IMAGE_PX },
      bl: { x: 0, y: FLAT_IMAGE_PX },
    };
    expect(sameBytes(warpToBoard(image, quad).data, image.data)).toBe(true);
  });

  it('samples white outside the source image', () => {
    const { image } = renderPuzzle(generate('warp-outside', 4));
    const beyond: Quad = { tl: { x: -500, y: -500 }, tr: { x: -400, y: -500 }, br: { x: -400, y: -400 }, bl: { x: -500, y: -400 } };
    const flat = warpToBoard(image, beyond);
    expect(flat.data.every((value) => value === 255)).toBe(true);
  });

  describe('a known-colour blob maps where predicted', () => {
    const RED = [255, 0, 0, 255];
    const BLOB_RADIUS = 4;

    // Paints a disc of pure red centred on `centre`, using pixel centres (x + 0.5, y + 0.5).
    function paintBlob(image: OcrImage, centre: Point): OcrImage {
      const data = new Uint8ClampedArray(image.data);
      for (let y = Math.floor(centre.y - BLOB_RADIUS); y <= Math.ceil(centre.y + BLOB_RADIUS); y++) {
        for (let x = Math.floor(centre.x - BLOB_RADIUS); x <= Math.ceil(centre.x + BLOB_RADIUS); x++) {
          if ((x + 0.5 - centre.x) ** 2 + (y + 0.5 - centre.y) ** 2 > BLOB_RADIUS ** 2) continue;
          data.set(RED, (y * image.width + x) * 4);
        }
      }
      return { width: image.width, height: image.height, data };
    }

    function redCentroid(image: OcrImage): Point | null {
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const [r, g, b] = pixel(image, x, y);
          if (r < 200 || g > 80 || b > 80) continue;
          count++;
          sumX += x + 0.5;
          sumY += y + 0.5;
        }
      }
      return count === 0 ? null : { x: sumX / count, y: sumY / count };
    }

    const rendered = renderPuzzle(generate('warp-blob', 5));
    const { tl, tr, bl } = rendered.label.corners;
    const { cellPitch, margin } = DEFAULT_SYNTH_STYLE;
    // The centre of the cell in row 1, column 2.
    const centre = { x: margin + 2.5 * cellPitch, y: margin + 1.5 * cellPitch };
    const predicted = {
      x: ((centre.x - tl.x) / (tr.x - tl.x)) * FLAT_IMAGE_PX,
      y: ((centre.y - tl.y) / (bl.y - tl.y)) * FLAT_IMAGE_PX,
    };
    const painted = paintBlob(rendered.image, centre);

    const cases = [
      { name: 'clean board', image: painted, corners: rendered.label.corners },
      {
        name: 'rotated, skewed board',
        ...distort(painted, rendered.label.corners, { seed: 'warp-blob', tag: 'perspective', rotation: 6, perspective: 0.06 }),
      },
    ];

    for (const { name, image, corners } of cases) {
      it(`lands within 2 px of the predicted flat coordinate on a ${name}`, () => {
        const flat = warpToBoard(image, corners);
        const found = redCentroid(flat);
        expect(found).not.toBeNull();
        if (found === null) return;
        expect(Math.hypot(found.x - predicted.x, found.y - predicted.y), JSON.stringify({ found, predicted })).toBeLessThanOrEqual(2);
        expect(pixel(flat, Math.floor(predicted.x), Math.floor(predicted.y))).toEqual(RED);
      });
    }
  });

  describe('homography and inverse round-trip', () => {
    const rendered = renderPuzzle(generate('warp-roundtrip', 6));
    const quads: Record<string, Quad> = {
      'axis-aligned': rendered.label.corners,
      rotated: distortedCorners(rendered.image, rendered.label.corners, { seed: 'rt-rot', tag: 'perspective', rotation: 8 }),
      perspective: distortedCorners(rendered.image, rendered.label.corners, {
        seed: 'rt-persp',
        tag: 'perspective',
        rotation: 3,
        perspective: 0.08,
      }),
    };

    for (const [name, quad] of Object.entries(quads)) {
      it(`returns the ${name} quad's corners within 0.5 px`, () => {
        const h = solveHomography(quad);
        const inverse = invertHomography(h);
        for (const corner of quadCorners(quad)) {
          const back = applyHomography(inverse, applyHomography(h, corner));
          expect(Math.hypot(back.x - corner.x, back.y - corner.y)).toBeLessThanOrEqual(0.5);
        }
      });
    }
  });
});
