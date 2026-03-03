import { Constraint } from './Constraint';
import Operator from './Operator';
import { createGameState } from './GameState';

// Ported from api/src/test/scala/gg/kenken/solver/GameStateTest.scala

describe('GameState.reduceCellPossibilities', () => {
  it('reduces cell possibilities correctly for 3x3 board', () => {
    /*
      123 aab
      312 cdb
      231 cdb
    */
    const gameState = createGameState([
      new Constraint('a', 3, Operator.Addition),
      new Constraint('b', 6, Operator.Addition),
      new Constraint('c', 5, Operator.Addition),
      new Constraint('d', 4, Operator.Addition),
    ], [
      ['a', 'a', 'b'],
      ['c', 'd', 'b'],
      ['c', 'd', 'b'],
    ]).reduceCellPossibilities();

    expect(gameState.cellPossibilities[0][0]).toEqual(new Set([1]));
    expect(gameState.cellPossibilities[0][1]).toEqual(new Set([2]));
    expect(gameState.cellPossibilities[0][2]).toEqual(new Set([3]));
    expect(gameState.cellPossibilities[1][1]).toEqual(new Set([1, 3]));
    expect(gameState.cellPossibilities[2][1]).toEqual(new Set([1, 3]));
  });
});

describe('GameState.cellsWithoutCertainty', () => {
  it('identifies uncertain cells correctly', () => {
    const gameState = createGameState([
      new Constraint('a', 3, Operator.Addition),
      new Constraint('b', 6, Operator.Addition),
      new Constraint('c', 5, Operator.Addition),
      new Constraint('d', 4, Operator.Addition),
    ], [
      ['a', 'a', 'b'],
      ['c', 'd', 'b'],
      ['c', 'd', 'b'],
    ]).reduceCellPossibilities();

    expect(gameState.cellsWithoutCertainty()).toEqual([
      [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]
    ]);
  });
});

// Ported from api/src/test/scala/gg/kenken/solver/GameConstraintStateTest.scala
describe('GameConstraintState.placementIsLegal', () => {
  it('checks placement legality correctly', () => {
    const gameState = createGameState([
      new Constraint('a', 3, Operator.Addition),
      new Constraint('b', 6, Operator.Addition),
      new Constraint('c', 5, Operator.Addition),
      new Constraint('d', 4, Operator.Addition),
    ], [
      ['a', 'a', 'b'],
      ['c', 'd', 'b'],
      ['c', 'd', 'b'],
    ]).reduceCellPossibilities();

    expect(gameState.constraints.get('a').placementIsLegal(gameState)).toBe(true);
  });
});
