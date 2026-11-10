// EXIF bytes are built inline: a minimal JPEG of SOI + one APP1 segment + EOI.
import { applyOrientation, readExifOrientation, ORIENTATION_DEFAULT } from './exif';
import type { OcrImage } from '../types';

function u16(value: number, littleEndian: boolean): number[] {
  return littleEndian ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff];
}

function u32(value: number, littleEndian: boolean): number[] {
  const bytes = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  return littleEndian ? bytes.reverse() : bytes;
}

function jpegWithOrientation(orientation: number, littleEndian: boolean): Uint8Array {
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(0x002a, littleEndian),
    ...u32(8, littleEndian), // IFD0 straight after the header
    ...u16(1, littleEndian), // one entry
    ...u16(0x0112, littleEndian), // Orientation
    ...u16(3, littleEndian), // SHORT
    ...u32(1, littleEndian), // count
    ...u16(orientation, littleEndian), 0, 0, // value, padded to 4 bytes
    ...u32(0, littleEndian), // no next IFD
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...exif, 0xff, 0xd9]);
}

describe('readExifOrientation', () => {
  it('reads little-endian orientations', () => {
    expect(readExifOrientation(jpegWithOrientation(1, true))).toBe(1);
    expect(readExifOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(readExifOrientation(jpegWithOrientation(8, true))).toBe(8);
  });

  it('reads big-endian orientations', () => {
    expect(readExifOrientation(jpegWithOrientation(6, false))).toBe(6);
    expect(readExifOrientation(jpegWithOrientation(8, false))).toBe(8);
  });

  it('returns the default for a non-JPEG buffer', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(readExifOrientation(png)).toBe(ORIENTATION_DEFAULT);
    expect(readExifOrientation(new Uint8Array([]))).toBe(1);
  });

  it('returns the default for a JPEG without EXIF', () => {
    expect(readExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
  });

  it('returns the default for out-of-range values', () => {
    expect(readExifOrientation(jpegWithOrientation(0, true))).toBe(1);
    expect(readExifOrientation(jpegWithOrientation(9, false))).toBe(1);
  });

  it('never throws on truncated input', () => {
    const full = jpegWithOrientation(6, true);
    for (let length = 0; length < full.length; length++) {
      expect(() => readExifOrientation(full.slice(0, length))).not.toThrow();
    }
  });
});

describe('applyOrientation', () => {
  // A 3x2 image whose pixel at (x, y) is RGBA [x, y, 10y + x, 255]:
  //   a b c
  //   d e f
  const W = 3;
  const H = 2;
  function makeImage(): OcrImage {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        data.set([x, y, 10 * y + x, 255], (y * W + x) * 4);
      }
    }
    return { width: W, height: H, data };
  }

  // Each output pixel, as the (x, y) of the input pixel it should hold.
  function sourceGrid(image: OcrImage): [number, number][][] {
    const rows: [number, number][][] = [];
    for (let y = 0; y < image.height; y++) {
      const row: [number, number][] = [];
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        expect(image.data[i + 2]).toBe(10 * image.data[i + 1] + image.data[i]);
        row.push([image.data[i], image.data[i + 1]]);
      }
      rows.push(row);
    }
    return rows;
  }

  const a: [number, number] = [0, 0];
  const b: [number, number] = [1, 0];
  const c: [number, number] = [2, 0];
  const d: [number, number] = [0, 1];
  const e: [number, number] = [1, 1];
  const f: [number, number] = [2, 1];

  const cases: [number, [number, number][][]][] = [
    [1, [[a, b, c], [d, e, f]]],
    [2, [[c, b, a], [f, e, d]]],
    [3, [[f, e, d], [c, b, a]]],
    [4, [[d, e, f], [a, b, c]]],
    [5, [[a, d], [b, e], [c, f]]],
    [6, [[d, a], [e, b], [f, c]]],
    [7, [[f, c], [e, b], [d, a]]],
    [8, [[c, f], [b, e], [a, d]]],
  ];

  for (const [orientation, expected] of cases) {
    it(`orientation ${orientation} puts every pixel in place`, () => {
      const out = applyOrientation(makeImage(), orientation);
      expect(out.width).toBe(expected[0].length);
      expect(out.height).toBe(expected.length);
      expect(out.data.length).toBe(out.width * out.height * 4);
      expect(sourceGrid(out)).toEqual(expected);
    });
  }

  it('swaps width and height for the transposed orientations 5..8', () => {
    for (const orientation of [5, 6, 7, 8]) {
      const out = applyOrientation(makeImage(), orientation);
      expect([out.width, out.height]).toEqual([H, W]);
    }
  });

  it('rotates 90 degrees clockwise for orientation 6', () => {
    const out = applyOrientation(makeImage(), 6);
    // Input bottom-left lands top-left; input top-right lands bottom-right.
    expect(Array.from(out.data.slice(0, 4))).toEqual([0, 1, 10, 255]);
    expect(Array.from(out.data.slice((2 * 2 + 1) * 4, (2 * 2 + 1) * 4 + 4))).toEqual([2, 0, 2, 255]);
  });

  it('returns an unchanged copy for unknown orientations', () => {
    const image = makeImage();
    const out = applyOrientation(image, 42);
    expect(out).not.toBe(image);
    expect(out.data).not.toBe(image.data);
    expect(out).toEqual(image);
  });

  it('does not mutate the input', () => {
    const image = makeImage();
    const before = new Uint8ClampedArray(image.data);
    for (let orientation = 1; orientation <= 8; orientation++) {
      const out = applyOrientation(image, orientation);
      expect(out.data).not.toBe(image.data);
    }
    expect(image.width).toBe(W);
    expect(image.height).toBe(H);
    expect(image.data).toEqual(before);
  });
});
