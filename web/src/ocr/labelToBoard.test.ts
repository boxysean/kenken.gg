// The label fixtures are hand-written; their `expected` strings are the oracle
// for labelToBoard, and the repo's own solver must be able to solve every one.
import labelsJson from './__fixtures__/labels.json?raw';
import { solveFromAPI } from '../solver';
import { labelToBoard, validateLabel } from './labelToBoard';
import type { BoardConversion } from './labelToBoard';
import type { OcrLabel } from './types';

interface ValidFixture {
  name: string;
  label: OcrLabel;
  expected: BoardConversion;
}

interface InvalidFixture {
  name: string;
  reason: string;
  label: OcrLabel;
  expectedErrors: string[];
}

const fixtures = JSON.parse(labelsJson) as { valid: ValidFixture[]; invalid: InvalidFixture[] };

describe('labelToBoard', () => {
  it('covers at least three board sizes', () => {
    expect(new Set(fixtures.valid.map((fixture) => fixture.label.boardSize)).size).toBeGreaterThanOrEqual(3);
  });

  for (const fixture of fixtures.valid) {
    it(`${fixture.name}: validates cleanly and converts to the expected solver strings`, () => {
      expect(validateLabel(fixture.label)).toEqual([]);
      const conversion = labelToBoard(fixture.label);
      expect(conversion.boardStrings).toEqual(fixture.expected.boardStrings);
      expect(conversion.constraintString).toBe(fixture.expected.constraintString);
      expect(conversion.boardSize).toBe(fixture.expected.boardSize);
    });

    it(`${fixture.name}: converts to a puzzle the solver solves`, () => {
      const conversion = labelToBoard(fixture.label);
      expect(solveFromAPI(conversion.boardStrings, conversion.constraintString).solved).toBe(true);
    });
  }

  it('emits single-cell cages with no operator character', () => {
    const tokens = fixtures.valid.flatMap((fixture) => labelToBoard(fixture.label).constraintString.split(' '));
    // h=1 (4x4), k=4 (5x5), l=5 and n=2 (6x6) are the single-cell cages.
    expect(tokens).toEqual(expect.arrayContaining(['h=1', 'k=4', 'l=5', 'n=2']));
    const sixBySix = fixtures.valid.find((fixture) => fixture.name === 'six-by-six-kenken1')!;
    expect(labelToBoard(sixBySix.label).constraintString).toContain(' l=5 ');
    expect(labelToBoard(sixBySix.label).constraintString.endsWith(' n=2')).toBe(true);
  });

  it('orders cages by first occurrence on the board, not by clue order', () => {
    const fiveByFive = fixtures.valid.find((fixture) => fixture.label.boardSize === 5)!;
    expect(Object.keys(fiveByFive.label.clues)[0]).toBe('k');
    expect(labelToBoard(fiveByFive.label).constraintString.startsWith('a=6+ ')).toBe(true);
  });
});

describe('validateLabel', () => {
  for (const fixture of fixtures.invalid) {
    it(`${fixture.name}: reports ${fixture.reason}`, () => {
      const errors = validateLabel(fixture.label);
      expect(errors.length).toBeGreaterThan(0);
      for (const expected of fixture.expectedErrors) {
        expect(errors).toContain(expected);
      }
      // The fixtures list every error, in order, so nothing spurious slips in.
      expect(errors).toEqual(fixture.expectedErrors);
    });

    it(`${fixture.name}: does not make labelToBoard throw`, () => {
      expect(() => labelToBoard(fixture.label)).not.toThrow();
    });
  }

  it('catches a deliberately split cage and names its letter', () => {
    const splitCage = fixtures.invalid.find((fixture) => fixture.name === 'split-cage')!;
    expect(validateLabel(splitCage.label)).toEqual([
      'cage "b" is not contiguous: its 3 cells form 2 separate groups',
    ]);
  });
});
