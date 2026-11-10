// Grid reading: finds the grid lines of a flattened board and measures every
// internal edge's stroke width, so cages can be recovered from thick vs thin.
// The flat image's border is the outer frame's centreline, so line i of an
// n x n board sits near i * FLAT_IMAGE_PX / n; we detect the lines rather than
// assume them, because a slightly-off corner estimate shifts every line a little,
// and the number of lines found is how the board size is inferred.
//
// Thick/thin is decided per image, not against a fixed pixel width: stroke
// widths vary with the source resolution, blur and the warp's scale, but within
// one image the two classes stay well separated, so a 1-D 2-means splits them.
import type { OcrImage } from '../types';
import { binarize } from './binarize';
import type { BinarizedImage } from './binarize';

const LINE_COVERAGE_MIN = 0.5; // a column/row is a grid line if >= half of it is ink
const BAND_FROM = 0.2; // internal-edge strip: middle ~60% of the edge
const BAND_TO = 0.8;
const SEARCH_PX = 2; // how far off the detected line to look for the stroke
const MODE_EPS = 1.0; // px; below this spread the widths have a single mode
const FIXED_THICK_RATIO = 0.03; // fallback: thick when width >= ratio * cell pitch

export type EdgeDirection = 'v' | 'h';

// One internal edge. For dir 'v' (a vertical grid line) `col` is the grid-line
// column index 1..n-1 and `row` is the cell row 0..n-1; it separates cells
// (row, col-1) and (row, col). For dir 'h' `row` is the grid-line row index
// 1..n-1 and `col` is the cell column 0..n-1; it separates (row-1, col) and
// (row, col).
export interface EdgeReading {
  row: number;
  col: number;
  dir: EdgeDirection;
  thicknessPx: number;
  isThick: boolean;
}

export interface GridReading {
  boardSize: number;
  lineX: number[]; // boardSize+1 detected vertical grid-line positions, ascending
  lineY: number[]; // boardSize+1 detected horizontal grid-line positions, ascending
  edges: EdgeReading[];
}

// Grid lines are the columns (axis 'x') or rows (axis 'y') that are at least
// half ink: they span the whole board, while clue text never covers that much.
// Each run of such positions is one line, placed at its darkness-weighted
// centroid so a blurred or anti-aliased stroke still lands sub-pixel accurate.
export function locateGridLines(bin: BinarizedImage, width: number, height: number, axis: 'x' | 'y'): number[] {
  const { gray, ink, threshold } = bin;
  const count = axis === 'x' ? width : height;
  const span = axis === 'x' ? height : width;
  const coverage = new Float64Array(count);
  const weight = new Float64Array(count);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (ink[index] !== 1) continue;
      const position = axis === 'x' ? x : y;
      coverage[position]++;
      weight[position] += threshold - gray[index];
    }
  }

  const lines: number[] = [];
  let position = 0;
  while (position < count) {
    if (coverage[position] / span < LINE_COVERAGE_MIN) {
      position++;
      continue;
    }
    const first = position;
    while (position < count && coverage[position] / span >= LINE_COVERAGE_MIN) position++;
    const last = position - 1;
    let sumWeight = 0;
    let sumMoment = 0;
    for (let i = first; i <= last; i++) {
      sumWeight += weight[i];
      sumMoment += weight[i] * (i + 0.5);
    }
    lines.push(sumWeight > 0 ? sumMoment / sumWeight : (first + last + 1) / 2);
  }
  return lines;
}

// The median width of the ink run crossing the line at `position`, sampled
// across [from, to) along the line. Each sample takes the run through the line
// itself (snapping to ink within SEARCH_PX), not any ink nearby, so clue text
// sitting just beside the line cannot inflate the width.
export function measureStrokeWidth(
  ink: Uint8Array,
  width: number,
  height: number,
  dir: EdgeDirection,
  position: number,
  from: number,
  to: number,
): number {
  const along = dir === 'v' ? height : width;
  const across = dir === 'v' ? width : height;
  const isInk = (offset: number, t: number): boolean =>
    offset >= 0 && offset < across && ink[dir === 'v' ? t * width + offset : offset * width + t] === 1;

  const centre = Math.round(position);
  const runs: number[] = [];
  for (let t = Math.ceil(Math.max(0, from)); t < Math.floor(Math.min(along, to)); t++) {
    let start = -1;
    for (let distance = 0; distance <= SEARCH_PX && start < 0; distance++) {
      if (isInk(centre - distance, t)) start = centre - distance;
      else if (isInk(centre + distance, t)) start = centre + distance;
    }
    if (start < 0) continue;
    let lo = start;
    let hi = start;
    while (isInk(lo - 1, t)) lo--;
    while (isInk(hi + 1, t)) hi++;
    runs.push(hi - lo + 1);
  }
  if (runs.length === 0) return NaN;
  runs.sort((a, b) => a - b);
  const middle = runs.length >> 1;
  return runs.length % 2 === 1 ? runs[middle] : (runs[middle - 1] + runs[middle]) / 2;
}

// Lloyd's 2-means on a line, seeded at the extremes. Returns null when the
// values have a single mode (spread under MODE_EPS, or a cluster empties).
function twoMeans(values: readonly number[]): { thin: number; thick: number } | null {
  if (values.length === 0) return null;
  let thin = Math.min(...values);
  let thick = Math.max(...values);
  if (thick - thin < MODE_EPS) return null;
  for (let iteration = 0; iteration < 50; iteration++) {
    let sumThin = 0;
    let countThin = 0;
    let sumThick = 0;
    let countThick = 0;
    for (const value of values) {
      if (Math.abs(value - thin) <= Math.abs(value - thick)) {
        sumThin += value;
        countThin++;
      } else {
        sumThick += value;
        countThick++;
      }
    }
    if (countThin === 0 || countThick === 0) return null;
    const nextThin = sumThin / countThin;
    const nextThick = sumThick / countThick;
    const moved = Math.max(Math.abs(nextThin - thin), Math.abs(nextThick - thick));
    thin = nextThin;
    thick = nextThick;
    if (moved < 1e-6) break;
  }
  return { thin, thick };
}

export function readGrid(flat: OcrImage): GridReading {
  const { width, height } = flat;
  const bin = binarize(flat);
  const foundX = locateGridLines(bin, width, height, 'x');
  const foundY = locateGridLines(bin, width, height, 'y');
  const boardSize = Math.min(foundX.length, foundY.length) - 1;
  if (boardSize < 1) {
    return { boardSize: Math.max(0, boardSize), lineX: foundX, lineY: foundY, edges: [] };
  }
  const lineX = foundX.slice(0, boardSize + 1);
  const lineY = foundY.slice(0, boardSize + 1);

  const edges: EdgeReading[] = [];
  for (let line = 1; line < boardSize; line++) {
    for (let cell = 0; cell < boardSize; cell++) {
      const spanY = lineY[cell + 1] - lineY[cell];
      edges.push({
        row: cell,
        col: line,
        dir: 'v',
        thicknessPx: measureStrokeWidth(bin.ink, width, height, 'v', lineX[line], lineY[cell] + BAND_FROM * spanY, lineY[cell] + BAND_TO * spanY),
        isThick: false,
      });
      const spanX = lineX[cell + 1] - lineX[cell];
      edges.push({
        row: line,
        col: cell,
        dir: 'h',
        thicknessPx: measureStrokeWidth(bin.ink, width, height, 'h', lineY[line], lineX[cell] + BAND_FROM * spanX, lineX[cell] + BAND_TO * spanX),
        isThick: false,
      });
    }
  }

  const widths = edges.map((edge) => edge.thicknessPx).filter(Number.isFinite);
  const modes = twoMeans(widths);
  let threshold: number;
  if (modes === null) {
    const pitch = ((lineX[boardSize] - lineX[0]) / boardSize + (lineY[boardSize] - lineY[0]) / boardSize) / 2;
    threshold = FIXED_THICK_RATIO * pitch;
  } else {
    threshold = (modes.thin + modes.thick) / 2;
  }
  for (const edge of edges) edge.isThick = Number.isFinite(edge.thicknessPx) && edge.thicknessPx >= threshold;

  return { boardSize, lineX, lineY, edges };
}
