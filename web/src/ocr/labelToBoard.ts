// Converts an OCR label into the solver's own puzzle strings, mirroring the
// generator's emit stage (finish() in web/src/play/generator/generate.ts), and
// validates a label before it is converted. See README.md.
import type { ScannedBoard } from './types';

export interface BoardConversion {
  boardStrings: string[];
  constraintString: string;
  boardSize: number;
}

function hasClue(label: ScannedBoard, letter: string): boolean {
  return Object.prototype.hasOwnProperty.call(label.clues, letter);
}

// Cage letters in first-occurrence, row-major reading order.
function lettersInReadingOrder(rows: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const letter of row) seen.add(letter);
  }
  return [...seen];
}

// Defined on valid labels only (call validateLabel first). On an invalid label
// it does not throw: it emits tokens for board letters that have a clue and
// ignores clues for letters absent from the board.
export function labelToBoard(label: ScannedBoard): BoardConversion {
  const rows = label.cageLetters.map((row) => row.split(/\s+/).filter((token) => token !== ''));
  const boardStrings = rows.map((row) => row.join(' '));
  const constraintString = lettersInReadingOrder(rows)
    .filter((letter) => hasClue(label, letter))
    .map((letter) => {
      const { target, operator } = label.clues[letter];
      return `${letter}=${target}${operator}`;
    })
    .join(' ');
  return { boardStrings, constraintString, boardSize: label.boardSize };
}

const OPERATORS: readonly string[] = ['+', '-', 'x', '/', ''];

// Returns every problem with the label, empty when it is valid. Shape checks
// come first, then contiguity, then clue coverage; within each, row-major
// order for cells and cages, then clue order for clues.
export function validateLabel(label: ScannedBoard): string[] {
  const errors: string[] = [];
  const { boardSize } = label;

  // Shape. Cells are split on single spaces, so a double or trailing space
  // shows up as an empty cell rather than being silently absorbed.
  if (!Number.isInteger(boardSize) || boardSize < 1) {
    errors.push(`boardSize ${boardSize} is not a positive integer`);
  } else if (label.cageLetters.length !== boardSize) {
    errors.push(`boardSize ${boardSize} does not match ${label.cageLetters.length} rows`);
  }
  const cells = label.cageLetters.map((row) => row.split(' '));
  cells.forEach((row, rowIndex) => {
    if (row.length !== boardSize) {
      errors.push(`row ${rowIndex} has ${row.length} cells, expected ${boardSize}`);
    }
    row.forEach((token, column) => {
      if (token === '') {
        errors.push(`row ${rowIndex}, column ${column} is empty`);
      } else if (token.length !== 1) {
        errors.push(`row ${rowIndex}, column ${column} is ${JSON.stringify(token)}, which is not a single character`);
      }
    });
  });

  // Contiguity: a cage letter's cells must form exactly one 4-connected group.
  const letterAt = (row: number, column: number): string | undefined => {
    const token = cells[row]?.[column];
    return token !== undefined && token.length === 1 ? token : undefined;
  };
  const letters = lettersInReadingOrder(cells.map((row) => row.filter((token) => token.length === 1)));
  for (const letter of letters) {
    const visited = cells.map((row) => new Array<boolean>(row.length).fill(false));
    let cellCount = 0;
    let groups = 0;
    cells.forEach((row, rowIndex) => {
      row.forEach((_, column) => {
        if (letterAt(rowIndex, column) !== letter) return;
        cellCount++;
        if (visited[rowIndex][column]) return;
        groups++;
        const stack: [number, number][] = [[rowIndex, column]];
        visited[rowIndex][column] = true;
        while (stack.length > 0) {
          const [r, c] = stack.pop()!;
          for (const [dr, dc] of [
            [-1, 0],
            [0, 1],
            [1, 0],
            [0, -1],
          ]) {
            if (letterAt(r + dr, c + dc) === letter && !visited[r + dr][c + dc]) {
              visited[r + dr][c + dc] = true;
              stack.push([r + dr, c + dc]);
            }
          }
        }
      });
    });
    if (groups > 1) {
      errors.push(`cage ${JSON.stringify(letter)} is not contiguous: its ${cellCount} cells form ${groups} separate groups`);
    }
  }

  // Clue coverage, then the clues themselves.
  for (const letter of letters) {
    if (!hasClue(label, letter)) errors.push(`cage ${JSON.stringify(letter)} has no clue`);
  }
  const onBoard = new Set(letters);
  for (const [letter, clue] of Object.entries(label.clues)) {
    const name = JSON.stringify(letter);
    if (!onBoard.has(letter)) errors.push(`clue ${name} does not appear on the board`);
    if (!Number.isInteger(clue.target) || clue.target < 1) {
      errors.push(`clue ${name} has target ${clue.target}, which is not a positive integer`);
    }
    if (!OPERATORS.includes(clue.operator)) {
      errors.push(`clue ${name} has operator ${JSON.stringify(clue.operator)}, which is not one of "+", "-", "x", "/" or ""`);
    }
  }

  return errors;
}
