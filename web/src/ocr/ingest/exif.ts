// EXIF orientation: reading the tag out of JPEG bytes, and applying it to raw RGBA.
// Pure: no DOM, no canvas, so all of it runs under vitest.
import type { OcrImage } from '../types';

// The orientation assumed when a photo has no (valid) Orientation tag: already upright.
export const ORIENTATION_DEFAULT = 1;

const ORIENTATION_TAG = 0x0112;
const TIFF_TYPE_SHORT = 3;
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

// Reads the Orientation (1..8) from a JPEG's EXIF APP1 segment. Anything missing,
// malformed or out of range yields ORIENTATION_DEFAULT; this never throws.
export function readExifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return ORIENTATION_DEFAULT;
  }

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return ORIENTATION_DEFAULT;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      // Fill byte before a marker.
      offset += 1;
      continue;
    }
    // EOI or start of scan: no more metadata segments follow.
    if (marker === 0xd9 || marker === 0xda) {
      return ORIENTATION_DEFAULT;
    }
    // Standalone markers (RSTn, TEM) carry no length.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) {
      return ORIENTATION_DEFAULT;
    }
    const segmentStart = offset + 4;
    const segmentEnd = Math.min(offset + 2 + length, bytes.length);

    if (marker === 0xe1 && hasExifHeader(bytes, segmentStart, segmentEnd)) {
      return readTiffOrientation(bytes, segmentStart + EXIF_HEADER.length, segmentEnd);
    }
    offset += 2 + length;
  }
  return ORIENTATION_DEFAULT;
}

function hasExifHeader(bytes: Uint8Array, start: number, end: number): boolean {
  if (start + EXIF_HEADER.length > end) {
    return false;
  }
  return EXIF_HEADER.every((byte, i) => bytes[start + i] === byte);
}

// Walks a TIFF header + IFD0 occupying bytes[start, end) looking for the Orientation tag.
function readTiffOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (start + 8 > end) {
    return ORIENTATION_DEFAULT;
  }

  let littleEndian: boolean;
  if (bytes[start] === 0x49 && bytes[start + 1] === 0x49) {
    littleEndian = true;
  } else if (bytes[start] === 0x4d && bytes[start + 1] === 0x4d) {
    littleEndian = false;
  } else {
    return ORIENTATION_DEFAULT;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  if (view.getUint16(2, littleEndian) !== 0x002a) {
    return ORIENTATION_DEFAULT;
  }

  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > view.byteLength) {
    return ORIENTATION_DEFAULT;
  }

  const entryCount = view.getUint16(ifdOffset, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) {
      return ORIENTATION_DEFAULT;
    }
    if (view.getUint16(entry, littleEndian) !== ORIENTATION_TAG) {
      continue;
    }
    if (view.getUint16(entry + 2, littleEndian) !== TIFF_TYPE_SHORT) {
      return ORIENTATION_DEFAULT;
    }
    const value = view.getUint16(entry + 8, littleEndian);
    return value >= 1 && value <= 8 ? value : ORIENTATION_DEFAULT;
  }
  return ORIENTATION_DEFAULT;
}

// Returns a new image with the EXIF orientation undone, i.e. displayed upright.
// Orientations 5..8 swap width and height. Unknown values return an unchanged copy.
export function applyOrientation(image: OcrImage, orientation: number): OcrImage {
  const { width: w, height: h, data } = image;
  const transposed = orientation >= 5 && orientation <= 8;
  const outWidth = transposed ? h : w;
  const outHeight = transposed ? w : h;

  // For each output pixel (x, y), where it comes from in the input.
  let source: (x: number, y: number) => [number, number];
  switch (orientation) {
    case 2: source = (x, y) => [w - 1 - x, y]; break;
    case 3: source = (x, y) => [w - 1 - x, h - 1 - y]; break;
    case 4: source = (x, y) => [x, h - 1 - y]; break;
    case 5: source = (x, y) => [y, x]; break;
    case 6: source = (x, y) => [y, h - 1 - x]; break;
    case 7: source = (x, y) => [w - 1 - y, h - 1 - x]; break;
    case 8: source = (x, y) => [w - 1 - y, x]; break;
    default:
      return { width: w, height: h, data: new Uint8ClampedArray(data) };
  }

  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const [sx, sy] = source(x, y);
      const from = (sy * w + sx) * 4;
      const to = (y * outWidth + x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}
