// Port of api/src/main/scala/gg/kenken/solver/GameConstraintState.scala.
//
// In Scala this class extends Constraint. Here it carries the same
// name/value/operator fields itself instead: Constraint.getGameConstraintState
// constructs a GameConstraintState, so a runtime `extends Constraint` would make
// the two modules a circular dependency that crashes ("Class extends value
// undefined") whenever Constraint.ts happens to be loaded first. Nothing in the
// solver calls Constraint methods on a GameConstraintState.
import type { CellLocation } from './Constraint';
import type { GameState } from './GameState';
import type { Operator } from './Operator';

export class GameConstraintState {
  constructor(
    readonly name: string,
    readonly value: number,
    readonly operator: Operator,
    readonly cellLocations: readonly CellLocation[],
    readonly possibleCombinations: readonly (readonly number[])[],
  ) {}

  toString(): string {
    return '' + this.name + '=' + this.value + '' + this.operator + ' (size: ' + this.constraintSize() + ')';
  }

  constraintSize(): number {
    return this.cellLocations.length;
  }

  possibleValuesOfCell(): number[] {
    return [...new Set(this.possibleCombinations.flat())].sort((a, b) => a - b);
  }

  isFullyPlaced(gameState: GameState): boolean {
    return this.cellLocations.every(([row, column]) => gameState.cellPossibilities[row][column].length === 1);
  }

  placementIsLegal(gameState: GameState): boolean {
    const placement = this.cellLocations
      .map(([row, column]) => gameState.cellPossibilities[row][column][0])
      .sort((a, b) => a - b);
    return this.possibleCombinations.some(
      (combination) =>
        combination.length === placement.length && combination.every((value, index) => value === placement[index]),
    );
  }
}
