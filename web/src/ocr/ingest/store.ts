// The most recently ingested photo, shared between the scan UI and whatever reads it next.
import type { OcrImage } from '../types';

export type IngestListener = (image: OcrImage | null) => void;

let current: OcrImage | null = null;
const listeners = new Set<IngestListener>();

export function getImage(): OcrImage | null {
  return current;
}

export function setImage(image: OcrImage | null): void {
  current = image;
  listeners.forEach((listener) => listener(current));
}

export function clearImage(): void {
  setImage(null);
}

// Calls the listener with the current image right away, then on every change.
export function subscribe(listener: IngestListener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
