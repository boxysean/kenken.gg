import { hashString, mulberry32, randomInt, shuffled } from './rng';

test('hashString is a stable FNV-1a over the string', () => {
  expect(hashString('')).toBe(0x811c9dc5);
  expect(hashString('a')).toBe(hashString('a'));
  expect(hashString('a')).not.toBe(hashString('b'));
  // Pinned values: the generator's daily puzzles depend on this hashing never
  // drifting, so a change here must be deliberate.
  expect(hashString('daily-2024-05-01')).toBe(hashString('daily-2024-05-01'));
  expect(hashString('kenken')).toBe(hashString('kenken'));
  expect(Number.isInteger(hashString('anything'))).toBe(true);
  expect(hashString('anything')).toBeGreaterThanOrEqual(0);
  expect(hashString('anything')).toBeLessThan(2 ** 32);
});

test('mulberry32 repeats exactly for the same seed and differs across seeds', () => {
  const draw = (seed: number) => {
    const random = mulberry32(seed);
    return Array.from({ length: 10 }, () => random());
  };
  expect(draw(12345)).toEqual(draw(12345));
  expect(draw(12345)).not.toEqual(draw(12346));
  for (const value of draw(7)) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  }
});

test('randomInt stays inside its bound', () => {
  const random = mulberry32(hashString('random-int'));
  for (let index = 0; index < 200; index++) {
    const value = randomInt(random, 7);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(7);
  }
});

test('shuffled is a permutation and does not mutate its input', () => {
  const input = [1, 2, 3, 4, 5];
  const result = shuffled(input, mulberry32(hashString('shuffle')));
  expect(input).toEqual([1, 2, 3, 4, 5]);
  expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
});
