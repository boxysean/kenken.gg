/// <reference types="vite/client" />
// Drives the UtilTest.scala expectations transcribed into
// __fixtures__/scala-parity.json; that JSON is the single source of truth.
import parityJson from './__fixtures__/scala-parity.json?raw';
import { KenKenSolverException } from './Constraint';
import {
  additionCombinations,
  combinationIsPossible,
  divisionCombinations,
  factorize,
  multiplicationCombinations,
  subtractionCombinations,
} from './Util';

interface Sourced {
  source: string;
}

interface ScalaParity {
  factorize: (Sourced & { input: number; expected: number[] })[];
  multiplicationCombinations: (Sourced & { remainingValues: number; maxValue: number; targetValue: number; expected: number[][] })[];
  additionCombinations: (Sourced & { remainingValues: number; maxValue: number; targetValue: number; expected: number[][] })[];
  subtractionCombinations: (Sourced & { maxValue: number; targetValue: number; expected: number[][] })[];
  divisionCombinations: (Sourced & { maxValue: number; targetValue: number; expected: number[][] })[];
  combinationIsPossible: (Sourced & { combination: number[]; cellPossibilities: number[][]; expected: boolean })[];
}

const parity = JSON.parse(parityJson) as ScalaParity;

describe('Util (transcribed from UtilTest.scala)', () => {
  it('has every transcribed UtilTest.scala assertion', () => {
    expect(parity.factorize).toHaveLength(4);
    expect(parity.multiplicationCombinations).toHaveLength(8);
    expect(parity.additionCombinations).toHaveLength(7);
    expect(parity.subtractionCombinations).toHaveLength(5);
    expect(parity.divisionCombinations).toHaveLength(5);
    expect(parity.combinationIsPossible).toHaveLength(5);
  });

  describe('factorize', () => {
    it.each(parity.factorize)('$source: factorize($input)', ({ input, expected }) => {
      expect(factorize(input)).toEqual(expected);
    });

    it('is partial like the Scala match: factorize(1) is empty, unknown primes throw', () => {
      expect(factorize(1)).toEqual([]);
      expect(() => factorize(11)).toThrow(KenKenSolverException);
    });
  });

  describe('multiplicationCombinations', () => {
    it.each(parity.multiplicationCombinations)(
      '$source: multiplicationCombinations($remainingValues, $maxValue, $targetValue)',
      ({ remainingValues, maxValue, targetValue, expected }) => {
        expect(multiplicationCombinations(remainingValues, maxValue, targetValue)).toEqual(expected);
      },
    );
  });

  describe('additionCombinations', () => {
    it.each(parity.additionCombinations)(
      '$source: additionCombinations($remainingValues, $maxValue, $targetValue)',
      ({ remainingValues, maxValue, targetValue, expected }) => {
        expect(additionCombinations(remainingValues, maxValue, targetValue)).toEqual(expected);
      },
    );
  });

  describe('subtractionCombinations', () => {
    it.each(parity.subtractionCombinations)(
      '$source: subtractionCombinations($maxValue, $targetValue)',
      ({ maxValue, targetValue, expected }) => {
        expect(subtractionCombinations(maxValue, targetValue)).toEqual(expected);
      },
    );
  });

  describe('divisionCombinations', () => {
    it.each(parity.divisionCombinations)(
      '$source: divisionCombinations($maxValue, $targetValue)',
      ({ maxValue, targetValue, expected }) => {
        expect(divisionCombinations(maxValue, targetValue)).toEqual(expected);
      },
    );
  });

  describe('combinationIsPossible', () => {
    it.each(parity.combinationIsPossible)(
      '$source: combinationIsPossible($combination, $cellPossibilities)',
      ({ combination, cellPossibilities, expected }) => {
        expect(combinationIsPossible(combination, cellPossibilities)).toBe(expected);
      },
    );
  });
});
