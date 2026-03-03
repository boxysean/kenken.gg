import { Constraint } from './Constraint';

export class GameConstraintState extends Constraint {
  constructor(name, value, operator, cellLocations, possibleCombinations) {
    super(name, value, operator);
    this.cellLocations = cellLocations;
    this.possibleCombinations = possibleCombinations;
  }

  toString() {
    return '' + this.name + '=' + this.value + '' + this.operator + ' (size: ' + this.constraintSize() + ')';
  }

  constraintSize() {
    return this.cellLocations.length;
  }

  possibleValuesOfCell() {
    const values = new Set();
    for (const combination of this.possibleCombinations) {
      for (const val of combination) {
        values.add(val);
      }
    }
    return values;
  }

  isFullyPlaced(gameState) {
    return this.cellLocations.every(([row, column]) =>
      gameState.cellPossibilities[row][column].size === 1
    );
  }

  placementIsLegal(gameState) {
    const placement = this.cellLocations
      .map(([row, column]) => {
        const possSet = gameState.cellPossibilities[row][column];
        return Array.from(possSet)[0];
      })
      .sort((a, b) => a - b);

    return this.possibleCombinations.some(
      combo => JSON.stringify(combo) === JSON.stringify(placement)
    );
  }
}

export default GameConstraintState;
