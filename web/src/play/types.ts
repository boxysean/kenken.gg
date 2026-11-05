import type { Operator } from '../solver';

export interface PlayPuzzle {
  boardStrings: string[]; // solver board format: one string per row, letters space-separated
  constraintString: string; // solver constraint format: "a=3+ b=5x ..."
  solution: number[]; // row-major, boardSize*boardSize, values 1..boardSize
  boardSize: number;
  difficulty: DifficultyMetrics;
  seed: string;
}

export interface DifficultyMetrics {
  cageSizeHistogram: number[]; // index = cage size, value = number of cages of that size
  singleCellCages: number;
  forcedCells: number;
}

// Transient during generation only; never stored on PlayPuzzle.
export interface Cage {
  cells: number[]; // flat row-major indices
  operator: Operator;
  target: number;
  letter: string; // single character
}
