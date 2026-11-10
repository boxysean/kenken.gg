// Perspective flattening: resamples the board quad of a photographed page into
// a fixed FLAT_IMAGE_PX square, so later stages can cut cells on a regular grid.
// The quad's corners land on the square's corners: a quad on the grid-outline
// centreline puts grid line i of an n x n board at i * FLAT_IMAGE_PX / n.
import type { OcrImage, Point, Quad } from '../types';
import { applyHomography, invertHomography, solveHomography } from './geometry';

export const FLAT_IMAGE_PX = 1024;

const WHITE = 255;

// Inverse mapping, so every output pixel gets exactly one sample: the output
// pixel centre (x + 0.5, y + 0.5) is scaled into the unit square, taken back
// through the inverse of quad -> unit square, and bilinearly sampled there.
// Sampling follows distort.ts's warpImage: pixel i covers [i, i + 1) and its
// value sits at its centre i + 0.5, so the continuous coordinate is shifted by
// -0.5 before splitting into a whole texel and the fractions between centres.
// Texels outside the source image read as white; alpha is always opaque.
export function warpToBoard(image: OcrImage, quad: Quad): OcrImage {
  const toSource = invertHomography(solveHomography(quad));
  const size = FLAT_IMAGE_PX;
  const data = new Uint8ClampedArray(size * size * 4);
  const source = image.data;
  const texel = (x: number, y: number, channel: number): number =>
    x < 0 || y < 0 || x >= image.width || y >= image.height ? WHITE : source[(y * image.width + x) * 4 + channel];
  const unit: Point = { x: 0, y: 0 };
  for (let y = 0; y < size; y++) {
    unit.y = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      unit.x = (x + 0.5) / size;
      const p = applyHomography(toSource, unit);
      const sx = p.x - 0.5;
      const sy = p.y - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const upper = texel(x0, y0, channel) * (1 - fx) + texel(x0 + 1, y0, channel) * fx;
        const lower = texel(x0, y0 + 1, channel) * (1 - fx) + texel(x0 + 1, y0 + 1, channel) * fx;
        data[offset + channel] = upper * (1 - fy) + lower * fy;
      }
      data[offset + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
