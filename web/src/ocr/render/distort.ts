// Seeded distortions for synthetic renders: an optional geometric warp
// (rotation and perspective, applied as one homography) followed by
// photometric damage (brightness gradient, glare, noise, blur). All randomness
// comes from mulberry32(hashString(seed)), so a spec always yields the same bytes.
import { hashString, mulberry32 } from '../../play/generator/rng';
import type { OcrImage, Point, Quad } from '../types';

export type StyleTag = 'clean' | 'noise' | 'glare' | 'perspective';

export interface DistortSpec {
  readonly seed: string;
  readonly tag: StyleTag;
  readonly rotation?: number;
  readonly perspective?: number;
  readonly glare?: number;
  readonly noise?: number;
  readonly blur?: number;
}

// Darkest the brightness gradient makes paper, as a fraction of its value.
const GRADIENT_DEPTH = 0.12;
// How far toward white glare can lift a pixel at full strength. Kept below
// half so ink under the glare stays darker than the 128 threshold.
const GLARE_LIFT = 0.4;
// Perspective jitter is capped so the warped board stays convex.
const MAX_PERSPECTIVE = 0.25;
const WHITE = 255;

type Matrix3 = [number, number, number, number, number, number, number, number, number];

function hasGeometry(spec: DistortSpec): boolean {
  return (spec.rotation ?? 0) > 0 || (spec.perspective ?? 0) > 0;
}

function hasPhotometry(spec: DistortSpec): boolean {
  return (spec.glare ?? 0) > 0 || (spec.noise ?? 0) > 0 || (spec.blur ?? 0) > 0;
}

function cornerList(quad: Quad): Point[] {
  return [quad.tl, quad.tr, quad.br, quad.bl];
}

function quadFrom(points: Point[]): Quad {
  return { tl: points[0], tr: points[1], br: points[2], bl: points[3] };
}

function copyQuad(quad: Quad): Quad {
  return quadFrom(cornerList(quad).map((p) => ({ x: p.x, y: p.y })));
}

// Solves the 8 unknowns of the homography mapping each `from` point onto the
// matching `to` point (h33 = 1), by Gaussian elimination with partial pivoting.
function homography(from: Point[], to: Point[]): Matrix3 {
  const rows: number[][] = [];
  for (let index = 0; index < 4; index++) {
    const { x, y } = from[index];
    const { x: u, y: v } = to[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) throw new Error('distort: degenerate quad, no homography');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      for (let k = column; k < 9; k++) rows[row][k] -= factor * rows[column][k];
    }
  }
  const h = rows.map((row, index) => row[8] / row[index]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function apply(m: Matrix3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

interface Warp {
  corners: Quad;
  width: number;
  height: number;
  // Maps output coordinates back to input coordinates.
  inverse: Matrix3;
}

// The geometric half. Consumes the first draws of `random`, so distort() and
// distortedCorners() agree on the quad for the same seed.
function planWarp(image: OcrImage, corners: Quad, spec: DistortSpec, random: () => number): Warp {
  const centre = { x: image.width / 2, y: image.height / 2 };
  const source = cornerList(corners);
  const angle = spec.rotation ? ((random() * 2 - 1) * spec.rotation * Math.PI) / 180 : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let destination = source.map((p) => ({
    x: centre.x + (p.x - centre.x) * cos - (p.y - centre.y) * sin,
    y: centre.y + (p.x - centre.x) * sin + (p.y - centre.y) * cos,
  }));
  const perspective = Math.min(spec.perspective ?? 0, MAX_PERSPECTIVE);
  if (perspective > 0) {
    const edge =
      (Math.hypot(corners.tr.x - corners.tl.x, corners.tr.y - corners.tl.y) +
        Math.hypot(corners.bl.x - corners.tl.x, corners.bl.y - corners.tl.y)) /
      2;
    destination = destination.map((p) => ({
      x: p.x + (random() * 2 - 1) * perspective * edge,
      y: p.y + (random() * 2 - 1) * perspective * edge,
    }));
  }

  // Grow the canvas to hold the whole warped image, then shift into positive coordinates.
  const forward = homography(source, destination);
  const imageCorners = [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: image.width, y: image.height },
    { x: 0, y: image.height },
  ].map((p) => apply(forward, p));
  const minX = Math.floor(Math.min(...imageCorners.map((p) => p.x)));
  const minY = Math.floor(Math.min(...imageCorners.map((p) => p.y)));
  const maxX = Math.ceil(Math.max(...imageCorners.map((p) => p.x)));
  const maxY = Math.ceil(Math.max(...imageCorners.map((p) => p.y)));
  const shifted = destination.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  return {
    corners: quadFrom(shifted),
    width: maxX - minX,
    height: maxY - minY,
    inverse: homography(shifted, source),
  };
}

export function distortedCorners(image: OcrImage, corners: Quad, spec: DistortSpec): Quad {
  if (!hasGeometry(spec)) return copyQuad(corners);
  return planWarp(image, corners, spec, mulberry32(hashString(spec.seed))).corners;
}

// Bilinear sample at continuous coordinates (pixel i covers [i, i + 1)); outside is white.
function warpImage(image: OcrImage, warp: Warp): OcrImage {
  const { width, height } = warp;
  const data = new Uint8ClampedArray(width * height * 4);
  const source = image.data;
  const texel = (x: number, y: number, channel: number): number =>
    x < 0 || y < 0 || x >= image.width || y >= image.height ? WHITE : source[(y * image.width + x) * 4 + channel];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = apply(warp.inverse, { x: x + 0.5, y: y + 0.5 });
      const sx = p.x - 0.5;
      const sy = p.y - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const top = texel(x0, y0, channel) * (1 - fx) + texel(x0 + 1, y0, channel) * fx;
        const bottom = texel(x0, y0 + 1, channel) * (1 - fx) + texel(x0 + 1, y0 + 1, channel) * fx;
        data[offset + channel] = top * (1 - fy) + bottom * fy;
      }
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function brightnessAndGlare(image: OcrImage, spec: DistortSpec, random: () => number): void {
  const { width, height, data } = image;
  const direction = random() * 2 * Math.PI;
  const dx = Math.cos(direction);
  const dy = Math.sin(direction);
  const glare = Math.min(spec.glare ?? 0, 1);
  const glareX = random() * width;
  const glareY = random() * height;
  const glareRadius = (0.2 + random() * 0.2) * Math.min(width, height);
  // Project every pixel onto the gradient direction and normalise to [0, 1].
  const extent = Math.abs(dx) * width + Math.abs(dy) * height;
  const origin = Math.min(0, dx * width) + Math.min(0, dy * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (dx * x + dy * y - origin) / extent;
      const shade = 1 - GRADIENT_DEPTH * t;
      const distanceSquared = (x - glareX) ** 2 + (y - glareY) ** 2;
      const lift = glare * GLARE_LIFT * Math.exp(-distanceSquared / (2 * glareRadius * glareRadius));
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const shaded = data[offset + channel] * shade;
        data[offset + channel] = shaded + (WHITE - shaded) * lift;
      }
    }
  }
}

function addNoise(image: OcrImage, noise: number, random: () => number): void {
  const sigma = Math.min(noise, 1) * 128;
  const { data } = image;
  for (let offset = 0; offset < data.length; offset += 4) {
    // Box-Muller; 1 - random() keeps the logarithm finite.
    const gaussian = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const delta = gaussian * sigma;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = data[offset + channel] + delta;
  }
}

// Separable box blur with edge clamping.
function boxBlur(image: OcrImage, radius: number): OcrImage {
  const { width, height } = image;
  const pass = (input: Uint8ClampedArray, horizontal: boolean): Uint8ClampedArray => {
    const output = new Uint8ClampedArray(input.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const sx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
            const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
            sum += input[(sy * width + sx) * 4 + channel];
          }
          output[offset + channel] = sum / (2 * radius + 1);
        }
        output[offset + 3] = input[offset + 3];
      }
    }
    return output;
  };
  return { width, height, data: pass(pass(image.data, true), false) };
}

export function distort(image: OcrImage, corners: Quad, spec: DistortSpec): { image: OcrImage; corners: Quad } {
  if (!hasGeometry(spec) && !hasPhotometry(spec)) return { image, corners: copyQuad(corners) };

  const random = mulberry32(hashString(spec.seed));
  let output: OcrImage;
  let outputCorners: Quad;
  if (hasGeometry(spec)) {
    const warp = planWarp(image, corners, spec, random);
    output = warpImage(image, warp);
    outputCorners = warp.corners;
  } else {
    output = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
    outputCorners = copyQuad(corners);
  }

  if (hasPhotometry(spec)) {
    brightnessAndGlare(output, spec, random);
    if ((spec.noise ?? 0) > 0) addNoise(output, spec.noise ?? 0, random);
    const radius = Math.ceil(spec.blur ?? 0);
    if (radius > 0) output = boxBlur(output, radius);
  }
  return { image: output, corners: outputCorners };
}
