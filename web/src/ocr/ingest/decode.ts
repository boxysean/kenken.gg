// Turning a user's photo File into an upright, bounded OcrImage. This is the only
// ingest module that touches browser APIs (createImageBitmap, canvas, FileReader);
// the orientation maths lives in exif.ts so it stays testable without them.
import type { OcrImage } from '../types';
import { applyOrientation, readExifOrientation } from './exif';

/**
 * The longest side of a decoded photo, in pixels. Larger photos are scaled down
 * (aspect ratio kept) so that max(width, height) <= INGEST_MAX_DIM; smaller ones
 * are left at their natural size. Phone cameras produce 12+ megapixel images,
 * which is far more than recognition needs and slow to walk as raw RGBA.
 */
export const INGEST_MAX_DIM = 1280;

const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export async function decodeFile(file: File): Promise<OcrImage> {
  if (SUPPORTED_TYPES.indexOf(file.type) < 0) {
    throw new Error("That file type isn't supported. Use a JPEG, PNG, or WebP photo.");
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error("This browser can't read photos. Try a recent version of Chrome, Firefox, or Safari.");
  }

  const orientation = readExifOrientation(new Uint8Array(await readBytes(file)));

  let bitmap: ImageBitmap;
  try {
    // Ask for the stored pixels, not the EXIF-rotated ones: orientation is applied
    // below by applyOrientation, and must not be applied twice.
    bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
  } catch {
    throw new Error("Couldn't read that photo. Try a different image.");
  }

  try {
    // Rotation doesn't change the longest side, so scaling before orienting is safe
    // and means only the small image is walked pixel by pixel.
    const scale = Math.min(1, INGEST_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const context = createContext(width, height);
    if (!context) {
      throw new Error("This browser can't read photos. Try a recent version of Chrome, Firefox, or Safari.");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);

    return applyOrientation({ width, height, data: pixels.data }, orientation);
  } finally {
    bitmap.close();
  }
}

// Renders an OcrImage as a data: URL for an <img>, or null where there is no
// canvas to draw with (jsdom).
export function imageToDataUrl(image: OcrImage): string | null {
  if (typeof document === 'undefined' || typeof ImageData === 'undefined') {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function createContext(width: number, height: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height).getContext('2d');
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Couldn't read that photo. Try a different image."));
    reader.readAsArrayBuffer(file);
  });
}
