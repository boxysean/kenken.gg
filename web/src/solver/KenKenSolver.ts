// Port of api/src/main/scala/gg/kenken/KenKenSolver.scala (parsing and the
// solveFromAPI entry point). Runs entirely in the client.
import { Constraint, KenKenSolverException } from './Constraint';
import { GameState } from './GameState';
import { operatorWithName } from './Operator';

export interface SolveResult {
  solved: boolean;
  // Scala's GameState.toString of the solved board; null when unsolved.
  boardOutput: string | null;
  // Flat row-major list of cell values; null when unsolved.
  cells: string[] | null;
}

// Java's String.split drops trailing empty strings; JS's does not.
function javaSplit(line: string, separator: string): string[] {
  const parts = line.split(separator);
  while (parts.length > 1 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

// Scala's `regex(groups)` extractor matches the whole string, hence ^...$.
const constraintBlobPattern = /^([^=]*)=([0-9]+)([+\-x/.]?)$/;

export function parseConstraintLine(constraintLine: string): Constraint[] {
  return javaSplit(constraintLine, ' ').map((token) => {
    const match = constraintBlobPattern.exec(token);
    if (match === null) {
      throw new KenKenSolverException('Error parsing token ' + token);
    }
    const [, name, value, operatorName] = match;
    // Scala's name(0) on an empty name and Operator.withName(".") both throw.
    const operator = operatorWithName(operatorName);
    if (name.length === 0 || operator === null) {
      throw new KenKenSolverException('Error parsing token ' + token);
    }
    return new Constraint(name[0], parseInt(value, 10), operator);
  });
}

export function parseBoard(boardLines: Iterable<string>): string[][] {
  return [...boardLines].map((line) =>
    javaSplit(line, ' ').map((charStr) => {
      // Scala's charStr(0) throws on an empty cell token.
      if (charStr.length === 0) {
        throw new KenKenSolverException('Error parsing board line ' + JSON.stringify(line));
      }
      return charStr[0];
    }),
  );
}

export function parsePuzzle(boardStrings: Iterable<string>, constraintString: string): GameState {
  return GameState.fromConstraints(parseConstraintLine(constraintString), parseBoard(boardStrings));
}

export function solveFromAPI(boardStrings: Iterable<string>, constraintString: string): SolveResult {
  const solution = parsePuzzle(boardStrings, constraintString).solve();
  if (solution === null) {
    // Scala calls .toString on the null result here and throws a
    // NullPointerException; the port reports "unsolved" instead.
    return { solved: false, boardOutput: null, cells: null };
  }
  return {
    solved: true,
    boardOutput: solution.toBoardOutput(),
    cells: solution.toJson().flat(),
  };
}
