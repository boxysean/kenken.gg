// The alphabet cage names are drawn from, shared by the board editor (App.jsx),
// the generator and OCR label validation. It lives in exactly one place so the
// three cannot drift: a name the editor hands out is one the generator could
// have produced and one validateLabel accepts.
//
// Letters only. A constraint is written `name=target+operator`, so a name that
// were a digit or an operator character would make that format ambiguous, and
// anything past the letters (the editor once walked on into '{', DEL and the C1
// controls) is not printable at all.
export const CAGE_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The first cage letter not in `used`. First unused rather than highest plus
// one, so the gap a deleted cage leaves is filled again.
export function nextCageLetter(used: Iterable<string>): string {
  const taken = new Set(used);
  for (const letter of CAGE_LETTERS) {
    if (!taken.has(letter)) return letter;
  }
  throw new Error(
    `cage letters: all ${CAGE_LETTERS.length} single-character cage names are in use; a board may have at most ${CAGE_LETTERS.length} cages`,
  );
}
