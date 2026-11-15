// @vitest-environment node
// The real-photo ratchet: every fixture under this directory (Sean's own phone
// photos, hand-labelled in the app) is scanned stage by stage and scored against
// its label, and the scores are held to baseline.json. A stage may get better
// but never worse; when it gets better, rerun with UPDATE_REAL_BASELINE=1 to
// raise the baseline in the same change.
//
// Each stage is also scored in isolation, fed the label's ground truth for the
// stages before it, so a failure upstream does not hide what happens downstream:
//   corners    detectCorners on the photo vs the clicked corners
//   grid       board size read from the photo warped with the clicked corners
//   cages      the partition derived from that warp vs the label's
//   clues      each label cage's clue crop, cut on the ideal lattice of that
//              warp, through the ONNX reader (the app's default)
//   scan       the whole app pipeline, scanPhoto, with nothing given to it
// Runs under node: it reads the photos and writes last-report.json (gitignored).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadClassifier, onnxReaderFrom } from '../../infer/onnxReader';
import type { PreparedClueReader } from '../../infer/onnxReader';
import { labelToBoard } from '../../labelToBoard';
import { deriveCages, cropClue } from '../../pipeline/cages';
import type { ClueReader } from '../../pipeline/clueReader';
import { detectCorners } from '../../pipeline/corners';
import { readGrid } from '../../pipeline/grid';
import { MIN_CORNER_CONFIDENCE, scanPhoto } from '../../pipeline/run';
import { FLAT_IMAGE_PX, warpToBoard } from '../../pipeline/warp';
import type { Clue, OcrImage, PhotoLabel, Quad, ScannedBoard } from '../../types';
import { solveFromAPI } from '../../../solver';
import { loadFixtures, readPhoto } from './fixtures';
import type { RealFixture } from './fixtures';

// A detected corner counts as found within this fraction of the board's mean
// side length (about 11px on a 550px board): the clicked corners are themselves
// a few pixels off the frame's centreline.
const CORNER_TOLERANCE = 0.02;

// Scores, all higher-is-better except cornerErrorPct, so one rule ratchets them.
interface StageScores {
  cornerConfidence: number;
  cornerErrorPct: number; // worst corner, as % of the board's mean side length
  cornerFound: number; // 1 when confidence >= MIN_CORNER_CONFIDENCE and within tolerance
  gridSize: number; // 1 when the warped board reads as the label's size
  edgeAccuracy: number; // internal edges classified thick/thin correctly; 0 if the size is wrong
  partition: number; // 1 when the cages match exactly
  clueAccuracy: number; // label cages whose clue the reader got right, over all cages
  scanSolved: number; // 1 when scanPhoto alone gives the label's puzzle and it solves to the solution
}

type Metric = keyof StageScores;
const LOWER_IS_BETTER: ReadonlySet<Metric> = new Set(['cornerErrorPct']);
const METRICS: readonly Metric[] = ['cornerConfidence', 'cornerErrorPct', 'cornerFound', 'gridSize', 'edgeAccuracy', 'partition', 'clueAccuracy', 'scanSolved'];

interface FixtureReport extends StageScores {
  id: string;
  boardSize: number;
  readGridSize: number;
  cornerErrorsPx: number[];
  clueMisses: string[];
  scanErrors: string[];
}

const BASELINE_URL = new URL('./baseline.json', import.meta.url);
const UPDATE = process.env.UPDATE_REAL_BASELINE === '1';

const KEYS = ['tl', 'tr', 'br', 'bl'] as const;

function cells(board: ScannedBoard): string[][] {
  return board.cageLetters.map((row) => row.split(' '));
}

// Cages renumbered by first appearance, so partitions compare whatever their letters.
function canonical(board: ScannedBoard): number[][] {
  const ids = new Map<string, number>();
  return cells(board).map((row) =>
    row.map((letter) => {
      if (!ids.has(letter)) ids.set(letter, ids.size);
      return ids.get(letter)!;
    }),
  );
}

// Internal edges, horizontal neighbours then vertical, true when thick.
function edges(board: ScannedBoard): boolean[] {
  const grid = cells(board);
  const n = board.boardSize;
  const thick: boolean[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c + 1 < n; c++) thick.push(grid[r][c] !== grid[r][c + 1]);
  for (let r = 0; r + 1 < n; r++) for (let c = 0; c < n; c++) thick.push(grid[r][c] !== grid[r + 1][c]);
  return thick;
}

// Each label cage's top-left cell (row-major first), which is where its clue is printed.
function clueCells(label: ScannedBoard): Map<string, { row: number; col: number }> {
  const first = new Map<string, { row: number; col: number }>();
  cells(label).forEach((row, r) => row.forEach((letter, c) => first.has(letter) || first.set(letter, { row: r, col: c })));
  return first;
}

function sameClue(a: { target: number; operator?: Clue['operator'] | null } | undefined, b: Clue): boolean {
  return a !== undefined && a.target === b.target && (a.operator ?? '') === (b.operator ?? '');
}

function meanSide(quad: Quad): number {
  const side = (a: keyof Quad, b: keyof Quad) => Math.hypot(quad[a].x - quad[b].x, quad[a].y - quad[b].y);
  return (side('tl', 'tr') + side('tr', 'br') + side('br', 'bl') + side('bl', 'tl')) / 4;
}

// The ONNX reader classifies asynchronously ahead of the synchronous read, so
// each batch of crops is prepared first through a stand-in for scanPhoto.
async function readCrops(reader: PreparedClueReader, crops: readonly OcrImage[]): Promise<ReturnType<ClueReader['read']>[]> {
  const blank: OcrImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  await reader.prepare(blank, (_image, collector) => {
    crops.forEach((crop) => collector.read(crop));
    return { lowConfidenceCages: [], errors: [] };
  });
  return crops.map((crop) => reader.read(crop));
}

function solvesTo(board: ScannedBoard, solution: string[] | undefined): boolean {
  try {
    const { boardStrings, constraintString } = labelToBoard(board);
    const result = solveFromAPI(boardStrings, constraintString);
    if (!result.solved) return false;
    if (solution === undefined) return true;
    return result.cells !== null && result.cells.join(' ') === solution.join(' ');
  } catch {
    return false;
  }
}

async function evaluate(fixture: RealFixture, reader: PreparedClueReader): Promise<FixtureReport> {
  const label: PhotoLabel = fixture.label;
  const n = label.boardSize;
  const photo = readPhoto(fixture);

  // Corners.
  const detection = detectCorners(photo);
  const cornerErrorsPx = KEYS.map((key) => Math.hypot(detection.quad[key].x - label.corners[key].x, detection.quad[key].y - label.corners[key].y));
  const cornerErrorPct = (100 * Math.max(...cornerErrorsPx)) / meanSide(label.corners);
  const cornerFound = Number(detection.confidence >= MIN_CORNER_CONFIDENCE && cornerErrorPct <= CORNER_TOLERANCE * 100);

  // Grid size and cages, from the photo warped with the clicked corners.
  const flat = warpToBoard(photo, label.corners);
  const readGridSize = readGrid(flat).boardSize;
  const gridSize = Number(readGridSize === n);
  let edgeAccuracy = 0;
  let partition = 0;
  if (gridSize === 1) {
    const derived = deriveCages(flat).board;
    const expected = edges(label);
    const found = edges(derived);
    edgeAccuracy = expected.filter((thick, index) => thick === found[index]).length / expected.length;
    partition = Number(JSON.stringify(canonical(derived)) === JSON.stringify(canonical(label)));
  }

  // Clues, on the label's own partition and the ideal lattice of that warp.
  const lattice = Array.from({ length: n + 1 }, (_, i) => (i * FLAT_IMAGE_PX) / n);
  const tops = [...clueCells(label)];
  const readings = await readCrops(
    reader,
    tops.map(([, { row, col }]) => cropClue(flat, lattice, lattice, row, col)),
  );
  const clueMisses: string[] = [];
  tops.forEach(([letter, { row, col }], index) => {
    const truth = label.clues[letter];
    const got = readings[index];
    if (!sameClue(got ?? undefined, truth)) {
      clueMisses.push(`r${row}c${col} ${truth.target}${truth.operator ?? ''} -> ${got === null ? 'declined' : `${got.target}${got.operator ?? ''}`}`);
    }
  });
  const clueAccuracy = (tops.length - clueMisses.length) / tops.length;

  // The whole app pipeline, nothing given.
  await reader.prepare(photo);
  const scan = scanPhoto(photo, reader);
  let scanSolved = 0;
  if (scan.board !== undefined && scan.errors.length === 0 && scan.board.boardSize === n) {
    const samePartition = JSON.stringify(canonical(scan.board)) === JSON.stringify(canonical(label));
    if (samePartition && Object.keys(scan.board.clues).length === tops.length) {
      scanSolved = Number(solvesTo(scan.board, fixture.meta.solution));
    }
  }

  return {
    id: fixture.id,
    boardSize: n,
    cornerConfidence: detection.confidence,
    cornerErrorPct,
    cornerFound,
    gridSize,
    edgeAccuracy,
    partition,
    clueAccuracy,
    scanSolved,
    readGridSize,
    cornerErrorsPx,
    clueMisses,
    scanErrors: scan.errors,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function table(reports: FixtureReport[]): string {
  const header = ['fixture', 'size', 'corner conf', 'corner err', 'corners', 'grid', 'edges', 'cages', 'clues', 'scan'];
  const mark = (value: number) => (value === 1 ? 'yes' : 'no');
  const rows = reports.map((r) => [
    r.id,
    `${r.boardSize}x${r.boardSize}`,
    r.cornerConfidence.toFixed(3),
    `${r.cornerErrorPct.toFixed(1)}%`,
    mark(r.cornerFound),
    r.gridSize === 1 ? 'yes' : `no (${r.readGridSize})`,
    `${(r.edgeAccuracy * 100).toFixed(0)}%`,
    mark(r.partition),
    `${(r.clueAccuracy * 100).toFixed(0)}%`,
    mark(r.scanSolved),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

describe('real-photo ratchet', () => {
  it('scores every fixture no worse than baseline.json', async () => {
    const fixtures = loadFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    const reader = onnxReaderFrom(await loadClassifier(new URL('../../models/char.onnx', import.meta.url)));

    const reports: FixtureReport[] = [];
    for (const fixture of fixtures) reports.push(await evaluate(fixture, reader));

    console.log(`real-photo ratchet, ${reports.length} photos (corners within ${CORNER_TOLERANCE * 100}% of the side)\n${table(reports)}`);
    for (const r of reports) {
      if (r.scanErrors.length > 0) console.log(`${r.id} scan: ${r.scanErrors.join('; ')}`);
      if (r.clueMisses.length > 0) console.log(`${r.id} clue misses (${r.clueMisses.length}): ${r.clueMisses.join(', ')}`);
    }
    writeFileSync(new URL('./last-report.json', import.meta.url), `${JSON.stringify(reports, null, 2)}\n`);

    const current: Record<string, StageScores> = Object.fromEntries(
      reports.map((r) => [r.id, Object.fromEntries(METRICS.map((metric) => [metric, round(r[metric])])) as unknown as StageScores]),
    );
    if (UPDATE || !existsSync(BASELINE_URL)) {
      writeFileSync(BASELINE_URL, `${JSON.stringify(current, null, 2)}\n`);
      console.log('baseline.json written');
      return;
    }

    const baseline: Record<string, StageScores> = JSON.parse(readFileSync(BASELINE_URL, 'utf8'));
    for (const id of Object.keys(baseline)) {
      expect(current[id], `${id} is in baseline.json but no longer a fixture`).toBeDefined();
    }
    for (const [id, scores] of Object.entries(current)) {
      const floor = baseline[id];
      expect(floor, `${id} has no baseline: rerun with UPDATE_REAL_BASELINE=1 and commit baseline.json`).toBeDefined();
      for (const metric of METRICS) {
        const message = `${id} ${metric} regressed: ${scores[metric]} vs baseline ${floor[metric]}`;
        if (LOWER_IS_BETTER.has(metric)) expect(scores[metric], message).toBeLessThanOrEqual(floor[metric] + 0.001);
        else expect(scores[metric], message).toBeGreaterThanOrEqual(floor[metric] - 0.001);
      }
    }
  }, 300_000);
});
