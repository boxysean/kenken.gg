import { parseConstraintLine, parseBoard, solveFromAPI } from './KenKenSolver';
import Operator from './Operator';

describe('parseConstraintLine', () => {
  it('parses addition constraints', () => {
    const constraints = parseConstraintLine('a=3+ b=6+ c=5+ d=4+');
    expect(constraints).toHaveLength(4);
    expect(constraints[0].name).toBe('a');
    expect(constraints[0].value).toBe(3);
    expect(constraints[0].operator).toBe(Operator.Addition);
    expect(constraints[1].name).toBe('b');
    expect(constraints[1].value).toBe(6);
    expect(constraints[3].name).toBe('d');
    expect(constraints[3].value).toBe(4);
  });

  it('parses mixed operators', () => {
    const constraints = parseConstraintLine('a=6x b=2 c=5+ d=1 e=1-');
    expect(constraints).toHaveLength(5);
    expect(constraints[0].operator).toBe(Operator.Multiplication);
    expect(constraints[1].operator).toBe(Operator.Constant);
    expect(constraints[2].operator).toBe(Operator.Addition);
    expect(constraints[3].operator).toBe(Operator.Constant);
    expect(constraints[4].operator).toBe(Operator.Subtraction);
  });

  it('parses division', () => {
    const constraints = parseConstraintLine('a=2/');
    expect(constraints[0].operator).toBe(Operator.Division);
    expect(constraints[0].value).toBe(2);
  });
});

describe('parseBoard', () => {
  it('parses board strings into 2D array', () => {
    const board = parseBoard(['a a b', 'c d b', 'c d b']);
    expect(board).toEqual([
      ['a', 'a', 'b'],
      ['c', 'd', 'b'],
      ['c', 'd', 'b'],
    ]);
  });
});

describe('solveFromAPI', () => {
  it('solves basic 3x3 puzzle (from serverless.test.yml)', () => {
    const result = solveFromAPI(
      ['a a b', 'c d b', 'c d b'],
      'a=3+ b=6+ c=5+ d=4+'
    );
    expect(result).toBe('1 2 3\n2 3 1\n3 1 2');
  });

  it('solves kenken3.in (3x3 with multiplication)', () => {
    // a=6x b=2 c=5+ d=1 e=1-
    // a b c
    // a c c
    // d e e
    const result = solveFromAPI(
      ['a b c', 'a c c', 'd e e'],
      'a=6x b=2 c=5+ d=1 e=1-'
    );
    // Verify it's a valid 3x3 solution
    const rows = result.split('\n');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const values = row.split(' ').map(Number);
      expect(values).toHaveLength(3);
      expect(new Set(values).size).toBe(3); // all unique in row
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(3);
      }
    }
  });

  it('solves kenken1.in (6x6 puzzle)', () => {
    const result = solveFromAPI(
      [
        'a b b c c d',
        'a b e c d d',
        'a f e e g g',
        'f f h i j g',
        'k l h i j j',
        'k k h m m n',
      ],
      'a=60x b=4+ c=16+ d=45x e=40x f=72x g=4x h=11+ i=4- j=12+ k=12x l=5 m=8+ n=2'
    );
    const rows = result.split('\n');
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      const values = row.split(' ').map(Number);
      expect(values).toHaveLength(6);
      expect(new Set(values).size).toBe(6); // all unique in row
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
    }
    // Also verify columns are unique
    for (let col = 0; col < 6; col++) {
      const colValues = rows.map(row => Number(row.split(' ')[col]));
      expect(new Set(colValues).size).toBe(6);
    }
  });
});
