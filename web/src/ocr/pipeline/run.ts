// The whole photo-to-board pipeline in one call: corners, warp, cages, clues.
// It never throws: the UI shows whatever went wrong instead of a crash, so each
// stage's failure is caught and reported as "<stage>: <reason>". A failed stage
// stops the run, but what the earlier stages found (e.g. the corners) is kept.
import type { Clue, OcrImage, Quad, ScannedBoard } from '../types';
import { detectCorners } from './corners';
import { warpToBoard } from './warp';
import { deriveCages } from './cages';
import type { DerivedCages } from './cages';
import { readAll } from './clueReader';
import type { CageReading, ClueReader } from './clueReader';

// Below this the frame is not trusted. The committed fixtures score 0.992-1.000
// and a blank image scores exactly 0, so 0.5 sits well clear of both.
export const MIN_CORNER_CONFIDENCE = 0.5;

export interface ScanResult {
  board?: ScannedBoard;
  corners?: Quad;
  // Cages whose clue the reader declined, in cage order: they need a human look.
  lowConfidenceCages: string[];
  errors: string[];
}

function reason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function scanPhoto(image: OcrImage, reader: ClueReader): ScanResult {
  const errors: string[] = [];
  const failed = (corners?: Quad): ScanResult => (corners ? { corners, lowConfidenceCages: [], errors } : { lowConfidenceCages: [], errors });

  let corners: Quad;
  try {
    const detection = detectCorners(image);
    if (!(detection.confidence >= MIN_CORNER_CONFIDENCE)) {
      // detectCorners falls back to the full-image quad rather than failing, so
      // a low score is the only sign there is no board in the photo.
      errors.push(`corners: no board frame found (confidence ${detection.confidence.toFixed(2)})`);
      return failed();
    }
    corners = detection.quad;
  } catch (error) {
    errors.push(`corners: ${reason(error)}`);
    return failed();
  }

  let flat: OcrImage;
  try {
    flat = warpToBoard(image, corners);
  } catch (error) {
    errors.push(`warp: ${reason(error)}`);
    return failed(corners);
  }

  let derived: DerivedCages;
  try {
    // No label: this is a real scan, there is no ground truth to attach.
    derived = deriveCages(flat);
  } catch (error) {
    errors.push(`cages: ${reason(error)}`);
    return failed(corners);
  }

  let readings: CageReading[];
  try {
    readings = readAll(derived.clueCrops, reader);
  } catch (error) {
    errors.push(`clues: ${reason(error)}`);
    return failed(corners);
  }

  // An unread clue is left out rather than guessed: the cage partition is still
  // worth loading, and the user fills the gap in the editor.
  const clues: Record<string, Clue> = {};
  const lowConfidenceCages: string[] = [];
  for (const { letter, result } of readings) {
    if (result === null) {
      lowConfidenceCages.push(letter);
    } else {
      clues[letter] = { target: result.target, operator: result.operator ?? '' };
    }
  }

  return {
    board: { boardSize: derived.board.boardSize, cageLetters: derived.board.cageLetters, clues },
    corners,
    lowConfidenceCages,
    errors,
  };
}
