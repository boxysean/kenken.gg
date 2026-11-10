// Binarisation: RGBA -> luma -> a global Otsu threshold -> a 0/1 ink mask.
// A single global threshold is enough for printed puzzles under mild lighting
// damage (the renderer's glare is capped well below the ink/paper midpoint),
// and it keeps every later stage working on one shared, deterministic mask.
import type { OcrImage } from '../types';

// Returned when the histogram has no two-class split at all (a constant image):
// the ink/paper midpoint, so a blank white page is all paper.
const FALLBACK_THRESHOLD = 128;

// ITU-R BT.601 luma, rounded to the nearest integer.
export function grayscale(image: OcrImage): Uint8Array {
  const { width, height, data } = image;
  const gray = new Uint8Array(width * height);
  for (let index = 0, offset = 0; index < gray.length; index++, offset += 4) {
    gray[index] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
  }
  return gray;
}

// Otsu's method: pick the split of the 256-bin histogram that maximises the
// between-class variance w0 * w1 * (mu0 - mu1)^2 (equivalently, minimises the
// within-class variance). Pixels with value <= k form the dark class, so the
// returned threshold is k + 1 and `value < threshold` means ink. Ties keep the
// first maximum; a histogram with only one occupied bin has no split with
// positive variance and falls back to the midpoint.
export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Float64Array(256);
  for (let index = 0; index < gray.length; index++) histogram[gray[index]]++;
  const total = gray.length;
  if (total === 0) return FALLBACK_THRESHOLD;

  let sumAll = 0;
  for (let value = 0; value < 256; value++) sumAll += value * histogram[value];

  let weightDark = 0;
  let sumDark = 0;
  let bestVariance = 0;
  let bestSplit = -1;
  for (let k = 0; k < 255; k++) {
    weightDark += histogram[k];
    sumDark += k * histogram[k];
    const weightLight = total - weightDark;
    if (weightDark === 0) continue;
    if (weightLight === 0) break;
    const meanDark = sumDark / weightDark;
    const meanLight = (sumAll - sumDark) / weightLight;
    const variance = weightDark * weightLight * (meanDark - meanLight) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestSplit = k;
    }
  }
  return bestSplit < 0 ? FALLBACK_THRESHOLD : bestSplit + 1;
}

export interface BinarizedImage {
  gray: Uint8Array;
  ink: Uint8Array;
  threshold: number;
}

export function binarize(image: OcrImage): BinarizedImage {
  const gray = grayscale(image);
  const threshold = otsuThreshold(gray);
  const ink = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index++) ink[index] = gray[index] < threshold ? 1 : 0;
  return { gray, ink, threshold };
}
