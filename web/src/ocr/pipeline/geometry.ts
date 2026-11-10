// Plane geometry for the OCR pipeline: polygon areas, convex hulls and the
// 3x3 projective maps (homographies) between a photographed board quad and the
// unit square. Everything is plain arrays of numbers; no matrix library.
import type { Point, Quad } from '../types';

// Row-major h11..h33. Maps (x, y) to ((h11 x + h12 y + h13) / w, (h21 x + h22 y + h23) / w)
// with w = h31 x + h32 y + h33.
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export const UNIT_SQUARE: Quad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

// Relative size below which a triangle, pivot or determinant counts as zero.
const DEGENERATE_EPSILON = 1e-9;
// Backstop inside the elimination; assertNonDegenerate catches the real cases first.
const PIVOT_EPSILON = 1e-12;

export function quadCorners(quad: Quad): Point[] {
  return [quad.tl, quad.tr, quad.br, quad.bl];
}

// Shoelace sum. In image coordinates (y down) it is positive for a polygon
// that runs clockwise on screen, which is the tl -> tr -> br -> bl convention.
export function signedArea(points: readonly Point[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

export function quadArea(quad: Quad): number {
  return Math.abs(signedArea(quadCorners(quad)));
}

// z-component of (a - o) x (b - o): positive when o -> a -> b turns clockwise on screen.
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Andrew's monotone chain. Sort by x then y, build the lower and upper chains,
// popping any point that does not make a strict turn (so collinear and
// duplicate points are dropped), then join the chains without repeating their
// shared endpoints. The result runs clockwise on screen (y down), starting from
// the leftmost-then-topmost point. Fewer than three distinct non-collinear
// points come back as the distinct extreme points (0, 1 or 2 of them).
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) {
    return sorted.filter((p, index) => index === 0 || p.x !== sorted[index - 1].x || p.y !== sorted[index - 1].y);
  }
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const p = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  // All points collinear (or identical): the chains collapse onto the two extremes.
  if (hull.length === 2 && hull[0].x === hull[1].x && hull[0].y === hull[1].y) return [hull[0]];
  return hull;
}

// A homography between quads exists only if no three corners of either quad
// are collinear; checked up front, relative to the quad's size, so a
// degenerate input fails loudly instead of yielding NaN or huge values.
function assertNonDegenerate(quad: Quad, role: string): void {
  const corners = quadCorners(quad);
  if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error(`solveHomography: ${role} quad has a non-finite corner`);
  }
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  for (let skip = 0; skip < 4; skip++) {
    const [a, b, c] = corners.filter((_, index) => index !== skip);
    if (Math.abs(cross(a, b, c)) <= DEGENERATE_EPSILON * extent * extent) {
      throw new Error(`solveHomography: degenerate ${role} quad (zero area or three collinear corners)`);
    }
  }
}

// Each correspondence (x, y) -> (u, v) gives two linear equations in the eight
// unknowns h11..h32 once h33 is fixed at 1:
//   h11 x + h12 y + h13 - h31 x u - h32 y u = u
//   h21 x + h22 y + h23 - h31 x v - h32 y v = v
// Four corners give an 8x8 system, solved by Gauss-Jordan elimination with
// partial pivoting (swap the largest remaining entry of each column onto the
// diagonal before eliminating it from every other row).
export function solveHomography(from: Quad, to: Quad = UNIT_SQUARE): Homography {
  assertNonDegenerate(from, 'source');
  assertNonDegenerate(to, 'target');
  const source = quadCorners(from);
  const target = quadCorners(to);
  const rows: number[][] = [];
  for (let index = 0; index < 4; index++) {
    const { x, y } = source[index];
    const { x: u, y: v } = target[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const scale = Math.max(...rows.map((row) => Math.max(...row.slice(0, 8).map(Math.abs))));
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) <= PIVOT_EPSILON * scale) {
      throw new Error('solveHomography: singular system, the quads are degenerate');
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      if (factor === 0) continue;
      for (let k = column; k < 9; k++) rows[row][k] -= factor * rows[column][k];
    }
  }
  const h = rows.map((row, index) => row[8] / row[index]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

// Inverse via the adjugate (transposed cofactor matrix) over the determinant.
// A homography is only defined up to scale, so the result is renormalised to
// h33 = 1 whenever that entry is usefully non-zero.
export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, i, j] = h;
  const adjugate = [
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];
  const determinant = a * adjugate[0] + b * adjugate[3] + c * adjugate[6];
  // The entries of a pixel-to-unit-square map span many orders of magnitude, so
  // a relative tolerance on the determinant would misfire; only exact zero is
  // rejected here and anything numerically useless shows up as non-finite below.
  if (!Number.isFinite(determinant) || determinant === 0) throw new Error('invertHomography: singular homography');
  const largest = Math.max(...adjugate.map(Math.abs));
  const divisor = Math.abs(adjugate[8]) > DEGENERATE_EPSILON * largest ? adjugate[8] : determinant;
  const m = adjugate.map((value) => value / divisor);
  if (m.some((value) => !Number.isFinite(value))) throw new Error('invertHomography: singular homography');
  return [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
}
