import {
  factorize,
  multiplicationCombinations,
  additionCombinations,
  subtractionCombinations,
  divisionCombinations,
  combinationIsPossible,
} from './Util';

// Ported from api/src/test/scala/gg/kenken/solver/UtilTest.scala

describe('Util.factorize', () => {
  it('factorizes correctly', () => {
    expect(factorize(3)).toEqual([3]);
    expect(factorize(6)).toEqual([2, 3]);
    expect(factorize(27)).toEqual([3, 3, 3]);
    expect(factorize(45)).toEqual([3, 3, 5]);
  });
});

describe('Util.multiplicationCombinations', () => {
  it('generates correct multiplication combinations', () => {
    expect(multiplicationCombinations(2, 6, 6)).toEqual([[1, 6], [2, 3]]);
    expect(multiplicationCombinations(3, 6, 6)).toEqual([[1, 1, 6], [1, 2, 3]]);
    expect(multiplicationCombinations(3, 6, 60)).toEqual([[2, 5, 6], [3, 4, 5]]);
    expect(multiplicationCombinations(3, 6, 45)).toEqual([[3, 3, 5]]);
    expect(multiplicationCombinations(3, 6, 40)).toEqual([[2, 4, 5]]);
    expect(multiplicationCombinations(3, 6, 72)).toEqual([[3, 4, 6]]);
    expect(multiplicationCombinations(3, 6, 4)).toEqual([[1, 1, 4], [1, 2, 2]]);
    expect(multiplicationCombinations(3, 6, 12)).toEqual([[1, 2, 6], [1, 3, 4], [2, 2, 3]]);
  });
});

describe('Util.additionCombinations', () => {
  it('generates correct addition combinations', () => {
    expect(additionCombinations(2, 5, 4)).toEqual([[1, 3]]);
    expect(additionCombinations(2, 5, 5)).toEqual([[1, 4], [2, 3]]);
    expect(additionCombinations(3, 6, 4)).toEqual([[1, 1, 2]]);
    expect(additionCombinations(3, 6, 16)).toEqual([[4, 6, 6], [5, 5, 6]]);
    expect(additionCombinations(3, 6, 11)).toEqual([[1, 4, 6], [1, 5, 5], [2, 3, 6], [2, 4, 5], [3, 3, 5], [3, 4, 4]]);
    expect(additionCombinations(3, 6, 12)).toEqual([[1, 5, 6], [2, 4, 6], [2, 5, 5], [3, 3, 6], [3, 4, 5]]);
    expect(additionCombinations(2, 6, 8)).toEqual([[2, 6], [3, 5]]);
  });
});

describe('Util.subtractionCombinations', () => {
  it('generates correct subtraction combinations', () => {
    expect(subtractionCombinations(5, 1)).toEqual([[1, 2], [2, 3], [3, 4], [4, 5]]);
    expect(subtractionCombinations(5, 2)).toEqual([[1, 3], [2, 4], [3, 5]]);
    expect(subtractionCombinations(5, 3)).toEqual([[1, 4], [2, 5]]);
    expect(subtractionCombinations(5, 4)).toEqual([[1, 5]]);
    expect(subtractionCombinations(5, 5)).toEqual([]);
  });
});

describe('Util.divisionCombinations', () => {
  it('generates correct division combinations', () => {
    expect(divisionCombinations(6, 2)).toEqual([[1, 2], [2, 4], [3, 6]]);
    expect(divisionCombinations(6, 3)).toEqual([[1, 3], [2, 6]]);
    expect(divisionCombinations(6, 4)).toEqual([[1, 4]]);
    expect(divisionCombinations(6, 5)).toEqual([[1, 5]]);
    expect(divisionCombinations(6, 6)).toEqual([[1, 6]]);
  });
});

describe('Util.combinationIsPossible', () => {
  it('checks combination possibility correctly', () => {
    expect(combinationIsPossible([1, 2], [new Set([1, 2]), new Set([1, 2])])).toBe(true);
    expect(combinationIsPossible([1, 2], [new Set([2]), new Set([1])])).toBe(true);
    expect(combinationIsPossible([2, 1, 3], [new Set([1]), new Set([3]), new Set([1, 2])])).toBe(true);
    expect(combinationIsPossible([1, 2], [new Set([1, 2]), new Set([1, 3])])).toBe(true);
    expect(combinationIsPossible([1, 3], [new Set([1, 2]), new Set([1, 2])])).toBe(false);
  });
});
