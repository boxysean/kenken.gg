// Repairs the cage names of a label exported by a build before #122, whose
// editor allocated names by adding one to the highest character code in use and
// so walked past 'z' into '{', '|', '}', '~', DEL and the C1 controls. Such a
// label is a perfectly good partition with unprintable names; this renames
// every name outside CAGE_LETTERS to the first letter the board does not use,
// in row-major order of first appearance, and renames its clue key with it.
//
// Deterministic, so a fixture normalised twice is the same fixture. Names that
// are already letters are kept, so a label that validateLabel already accepts
// comes back unchanged. The strict path is untouched: validateLabel still
// rejects the raw export, and this is called only where an old export is
// knowingly being taken in (the real-photo fixtures).
import { CAGE_LETTERS } from '../cageLetters';
import type { Clue, OcrLabel } from './types';

export interface NormalisedLabel<T extends OcrLabel> {
  label: T;
  // Old name -> new name, only for the names that changed, in the order they were met.
  renamed: Record<string, string>;
}

export function normaliseCageNames<T extends OcrLabel>(label: T): NormalisedLabel<T> {
  const rows = label.cageLetters.map((row) => row.split(' '));
  const used = new Set<string>();
  for (const row of rows) {
    for (const name of row) if (CAGE_LETTERS.includes(name) && name.length === 1) used.add(name);
  }

  const renamed: Record<string, string> = {};
  const rename = (name: string): string => {
    if ((CAGE_LETTERS.includes(name) && name.length === 1) || name === '') return name;
    if (!(name in renamed)) {
      const fresh = [...CAGE_LETTERS].find((letter) => !used.has(letter));
      if (fresh === undefined) {
        throw new Error(`normaliseCageNames: no free letter left for cage ${JSON.stringify(name)}`);
      }
      used.add(fresh);
      renamed[name] = fresh;
    }
    return renamed[name];
  };

  const cageLetters = rows.map((row) => row.map(rename).join(' '));
  // Clue keys follow the board; a clue whose name is on neither stays as it is,
  // for validateLabel to report.
  const clues: Record<string, Clue> = {};
  for (const [name, clue] of Object.entries(label.clues)) {
    clues[name in renamed ? renamed[name] : name] = { ...clue };
  }
  return { label: { ...label, cageLetters, clues }, renamed };
}
