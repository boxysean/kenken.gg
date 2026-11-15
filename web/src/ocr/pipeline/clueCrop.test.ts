import { clearLineRemnants } from './clueCrop';
import { binarize } from './binarize';
import type { OcrImage } from '../types';

const W = 60;
const H = 40;

function blank(): OcrImage {
  return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
}

function paint(image: OcrImage, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 0;
    }
  }
}

function inkAt(image: OcrImage, x: number, y: number): boolean {
  return binarize(image).ink[y * image.width + x] === 1;
}

function anyInkOnBorder(image: OcrImage): boolean {
  const { ink } = binarize(image);
  for (let x = 0; x < W; x++) if (ink[x] || ink[(H - 1) * W + x]) return true;
  for (let y = 0; y < H; y++) if (ink[y * W] || ink[y * W + W - 1]) return true;
  return false;
}

// A glyph-sized block well inside the crop.
const GLYPH = [20, 10, 28, 24] as const;

describe('clearLineRemnants', () => {
  it('leaves a crop with no lines untouched', () => {
    const crop = blank();
    paint(crop, ...GLYPH);
    expect(clearLineRemnants(crop)).toBe(crop);
  });

  it('whitens a grid-line sliver along the left edge and keeps the glyph', () => {
    const crop = blank();
    paint(crop, 0, 0, 2, H - 1);
    paint(crop, ...GLYPH);
    const cleaned = clearLineRemnants(crop);
    expect(anyInkOnBorder(cleaned)).toBe(false);
    expect(inkAt(cleaned, 24, 16)).toBe(true);
  });

  it('whitens an L of the left and top lines meeting in the corner', () => {
    const crop = blank();
    paint(crop, 0, 0, 3, H - 1);
    paint(crop, 0, 0, W - 1, 2);
    paint(crop, ...GLYPH);
    const cleaned = clearLineRemnants(crop);
    expect(anyInkOnBorder(cleaned)).toBe(false);
    expect(inkAt(cleaned, 24, 16)).toBe(true);
  });

  it('whitens a line sliver along the right edge that does not touch it', () => {
    const crop = blank();
    paint(crop, W - 3, 0, W - 1, H - 1);
    paint(crop, ...GLYPH);
    expect(anyInkOnBorder(clearLineRemnants(crop))).toBe(false);
  });

  it('keeps a clipped glyph on the border, which the readers must still reject', () => {
    const crop = blank();
    paint(crop, W - 8, 12, W - 1, 24);
    const cleaned = clearLineRemnants(crop);
    expect(inkAt(cleaned, W - 1, 18)).toBe(true);
  });
});
