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

  it('rejects a cage named by a control character', () => {
    const fourByFour = fixtures.valid.find((fixture) => fixture.name === 'four-by-four-dominoes')!;
    const label = JSON.parse(JSON.stringify(fourByFour.label)) as OcrLabel;
    label.cageLetters = label.cageLetters.map((row) =>
      row
        .split(' ')
        .map((token) => (token === 'b' ? '\u007f' : token))
        .join(' '),
    );
    label.clues['\u007f'] = label.clues.b;
    delete label.clues.b;
    // JSON.stringify escapes only C0 controls, so DEL appears raw in the
    // message. Like the other shape checks, every cell of the cage is reported.
    expect(validateLabel(label)).toEqual([
      'row 0, column 2 is "\u007f", which is not a printable cage letter',
      'row 1, column 2 is "\u007f", which is not a printable cage letter',
    ]);
  });

  describe('corners', () => {
    const fourByFour = () => {
      const fixture = fixtures.valid.find((candidate) => candidate.name === 'four-by-four-dominoes')!;
      return JSON.parse(JSON.stringify(fixture.label)) as OcrLabel;
    };
    const QUAD = { tl: { x: 1, y: 2 }, tr: { x: 30, y: 2 }, br: { x: 30, y: 31 }, bl: { x: 1, y: 31 } };

    it('accepts a board-only label with no corners key', () => {
      const { corners: _corners, ...rest } = fourByFour();
      const label: OcrLabel = { ...rest, source: { kind: 'manual' } };
      expect('corners' in label).toBe(false);
      expect(validateLabel(label)).toEqual([]);
    });

    it('accepts corners: undefined', () => {
      expect(validateLabel({ ...fourByFour(), corners: undefined })).toEqual([]);
    });

    it('still validates a full quad', () => {
      expect(validateLabel({ ...fourByFour(), corners: QUAD })).toEqual([]);
    });

    it('still checks the board half of a board-only label', () => {
      const { corners: _corners, ...rest } = fourByFour();
      const label: OcrLabel = { ...rest, source: { kind: 'manual' } };
      label.clues = {};
      expect(validateLabel(label).length).toBeGreaterThan(0);
    });

    it('rejects a partial quad, one error per missing corner', () => {
      const label = { ...fourByFour(), corners: { tl: QUAD.tl, tr: QUAD.tr } } as unknown as OcrLabel;
      expect(validateLabel(label)).toEqual([
        'corners.br is missing or not an {x, y} point',
        'corners.bl is missing or not an {x, y} point',
      ]);
    });

    it('rejects a non-numeric or non-finite coordinate', () => {
      const label = {
        ...fourByFour(),
        corners: { ...QUAD, tr: { x: '30', y: 2 }, bl: { x: 1, y: Number.NaN } },
      } as unknown as OcrLabel;
      expect(validateLabel(label)).toEqual([
        'corners.tr is missing or not an {x, y} point',
        'corners.bl is missing or not an {x, y} point',
      ]);
    });

    it('rejects corners that are not an object at all', () => {
      expect(validateLabel({ ...fourByFour(), corners: 4 } as unknown as OcrLabel)).toEqual([
        'corners is 4, which is not a {tl, tr, br, bl} quad',
      ]);
      expect(validateLabel({ ...fourByFour(), corners: null } as unknown as OcrLabel)).toEqual([
        'corners is null, which is not a {tl, tr, br, bl} quad',
      ]);
    });
  });
});
