// Cage recovery: turns the grid reading into a cage partition and one clue crop
// per cage. Cells joined by a thin edge are in the same cage, so a union-find
// across thin edges gives the partition directly; thick edges are never crossed
// and the outer frame is not an internal edge at all. The clue sits in the
// top-left corner of each cage's first cell in reading order, which is exactly
// the cell the union-find walk meets first, so that cell's corner is cropped.
//
// Clues are left empty here: reading the crops' text is a later stage.
import type { Clue, OcrImage, ScannedBoard } from '../types';
import { readGrid } from './grid';
import type { EdgeReading } from './grid';

const CAGE_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// The clue crop, as fractions of the cell pitch: a small inset past the grid
// line, then 0.7 wide by 0.6 tall. Width 0.7 rather than 0.6 because a 0.6 crop
// clips wide three-character clues on small boards; the renderer's own clue
// region is 0.7 x 0.55 of the cell interior.
const CROP_INSET = 0.03;
const CROP_WIDTH = 0.7;
const CROP_HEIGHT = 0.6;

export interface CellRef {
  row: number;
  col: number;
}

export interface ClueCrop {
  letter: string;
  crop: OcrImage;
  topLeftCell: CellRef;
  // Present only when a ground-truth label was passed to deriveCages: the label's
  // constraint for the cage, i.e. the expected result of reading this crop.
  expected?: Clue;
}

export interface DerivedCages {
  board: ScannedBoard; // clues is ALWAYS {}: the clue-reading stage fills it from the crops
  clueCrops: ClueCrop[];
  edges: EdgeReading[];
}

function cropImage(image: OcrImage, x0: number, y0: number, width: number, height: number): OcrImage {
  const left = Math.min(image.width, Math.max(0, x0));
  const top = Math.min(image.height, Math.max(0, y0));
  const w = Math.max(0, Math.min(width, image.width - left));
  const h = Math.max(0, Math.min(height, image.height - top));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const start = ((top + y) * image.width + left) * 4;
    data.set(image.data.subarray(start, start + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

export function deriveCages(flat: OcrImage, label?: ScannedBoard): DerivedCages {
  const grid = readGrid(flat);
  const n = grid.boardSize;
  const { lineX, lineY } = grid;

  const parent = Array.from({ length: n * n }, (_, index) => index);
  const find = (cell: number): number => {
    while (parent[cell] !== cell) {
      parent[cell] = parent[parent[cell]];
      cell = parent[cell];
    }
    return cell;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  for (const edge of grid.edges) {
    if (edge.isThick) continue;
    if (edge.dir === 'v') union(edge.row * n + edge.col - 1, edge.row * n + edge.col);
    else union((edge.row - 1) * n + edge.col, edge.row * n + edge.col);
  }

  const letterOfRoot = new Map<number, string>();
  const rows: string[][] = [];
  const clueCrops: ClueCrop[] = [];
  for (let row = 0; row < n; row++) {
    const letters: string[] = [];
    for (let col = 0; col < n; col++) {
      const root = find(row * n + col);
      let letter = letterOfRoot.get(root);
      if (letter === undefined) {
        if (letterOfRoot.size >= CAGE_LETTERS.length) {
          throw new Error(`deriveCages: more than ${CAGE_LETTERS.length} cages; ran out of cage letters`);
        }
        letter = CAGE_LETTERS[letterOfRoot.size];
        letterOfRoot.set(root, letter);

        const pitchX = lineX[col + 1] - lineX[col];
        const pitchY = lineY[row + 1] - lineY[row];
        const x0 = Math.max(0, Math.round(lineX[col] + CROP_INSET * pitchX));
        const y0 = Math.max(0, Math.round(lineY[row] + CROP_INSET * pitchY));
        const crop: ClueCrop = {
          letter,
          crop: cropImage(flat, x0, y0, Math.round(CROP_WIDTH * pitchX), Math.round(CROP_HEIGHT * pitchY)),
          topLeftCell: { row, col },
        };
        // Looked up by cell, not by letter, so it holds whatever the label calls the cage.
        if (label !== undefined) crop.expected = label.clues[label.cageLetters[row].split(' ')[col]];
        clueCrops.push(crop);
      }
      letters.push(letter);
    }
    rows.push(letters);
  }

  return {
    board: { boardSize: n, cageLetters: rows.map((letters) => letters.join(' ')), clues: {} },
    clueCrops,
    edges: grid.edges,
  };
}
