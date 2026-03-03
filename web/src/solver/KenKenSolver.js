import { Constraint } from './Constraint';
import { operatorFromString } from './Operator';
import { KenKenSolverException } from './KenKenSolverException';
import { createGameState } from './GameState';

export function parseConstraintLine(constraintLine) {
  const constraintBlobPattern = /([^=]*)=([0-9]+)([\+\-x/\.]?)/;

  return constraintLine.split(' ').map(token => {
    const match = token.match(constraintBlobPattern);
    if (match) {
      const name = match[1].charAt(0);
      const value = parseInt(match[2], 10);
      const operator = operatorFromString(match[3]);
      return new Constraint(name, value, operator);
    } else {
      throw new KenKenSolverException('Error parsing token ' + token);
    }
  });
}

export function parseBoard(boardLines) {
  return boardLines.map(line =>
    line.split(' ').map(charStr => charStr.charAt(0))
  );
}

export function solveFromAPI(boardStrings, constraintString) {
  const constraints = parseConstraintLine(constraintString);
  const board = parseBoard(boardStrings);
  const gameState = createGameState(constraints, board);
  const solved = gameState.solve();
  if (solved) {
    return solved.toString();
  }
  throw new KenKenSolverException('No solution found');
}
