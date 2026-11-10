// Writes labelled 16x16 character crops for training a clue-character model into
// training/data/crops/<class>/, plus training/data/manifest.json. Each recipe is
// rendered, distorted, warped flat with its known corners and cut into clue crops;
// each clue crop is split into characters by its column ink profile.
// Run with `npm run ocr:export-crops`. Output is deterministic: rerunning rewrites identical files.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/play/generator/generate';
import { CANVAS_SIZE, characterCanvas } from '../src/ocr/infer/preprocess';
import type { Run } from '../src/ocr/infer/preprocess';
import { binarize } from '../src/ocr/pipeline/binarize';
import { deriveCages } from '../src/ocr/pipeline/cages';
import type { ClueCrop } from '../src/ocr/pipeline/cages';
import { warpToBoard } from '../src/ocr/pipeline/warp';
import { distort } from '../src/ocr/render/distort';
import type { DistortSpec, StyleTag } from '../src/ocr/render/distort';
import { encodePng } from '../src/ocr/render/png';
import { clueText, renderPuzzle } from '../src/ocr/render/synth';
import type { OcrImage, OcrLabel } from '../src/ocr/types';

const BOARD_SIZES = [4, 5, 6, 7, 8, 9];
const SEEDS_PER_TAG = 25;
// Shared with the in-browser reader, which builds its canvases the same way.
const IMAGE_SIZE = CANVAS_SIZE;
// Columns with fewer ink pixels than this are treated as gaps, so single-pixel
// speckle does not start a character of its own.
const MIN_COLUMN_INK = 2;

const CLASSES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', 'x', '/'] as const;

// '+' and '/' cannot be directory names as-is, so every operator gets a word.
const CLASS_DIRECTORIES: Record<string, string> = { '+': 'plus', '-': 'minus', x: 'times', '/': 'div' };

// The same distortion per tag as scripts/export-synth.ts and the ticket-8 eval.
const STYLE_SPECS: Record<StyleTag, Omit<DistortSpec, 'seed'>> = {
  clean: { tag: 'clean' },
  noise: { tag: 'noise', noise: 0.25, blur: 1 },
  glare: { tag: 'glare', glare: 0.8 },
  perspective: { tag: 'perspective', rotation: 6, perspective: 0.06 },
};

const SPLIT_RULE =
  'train/val by puzzle seed and style tag (one recipe is wholly train or wholly val); a recipe is val when its seed index % 5 === 0';

type Split = 'train' | 'val';

interface Recipe {
  readonly seed: string;
  readonly puzzleId: string;
  readonly boardSize: number;
  readonly styleTag: StyleTag;
  readonly split: Split;
}

interface ManifestCrop {
  readonly file: string;
  readonly class: string;
  readonly seed: string;
  readonly puzzleId: string;
  readonly boardSize: number;
  readonly styleTag: StyleTag;
  readonly row: number;
  readonly col: number;
  readonly index: number;
  readonly split: Split;
}

const recipes: Recipe[] = [];
for (const styleTag of Object.keys(STYLE_SPECS) as StyleTag[]) {
  for (let i = 0; i < SEEDS_PER_TAG; i++) {
    const boardSize = BOARD_SIZES[i % BOARD_SIZES.length];
    const seed = `crops-${styleTag}-${i}`;
    recipes.push({ seed, puzzleId: `${seed}-${boardSize}x${boardSize}`, boardSize, styleTag, split: i % 5 === 0 ? 'val' : 'train' });
  }
}

// Runs of consecutive columns holding at least MIN_COLUMN_INK ink pixels.
function inkRuns(profile: readonly number[]): Run[] {
  const runs: Run[] = [];
  let start = -1;
  profile.forEach((count, x) => {
    if (count >= MIN_COLUMN_INK && start < 0) start = x;
    if (count < MIN_COLUMN_INK && start >= 0) {
      runs.push({ start, end: x - 1 });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ start, end: profile.length - 1 });
  return runs;
}

// Merges the closest adjacent runs, or splits the widest, until there are exactly
// count runs. Returns null when a run is too narrow to split.
function fitRuns(found: readonly Run[], count: number): Run[] | null {
  const runs = found.map((run) => ({ ...run }));
  while (runs.length > count) {
    let best = 0;
    for (let i = 1; i + 1 < runs.length; i++) {
      if (runs[i + 1].start - runs[i].end < runs[best + 1].start - runs[best].end) best = i;
    }
    runs.splice(best, 2, { start: runs[best].start, end: runs[best + 1].end });
  }
  while (runs.length > 0 && runs.length < count) {
    let widest = 0;
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].end - runs[i].start > runs[widest].end - runs[widest].start) widest = i;
    }
    const { start, end } = runs[widest];
    if (end <= start) return null;
    const middle = Math.floor((start + end) / 2);
    runs.splice(widest, 1, { start, end: middle }, { start: middle + 1, end });
  }
  return runs.length === count ? runs : null;
}

// Splits one clue crop into one canvas per drawn character, or null to drop it.
function segment(crop: ClueCrop, text: string): Uint8Array[] | null {
  if (text.length === 0) return null;
  const { width, height } = crop.crop;
  const { ink } = binarize(crop.crop);
  const profile = Array.from({ length: width }, (_, x) => {
    let count = 0;
    for (let y = 0; y < height; y++) count += ink[y * width + x];
    return count;
  });
  const runs = fitRuns(inkRuns(profile), text.length);
  if (runs === null) return null;
  const canvases: Uint8Array[] = [];
  for (const run of runs) {
    const canvas = characterCanvas(ink, width, height, run);
    if (canvas === null) return null;
    canvases.push(canvas);
  }
  return canvases;
}

// encodePng only writes RGBA, so the grayscale canvas goes into R, G and B alike
// with A = 255. The training side reads the value back from the RGB channels.
function canvasImage(canvas: Uint8Array): OcrImage {
  const data = new Uint8ClampedArray(canvas.length * 4);
  canvas.forEach((value, index) => {
    data.set([value, value, value, 255], index * 4);
  });
  return { width: IMAGE_SIZE, height: IMAGE_SIZE, data };
}

const dataDirectory = fileURLToPath(new URL('../../training/data/', import.meta.url));
const cropsDirectory = join(dataDirectory, 'crops');
// Start from an empty crops directory so files from an older run never linger.
rmSync(cropsDirectory, { recursive: true, force: true });

const crops: ManifestCrop[] = [];
let dropped = 0;

for (const recipe of recipes) {
  const puzzle = generate(recipe.seed, recipe.boardSize);
  const rendered = renderPuzzle(puzzle, { tag: recipe.styleTag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...STYLE_SPECS[recipe.styleTag], seed: recipe.seed });
  const label: OcrLabel = { ...rendered.label, corners };
  const flat = warpToBoard(image, label.corners);
  const derived = deriveCages(flat, label);

  let written = 0;
  for (const crop of derived.clueCrops) {
    if (crop.expected === undefined) continue;
    const text = clueText(crop.expected);
    const canvases = segment(crop, text);
    if (canvases === null) {
      dropped++;
      continue;
    }
    const { row, col } = crop.topLeftCell;
    canvases.forEach((canvas, index) => {
      const character = text[index];
      const directory = CLASS_DIRECTORIES[character] ?? character;
      const name = `${recipe.seed}_${recipe.boardSize}_${row}_${col}_${index}.png`;
      mkdirSync(join(cropsDirectory, directory), { recursive: true });
      writeFileSync(join(cropsDirectory, directory, name), encodePng(canvasImage(canvas)));
      crops.push({
        file: `training/data/crops/${directory}/${name}`,
        class: character,
        seed: recipe.seed,
        puzzleId: recipe.puzzleId,
        boardSize: recipe.boardSize,
        styleTag: recipe.styleTag,
        row,
        col,
        index,
        split: recipe.split,
      });
      written++;
    });
  }
  console.log(`wrote ${recipe.puzzleId} ${recipe.styleTag}: ${written} crops`);
}

crops.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
const manifest = { generatedBy: 'web/scripts/export-crops.ts', classes: CLASSES, imageSize: IMAGE_SIZE, splitRule: SPLIT_RULE, crops };
writeFileSync(join(dataDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const perClass = CLASSES.map((character) => `  ${character.padEnd(2)} ${crops.filter((crop) => crop.class === character).length}`);
const train = crops.filter((crop) => crop.split === 'train').length;
console.log(
  [
    '',
    `${crops.length} crops from ${recipes.length} puzzles, ${dropped} clue crops dropped`,
    'per class:',
    ...perClass,
    `split: ${train} train, ${crops.length - train} val`,
  ].join('\n'),
);
