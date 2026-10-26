/// <reference types="vite/client" />
// Drives the GameStateTest.scala and GameConstraintStateTest.scala expectations
// transcribed into __fixtures__/scala-parity.json; that JSON is the single
// source of truth.
import parityJson from './__fixtures__/scala-parity.json?raw';
import { Constraint } from './Constraint';
import { GameState } from './GameState';
import type { Operator } from './Operator';

interface Sourced {
  source: string;
}

interface ScalaParity {
  gameStatePuzzle: Sourced & {
    constraints: { name: string; value: number; operator: Operator }[];
    board: string[][];
  };
  reduceCellPossibilities: (Sourced & { row: number; column: number; expected: number[] })[];
  cellsWithoutCertainty: (Sourced & { expected: [number, number][] })[];
  placementIsLegal: (Sourced & { constraint: string; expected: boolean })[];
}

const parity = JSON.parse(parityJson) as ScalaParity;

// GameState(List(Constraint(...)), Array(...)).reduceCellPossibilities, as in
// every one of the transcribed Scala tests.
function reducedGameState(): GameState {
  const { constraints, board } = parity.gameStatePuzzle;
  const reduced = GameState.fromConstraints(
    constraints.map(({ name, value, operator }) => new Constraint(name, value, operator)),
    board.map((row) => [...row]),
  ).reduceCellPossibilities();
  if (reduced === null) {
    throw new Error('reduceCellPossibilities unexpectedly made no progress');
  }
  return reduced;
}

describe('GameState (transcribed from GameStateTest.scala)', () => {
  it('has every transcribed GameStateTest.scala / GameConstraintStateTest.scala assertion', () => {
    expect(parity.reduceCellPossibilities).toHaveLength(5);
    expect(parity.cellsWithoutCertainty).toHaveLength(1);
    expect(parity.placementIsLegal).toHaveLength(1);
  });

  describe('reduceCellPossibilities', () => {
    it.each(parity.reduceCellPossibilities)('$source: cell ($row, $column)', ({ row, column, expected }) => {
      expect(reducedGameState().cellPossibilities[row][column]).toEqual(expected);
    });
  });

  describe('cellsWithoutCertainty', () => {
    it.each(parity.cellsWithoutCertainty)('$source', ({ expected }) => {
      expect(reducedGameState().cellsWithoutCertainty()).toEqual(expected);
    });
  });
});

describe('GameConstraintState (transcribed from GameConstraintStateTest.scala)', () => {
  describe('placementIsLegal', () => {
    it.each(parity.placementIsLegal)('$source: constraint $constraint', ({ constraint, expected }) => {
      const gameState = reducedGameState();
      expect(gameState.constraints.get(constraint)?.placementIsLegal(gameState)).toBe(expected);
    });
  });
});
