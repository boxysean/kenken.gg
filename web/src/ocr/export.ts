// Turns the editor board into the file the export control saves: a full label
// when the photo's corners are known, a board-only label otherwise. See README.md.
import { boardToLabel } from './boardToLabel';
import type { Clue, OcrLabel, OcrSource, Quad, ScannedBoard } from './types';

export const LABEL_FILENAME = 'kenken-label.json';
export const BOARD_FILENAME = 'kenken-board.json';

// Saves a value as a pretty-printed JSON file through a temporary object URL.
// Kept apart from the component so tests can drive it with Blob and URL stubbed.
export function downloadJson(value: unknown, filename: string = LABEL_FILENAME): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  // Firefox ignores clicks on links that are not in the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The artefact for a board: a full label when corners are known, a board-only
// label otherwise. Never invents corners.
export function boardExport(
  board: ScannedBoard,
  corners?: Quad | null,
  source: OcrSource = { kind: 'photo' },
): { value: OcrLabel; filename: string } {
  if (corners) {
    return { value: boardToLabel(board, corners, source), filename: LABEL_FILENAME };
  }
  // Fresh copies, as in boardToLabel: the value is serialised later, and the
  // editor board must not change under it. No corners key at all, not null.
  const clues: Record<string, Clue> = {};
  for (const [letter, { target, operator }] of Object.entries(board.clues)) {
    clues[letter] = { target, operator };
  }
  return {
    value: {
      boardSize: board.boardSize,
      cageLetters: [...board.cageLetters],
      clues,
      source: { kind: 'manual' },
    },
    filename: BOARD_FILENAME,
  };
}
