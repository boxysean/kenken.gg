import { generate } from '../../play/generator/generate';
import { distort } from '../render/distort';
import type { DistortSpec } from '../render/distort';
import { renderPuzzle } from '../render/synth';
import type { OcrImage, Point, Quad } from '../types';
import { detectCorners } from './corners';
import type { CornerDetection } from './corners';
import { quadCorners, signedArea } from './geometry';

// Mostly mild damage: the heavy end of distort's ranges is out of scope for this ticket.
type FixtureSpec = Omit<DistortSpec, 'seed'> & { boardSize: number };

const FIXTURE_SPECS: FixtureSpec[] = [
  { boardSize: 4, tag: 'clean' },
  { boardSize: 5, tag: 'clean' },
  { boardSize: 6, tag: 'clean' },
  { boardSize: 5, tag: 'clean' },
  { boardSize: 6, tag: 'clean' },
  { boardSize: 4, tag: 'perspective', rotation: 2 },
  { boardSize: 5, tag: 'perspective', rotation: 4 },
  { boardSize: 6, tag: 'perspective', rotation: 6 },
  { boardSize: 5, tag: 'perspective', rotation: 8 },
  { boardSize: 4, tag: 'perspective', perspective: 0.02 },
  { boardSize: 5, tag: 'perspective', perspective: 0.04 },
  { boardSize: 6, tag: 'perspective', perspective: 0.06 },
  { boardSize: 4, tag: 'perspective', perspective: 0.08 },
  { boardSize: 5, tag: 'perspective', rotation: 3, perspective: 0.03 },
  { boardSize: 6, tag: 'perspective', rotation: 5, perspective: 0.05 },
  { boardSize: 4, tag: 'perspective', rotation: 7, perspective: 0.07 },
  { boardSize: 5, tag: 'noise', noise: 0.1 },
  { boardSize: 6, tag: 'glare', glare: 0.4 },
  { boardSize: 4, tag: 'noise', blur: 1 },
  { boardSize: 5, tag: 'noise', noise: 0.15, glare: 0.2 },
  { boardSize: 6, tag: 'noise', rotation: 4, perspective: 0.04, noise: 0.1, blur: 1 },
  { boardSize: 4, tag: 'glare', rotation: 6, glare: 0.3, noise: 0.05 },
  { boardSize: 5, tag: 'glare', perspective: 0.06, glare: 0.4, blur: 1 },
];

interface Fixture {
  name: string;
  tag: string;
  image: OcrImage;
  corners: Quad;
}

function buildFixture(spec: FixtureSpec, index: number): Fixture {
  const { boardSize, ...damage } = spec;
  const seed = `corners-${index}`;
  const rendered = renderPuzzle(generate(seed, boardSize));
  const { image, corners } = distort(rendered.image, rendered.label.corners, { seed, ...damage });
  const name = `#${index} ${boardSize}x${boardSize} ${JSON.stringify(damage)}`;
  return { name, tag: spec.tag, image, corners };
}

function cornerError(found: Quad, expected: Quad): number {
  const a = quadCorners(found);
  const b = quadCorners(expected);
  return Math.max(...a.map((p, index) => Math.hypot(p.x - b[index].x, p.y - b[index].y)));
}

const fixtures: Fixture[] = [];
const detections: CornerDetection[] = [];
let detectMillis = 0;

beforeAll(() => {
  FIXTURE_SPECS.forEach((spec, index) => fixtures.push(buildFixture(spec, index)));
  const start = performance.now();
  for (const fixture of fixtures) detections.push(detectCorners(fixture.image));
  detectMillis = performance.now() - start;
}, 120_000);

function report(): string {
  return fixtures
    .map((fixture, index) => `${cornerError(detections[index].quad, fixture.corners).toFixed(3)} px  ${fixture.name}`)
    .join('\n');
}

describe('detectCorners on synthetic fixtures', () => {
  it('uses at least 20 fixtures, several of them clean, across board sizes 4 to 6', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    const clean = FIXTURE_SPECS.filter((spec) => spec.tag === 'clean');
    expect(clean.length).toBeGreaterThanOrEqual(3);
    expect(new Set(clean.map((spec) => spec.boardSize))).toEqual(new Set([4, 5, 6]));
  });

  it('puts at least 90% of fixtures within 3 px of the label corners', () => {
    const errors = fixtures.map((fixture, index) => cornerError(detections[index].quad, fixture.corners));
    const within3 = errors.filter((error) => error <= 3).length;
    expect(within3 / fixtures.length, `per-fixture max corner error:\n${report()}`).toBeGreaterThanOrEqual(0.9);
  });

  it('puts every clean fixture within 1 px on all four corners', () => {
    fixtures.forEach((fixture, index) => {
      if (fixture.tag !== 'clean') return;
      expect(cornerError(detections[index].quad, fixture.corners), `${fixture.name}\n${report()}`).toBeLessThanOrEqual(1);
    });
  });

  it('reports high confidence on every fixture', () => {
    for (const detection of detections) expect(detection.confidence).toBeGreaterThan(0.9);
  });

  it('keeps the tl/tr/br/bl convention: clockwise on screen, tl nearest the top-left', () => {
    for (const { quad } of detections) {
      const corners = quadCorners(quad);
      expect(signedArea(corners)).toBeGreaterThan(0);
      const nearest = corners.reduce((best, p) => (p.x + p.y < best.x + best.y ? p : best));
      expect(nearest).toBe(quad.tl);
      expect(quad.tr.x).toBeGreaterThan(quad.tl.x);
      expect(quad.bl.y).toBeGreaterThan(quad.tl.y);
    }
  });

  it('stays well under a second per image', () => {
    expect(detectMillis / fixtures.length).toBeLessThan(500);
  });
});

describe('detectCorners on degenerate input', () => {
  const white = (width: number, height: number): OcrImage => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(255),
  });
  const finite = (quad: Quad): boolean => quadCorners(quad).every((p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y));

  it('returns a finite quad and zero confidence for a blank white page', () => {
    const detection = detectCorners(white(200, 200));
    expect(finite(detection.quad)).toBe(true);
    expect(detection.confidence).toBeCloseTo(0, 6);
  });

  it('does not throw on an empty image or a single dark pixel', () => {
    expect(detectCorners(white(0, 0)).confidence).toBe(0);
    const speck = white(50, 50);
    speck.data.fill(0, (25 * 50 + 25) * 4, (25 * 50 + 25) * 4 + 3);
    const detection = detectCorners(speck);
    expect(finite(detection.quad)).toBe(true);
    expect(detection.confidence).toBe(0);
  });
});
