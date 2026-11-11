import {
  CORNER_ORDER,
  addCorner,
  clicksToQuad,
  displayPoint,
  naturalPoint,
  nextCornerName,
} from './cornersFromClicks';
import type { Point } from '../types';

describe('nextCornerName', () => {
  it('names the corners in tl, tr, br, bl order, then null', () => {
    expect([0, 1, 2, 3, 4, 5].map(nextCornerName)).toEqual(['tl', 'tr', 'br', 'bl', null, null]);
    expect(CORNER_ORDER).toEqual(['tl', 'tr', 'br', 'bl']);
  });
});

describe('naturalPoint', () => {
  it('scales a click from displayed to natural pixels', () => {
    expect(naturalPoint({ x: 10, y: 20 }, { width: 400, height: 300 }, { width: 1200, height: 900 }))
      .toEqual({ x: 30, y: 60 });
  });

  it('rounds a non-uniform, fractional scale to the nearest pixel', () => {
    // x scale 1001/300 = 3.3367, y scale 667/200 = 3.335.
    const point = naturalPoint({ x: 100, y: 50 }, { width: 300, height: 200 }, { width: 1001, height: 667 });
    expect(point).toEqual({ x: 334, y: 167 });
    expect(point).not.toEqual({ x: 100, y: 50 });
    expect(naturalPoint({ x: 299, y: 199 }, { width: 300, height: 200 }, { width: 1001, height: 667 }))
      .toEqual({ x: 998, y: 664 });
  });

  it('throws on a displayed size that is zero, negative or not finite', () => {
    const natural = { width: 100, height: 100 };
    expect(() => naturalPoint({ x: 1, y: 1 }, { width: 0, height: 10 }, natural)).toThrow(/displayed width 0/);
    expect(() => naturalPoint({ x: 1, y: 1 }, { width: 10, height: -5 }, natural)).toThrow(/displayed height -5/);
    expect(() => naturalPoint({ x: 1, y: 1 }, { width: NaN, height: 10 }, natural)).toThrow(/displayed width NaN/);
    expect(() => naturalPoint({ x: 1, y: 1 }, { width: 10, height: Infinity }, natural)).toThrow(/positive finite/);
  });
});

describe('displayPoint', () => {
  it('round-trips naturalPoint back to the click within a pixel', () => {
    const displayed = { width: 300, height: 200 };
    const natural = { width: 1001, height: 667 };
    for (const click of [{ x: 0, y: 0 }, { x: 17, y: 133 }, { x: 150.5, y: 99.25 }, { x: 300, y: 200 }]) {
      const back = displayPoint(naturalPoint(click, displayed, natural), displayed, natural);
      expect(Math.abs(back.x - click.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y - click.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe('addCorner', () => {
  const displayed = { width: 400, height: 300 };
  const natural = { width: 1200, height: 900 };

  it('appends the click in natural pixels without mutating the input', () => {
    const clicks: Point[] = [{ x: 3, y: 3 }];
    const next = addCorner(clicks, { x: 10, y: 20 }, displayed, natural);
    expect(next).toEqual([{ x: 3, y: 3 }, { x: 30, y: 60 }]);
    expect(clicks).toEqual([{ x: 3, y: 3 }]);
  });

  it('ignores a fifth click and returns the first four unchanged', () => {
    const four: Point[] = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }];
    const snapshot = JSON.parse(JSON.stringify(four));
    const next = addCorner(four, { x: 100, y: 100 }, displayed, natural);
    expect(next).toEqual(snapshot);
    expect(four).toEqual(snapshot);
  });
});

describe('clicksToQuad', () => {
  it('returns null for anything but four clicks', () => {
    const point = { x: 1, y: 1 };
    for (const count of [0, 1, 2, 3, 5]) {
      expect(clicksToQuad(new Array(count).fill(point))).toBeNull();
    }
  });

  it('assigns four clicks to tl, tr, br, bl in click order', () => {
    expect(clicksToQuad([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, { x: 7, y: 8 }])).toEqual({
      tl: { x: 1, y: 2 },
      tr: { x: 3, y: 4 },
      br: { x: 5, y: 6 },
      bl: { x: 7, y: 8 },
    });
  });
});
