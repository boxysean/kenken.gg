// The label schema for KenKen OCR: what a scanned puzzle image is annotated
// with, and what the recogniser is expected to produce. See README.md.
import type { Operator } from '../solver/Operator';

export interface Point {
  x: number;
  y: number;
}

// Which way is up: tl = top-left, tr = top-right, br = bottom-right, bl = bottom-left.
export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

// A raster image as raw RGBA bytes, row-major. Deliberately not a canvas: jsdom has none.
export interface OcrImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Clue {
  target: number;
  operator: Operator;
}

export interface ScannedBoard {
  boardSize: number;
  // One row-string per row; single-character letters separated by single spaces,
  // exactly the boardStrings convention in web/src/play/types.ts.
  cageLetters: string[];
  // Keyed by cage letter. Every letter used on the board needs an entry.
  clues: Record<string, Clue>;
}

export interface OcrSource {
  kind: 'synthetic' | 'photo';
  seed?: string;
  styleTag?: string;
}

export interface OcrLabel extends ScannedBoard {
  corners: Quad;
  source: OcrSource;
}
