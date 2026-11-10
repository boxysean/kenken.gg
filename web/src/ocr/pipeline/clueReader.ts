// The clue-reading seam: a ClueReader turns one cage's clue crop into a target
// and operator, or declines. Readers are swappable (template matching today, a
// learned model later) and are compared through readAll on labelled crops.
import type { Operator } from '../../solver/Operator';
import type { Clue, OcrImage } from '../types';
import type { ClueCrop } from './cages';

export interface ClueReading {
  target: number;
  operator: Operator | null; // null means a single-cell (constant) cage, never ''
  confidence: number; // in [0, 1]; higher = more confident
}

export interface ClueReader {
  // null = below the reader's confidence threshold or an unusable crop. A reader
  // never guesses: "needs review" is always better than a confident wrong clue.
  read(crop: OcrImage): ClueReading | null;
}

export interface CageReading {
  letter: string;
  crop: OcrImage;
  expected?: Clue;
  result: ClueReading | null;
}

// Runs a reader over every cage crop, preserving order, for evaluation.
export function readAll(crops: readonly ClueCrop[], reader: ClueReader): CageReading[] {
  return crops.map(({ letter, crop, expected }) => {
    const reading: CageReading = { letter, crop, result: reader.read(crop) };
    if (expected !== undefined) reading.expected = expected;
    return reading;
  });
}
