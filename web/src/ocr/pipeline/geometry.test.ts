import type { Point, Quad } from '../types';
import {
  UNIT_SQUARE,
  applyHomography,
  convexHull,
  invertHomography,
  quadArea,
  quadCorners,
  signedArea,
  solveHomography,
} from './geometry';
import type { Homography } from './geometry';

function rotatedSquare(centre: Point, half: number, degrees: number): Quad {
  const angle = (degrees * Math.PI) / 180;
  const rotate = (dx: number, dy: number): Point => ({
    x: centre.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: centre.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  });
  return { tl: rotate(-half, -half), tr: rotate(half, -half), br: rotate(half, half), bl: rotate(-half, half) };
}

const QUADS: Record<string, Quad> = {
  'axis-aligned': { tl: { x: 24, y: 24 }, tr: { x: 408, y: 24 }, br: { x: 408, y: 408 }, bl: { x: 24, y: 408 } },
  rotated: rotatedSquare({ x: 300, y: 300 }, 250, 7),
  perspective: { tl: { x: 40, y: 31 }, tr: { x: 590, y: 58 }, br: { x: 612, y: 640 }, bl: { x: 18, y: 597 } },
};

function compose(a: Homography, b: Homography): number[] {
  // a * b, row-major 3x3.
  const product: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k] * b[k * 3 + column];
      product.push(sum);
    }
  }
  return product;
}

describe('solveHomography', () => {
  for (const [name, quad] of Object.entries(QUADS)) {
    it(`maps the corners of a ${name} quad onto the unit square`, () => {
      const h = solveHomography(quad);
      const expected = quadCorners(UNIT_SQUARE);
      quadCorners(quad).forEach((corner, index) => {
        const mapped = applyHomography(h, corner);
        expect(Math.abs(mapped.x - expected[index].x)).toBeLessThan(1e-9);
        expect(Math.abs(mapped.y - expected[index].y)).toBeLessThan(1e-9);
      });
      expect(h[8]).toBe(1);
    });
  }

  it('maps between two arbitrary quads', () => {
    const h = solveHomography(QUADS.rotated, QUADS.perspective);
    const from = quadCorners(QUADS.rotated);
    quadCorners(QUADS.perspective).forEach((expected, index) => {
      const mapped = applyHomography(h, from[index]);
      expect(mapped.x).toBeCloseTo(expected.x, 6);
      expect(mapped.y).toBeCloseTo(expected.y, 6);
    });
  });

  it('throws a clear error on a zero-area quad instead of returning NaN', () => {
    const flat: Quad = { tl: { x: 0, y: 0 }, tr: { x: 10, y: 0 }, br: { x: 20, y: 0 }, bl: { x: 30, y: 0 } };
    expect(() => solveHomography(flat)).toThrow(/degenerate/);
    const collapsed: Quad = { tl: { x: 5, y: 5 }, tr: { x: 5, y: 5 }, br: { x: 5, y: 5 }, bl: { x: 5, y: 5 } };
    expect(() => solveHomography(collapsed)).toThrow(/degenerate/);
  });

  it('throws when three corners are collinear even though the area is positive', () => {
    const triangle: Quad = { tl: { x: 0, y: 0 }, tr: { x: 50, y: 0 }, br: { x: 100, y: 0 }, bl: { x: 0, y: 100 } };
    expect(quadArea(triangle)).toBeGreaterThan(0);
    expect(() => solveHomography(triangle)).toThrow(/degenerate/);
  });
});

describe('invertHomography and applyHomography', () => {
  for (const [name, quad] of Object.entries(QUADS)) {
    it(`composes to the identity for a ${name} quad`, () => {
      const h = solveHomography(quad);
      const product = compose(h, invertHomography(h));
      const scale = product[8];
      const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      product.forEach((value, index) => expect(value / scale).toBeCloseTo(identity[index], 9));
    });

    it(`round-trips the corners of a ${name} quad within 0.5 px`, () => {
      const h = solveHomography(quad);
      const inverse = invertHomography(h);
      for (const corner of quadCorners(quad)) {
        const back = applyHomography(inverse, applyHomography(h, corner));
        expect(Math.hypot(back.x - corner.x, back.y - corner.y)).toBeLessThan(0.5);
      }
    });
  }

  it('normalises the inverse to h33 = 1', () => {
    expect(invertHomography(solveHomography(QUADS.perspective))[8]).toBe(1);
  });

  it('throws on a singular matrix', () => {
    expect(() => invertHomography([1, 2, 3, 2, 4, 6, 0, 0, 1])).toThrow(/singular/);
  });
});

describe('quadArea', () => {
  it('measures an axis-aligned square', () => {
    expect(quadArea(QUADS['axis-aligned'])).toBe(384 * 384);
  });

  it('is unchanged by rotation', () => {
    expect(quadArea(rotatedSquare({ x: 0, y: 0 }, 5, 33))).toBeCloseTo(100, 9);
  });

  it('is absolute whatever the winding', () => {
    const { tl, tr, br, bl } = UNIT_SQUARE;
    expect(quadArea({ tl, tr: bl, br, bl: tr })).toBe(1);
    expect(signedArea([tl, tr, br, bl])).toBe(1);
    expect(signedArea([tl, bl, br, tr])).toBe(-1);
  });

  it('is zero for a degenerate quad', () => {
    const p = { x: 3, y: 4 };
    expect(quadArea({ tl: p, tr: { x: 6, y: 8 }, br: { x: 9, y: 12 }, bl: p })).toBe(0);
  });
});

describe('convexHull', () => {
  const key = (points: Point[]): string[] => points.map((p) => `${p.x},${p.y}`).sort();

  it('drops collinear points along an edge and in a line', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
    ];
    expect(key(convexHull(square))).toEqual(['0,0', '0,10', '10,0', '10,10']);
    const line = [0, 1, 2, 3].map((t) => ({ x: t, y: 2 * t }));
    expect(key(convexHull(line))).toEqual(['0,0', '3,6']);
  });

  it('drops duplicate points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
      { x: 2, y: 3 },
    ];
    expect(key(convexHull(points))).toEqual(['0,0', '2,3', '4,0']);
    expect(convexHull([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });

  it('keeps points already in hull order, without a repeated closing point', () => {
    const ordered = quadCorners(QUADS.perspective);
    const hull = convexHull(ordered);
    expect(hull).toHaveLength(4);
    expect(key(hull)).toEqual(key(ordered));
    expect(signedArea(hull)).toBeGreaterThan(0);
  });

  it('excludes an interior point of a square', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const hull = convexHull(points);
    expect(key(hull)).toEqual(['0,0', '0,10', '10,0', '10,10']);
    expect(Math.abs(signedArea(hull))).toBe(100);
  });
});
