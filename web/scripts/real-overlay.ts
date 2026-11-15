// Draws a real-photo fixture's labelled corners and the n x n lattice their
// homography implies over the photo, and alongside it what the corner detector
// found, so the two can be eyeballed: are the labelled corners on the frame, and
// does a flat four-corner homography follow the printed grid lines all the way
// down (it will not on curved paper)? Also prints how far the grid lines the
// pipeline finds in the warped board sit from the ideal lattice, line by line,
// which is the same question in numbers. Not part of the test suite.
//
//   npm run real:overlay                       every fixture, to /tmp/kenken-real/<id>-overlay.png
//   npm run real:overlay -- photo-02 out.png   one fixture, to a path
import { mkdirSync, writeFileSync } from 'node:fs';
import { detectCorners } from '../src/ocr/pipeline/corners';
import { applyHomography, invertHomography, solveHomography } from '../src/ocr/pipeline/geometry';
import { readGrid } from '../src/ocr/pipeline/grid';
import { FLAT_IMAGE_PX, warpToBoard } from '../src/ocr/pipeline/warp';
import { encodePng } from '../src/ocr/render/png';
import { listFixtureIds, loadFixture, readPhoto } from '../src/ocr/samples/real/fixtures';
import type { OcrImage, Point, Quad } from '../src/ocr/types';

type Rgb = [number, number, number];
const LABEL_COLOUR: Rgb = [0, 170, 255]; // labelled corners + lattice: blue
const DETECTED_COLOUR: Rgb = [255, 40, 40]; // detector's quad: red

function plot(image: OcrImage, x: number, y: number, [r, g, b]: Rgb): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
  const offset = (py * image.width + px) * 4;
  image.data[offset] = r;
  image.data[offset + 1] = g;
  image.data[offset + 2] = b;
}

function line(image: OcrImage, a: Point, b: Point, colour: Rgb): void {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
  for (let k = 0; k <= steps; k++) {
    const t = steps === 0 ? 0 : k / steps;
    plot(image, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, colour);
  }
}

function cross(image: OcrImage, p: Point, colour: Rgb, arm = 8): void {
  line(image, { x: p.x - arm, y: p.y }, { x: p.x + arm, y: p.y }, colour);
  line(image, { x: p.x, y: p.y - arm }, { x: p.x, y: p.y + arm }, colour);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) plot(image, p.x + dx, p.y + dy, colour);
}

function quadOutline(image: OcrImage, quad: Quad, colour: Rgb): void {
  line(image, quad.tl, quad.tr, colour);
  line(image, quad.tr, quad.br, colour);
  line(image, quad.br, quad.bl, colour);
  line(image, quad.bl, quad.tl, colour);
}

// The lattice of an n x n board inside the quad, through the quad's homography.
function lattice(image: OcrImage, quad: Quad, n: number, colour: Rgb): void {
  const toPhoto = invertHomography(solveHomography(quad));
  const at = (u: number, v: number): Point => applyHomography(toPhoto, { x: u, y: v });
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    line(image, at(t, 0), at(t, 1), colour);
    line(image, at(0, t), at(1, t), colour);
  }
}

const args = process.argv.slice(2);
const ids = args.length > 0 ? [args[0]] : listFixtureIds();
const outDir = '/tmp/kenken-real/';
mkdirSync(outDir, { recursive: true });

for (const id of ids) {
  const fixture = loadFixture(id);
  const photo = readPhoto(fixture);
  const { corners, boardSize: n } = fixture.label;

  const detection = detectCorners(photo);
  const distances = (['tl', 'tr', 'br', 'bl'] as const).map((key) => Math.hypot(detection.quad[key].x - corners[key].x, detection.quad[key].y - corners[key].y));
  console.log(`${id}: ${photo.width}x${photo.height}, ${n}x${n}`);
  console.log(`  detector: confidence ${detection.confidence.toFixed(3)}; quad vs label (px): ${distances.map((d) => d.toFixed(1)).join(', ')}`);
  for (const key of ['tl', 'tr', 'br', 'bl'] as const) {
    console.log(`    ${key}: label (${corners[key].x.toFixed(1)}, ${corners[key].y.toFixed(1)}) detected (${detection.quad[key].x.toFixed(1)}, ${detection.quad[key].y.toFixed(1)})`);
  }

  // How far each grid line the pipeline finds in the labelled-corner warp sits
  // from where a planar board would put it; also in photo pixels, using the
  // board's mean side so the two fixtures' numbers compare.
  const flat = warpToBoard(photo, corners);
  const grid = readGrid(flat);
  const side = (Math.hypot(corners.tr.x - corners.tl.x, corners.tr.y - corners.tl.y) + Math.hypot(corners.br.x - corners.bl.x, corners.br.y - corners.bl.y) + Math.hypot(corners.bl.x - corners.tl.x, corners.bl.y - corners.tl.y) + Math.hypot(corners.br.x - corners.tr.x, corners.br.y - corners.tr.y)) / 4;
  const toPhotoPx = side / FLAT_IMAGE_PX;
  const drift = (found: number[]): string =>
    found.map((position, index) => `${(position - (index * FLAT_IMAGE_PX) / n).toFixed(0)}`).join(' ');
  console.log(`  grid in the labelled-corner warp: ${grid.boardSize}x${grid.boardSize} (${grid.lineX.length} x-lines, ${grid.lineY.length} y-lines)`);
  console.log(`    x-line drift from the ideal lattice, flat px (1 flat px = ${toPhotoPx.toFixed(2)} photo px): ${drift(grid.lineX)}`);
  console.log(`    y-line drift from the ideal lattice, flat px: ${drift(grid.lineY)}`);

  const overlay: OcrImage = { width: photo.width, height: photo.height, data: new Uint8ClampedArray(photo.data) };
  lattice(overlay, corners, n, LABEL_COLOUR);
  for (const key of ['tl', 'tr', 'br', 'bl'] as const) cross(overlay, corners[key], LABEL_COLOUR);
  quadOutline(overlay, detection.quad, DETECTED_COLOUR);
  for (const key of ['tl', 'tr', 'br', 'bl'] as const) cross(overlay, detection.quad[key], DETECTED_COLOUR, 5);
  const out = args[1] ?? `${outDir}${id}-overlay.png`;
  writeFileSync(out, encodePng(overlay));
  console.log(`  wrote ${out} (blue: labelled corners + lattice; red: detector's quad)`);
}
