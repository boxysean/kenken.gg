// Port of api/src/main/scala/gg/kenken/solver/Constraint.scala, plus
// KenKenSolverException from api/src/main/scala/gg/kenken/BaseException.scala.
import type { Operator } from './Operator';
import { GameConstraintState } from './GameConstraintState';
import { generatePossibilities } from './Util';

export class KenKenSolverException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KenKenSolverException';
  }
}

export type CellLocation = [number, number];

export class Constraint {
  constructor(
    // A single character, as Scala's `Char`.
    readonly name: string,
    readonly value: number,
    readonly operator: Operator,
  ) {}

  toString(): string {
    return '' + this.name + '=' + this.value + '' + this.operator;
  }

  getConstraintCellLocations(board: readonly (readonly string[])[], row: number, column: number): CellLocation[];
  getConstraintCellLocations(
    board: readonly (readonly string[])[],
    row: number,
    column: number,
    visited: boolean[][],
  ): CellLocation[];
  getConstraintCellLocations(
    board: readonly (readonly string[])[],
    row: number,
    column: number,
    visited?: boolean[][],
  ): CellLocation[] {
    if (visited === undefined) {
      return this.getConstraintCellLocations(
        board,
        row,
        column,
        board.map(() => new Array<boolean>(board.length).fill(false)),
      );
    }

    let cellLocations: CellLocation[] = [[row, column]];
    visited[row][column] = true;

    const deltas: CellLocation[] = [
      [-1, 0],
      [0, 1],
      [1, 0],
      [0, -1],
    ];
    for (const [dr, dc] of deltas) {
      // The board is square: Scala bounds both coordinates by board.length.
      if (
        0 <= row + dr &&
        row + dr < board.length &&
        0 <= column + dc &&
        column + dc < board.length &&
        board[row + dr][column + dc] === this.name &&
        !visited[row + dr][column + dc]
      ) {
        cellLocations = cellLocations.concat(this.getConstraintCellLocations(board, row + dr, column + dc, visited));
      }
    }

    return cellLocations;
  }

  getGameConstraintState(board: readonly (readonly string[])[]): GameConstraintState {
    let cellLocations: CellLocation[] = [];

    search: for (let row = 0; row < board.length; row++) {
      for (let column = 0; column < board.length; column++) {
        if (board[row][column] === this.name) {
          cellLocations = this.getConstraintCellLocations(board, row, column);
          break search;
        }
      }
    }

    return new GameConstraintState(
      this.name,
      this.value,
      this.operator,
      cellLocations,
      generatePossibilities(this, cellLocations.length, board.length),
    );
  }
}
