import { generate } from '../../play/generator/generate';
import type { PlayPuzzle } from '../../play/types';
import { validateLabel } from '../labelToBoard';
import type { OcrImage } from '../types';
import { ALL_GLYPH_CHARS, GLYPHS, glyphFor } from './glyphs';
import { DEFAULT_SYNTH_STYLE, boardGeometry, clueText, renderClueBitmap, renderPuzzle } from './synth';
import type { Rect } from './synth';

function isInk(image: OcrImage, x: number, y: number): boolean {
  const offset = (y * image.width + x) * 4;
  return image.data[offset] + image.data[offset + 1] + image.data[offset + 2] < 3 * 128;
}

function letterGrid(puzzle: PlayPuzzle): string[][] {
  return puzzle.boardStrings.map((row) => row.split(' '));
}

// Row-major first cell of each cage.
function topLeftCells(puzzle: PlayPuzzle): Map<string, [number, number]> {
  const cells = new Map<string, [number, number]>();
  letterGrid(puzzle).forEach((row, r) =>
    row.forEach((letter, c) => {
      if (!cells.has(letter)) cells.set(letter, [r, c]);
    }),
  );
  return cells;
}

function inRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

describe('glyphs', () => {
  it('are well-formed, inked and distinct', () => {
    const seen = new Set<string>();
    for (const char of ALL_GLYPH_CHARS) {
      const glyph = GLYPHS[char];
      expect(glyph.rows).toHaveLength(glyph.height);
      for (const row of glyph.rows) expect(row).toMatch(new RegExp(`^[#.]{${glyph.width}}$`));
      expect(glyph.rows.join('')).toContain('#');
      seen.add(glyph.rows.join('\n'));
    }
    expect(seen.size).toBe(ALL_GLYPH_CHARS.length);
    expect(() => glyphFor('*')).toThrow();
  });
});

describe('renderPuzzle', () => {
  it('is deterministic', () => {
    const puzzle = generate('synth-determinism', 5);
    const first = renderPuzzle(puzzle);
    const second = renderPuzzle(generate('synth-determinism', 5));
    // Byte comparison; toEqual on megabyte typed arrays is very slow.
    const bytes = (data: Uint8ClampedArray) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    expect(bytes(second.image.data).equals(bytes(first.image.data))).toBe(true);
    expect(second.label).toEqual(first.label);
  });

  it('produces a plain RGBA buffer without any canvas', () => {
    const { image } = renderPuzzle(generate('synth-buffer', 4));
    expect(image.data).toBeInstanceOf(Uint8ClampedArray);
    expect(image.data.length).toBe(image.width * image.height * 4);
    for (let offset = 3; offset < image.data.length; offset += 4) {
      if (image.data[offset] !== 255) throw new Error(`alpha ${image.data[offset]} at ${offset}`);
    }
  });

  it.each([4, 6])('draws every grid line where the geometry says (boardSize %i)', (boardSize) => {
    const puzzle = generate(`synth-grid-${boardSize}`, boardSize);
    const { image } = renderPuzzle(puzzle);
    const geometry = boardGeometry(boardSize, DEFAULT_SYNTH_STYLE);
    const letters = letterGrid(puzzle);
    const widthOf = (isCage: boolean): number => (isCage ? DEFAULT_SYNTH_STYLE.thickWidth : DEFAULT_SYNTH_STYLE.thinWidth);
    for (let index = 0; index <= boardSize; index++) {
      for (let cell = 0; cell < boardSize; cell++) {
        // Vertical line `index`, probed halfway down cell row `cell`.
        const x = geometry.gridLineX(index);
        const y = geometry.gridLineY(cell) + geometry.cellPitch / 2;
        const vWidth = widthOf(index === 0 || index === boardSize || letters[cell][index - 1] !== letters[cell][index]);
        const vStart = x - Math.floor(vWidth / 2);
        expect(isInk(image, x, y) || isInk(image, x - 1, y) || isInk(image, x + 1, y)).toBe(true);
        expect(isInk(image, vStart - 1, y)).toBe(false);
        expect(isInk(image, vStart + vWidth, y)).toBe(false);

        // Horizontal line `index`, probed halfway across cell column `cell`.
        const hx = geometry.gridLineX(cell) + geometry.cellPitch / 2;
        const hy = geometry.gridLineY(index);
        const hWidth = widthOf(index === 0 || index === boardSize || letters[index - 1][cell] !== letters[index][cell]);
        const hStart = hy - Math.floor(hWidth / 2);
        expect(isInk(image, hx, hy) || isInk(image, hx, hy - 1) || isInk(image, hx, hy + 1)).toBe(true);
        expect(isInk(image, hx, hStart - 1)).toBe(false);
        expect(isInk(image, hx, hStart + hWidth)).toBe(false);
      }
    }
  });

  it('labels the exact board corners', () => {
    for (const boardSize of [4, 5, 6]) {
      const { label } = renderPuzzle(generate(`synth-corners-${boardSize}`, boardSize));
      expect(label.corners).toEqual(boardGeometry(boardSize, DEFAULT_SYNTH_STYLE).corners);
    }
  });

  it('emits a valid label matching the puzzle', () => {
    for (const boardSize of [4, 5, 6]) {
      for (const seed of ['alpha', 'beta', 'gamma']) {
        const puzzle = generate(`synth-label-${seed}`, boardSize);
        const { label } = renderPuzzle(puzzle, { tag: 'test-style' });
        expect(validateLabel(label)).toEqual([]);
        expect(label.boardSize).toBe(boardSize);
        expect(label.cageLetters).toEqual(puzzle.boardStrings);
        expect(label.source).toEqual({ kind: 'synthetic', seed: puzzle.seed, styleTag: 'test-style' });
        const tokens = Object.entries(label.clues).map(([letter, clue]) => `${letter}=${clue.target}${clue.operator}`);
        expect(tokens.sort()).toEqual(puzzle.constraintString.split(' ').sort());
      }
    }
  });

  it('keeps all clue ink inside the clue region of each cage’s top-left cell', () => {
    for (const [boardSize, style] of [
      [4, {}],
      [6, {}],
      [6, { cellPitch: 40, margin: 8 }], // small cells force down-scaled clues
    ] as const) {
      const puzzle = generate(`synth-clue-region-${boardSize}`, boardSize);
      const { image } = renderPuzzle(puzzle, style);
      const geometry = boardGeometry(boardSize, { ...DEFAULT_SYNTH_STYLE, ...style });
      const clueCells = [...topLeftCells(puzzle).values()].map(([r, c]) => `${r},${c}`);
      for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
          const cell = geometry.cellRect(r, c);
          const region = geometry.clueRegion(r, c);
          const hasClue = clueCells.includes(`${r},${c}`);
          let inkInRegion = 0;
          for (let y = cell.y; y < cell.y + cell.height; y++) {
            for (let x = cell.x; x < cell.x + cell.width; x++) {
              if (!isInk(image, x, y)) continue;
              if (!hasClue || !inRect(region, x, y)) throw new Error(`stray ink at (${x}, ${y}) in cell ${r},${c}`);
              inkInRegion++;
            }
          }
          expect(inkInRegion > 0).toBe(hasClue);
        }
      }
    }
  });

  it('draws no operator glyph for a single-cell cage', () => {
    // Generated puzzles rarely have single-cell cages, so this one is hand-made.
    // Cage 'h' is the single cell at row 1, column 1. Only the drawing is under test, so the targets need not be solvable.
    const puzzle: PlayPuzzle = {
      ...generate('synth-single-cell', 4),
      boardStrings: ['a b b c', 'a h c c', 'e d f f', 'e d g g'],
      constraintString: 'a=3+ b=7+ c=6x h=5 d=2/ e=4+ f=6x g=3+',
    };
    expect(clueText({ target: 5, operator: '' })).toBe('5');

    const { image, label } = renderPuzzle(puzzle);
    expect(label.clues.h).toEqual({ target: 5, operator: '' });
    const geometry = boardGeometry(4, DEFAULT_SYNTH_STYLE);
    const region = geometry.clueRegion(1, 1);

    // The ink in the region, cropped to its bounding box, is exactly the bitmap for "5".
    const ink: [number, number][] = [];
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) if (isInk(image, x, y)) ink.push([x, y]);
    }
    const minX = Math.min(...ink.map(([x]) => x));
    const minY = Math.min(...ink.map(([, y]) => y));
    const bitmap = renderClueBitmap('5', region.width, region.height, DEFAULT_SYNTH_STYLE.cellPitch);
    const bitmapInk: [number, number][] = [];
    for (let y = 0; y < bitmap.height; y++) {
      for (let x = 0; x < bitmap.width; x++) if (bitmap.ink[y * bitmap.width + x] === 1) bitmapInk.push([x, y]);
    }
    const bitmapMinX = Math.min(...bitmapInk.map(([x]) => x));
    const bitmapMinY = Math.min(...bitmapInk.map(([, y]) => y));
    expect(ink.map(([x, y]) => [x - minX, y - minY])).toEqual(bitmapInk.map(([x, y]) => [x - bitmapMinX, y - bitmapMinY]));
    const withOperator = renderClueBitmap('5+', region.width, region.height, DEFAULT_SYNTH_STYLE.cellPitch);
    expect(withOperator.ink.reduce((a, b) => a + b, 0)).toBeGreaterThan(bitmapInk.length);
  });

  it('throws when a cage has no constraint', () => {
    const puzzle = generate('synth-missing', 4);
    const constraintString = puzzle.constraintString.split(' ').slice(1).join(' ');
    expect(() => renderPuzzle({ ...puzzle, constraintString })).toThrow(/has no constraint/);
  });
});
