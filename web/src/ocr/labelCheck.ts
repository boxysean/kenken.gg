// Checks a label file before it joins the training set: it must be a valid
// label (validateLabel), and its cages and clues must describe a real puzzle,
// i.e. one with exactly one solution. A hand-drawn label that fails the second
// check almost always has a misread clue or a misdrawn cage. The CLI wrapper is
// scripts/check-labels.ts.
import { labelToBoard, validateLabel } from './labelToBoard';
import type { ScannedBoard } from './types';
import { parseBoard, parseConstraintLine } from '../solver';
import { countSolutions } from '../play/generator/countSolutions';

export type LabelVerdict =
  | { status: 'ok' }
  | { status: 'invalid'; reasons: string[] }
  | { status: 'no-solution' }
  | { status: 'not-unique'; solutions: number }; // solutions is the count, capped

// Counting stops at three: two already proves "not unique", and the third only
// distinguishes "exactly two" from "at least three" in the report.
const CAP = 3;
// Search nodes. Generated 9x9 puzzles settle in far fewer; the bound keeps a
// badly underconstrained label from hanging the check. An exhausted budget
// reports CAP, i.e. "at least three, unproven", which is still not ok.
const BUDGET = 5000000;

// validateLabel trusts the ScannedBoard type; parsed JSON has earned no such trust.
function shapeProblems(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['not a JSON object'];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof record.boardSize !== 'number') {
    problems.push('boardSize is missing or not a number');
  }
  if (!Array.isArray(record.cageLetters) || !record.cageLetters.every((row) => typeof row === 'string')) {
    problems.push('cageLetters is missing or not an array of strings');
  }
  if (typeof record.clues !== 'object' || record.clues === null || Array.isArray(record.clues)) {
    problems.push('clues is missing or not an object');
  } else if (!Object.values(record.clues).every((clue) => typeof clue === 'object' && clue !== null)) {
    problems.push('clues has an entry that is not an object');
  }
  return problems;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function checkLabel(value: unknown): LabelVerdict {
  const shape = shapeProblems(value);
  if (shape.length > 0) return { status: 'invalid', reasons: shape };

  const label = value as ScannedBoard;
  const reasons = validateLabel(label);
  if (reasons.length > 0) return { status: 'invalid', reasons };

  let solutions: number;
  try {
    const { boardStrings, constraintString } = labelToBoard(label);
    solutions = countSolutions(parseConstraintLine(constraintString), parseBoard(boardStrings), CAP, BUDGET);
  } catch (error) {
    return { status: 'invalid', reasons: [`solver: ${message(error)}`] };
  }
  if (solutions === 0) return { status: 'no-solution' };
  if (solutions === 1) return { status: 'ok' };
  return { status: 'not-unique', solutions };
}

export function formatVerdict(name: string, verdict: LabelVerdict): string {
  switch (verdict.status) {
    case 'ok':
      return `${name}: ok`;
    case 'invalid':
      return `${name}: invalid: ${verdict.reasons.join('; ')}`;
    case 'no-solution':
      return `${name}: no solution`;
    case 'not-unique':
      return `${name}: not unique (${verdict.solutions} solutions)`;
  }
}
