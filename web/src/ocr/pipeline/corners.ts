// Grid corner detection: finds the four corners of the board's outer frame in a
// photographed (or synthetic) page, in continuous image coordinates where pixel
// (i, j) covers [i, i + 1) x [j, j + 1) -- the same convention as the labels.
//
// binarize -> 4-connected components of ink -> the largest one (the grid: every
// line touches the frame) -> convex hull of its pixel squares -> a few extreme
// hull points -> the max-area quadruple among them -> per-side refinement from
// the frame's outer edge to its stroke centreline, which is what labels mark.
import type { OcrImage, Point, Quad } from '../types';
import { binarize } from './binarize';
import { convexHull, quadArea, signedArea } from './geometry';

export interface CornerDetection {
  quad: Quad;
  confidence: number;
}

// Hull points kept as max-area candidates: the furthest hull point in each of
// this many evenly spaced directions. A board corner is extreme for every
// direction within its exterior angle (about 90 degrees under mild
// perspective), so a 22.5 degree spacing always lands on it.
const CANDIDATE_DIRECTIONS = 16;
// Perpendicular probes across the middle of each side, as fractions of its length.
const SIDE_SAMPLES = 41;
const SIDE_FROM = 0.1;
const SIDE_TO = 0.9;
// Each probe marches inward from this far outside the hull side ...
const PROBE_START = 6;
// ... for at most this far past it; longer runs (a grid line meeting the frame) are discarded.
const PROBE_REACH = 48;
const PROBE_STEP = 0.25;
const BISECT_STEPS = 12;
// Probes whose outer edge is further than this from the fitted line are refit without.
const EDGE_OUTLIER_PX = 1.5;
const MIN_SIDE_SAMPLES = 5;
// A blob smaller than this cannot be a readable board (a speck of dust or noise).
const MIN_COMPONENT_PIXELS = 64;

interface Component {
  labels: Int32Array;
  label: number;
  size: number;
}

// Labels 4-connected ink pixels with an explicit stack (no recursion) and
// returns the label of the largest component, or label 0 when there is no ink.
function largestComponent(ink: Uint8Array, width: number, height: number): Component {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  let next = 0;
  let best = { label: 0, size: 0 };
  for (let start = 0; start < ink.length; start++) {
    if (ink[start] === 0 || labels[start] !== 0) continue;
    const label = ++next;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const index = stack[--top];
      size++;
      const x = index % width;
      const visit = (neighbour: number): void => {
        if (ink[neighbour] === 1 && labels[neighbour] === 0) {
          labels[neighbour] = label;
          stack[top++] = neighbour;
        }
      };
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (index >= width) visit(index - width);
      if (index < ink.length - width) visit(index + width);
    }
    if (size > best.size) best = { label, size };
  }
  return { labels, ...best };
}

// The hull of a set of pixel squares only depends on each row's leftmost and
// rightmost pixel, and on their outer corners: (x, y), (x, y + 1) on the left
// and (x + 1, y), (x + 1, y + 1) on the right. So the hull is the ink's outer
// edge, not its pixel centres.
function componentOutline(component: Component, width: number, height: number): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0, index = y * width; x < width; x++, index++) {
      if (component.labels[index] !== component.label) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left < 0) continue;
    points.push({ x: left, y }, { x: left, y: y + 1 }, { x: right + 1, y }, { x: right + 1, y: y + 1 });
  }
  return points;
}

function candidateIndices(hull: Point[]): number[] {
  const chosen = new Set<number>();
  for (let k = 0; k < CANDIDATE_DIRECTIONS; k++) {
    const angle = (2 * Math.PI * k) / CANDIDATE_DIRECTIONS;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = 0;
    for (let index = 1; index < hull.length; index++) {
      if (hull[index].x * dx + hull[index].y * dy > hull[best].x * dx + hull[best].y * dy) best = index;
    }
    chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b);
}

// Any four hull vertices taken in hull order form a convex quad, so this is a
// plain search over ordered quadruples: at most C(16, 4) = 1820 shoelaces.
function maxAreaQuad(hull: Point[], candidates: number[]): Point[] | null {
  let best: Point[] | null = null;
  let bestArea = 0;
  const m = candidates.length;
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      for (let c = b + 1; c < m; c++) {
        for (let d = c + 1; d < m; d++) {
          const points = [hull[candidates[a]], hull[candidates[b]], hull[candidates[c]], hull[candidates[d]]];
          const area = Math.abs(signedArea(points));
          if (area > bestArea) {
            bestArea = area;
            best = points;
          }
        }
      }
    }
  }
  return best;
}

// Clockwise on screen (positive signed area with y down), starting from the
// corner nearest the image's top-left.
function orderCorners(points: Point[]): Quad {
  const ordered = signedArea(points) < 0 ? [...points].reverse() : [...points];
  let first = 0;
  for (let index = 1; index < 4; index++) {
    if (ordered[index].x + ordered[index].y < ordered[first].x + ordered[first].y) first = index;
  }
  const [tl, tr, br, bl] = [0, 1, 2, 3].map((k) => ordered[(first + k) % 4]);
  return { tl, tr, br, bl };
}

interface Line {
  point: Point;
  direction: Point;
}

function intersect(first: Line, second: Line): Point | null {
  const denominator = first.direction.x * second.direction.y - first.direction.y * second.direction.x;
  if (Math.abs(denominator) < 1e-12) return null;
  const dx = second.point.x - first.point.x;
  const dy = second.point.y - first.point.y;
  const t = (dx * second.direction.y - dy * second.direction.x) / denominator;
  return { x: first.point.x + t * first.direction.x, y: first.point.y + t * first.direction.y };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Least-squares fit of offset = intercept + slope * position.
function fitLine(samples: { position: number; offset: number }[]): { intercept: number; slope: number } {
  const n = samples.length;
  const meanPosition = samples.reduce((sum, s) => sum + s.position, 0) / n;
  const meanOffset = samples.reduce((sum, s) => sum + s.offset, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const s of samples) {
    covariance += (s.position - meanPosition) * (s.offset - meanOffset);
    variance += (s.position - meanPosition) ** 2;
  }
  const slope = variance > 0 ? covariance / variance : 0;
  return { intercept: meanOffset - slope * meanPosition, slope };
}

interface Probe {
  position: number;
  entry: number;
  run: number;
}

// The frame stroke's centreline along one side of the hull quad, a -> b, with
// the board on the right-hand side on screen.
//
// Labels mark the centreline, but the hull hugs the stroke's outer edge, half
// a stroke width further out (2 px for the default 4 px frame). Probes run
// along the inward normal across the middle of the side; each finds where it
// enters the ink (the outer edge) and how long it stays in it (the stroke
// thickness along the probe). The outer edge is fitted as a line in
// (position along side, offset along normal), then moved inward by half the
// median run. Half the run *along the probe* lands exactly on the centreline
// even when the fitted edge is slightly tilted against the normal, so no cosine
// correction is needed. Everything is measured on the component's binary mask,
// with bisection to sub-pixel precision: on an antialiased edge the mask flips
// where the grey level crosses the Otsu threshold, which is the geometric edge
// when the threshold sits between ink and paper. Measuring per side copes with
// perspective, which makes the stroke thinner on the far side of the board.
function refineSide(a: Point, b: Point, isInk: (p: Point) => boolean): Line | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return null;
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const n = { x: -u.y, y: u.x };
  const at = (position: number, offset: number): Point => ({
    x: a.x + u.x * position + n.x * offset,
    y: a.y + u.y * position + n.y * offset,
  });
  // Narrows a transition between offsets `outside` and `inside` (mask differs at the two).
  const bisect = (position: number, from: number, to: number, wantInk: boolean): number => {
    let low = from;
    let high = to;
    for (let step = 0; step < BISECT_STEPS; step++) {
      const middle = (low + high) / 2;
      if (isInk(at(position, middle)) === wantInk) high = middle;
      else low = middle;
    }
    return (low + high) / 2;
  };

  const probes: Probe[] = [];
  for (let k = 0; k < SIDE_SAMPLES; k++) {
    const position = length * (SIDE_FROM + ((SIDE_TO - SIDE_FROM) * k) / (SIDE_SAMPLES - 1));
    let entry = Number.NaN;
    let run = Number.POSITIVE_INFINITY;
    for (let offset = -PROBE_START; offset <= PROBE_REACH; offset += PROBE_STEP) {
      const ink = isInk(at(position, offset));
      if (Number.isNaN(entry)) {
        if (ink) entry = bisect(position, offset - PROBE_STEP, offset, true);
      } else if (!ink) {
        run = bisect(position, offset - PROBE_STEP, offset, false) - entry;
        break;
      }
    }
    if (!Number.isNaN(entry)) probes.push({ position, entry, run });
  }

  // Fit the outer edge, then refit without probes that hit a speck of noise or missed the stroke.
  let inliers = probes;
  if (inliers.length < MIN_SIDE_SAMPLES) return null;
  let edge = fitLine(inliers.map((p) => ({ position: p.position, offset: p.entry })));
  for (let round = 0; round < 2; round++) {
    const kept = probes.filter((p) => Math.abs(p.entry - (edge.intercept + edge.slope * p.position)) <= EDGE_OUTLIER_PX);
    if (kept.length < MIN_SIDE_SAMPLES) break;
    inliers = kept;
    edge = fitLine(inliers.map((p) => ({ position: p.position, offset: p.entry })));
  }
  const runs = inliers.map((p) => p.run).filter(Number.isFinite);
  if (runs.length < MIN_SIDE_SAMPLES) return null;
  const halfThickness = median(runs) / 2;
  return {
    point: at(0, edge.intercept + halfThickness),
    direction: { x: u.x + n.x * edge.slope, y: u.y + n.y * edge.slope },
  };
}

function fallback(image: OcrImage): CornerDetection {
  const { width, height } = image;
  return {
    quad: { tl: { x: 0, y: 0 }, tr: { x: width, y: 0 }, br: { x: width, y: height }, bl: { x: 0, y: height } },
    confidence: 0,
  };
}

export function detectCorners(image: OcrImage): CornerDetection {
  const { width, height } = image;
  if (width === 0 || height === 0) return fallback(image);
  const { ink } = binarize(image);
  const component = largestComponent(ink, width, height);
  if (component.size < MIN_COMPONENT_PIXELS) return fallback(image);

  const hull = convexHull(componentOutline(component, width, height));
  const hullArea = hull.length >= 3 ? Math.abs(signedArea(hull)) : 0;
  if (hull.length < 4 || hullArea === 0) return fallback(image);
  const picked = maxAreaQuad(hull, candidateIndices(hull));
  if (picked === null) return fallback(image);
  const outer = orderCorners(picked);
  // The inscribed quad covers nearly all of the hull exactly when the blob is a quadrilateral.
  const confidence = Math.min(1, Math.max(0, quadArea(outer) / hullArea));

  const isInk = (p: Point): boolean => {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return x >= 0 && y >= 0 && x < width && y < height && component.labels[y * width + x] === component.label;
  };
  const top = refineSide(outer.tl, outer.tr, isInk);
  const right = refineSide(outer.tr, outer.br, isInk);
  const bottom = refineSide(outer.br, outer.bl, isInk);
  const left = refineSide(outer.bl, outer.tl, isInk);
  if (top === null || right === null || bottom === null || left === null) {
    // No measurable stroke on some side: report the outer edge, with less confidence.
    return { quad: outer, confidence: confidence / 2 };
  }
  const tl = intersect(left, top);
  const tr = intersect(top, right);
  const br = intersect(right, bottom);
  const bl = intersect(bottom, left);
  if (tl === null || tr === null || br === null || bl === null) return { quad: outer, confidence: confidence / 2 };
  const quad = { tl, tr, br, bl };
  if (signedArea([tl, tr, br, bl]) <= 0) return { quad: outer, confidence: confidence / 2 };
  return { quad, confidence };
}
