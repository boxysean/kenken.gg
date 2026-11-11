// Synthetic KenKen renderer: draws a PlayPuzzle into a raw RGBA buffer and
// emits the exactly-correct OCR label for it. No canvas and no randomness, so
// the same puzzle and style always produce byte-identical output.
import type { Operator } from '../../solver/Operator';
import type { PlayPuzzle } from '../../play/types';
import type { Clue, OcrImage, PhotoLabel, Quad } from '../types';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphFor } from './glyphs';

export type Rgba = readonly [number, number, number, number];

export interface SynthStyle {
  readonly cellPitch: number;
  readonly margin: number;
  readonly thickWidth: number;
  readonly thinWidth: number;
  readonly ink: Rgba;
  readonly paper: Rgba;
  readonly tag: string;
}

export const DEFAULT_SYNTH_STYLE: SynthStyle = {
  cellPitch: 96,
  margin: 24,
  thickWidth: 4,
  thinWidth: 2,
  ink: [0, 0, 0, 255],
  paper: [255, 255, 255, 255],
  tag: 'clean',
};

// Clue glyphs at this pitch are drawn at 1x; larger pitches scale up by whole factors.
const PITCH_PER_GLYPH_SCALE = 48;
const CLUE_REGION_WIDTH = 0.7;
const CLUE_REGION_HEIGHT = 0.55;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardGeometry {
  readonly width: number;
  readonly height: number;
  readonly cellPitch: number;
  readonly margin: number;
  readonly corners: Quad;
  // The cell's interior: the pixels no grid line of any width can touch.
  cellRect(row: number, column: number): Rect;
  clueRegion(row: number, column: number): Rect;
  gridLineX(index: number): number;
  gridLineY(index: number): number;
}

// A line of width w at position p covers pixels [p - floor(w/2), p - floor(w/2) + w).
function lineStart(position: number, width: number): number {
  return position - Math.floor(width / 2);
}

export function boardGeometry(boardSize: number, style: SynthStyle): BoardGeometry {
  const { cellPitch, margin, thickWidth, thinWidth } = style;
  if (!Number.isInteger(boardSize) || boardSize < 1) throw new Error(`boardGeometry: bad boardSize ${boardSize}`);
  for (const [name, value] of Object.entries({ cellPitch, margin, thickWidth, thinWidth })) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`boardGeometry: ${name} must be a positive integer, got ${value}`);
  }
  if (thinWidth > thickWidth) throw new Error('boardGeometry: thinWidth must not exceed thickWidth');
  if (margin < thickWidth) throw new Error('boardGeometry: margin must be at least thickWidth');
  if (cellPitch < thickWidth + 8) throw new Error('boardGeometry: cellPitch too small for thickWidth');

  const size = 2 * margin + boardSize * cellPitch;
  const gridLine = (index: number): number => margin + index * cellPitch;
  const interiorStart = lineStart(0, thickWidth) + thickWidth; // offset past a thick line
  const interiorSize = cellPitch - thickWidth;
  const cellRect = (row: number, column: number): Rect => ({
    x: gridLine(column) + interiorStart,
    y: gridLine(row) + interiorStart,
    width: interiorSize,
    height: interiorSize,
  });
  const edge = boardSize * cellPitch;
  return {
    width: size,
    height: size,
    cellPitch,
    margin,
    corners: {
      tl: { x: margin, y: margin },
      tr: { x: margin + edge, y: margin },
      br: { x: margin + edge, y: margin + edge },
      bl: { x: margin, y: margin + edge },
    },
    cellRect,
    clueRegion(row, column) {
      const cell = cellRect(row, column);
      return {
        x: cell.x + 1,
        y: cell.y + 1,
        width: Math.round(cell.width * CLUE_REGION_WIDTH),
        height: Math.round(cell.height * CLUE_REGION_HEIGHT),
      };
    },
    gridLineX: gridLine,
    gridLineY: gridLine,
  };
}

// The characters drawn for a clue: the target, then the operator unless it is a constant.
export function clueText(clue: Clue): string {
  return `${clue.target}${clue.operator}`;
}

export interface ClueBitmap {
  width: number;
  height: number;
  ink: Uint8Array; // 1 = ink, row-major
}

// Lays a clue's glyphs side by side, scaled by a whole factor so it fits
// maxWidth x maxHeight: up by up to floor(cellPitch / 48), or, if even 1x is
// too big, down by the smallest whole factor that fits (nearest neighbour).
export function renderClueBitmap(text: string, maxWidth: number, maxHeight: number, cellPitch: number): ClueBitmap {
  const glyphs = [...text].map(glyphFor);
  const naturalWidth = glyphs.length * GLYPH_WIDTH;
  const naturalHeight = GLYPH_HEIGHT;
  const naturalInk = (x: number, y: number): boolean => glyphs[Math.floor(x / GLYPH_WIDTH)].rows[y][x % GLYPH_WIDTH] === '#';

  let up = Math.max(1, Math.floor(cellPitch / PITCH_PER_GLYPH_SCALE));
  while (up > 1 && (naturalWidth * up > maxWidth || naturalHeight * up > maxHeight)) up--;
  const down = Math.max(1, Math.ceil(naturalWidth / maxWidth), Math.ceil(naturalHeight / maxHeight));

  const width = down > 1 ? Math.ceil(naturalWidth / down) : naturalWidth * up;
  const height = down > 1 ? Math.ceil(naturalHeight / down) : naturalHeight * up;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = down > 1 ? x * down : Math.floor(x / up);
      const sy = down > 1 ? y * down : Math.floor(y / up);
      ink[y * width + x] = naturalInk(sx, sy) ? 1 : 0;
    }
  }
  return { width, height, ink };
}

const CONSTRAINT_TOKEN = /^(.)=([0-9]+)([+\-x/]?)$/;

function parseClues(constraintString: string): Record<string, Clue> {
  const clues: Record<string, Clue> = {};
  for (const token of constraintString.split(/\s+/).filter((t) => t !== '')) {
    const match = CONSTRAINT_TOKEN.exec(token);
    if (match === null) throw new Error(`renderPuzzle: cannot parse constraint token ${JSON.stringify(token)}`);
    clues[match[1]] = { target: Number(match[2]), operator: match[3] as Operator };
  }
  return clues;
}

function blendInto(image: OcrImage, x: number, y: number, color: Rgba): void {
  const offset = (y * image.width + x) * 4;
  const alpha = color[3] / 255;
  for (let channel = 0; channel < 3; channel++) {
    image.data[offset + channel] = color[channel] * alpha + image.data[offset + channel] * (1 - alpha);
  }
  image.data[offset + 3] = 255;
}

function fillRect(image: OcrImage, x: number, y: number, width: number, height: number, color: Rgba): void {
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) blendInto(image, column, row, color);
  }
}

export function renderPuzzle(puzzle: PlayPuzzle, style: Partial<SynthStyle> = {}): { image: OcrImage; label: PhotoLabel } {
  const merged: SynthStyle = { ...DEFAULT_SYNTH_STYLE, ...style };
  const n = puzzle.boardSize;
  const letters = puzzle.boardStrings.map((row) => row.split(' '));
  if (letters.length !== n || letters.some((row) => row.length !== n)) {
    throw new Error(`renderPuzzle: boardStrings do not form a ${n}x${n} board`);
  }
  const clues = parseClues(puzzle.constraintString);
  for (const row of letters) {
    for (const letter of row) {
      if (clues[letter] === undefined) throw new Error(`renderPuzzle: cage ${JSON.stringify(letter)} has no constraint`);
    }
  }

  const geometry = boardGeometry(n, merged);
  const image: OcrImage = {
    width: geometry.width,
    height: geometry.height,
    data: new Uint8ClampedArray(geometry.width * geometry.height * 4),
  };
  const paper: Rgba = [merged.paper[0], merged.paper[1], merged.paper[2], 255];
  fillRect(image, 0, 0, image.width, image.height, paper);

  const letterAt = (row: number, column: number): string | undefined => letters[row]?.[column];
  // Vertical segment `index` beside cell row `row`, and horizontal segment `index` above cell column `column`.
  const verticalIsCage = (index: number, row: number): boolean =>
    index === 0 || index === n || letterAt(row, index - 1) !== letterAt(row, index);
  const horizontalIsCage = (index: number, column: number): boolean =>
    index === 0 || index === n || letterAt(index - 1, column) !== letterAt(index, column);

  // Each segment runs one pitch, extended by half a thick line at both ends so
  // corners and junctions are filled solid.
  const pitch = merged.cellPitch;
  const drawPass = (width: number, include: (isCage: boolean) => boolean): void => {
    const extend = lineStart(0, merged.thickWidth);
    for (let index = 0; index <= n; index++) {
      for (let cell = 0; cell < n; cell++) {
        if (include(verticalIsCage(index, cell))) {
          const x = lineStart(geometry.gridLineX(index), width);
          const y = geometry.gridLineY(cell) + extend;
          fillRect(image, x, y, width, pitch + merged.thickWidth, merged.ink);
        }
        if (include(horizontalIsCage(index, cell))) {
          const x = geometry.gridLineX(cell) + extend;
          const y = lineStart(geometry.gridLineY(index), width);
          fillRect(image, x, y, pitch + merged.thickWidth, width, merged.ink);
        }
      }
    }
  };
  drawPass(merged.thinWidth, () => true);
  drawPass(merged.thickWidth, (isCage) => isCage);

  // Clues, centred in the clue region of each cage's first cell in reading order.
  const drawn = new Set<string>();
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      const letter = letters[row][column];
      if (drawn.has(letter)) continue;
      drawn.add(letter);
      const region = geometry.clueRegion(row, column);
      const bitmap = renderClueBitmap(clueText(clues[letter]), region.width, region.height, pitch);
      const left = region.x + Math.floor((region.width - bitmap.width) / 2);
      const top = region.y + Math.floor((region.height - bitmap.height) / 2);
      for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
          if (bitmap.ink[y * bitmap.width + x] === 1) blendInto(image, left + x, top + y, merged.ink);
        }
      }
    }
  }

  const { corners } = geometry;
  const label: PhotoLabel = {
    boardSize: n,
    cageLetters: [...puzzle.boardStrings],
    clues,
    corners: {
      tl: { ...corners.tl },
      tr: { ...corners.tr },
      br: { ...corners.br },
      bl: { ...corners.bl },
    },
    source: { kind: 'synthetic', seed: puzzle.seed, styleTag: merged.tag },
  };
  return { image, label };
}
