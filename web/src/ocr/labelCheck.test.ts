import { checkLabel, formatVerdict } from './labelCheck';
import type { LabelVerdict } from './labelCheck';
import type { OcrLabel, ScannedBoard } from './types';

const CORNERS = { tl: { x: 0, y: 0 }, tr: { x: 9, y: 0 }, br: { x: 9, y: 9 }, bl: { x: 0, y: 9 } };

function label(board: ScannedBoard): OcrLabel {
  return { ...board, corners: CORNERS, source: { kind: 'photo' } };
}

// The kenken-4x4-clean fixture's cages: a generated, uniquely solvable puzzle.
const UNIQUE = label({
  boardSize: 4,
  cageLetters: ['a b b c', 'a d d c', 'e e f c', 'g g f f'],
  clues: {
    a: { target: 2, operator: '-' },
    b: { target: 2, operator: '/' },
    c: { target: 6, operator: 'x' },
    d: { target: 3, operator: '-' },
    e: { target: 2, operator: '-' },
    f: { target: 12, operator: 'x' },
    g: { target: 1, operator: '-' },
  },
});

// Each 2x2 row is a "3+" cage, i.e. {1, 2} in either order: exactly two
// solutions, 12/21 and 21/12.
const TWO_SOLUTIONS = label({
  boardSize: 2,
  cageLetters: ['a a', 'b b'],
  clues: { a: { target: 3, operator: '+' }, b: { target: 3, operator: '+' } },
});

// Each 3x3 row is a "6+" cage, so every one of the 12 Latin squares fits; the
// count saturates at the cap of three.
const MANY_SOLUTIONS = label({
  boardSize: 3,
  cageLetters: ['a a a', 'b b b', 'c c c'],
  clues: {
    a: { target: 6, operator: '+' },
    b: { target: 6, operator: '+' },
    c: { target: 6, operator: '+' },
  },
});

// A 2x2 row holds 1 and 2, which never sum to 4.
const CONTRADICTORY = label({
  boardSize: 2,
  cageLetters: ['a a', 'b b'],
  clues: { a: { target: 3, operator: '+' }, b: { target: 4, operator: '+' } },
});

describe('checkLabel', () => {
  it('passes a valid label with exactly one solution', () => {
    expect(checkLabel(UNIQUE)).toEqual({ status: 'ok' });
  });

  it('reports validation problems, such as an empty cell, as invalid', () => {
    const verdict = checkLabel({ ...UNIQUE, cageLetters: ['a b b c', 'a d d c', 'e e f c', 'g g f '] });
    expect(verdict).toEqual({ status: 'invalid', reasons: ['row 3, column 3 is empty'] });
  });

  it('reports a label whose clues admit two solutions as not unique', () => {
    expect(checkLabel(TWO_SOLUTIONS)).toEqual({ status: 'not-unique', solutions: 2 });
  });

  it('caps the count of a loose label at three', () => {
    expect(checkLabel(MANY_SOLUTIONS)).toEqual({ status: 'not-unique', solutions: 3 });
  });

  it('reports a contradictory clue set as having no solution', () => {
    expect(checkLabel(CONTRADICTORY)).toEqual({ status: 'no-solution' });
  });

  it('rejects JSON that is not shaped like a label before validating it', () => {
    expect(checkLabel(null)).toEqual({ status: 'invalid', reasons: ['not a JSON object'] });
    expect(checkLabel([1, 2])).toEqual({ status: 'invalid', reasons: ['not a JSON object'] });
    expect(checkLabel({ boardSize: '4', cageLetters: ['a', 7], clues: null })).toEqual({
      status: 'invalid',
      reasons: [
        'boardSize is missing or not a number',
        'cageLetters is missing or not an array of strings',
        'clues is missing or not an object',
      ],
    });
    expect(checkLabel({ boardSize: 1, cageLetters: ['a'], clues: { a: 1 } })).toEqual({
      status: 'invalid',
      reasons: ['clues has an entry that is not an object'],
    });
  });

  it('rejects a constraint name that is not a cage letter before the solver sees it', () => {
    // "=" was the old shape of this bug: it passed the single-character check
    // and only failed inside the solver, as a parse error. The shared alphabet
    // now catches it up front with a message that names the cell.
    const verdict = checkLabel(label({ boardSize: 1, cageLetters: ['='], clues: { '=': { target: 1, operator: '' } } }));
    expect(verdict.status).toBe('invalid');
    expect((verdict as { reasons: string[] }).reasons).toEqual([
      'row 0, column 0 is "=", which is not a printable cage letter',
    ]);
  });
});

describe('formatVerdict', () => {
  it('renders each verdict as one line', () => {
    const cases: [LabelVerdict, string][] = [
      [checkLabel(UNIQUE), 'a.json: ok'],
      [{ status: 'invalid', reasons: ['row 0 is short', 'cage "b" has no clue'] }, 'a.json: invalid: row 0 is short; cage "b" has no clue'],
      [checkLabel(CONTRADICTORY), 'a.json: no solution'],
      [checkLabel(TWO_SOLUTIONS), 'a.json: not unique (2 solutions)'],
      [checkLabel(MANY_SOLUTIONS), 'a.json: not unique (3 solutions)'],
    ];
    for (const [verdict, line] of cases) {
      expect(formatVerdict('a.json', verdict)).toBe(line);
      expect(line).not.toContain('\n');
    }
  });
});
