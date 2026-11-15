// Clue-crop cleanup: whitens the grid-line remnants a clue crop picks up along
// its edges. The crop starts a small inset past the cell's grid lines, but on a
// photo the lines are thicker than on a render and the corners a few pixels
// off, so a sliver of the left or top line (and, on a wide crop, the next
// line) often lands inside it. Both clue readers decline any crop with ink on
// its border, as a clipped glyph would be misread, so one sliver used to cost
// the whole clue.
//
// A remnant is told from a clipped glyph by shape: it touches the border it
// runs along, spans most of the crop in that direction, and is thin across it.
// Anything else touching the border is left alone for the readers to reject.
import type { OcrImage } from '../types';
import { binarize } from './binarize';

// Spans at least this fraction of the crop's height (vertical) or width (horizontal) ...
const LINE_MIN_SPAN = 0.6;
// ... and is at most this fraction of the crop's smaller side thick.
const LINE_MAX_THICKNESS = 0.15;

const PAPER = 255;

interface Component {
  pixels: number[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// 8-connected ink components, as the readers group them.
function components(ink: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(ink.length);
  const found: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (ink[start] !== 1 || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const component: Component = { pixels: [], x0: width, y0: height, x1: -1, y1: -1 };
    while (stack.length > 0) {
      const index = stack.pop()!;
      component.pixels.push(index);
      const x = index % width;
      const y = (index - x) / width;
      if (x < component.x0) component.x0 = x;
      if (x > component.x1) component.x1 = x;
      if (y < component.y0) component.y0 = y;
      if (y > component.y1) component.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (ink[next] === 1 && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    found.push(component);
  }
  return found;
}

function isLineRemnant(c: Component, width: number, height: number): boolean {
  const w = c.x1 - c.x0 + 1;
  const h = c.y1 - c.y0 + 1;
  const thin = LINE_MAX_THICKNESS * Math.min(width, height);
  const vertical = (c.x0 === 0 || c.x1 === width - 1) && h >= LINE_MIN_SPAN * height && w <= thin;
  const horizontal = (c.y0 === 0 || c.y1 === height - 1) && w >= LINE_MIN_SPAN * width && h <= thin;
  return vertical || horizontal;
}

// Border rows and columns that are mostly ink are a grid line seen edge-on: an
// L of two lines meeting in the crop's corner is one component with no thin
// bounding box, so those are peeled off by coverage first.
function peelLineBands(ink: Uint8Array, width: number, height: number): void {
  const maxBand = Math.ceil(LINE_MAX_THICKNESS * Math.min(width, height));
  const columnInk = (x: number) => {
    let count = 0;
    for (let y = 0; y < height; y++) count += ink[y * width + x] === 1 ? 1 : 0;
    return count;
  };
  const rowInk = (y: number) => {
    let count = 0;
    for (let x = 0; x < width; x++) count += ink[y * width + x] === 1 ? 1 : 0;
    return count;
  };
  const clearColumn = (x: number) => {
    for (let y = 0; y < height; y++) ink[y * width + x] = 2;
  };
  const clearRow = (y: number) => {
    for (let x = 0; x < width; x++) ink[y * width + x] = 2;
  };
  // A band ends at the first column (row) back to mostly paper; one more is
  // taken for the line's anti-aliased edge.
  const peel = (count: number, inkAt: (i: number) => number, span: number, clear: (i: number) => void, from: number, step: number) => {
    let i = from;
    let peeled = 0;
    while (peeled < maxBand && i >= 0 && i < count && inkAt(i) >= LINE_MIN_SPAN * span) {
      clear(i);
      i += step;
      peeled++;
    }
    if (peeled > 0 && i >= 0 && i < count) clear(i);
  };
  peel(width, columnInk, height, clearColumn, 0, 1);
  peel(width, columnInk, height, clearColumn, width - 1, -1);
  peel(height, rowInk, width, clearRow, 0, 1);
  peel(height, rowInk, width, clearRow, height - 1, -1);
}

// A copy of the crop with every line remnant painted paper-white.
export function clearLineRemnants(crop: OcrImage): OcrImage {
  const { width, height } = crop;
  if (width === 0 || height === 0) return crop;
  const { ink } = binarize(crop);
  // 2 marks peeled band pixels: paper from here on, and whitened below.
  peelLineBands(ink, width, height);
  const remaining = Uint8Array.from(ink, (value) => (value === 1 ? 1 : 0));
  const remnants = components(remaining, width, height).filter((c) => isLineRemnant(c, width, height));
  for (const { pixels } of remnants) for (const index of pixels) ink[index] = 2;
  if (!ink.includes(2)) return crop;
  const data = new Uint8ClampedArray(crop.data);
  ink.forEach((value, index) => {
    if (value !== 2) return;
    data[index * 4] = PAPER;
    data[index * 4 + 1] = PAPER;
    data[index * 4 + 2] = PAPER;
  });
  return { width, height, data };
}
