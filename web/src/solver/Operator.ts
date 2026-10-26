// Port of api/src/main/scala/gg/kenken/solver/Operator.scala.
// The Scala Enumeration's value names are the operator symbols, so the
// symbols themselves are used as the TypeScript representation.
export type Operator = '+' | '-' | 'x' | '/' | '';

export const Addition: Operator = '+';
export const Subtraction: Operator = '-';
export const Multiplication: Operator = 'x';
export const Division: Operator = '/';
export const Constant: Operator = '';

const OPERATORS: readonly Operator[] = [Addition, Subtraction, Multiplication, Division, Constant];

// Mirrors Scala's `Operator.withName`: returns null where Scala would throw
// NoSuchElementException, so the caller can raise its own error.
export function operatorWithName(name: string): Operator | null {
  return OPERATORS.find((operator) => operator === name) ?? null;
}
