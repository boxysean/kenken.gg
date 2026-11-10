// Zero-ML clue reader: segments the crop's ink into connected components, then
// matches each one against the renderer's own glyph templates (ticket 2) by
// normalised cross-correlation. Both sides are resampled from their ink
// bounding box into the same fit-and-centred 16x16 canvas, so the comparison is
// independent of the glyph's scale in the crop but keeps its aspect ratio (a
// '1', a '-' and an 'x' differ mostly in shape of the box).
import { ALL_GLYPH_CHARS, GLYPHS } from '../render/glyphs';
import type { GlyphChar } from '../render/glyphs';
import type { Operator } from '../../solver/Operator';
import type { OcrImage } from '../types';
import { binarize } from './binarize';
import type { ClueReader, ClueReading } from './clueReader';

const CANVAS = 16;

// A component is a speck (noise, not a glyph) when the longer side of its ink
// bbox is under this fraction of the tallest component's height. The smallest
// real glyph extent is the '-' (10 of 12 template px wide) and the narrow '1'
// is still 12 tall, so every glyph's longer side is >= 0.8 of the clue height.
const SPECK_FRACTION = 0.4;

// Scale variants: the component bbox is padded by this fraction of its size on
// every side before resampling, absorbing a pixel or two of blur/threshold bloat.
const PAD_VARIANTS: readonly number[] = [0, 0.04, 0.08];

// See confidence() below. Reads with confidence under this are returned as null.
export const CLUE_CONFIDENCE_THRESHOLD = 0.5;

const OPERATOR_CHARS: ReadonlySet<GlyphChar> = new Set<GlyphChar>(['+', '-', 'x', '/']);

interface Box {
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number; // inclusive
}

interface Component {
  box: Box;
  pixels: number[]; // indices into the mask
}

// A binary mask with its own dimensions; templates and crops share this shape.
interface Mask {
  width: number;
  height: number;
  ink: Uint8Array;
}

// 8-connected components, discovered in row-major scan order (deterministic).
function components(mask: Mask): Component[] {
  const { width, height, ink } = mask;
  const seen = new Uint8Array(ink.length);
  const found: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (ink[start] !== 1 || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const pixels: number[] = [];
    const box: Box = { x0: width, y0: height, x1: -1, y1: -1 };
    while (stack.length > 0) {
      const index = stack.pop()!;
      pixels.push(index);
      const x = index % width;
      const y = (index - x) / width;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
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
    found.push({ box, pixels });
  }
  return found;
}

// Area-averaged resampling of one component's ink (only its own pixels, so a
// neighbouring glyph overlapping the bbox does not leak in) into a CANVAS x
// CANVAS grey bitmap. The bbox, grown by `pad` of its size on every side, is
// scaled uniformly to fit the canvas and centred.
function resample(mask: Mask, component: Component, pad: number): Float64Array {
  const { box } = component;
  const boxW = box.x1 - box.x0 + 1;
  const boxH = box.y1 - box.y0 + 1;
  const srcW = boxW * (1 + 2 * pad);
  const srcH = boxH * (1 + 2 * pad);
  const scale = CANVAS / Math.max(srcW, srcH); // canvas px per source px
  const originX = box.x0 - boxW * pad - (CANVAS / scale - srcW) / 2;
  const originY = box.y0 - boxH * pad - (CANVAS / scale - srcH) / 2;

  const own = new Uint8Array(boxW * boxH);
  for (const index of component.pixels) {
    const x = index % mask.width;
    const y = (index - x) / mask.width;
    own[(y - box.y0) * boxW + (x - box.x0)] = 1;
  }

  // Each source pixel [x, x+1) x [y, y+1) is spread over the canvas cells it
  // overlaps, weighted by overlap area.
  const out = new Float64Array(CANVAS * CANVAS);
  for (let sy = 0; sy < boxH; sy++) {
    const top = (box.y0 + sy - originY) * scale;
    const bottom = top + scale;
    for (let sx = 0; sx < boxW; sx++) {
      if (own[sy * boxW + sx] !== 1) continue;
      const left = (box.x0 + sx - originX) * scale;
      const right = left + scale;
      for (let cy = Math.max(0, Math.floor(top)); cy < Math.min(CANVAS, Math.ceil(bottom)); cy++) {
        const overlapY = Math.min(bottom, cy + 1) - Math.max(top, cy);
        if (overlapY <= 0) continue;
        for (let cx = Math.max(0, Math.floor(left)); cx < Math.min(CANVAS, Math.ceil(right)); cx++) {
          const overlapX = Math.min(right, cx + 1) - Math.max(left, cx);
          if (overlapX > 0) out[cy * CANVAS + cx] += overlapX * overlapY;
        }
      }
    }
  }
  return out;
}

// Pearson correlation of two equal-length vectors, in [-1, 1]; 0 if either is flat.
function ncc(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let cross = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cross += da * db;
    varA += da * da;
    varB += db * db;
  }
  return varA === 0 || varB === 0 ? 0 : cross / Math.sqrt(varA * varB);
}

// Each template, resampled from its own ink bbox exactly like a crop component.
const TEMPLATES: readonly { char: GlyphChar; bitmap: Float64Array }[] = ALL_GLYPH_CHARS.map((char) => {
  const glyph = GLYPHS[char];
  const ink = new Uint8Array(glyph.width * glyph.height);
  for (let y = 0; y < glyph.height; y++) {
    for (let x = 0; x < glyph.width; x++) ink[y * glyph.width + x] = glyph.rows[y][x] === '#' ? 1 : 0;
  }
  const mask: Mask = { width: glyph.width, height: glyph.height, ink };
  const parts = components(mask);
  // Every template glyph is one 8-connected stroke; merge defensively anyway.
  const merged: Component = {
    box: {
      x0: Math.min(...parts.map((part) => part.box.x0)),
      y0: Math.min(...parts.map((part) => part.box.y0)),
      x1: Math.max(...parts.map((part) => part.box.x1)),
      y1: Math.max(...parts.map((part) => part.box.y1)),
    },
    pixels: parts.flatMap((part) => part.pixels),
  };
  return { char, bitmap: resample(mask, merged, 0) };
});

export interface GlyphMatch {
  char: GlyphChar;
  score: number; // best NCC over the scale variants, in [-1, 1]
  margin: number; // score minus the runner-up char's best score
}

function classify(mask: Mask, component: Component): GlyphMatch {
  const variants = PAD_VARIANTS.map((pad) => resample(mask, component, pad));
  const scored = TEMPLATES.map(({ char, bitmap }) => ({
    char,
    score: Math.max(...variants.map((variant) => ncc(variant, bitmap))),
  }));
  // Stable sort: ties keep ALL_GLYPH_CHARS order.
  scored.sort((a, b) => b.score - a.score);
  return { char: scored[0].char, score: scored[0].score, margin: scored[0].score - scored[1].score };
}

// Margin at which a match counts as fully unambiguous; see confidence().
const FULL_MARGIN = 0.2;

// Confidence of a whole clue, in [0, 1]: the weakest component decides.
//   per component: min(max(score, 0), margin / FULL_MARGIN), capped at 1
//   clue:          min over components
// So a component is trusted only if it both looks like its template (high NCC)
// and looks clearly unlike every other template (wide margin to the runner-up).
export function confidence(matches: readonly GlyphMatch[]): number {
  let result = 1;
  for (const { score, margin } of matches) {
    result = Math.min(result, Math.max(0, score), margin / FULL_MARGIN);
  }
  return Math.max(0, Math.min(1, result));
}

// Parses glyph chars as <digits><optional operator>; null if not that shape.
function parse(chars: readonly GlyphChar[]): { target: number; operator: Operator | null } | null {
  let digits = 0;
  while (digits < chars.length && !OPERATOR_CHARS.has(chars[digits])) digits++;
  if (digits === 0) return null;
  const rest = chars.slice(digits);
  if (rest.length > 1) return null;
  if (chars[0] === '0') return null; // targets are positive with no leading zero
  return { target: Number(chars.slice(0, digits).join('')), operator: rest.length === 1 ? (rest[0] as Operator) : null };
}

export interface ClueAnalysis {
  // Why the crop was rejected before classification, if it was.
  rejected?: 'blank' | 'clipped';
  matches: GlyphMatch[];
  confidence: number;
  parsed: { target: number; operator: Operator | null } | null;
}

// The reader's full working, for diagnostics; read() is a thin wrapper.
export function analyseClue(crop: OcrImage): ClueAnalysis {
  const { ink } = binarize(crop);
  const mask: Mask = { width: crop.width, height: crop.height, ink };
  const all = components(mask);
  if (all.length === 0) return { rejected: 'blank', matches: [], confidence: 0, parsed: null };

  const tallest = Math.max(...all.map(({ box }) => box.y1 - box.y0 + 1));
  const kept = all.filter(({ box }) => Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1) >= SPECK_FRACTION * tallest);
  for (const { box } of kept) {
    if (box.x0 === 0 || box.y0 === 0 || box.x1 === crop.width - 1 || box.y1 === crop.height - 1) {
      return { rejected: 'clipped', matches: [], confidence: 0, parsed: null };
    }
  }

  kept.sort((a, b) => a.box.x0 + a.box.x1 - (b.box.x0 + b.box.x1) || a.box.y0 + a.box.y1 - (b.box.y0 + b.box.y1));
  const matches = kept.map((component) => classify(mask, component));
  return { matches, confidence: confidence(matches), parsed: parse(matches.map(({ char }) => char)) };
}

export const templateClueReader: ClueReader = {
  read(crop: OcrImage): ClueReading | null {
    const { parsed, confidence: score } = analyseClue(crop);
    if (parsed === null || score < CLUE_CONFIDENCE_THRESHOLD) return null;
    return { target: parsed.target, operator: parsed.operator, confidence: score };
  },
};
