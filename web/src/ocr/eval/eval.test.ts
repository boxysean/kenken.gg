// @vitest-environment node
// The OCR accuracy eval: every recipe in manifest.json is rendered, distorted and
// scanned with no label in sight, then scored against its label. Metrics are
// grouped by style tag, printed as a table, written in full to last-report.json
// (gitignored) and held to the committed floors in the manifest, which are the
// regression baseline. Runs under node: it reads and writes files next to itself.
import { readFileSync, writeFileSync } from 'node:fs';
import { generate } from '../../play/generator/generate';
import { solveFromAPI } from '../../solver';
import { labelToBoard } from '../labelToBoard';
import { distort } from '../render/distort';
import type { DistortSpec, StyleTag } from '../render/distort';
import { renderPuzzle } from '../render/synth';
import type { OcrLabel, Quad, ScannedBoard } from '../types';
import { templateClueReader } from '../pipeline/clueTemplate';
import { scanPhoto } from '../pipeline/run';

const METRICS = ['cornerAccuracy', 'edgeAccuracy', 'clueAccuracy', 'wholePuzzle'] as const;
type Metric = (typeof METRICS)[number];

interface Recipe {
  seed: string;
  boardSize: number;
  styleTag: StyleTag;
}

interface Manifest {
  recipes: Recipe[];
  tolerance: { cornerPx: number };
  floors: Record<StyleTag, Record<Metric, number>>;
}

// The same distortion per tag as scripts/export-synth.ts.
const STYLE_SPECS: Record<StyleTag, Omit<DistortSpec, 'seed'>> = {
  clean: { tag: 'clean' },
  noise: { tag: 'noise', noise: 0.25, blur: 1 },
  glare: { tag: 'glare', glare: 0.8 },
  perspective: { tag: 'perspective', rotation: 6, perspective: 0.06 },
};

interface FixtureReport {
  seed: string;
  boardSize: number;
  styleTag: StyleTag;
  errors: string[];
  // null when the scan found no corners at all.
  cornerMaxPx: number | null;
  cornerMeanPx: number | null;
  cornerPass: boolean;
  partitionMatches: boolean;
  edgesCorrect: number;
  edgesTotal: number;
  cluesCommitted: number;
  cluesCorrect: number;
  cagesTotal: number;
  solved: boolean;
  wholePuzzle: boolean;
}

interface TagReport {
  fixtures: number;
  cornerAccuracy: number;
  cornerMeanPx: number | null;
  edgeAccuracy: number;
  // Correct committed clues / committed clues, pooled over the tag's fixtures.
  // null when no clue was committed at all; scored as 1.0 against the floor,
  // since a reader that declines everything has made no wrong reading (its
  // failure shows up in coverage and wholePuzzle instead).
  clueAccuracy: number | null;
  clueCoverage: number;
  wholePuzzle: number;
  wholePuzzlePasses: number;
}

const manifest: Manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

function cells(board: ScannedBoard): string[][] {
  return board.cageLetters.map((row) => row.split(' '));
}

// Renames cages to integers in order of first appearance, row-major, so two
// partitions compare equal whatever their letters are called (as in run.test.ts).
function canonical(board: ScannedBoard): number[][] {
  const ids = new Map<string, number>();
  return cells(board).map((row) =>
    row.map((letter) => {
      if (!ids.has(letter)) ids.set(letter, ids.size);
      return ids.get(letter)!;
    }),
  );
}

// Each cage's cells as a sorted "r,c;r,c" key, keyed by letter.
function cageCells(board: ScannedBoard): Map<string, string> {
  const members = new Map<string, string[]>();
  cells(board).forEach((row, r) =>
    row.forEach((letter, c) => {
      if (!members.has(letter)) members.set(letter, []);
      members.get(letter)!.push(`${r},${c}`);
    }),
  );
  return new Map([...members].map(([letter, list]) => [letter, list.sort().join(';')]));
}

// Maps each scanned letter to the label letter of the cage with exactly the same
// cells. Once the partitions match this is run.test.ts's letterMap; before that,
// a scanned cage with no identical label cage maps to nothing, so its clue is
// counted as wrong (it is attached to a cage that does not exist).
function letterMap(board: ScannedBoard, label: ScannedBoard): Map<string, string> {
  const labelByCells = new Map([...cageCells(label)].map(([letter, key]) => [key, letter]));
  const map = new Map<string, string>();
  for (const [letter, key] of cageCells(board)) {
    const labelLetter = labelByCells.get(key);
    if (labelLetter !== undefined) map.set(letter, labelLetter);
  }
  return map;
}

// Internal edges, horizontal then vertical, each true when thick: the two cells
// either side are in different cages.
function edges(board: ScannedBoard): boolean[] {
  const grid = cells(board);
  const n = board.boardSize;
  const thick: boolean[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c + 1 < n; c++) thick.push(grid[r][c] !== grid[r][c + 1]);
  for (let r = 0; r + 1 < n; r++) for (let c = 0; c < n; c++) thick.push(grid[r][c] !== grid[r + 1][c]);
  return thick;
}

function cornerDistances(found: Quad, truth: Quad): number[] {
  return (['tl', 'tr', 'br', 'bl'] as const).map((key) => Math.hypot(found[key].x - truth[key].x, found[key].y - truth[key].y));
}

function evaluate(recipe: Recipe): FixtureReport {
  const puzzle = generate(recipe.seed, recipe.boardSize);
  const rendered = renderPuzzle(puzzle, { tag: recipe.styleTag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...STYLE_SPECS[recipe.styleTag], seed: recipe.seed });
  const label: OcrLabel = { ...rendered.label, corners };
  const result = scanPhoto(image, templateClueReader);

  const distances = result.corners ? cornerDistances(result.corners, label.corners) : null;
  const cornerMaxPx = distances ? Math.max(...distances) : null;
  const cornerMeanPx = distances ? distances.reduce((sum, d) => sum + d, 0) / distances.length : null;

  const expectedEdges = edges(label);
  const cagesTotal = cageCells(label).size;
  const board = result.board;
  const sameSize = board !== undefined && board.boardSize === label.boardSize;

  let edgesCorrect = 0;
  if (sameSize) {
    const found = edges(board);
    edgesCorrect = expectedEdges.filter((thick, index) => thick === found[index]).length;
  }
  const partitionMatches = sameSize && JSON.stringify(canonical(board)) === JSON.stringify(canonical(label));

  let cluesCommitted = 0;
  let cluesCorrect = 0;
  if (board !== undefined) {
    const toLabel = sameSize ? letterMap(board, label) : new Map<string, string>();
    for (const [letter, clue] of Object.entries(board.clues)) {
      cluesCommitted++;
      const labelLetter = toLabel.get(letter);
      const truth = labelLetter === undefined ? undefined : label.clues[labelLetter];
      if (truth !== undefined && truth.target === clue.target && truth.operator === clue.operator) cluesCorrect++;
    }
  }

  let solved = false;
  if (board !== undefined) {
    const { boardStrings, constraintString } = labelToBoard(board);
    try {
      solved = solveFromAPI(boardStrings, constraintString).solved;
    } catch {
      solved = false;
    }
  }

  const wholePuzzle = result.errors.length === 0 && partitionMatches && cluesCorrect === cagesTotal && cluesCommitted === cagesTotal && solved;

  return {
    seed: recipe.seed,
    boardSize: recipe.boardSize,
    styleTag: recipe.styleTag,
    errors: result.errors,
    cornerMaxPx,
    cornerMeanPx,
    cornerPass: cornerMaxPx !== null && cornerMaxPx <= manifest.tolerance.cornerPx,
    partitionMatches,
    edgesCorrect,
    edgesTotal: expectedEdges.length,
    cluesCommitted,
    cluesCorrect,
    cagesTotal,
    solved,
    wholePuzzle,
  };
}

function summarise(fixtures: FixtureReport[]): TagReport {
  const sum = (pick: (f: FixtureReport) => number) => fixtures.reduce((total, f) => total + pick(f), 0);
  const located = fixtures.filter((f) => f.cornerMeanPx !== null);
  const committed = sum((f) => f.cluesCommitted);
  const passes = fixtures.filter((f) => f.wholePuzzle).length;
  return {
    fixtures: fixtures.length,
    cornerAccuracy: fixtures.filter((f) => f.cornerPass).length / fixtures.length,
    cornerMeanPx: located.length > 0 ? located.reduce((total, f) => total + f.cornerMeanPx!, 0) / located.length : null,
    edgeAccuracy: sum((f) => f.edgesCorrect) / sum((f) => f.edgesTotal),
    clueAccuracy: committed > 0 ? sum((f) => f.cluesCorrect) / committed : null,
    clueCoverage: committed / sum((f) => f.cagesTotal),
    wholePuzzle: passes / fixtures.length,
    wholePuzzlePasses: passes,
  };
}

function scored(tag: TagReport, metric: Metric): number {
  return tag[metric] ?? 1;
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function table(byTag: [StyleTag, TagReport][]): string {
  const header = ['styleTag', 'fixtures', 'corner', 'edge', 'clue', 'coverage', 'whole', 'passes'];
  const rows = byTag.map(([tag, r]) => [
    tag,
    String(r.fixtures),
    percent(r.cornerAccuracy),
    percent(r.edgeAccuracy),
    percent(r.clueAccuracy),
    percent(r.clueCoverage),
    percent(r.wholePuzzle),
    `${r.wholePuzzlePasses}/${r.fixtures}`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

describe('OCR accuracy eval', () => {
  it('meets the committed floors for every style tag', () => {
    expect(manifest.recipes.length).toBeGreaterThanOrEqual(20);
    const fixtures = manifest.recipes.map(evaluate);

    const tags = Object.keys(manifest.floors) as StyleTag[];
    const byTag = tags.map((tag): [StyleTag, TagReport] => [tag, summarise(fixtures.filter((f) => f.styleTag === tag))]);

    console.log(`OCR eval, ${fixtures.length} fixtures, corner tolerance ${manifest.tolerance.cornerPx}px\n${table(byTag)}`);
    writeFileSync(
      new URL('./last-report.json', import.meta.url),
      `${JSON.stringify({ tolerance: manifest.tolerance, floors: manifest.floors, byTag: Object.fromEntries(byTag), fixtures }, null, 2)}\n`,
    );

    for (const [tag, report] of byTag) {
      expect(report.fixtures, `${tag}: no recipes`).toBeGreaterThan(0);
      for (const metric of METRICS) {
        const floor = manifest.floors[tag][metric];
        const value = scored(report, metric);
        expect(value, `${tag} ${metric}: measured ${value.toFixed(3)}, floor ${floor}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});
