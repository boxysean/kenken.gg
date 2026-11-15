import { normaliseCageNames } from './normaliseCageNames';
import { validateLabel } from './labelToBoard';
import type { OcrLabel } from './types';

// The shape of Sean's first real-photo export (photo-01), made by a build from
// before #122: a 17-cage board whose names ran from 'r' past 'z' into '{', '|',
// '}', '~', DEL and the C1 controls.
const broken: OcrLabel = {
  boardSize: 6,
  cageLetters: [
    'r \x82 \x82 \x82 \x83 \x83',
    'r r \x80 \x80 \x7f \x7f',
    's s { | } ~',
    't z { y } ~',
    't z y y x x',
    'u u u v v w',
  ],
  clues: {
    r: { target: 8, operator: 'x' },
    '\x82': { target: 15, operator: '+' },
    '\x83': { target: 1, operator: '-' },
    '\x80': { target: 2, operator: '-' },
    '\x7f': { target: 5, operator: '-' },
    s: { target: 1, operator: '-' },
    '{': { target: 3, operator: '/' },
    '|': { target: 1, operator: '' },
    '}': { target: 3, operator: '-' },
    '~': { target: 2, operator: '-' },
    t: { target: 3, operator: '-' },
    z: { target: 6, operator: 'x' },
    y: { target: 60, operator: 'x' },
    x: { target: 3, operator: '/' },
    u: { target: 10, operator: '+' },
    v: { target: 2, operator: '/' },
    w: { target: 5, operator: '' },
  },
  source: { kind: 'photo' },
};

describe('normaliseCageNames', () => {
  it('is rejected raw and accepted once normalised', () => {
    expect(validateLabel(broken).length).toBeGreaterThan(0);
    const { label } = normaliseCageNames(broken);
    expect(validateLabel(label)).toEqual([]);
  });

  it('renames only the names outside the alphabet, to unused letters in reading order', () => {
    const { label, renamed } = normaliseCageNames(broken);
    expect(renamed).toEqual({ '\x82': 'a', '\x83': 'b', '\x80': 'c', '\x7f': 'd', '{': 'e', '|': 'f', '}': 'g', '~': 'h' });
    expect(label.cageLetters).toEqual(['r a a a b b', 'r r c c d d', 's s e f g h', 't z e y g h', 't z y y x x', 'u u u v v w']);
    // Clues follow their cage, letters that were fine keep theirs.
    expect(label.clues.a).toEqual({ target: 15, operator: '+' });
    expect(label.clues.f).toEqual({ target: 1, operator: '' });
    expect(label.clues.r).toEqual({ target: 8, operator: 'x' });
    expect(Object.keys(label.clues)).toHaveLength(17);
    expect(label.clues).not.toHaveProperty('{');
  });

  it('is idempotent and leaves a valid label alone', () => {
    const once = normaliseCageNames(broken).label;
    const twice = normaliseCageNames(once);
    expect(twice.renamed).toEqual({});
    expect(twice.label).toEqual(once);
  });

  it('does not touch the input', () => {
    const before = JSON.stringify(broken);
    normaliseCageNames(broken);
    expect(JSON.stringify(broken)).toBe(before);
  });

  it('keeps corners and source', () => {
    const withCorners: OcrLabel = {
      ...broken,
      corners: { tl: { x: 1, y: 2 }, tr: { x: 3, y: 2 }, br: { x: 3, y: 4 }, bl: { x: 1, y: 4 } },
      source: { kind: 'photo', styleTag: 'newspaper' },
    };
    const { label } = normaliseCageNames(withCorners);
    expect(label.corners).toEqual(withCorners.corners);
    expect(label.source).toEqual({ kind: 'photo', styleTag: 'newspaper' });
  });
});
