// Seeded randomness for the puzzle generator. Everything here is pure, so the
// same seed string yields the same sequence on every call and every machine.

// FNV-1a, 32-bit, over UTF-16 code units. Returns an unsigned 32-bit integer.
export function hashString(s: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < s.length; index++) {
    hash ^= s.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Standard mulberry32: a 32-bit state PRNG returning floats in [0, 1).
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(random: () => number, maxExclusive: number): number {
  return Math.floor(random() * maxExclusive);
}

// Fisher-Yates on a copy.
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(random, index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
