// The inverse of labelToBoard's input side: wraps a board (typically the
// editor's, after the user corrected a scan) and the detected corners into an
// OcrLabel, the schema in README.md, so corrections can be exported as training data.
import type { Clue, OcrLabel, OcrSource, Quad, ScannedBoard } from './types';

export function boardToLabel(
  board: ScannedBoard,
  corners: Quad,
  source: OcrSource = { kind: 'photo' },
): OcrLabel {
  // Fresh copies throughout: the label is serialised later, and the caller's
  // board (live editor state) must not change under it, nor it under the board.
  const clues: Record<string, Clue> = {};
  for (const [letter, { target, operator }] of Object.entries(board.clues)) {
    clues[letter] = { target, operator };
  }
  return {
    boardSize: board.boardSize,
    cageLetters: [...board.cageLetters],
    clues,
    corners: {
      tl: { ...corners.tl },
      tr: { ...corners.tr },
      br: { ...corners.br },
      bl: { ...corners.bl },
    },
    source: { ...source },
  };
}
