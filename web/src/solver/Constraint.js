import { operatorFromString } from './Operator';
import { generatePossibilities } from './Util';

export class Constraint {
  constructor(name, value, operator) {
    this.name = name;
    this.value = value;
    this.operator = operator;
  }

  toString() {
    return '' + this.name + '=' + this.value + '' + this.operator;
  }

  getConstraintCellLocations(board, row, column, visited) {
    if (!visited) {
      visited = [];
      for (let r = 0; r < board.length; r++) {
        visited.push(new Array(board.length).fill(false));
      }
    }

    let cellLocations = [[row, column]];
    visited[row][column] = true;

    const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    for (const [dr, dc] of directions) {
      const nr = row + dr;
      const nc = column + dc;
      if (
        nr >= 0 && nr < board.length &&
        nc >= 0 && nc < board.length &&
        board[nr][nc] === this.name &&
        !visited[nr][nc]
      ) {
        cellLocations = cellLocations.concat(
          this.getConstraintCellLocations(board, nr, nc, visited)
        );
      }
    }

    return cellLocations;
  }

  getGameConstraintState(board) {
    // Lazily import to avoid circular dependency
    const { GameConstraintState } = require('./GameConstraintState');

    let cellLocations = [];

    for (let row = 0; row < board.length; row++) {
      for (let column = 0; column < board.length; column++) {
        if (board[row][column] === this.name) {
          cellLocations = this.getConstraintCellLocations(board, row, column);
          // Break out of both loops
          row = board.length;
          break;
        }
      }
    }

    return new GameConstraintState(
      this.name,
      this.value,
      this.operator,
      cellLocations,
      generatePossibilities({ operator: this.operator, value: this.value }, cellLocations.length, board.length)
    );
  }
}

export default Constraint;
