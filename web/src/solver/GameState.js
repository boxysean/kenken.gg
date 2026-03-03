import { generatePossibilities } from './Util';

export class GameState {
  constructor(constraints, board, cellPossibilities, placed) {
    this.constraints = constraints;
    this.board = board;
    this.cellPossibilities = cellPossibilities;
    this.placed = placed;
  }

  get boardSize() {
    return this.board.length;
  }

  constraintAt(row, column) {
    return this.constraints.get(this.board[row][column]);
  }

  clone() {
    return new GameState(
      this.constraints,
      this.board.map(row => row.slice()),
      this.cellPossibilities.map(row => row.map(s => new Set(s))),
      this.placed.map(row => row.slice())
    );
  }

  isSolved() {
    for (let row = 0; row < this.boardSize; row++) {
      for (let col = 0; col < this.boardSize; col++) {
        if (this.cellPossibilities[row][col].size !== 1) return false;
      }
    }
    return true;
  }

  allCellsHaveAChoice() {
    for (let row = 0; row < this.boardSize; row++) {
      for (let col = 0; col < this.boardSize; col++) {
        if (this.cellPossibilities[row][col].size === 0) return false;
      }
    }
    return true;
  }

  allPlacementsAreLegal() {
    for (const constraint of this.constraints.values()) {
      if (constraint.isFullyPlaced(this)) {
        if (!constraint.placementIsLegal(this)) return false;
      }
    }
    return true;
  }

  isPossible() {
    return this.allCellsHaveAChoice() && this.allPlacementsAreLegal();
  }

  reduceCellPossibilities() {
    const newGameState = this.clone();
    let modified = false;

    // Row scan
    for (let row = 0; row < newGameState.boardSize; row++) {
      const histogram = new Map();

      for (let column = 0; column < newGameState.boardSize; column++) {
        const key = setToKey(newGameState.cellPossibilities[row][column]);
        if (!histogram.has(key)) {
          histogram.set(key, {
            possibilities: newGameState.cellPossibilities[row][column],
            cells: []
          });
        }
        histogram.get(key).cells.push([row, column]);
      }

      for (const [, entry] of histogram) {
        if (entry.possibilities.size === entry.cells.length) {
          for (let column = 0; column < newGameState.boardSize; column++) {
            const isInGroup = entry.cells.some(([r, c]) => r === row && c === column);
            if (!isInGroup) {
              const before = newGameState.cellPossibilities[row][column].size;
              const newSet = new Set(
                [...newGameState.cellPossibilities[row][column]].filter(v => !entry.possibilities.has(v))
              );
              if (newSet.size < before) {
                modified = true;
              }
              newGameState.cellPossibilities[row][column] = newSet;
            }
          }
        }
      }
    }

    // Column scan
    for (let column = 0; column < newGameState.boardSize; column++) {
      const histogram = new Map();

      for (let row = 0; row < newGameState.boardSize; row++) {
        const key = setToKey(newGameState.cellPossibilities[row][column]);
        if (!histogram.has(key)) {
          histogram.set(key, {
            possibilities: newGameState.cellPossibilities[row][column],
            cells: []
          });
        }
        histogram.get(key).cells.push([row, column]);
      }

      for (const [, entry] of histogram) {
        if (entry.possibilities.size === entry.cells.length) {
          for (let row = 0; row < newGameState.boardSize; row++) {
            const isInGroup = entry.cells.some(([r, c]) => r === row && c === column);
            if (!isInGroup) {
              const before = newGameState.cellPossibilities[row][column].size;
              const newSet = new Set(
                [...newGameState.cellPossibilities[row][column]].filter(v => !entry.possibilities.has(v))
              );
              if (newSet.size < before) {
                modified = true;
              }
              newGameState.cellPossibilities[row][column] = newSet;
            }
          }
        }
      }
    }

    if (modified) {
      return newGameState;
    } else {
      return null;
    }
  }

  cellsWithoutCertainty() {
    const cells = [];
    for (let row = 0; row < this.boardSize; row++) {
      for (let column = 0; column < this.boardSize; column++) {
        if (this.cellPossibilities[row][column].size > 1) {
          cells.push([row, column]);
        }
      }
    }
    return cells;
  }

  pickSomething() {
    const picked = this.cellsWithoutCertainty()[0];
    const value = Array.from(this.cellPossibilities[picked[0]][picked[1]])[0];
    return [picked[0], picked[1], value];
  }

  tryIt(row, column, value) {
    const newGameState = this.clone();
    newGameState.cellPossibilities[row][column] = new Set([value]);
    return newGameState;
  }

  definitelyNotThis(row, column, value) {
    const newGameState = this.clone();
    const newSet = new Set(newGameState.cellPossibilities[row][column]);
    newSet.delete(value);
    newGameState.cellPossibilities[row][column] = newSet;
    return newGameState;
  }

  solve() {
    if (!this.isPossible()) {
      return null;
    }

    if (this.isSolved()) {
      return this;
    }

    // Try to reduce cell possibilities
    const reduce = this.reduceCellPossibilities();
    if (reduce != null) {
      return reduce.solve();
    }

    // Pick a cell/value and try it
    const [row, column, value] = this.pickSomething();

    const tryItBoard = this.tryIt(row, column, value).solve();
    if (tryItBoard != null) {
      return tryItBoard;
    } else {
      return this.definitelyNotThis(row, column, value).solve();
    }
  }

  toString() {
    return this.cellPossibilities.map(row =>
      row.map(possibilities => {
        const arr = Array.from(possibilities);
        if (arr.length === 1) return arr[0].toString();
        return '.';
      }).join(' ')
    ).join('\n');
  }

  toJson() {
    return this.cellPossibilities.map(row =>
      row.map(possibilities => {
        const arr = Array.from(possibilities);
        if (arr.length === 1) return arr[0].toString();
        return '.';
      })
    );
  }
}

function setToKey(s) {
  return Array.from(s).sort((a, b) => a - b).join(',');
}

export function createGameState(constraints, board) {
  const { GameConstraintState } = require('./GameConstraintState');
  const { Constraint } = require('./Constraint');

  const size = board.length;
  const initPossibilities = [];
  const gameConstraintStates = new Map();

  for (const constraint of constraints) {
    gameConstraintStates.set(constraint.name, constraint.getGameConstraintState(board));
  }

  for (let row = 0; row < size; row++) {
    const rowPossibilities = [];
    for (let column = 0; column < size; column++) {
      const constraint = gameConstraintStates.get(board[row][column]);
      rowPossibilities.push(constraint.possibleValuesOfCell());
    }
    initPossibilities.push(rowPossibilities);
  }

  const placed = [];
  for (let row = 0; row < size; row++) {
    placed.push(new Array(size).fill(false));
  }

  return new GameState(gameConstraintStates, board, initPossibilities, placed);
}

export default GameState;
