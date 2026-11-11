import { CAGE_LETTERS, nextCageLetter } from './cageLetters';

function allocate(count: number, used: string[] = []): string[] {
  const names = [...used];
  for (let index = 0; index < count; index++) {
    names.push(nextCageLetter(names));
  }
  return names.slice(used.length);
}

describe('nextCageLetter', () => {
  // The old editor allocator (max char code + 1) walked past 'z' into '{', DEL
  // and the C1 controls. Sixty calls is past the alphabet: the first 52 must be
  // unique letters and every call after that must refuse, never hand out a
  // non-letter.
  it('allocates only unique letters over 60 calls, refusing past the 52nd', () => {
    const names: string[] = [];
    for (let index = 0; index < 60; index++) {
      if (index < 52) {
        const name = nextCageLetter(names);
        expect(name).toMatch(/^[a-zA-Z]$/);
        expect(names).not.toContain(name);
        names.push(name);
      } else {
        expect(() => nextCageLetter(names)).toThrow(/52/);
      }
    }
    expect(new Set(names).size).toBe(52);
  });

  it('reuses the gap a deleted cage leaves', () => {
    expect(allocate(3)).toEqual(['a', 'b', 'c']);
    expect(nextCageLetter(['a', 'c'])).toBe('b');
  });

  it('hands back a freed first letter', () => {
    const names = allocate(3);
    expect(names).toEqual(['a', 'b', 'c']);
    expect(nextCageLetter(names.filter((name) => name !== 'a'))).toBe('a');
  });

  it('throws once all 52 letters are in use', () => {
    expect(() => nextCageLetter(CAGE_LETTERS)).toThrow(/52/);
  });
});

describe('CAGE_LETTERS', () => {
  it('is the 52 ASCII letters, lower case first, with no duplicates', () => {
    expect(CAGE_LETTERS).toBe('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(CAGE_LETTERS).toHaveLength(52);
    expect(new Set(CAGE_LETTERS).size).toBe(52);
  });
});
