// The template reader's per-character accuracy on the ticket-8 eval recipes: the
// baseline a per-character model is compared with. The eval scores whole clues,
// where the template reader is perfect because its templates are the renderer's
// own font; here every character counts, and a declined clue counts every one of
// its characters as wrong. Crops come from warping with the known corners, as in
// scripts/export-crops.ts. Run with `npm run ocr:baseline`. Prints to stdout only.
import { readFileSync } from 'node:fs';
import { generate } from '../src/play/generator/generate';
import { deriveCages } from '../src/ocr/pipeline/cages';
import { readAll } from '../src/ocr/pipeline/clueReader';
import { templateClueReader } from '../src/ocr/pipeline/clueTemplate';
import { warpToBoard } from '../src/ocr/pipeline/warp';
import { distort } from '../src/ocr/render/distort';
import type { DistortSpec, StyleTag } from '../src/ocr/render/distort';
import { clueText, renderPuzzle } from '../src/ocr/render/synth';
import type { OcrLabel } from '../src/ocr/types';

interface Recipe {
  readonly seed: string;
  readonly boardSize: number;
  readonly styleTag: StyleTag;
}

interface Tally {
  characters: number;
  correct: number;
}

// The same distortion per tag as scripts/export-synth.ts and the ticket-8 eval.
const STYLE_SPECS: Record<StyleTag, Omit<DistortSpec, 'seed'>> = {
  clean: { tag: 'clean' },
  noise: { tag: 'noise', noise: 0.25, blur: 1 },
  glare: { tag: 'glare', glare: 0.8 },
  perspective: { tag: 'perspective', rotation: 6, perspective: 0.06 },
};

const DISTORTED: readonly StyleTag[] = ['noise', 'glare', 'perspective'];

const { recipes }: { recipes: Recipe[] } = JSON.parse(readFileSync(new URL('../src/ocr/eval/manifest.json', import.meta.url), 'utf8'));

const byTag = new Map<StyleTag, Tally>();
for (const recipe of recipes) {
  const puzzle = generate(recipe.seed, recipe.boardSize);
  const rendered = renderPuzzle(puzzle, { tag: recipe.styleTag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...STYLE_SPECS[recipe.styleTag], seed: recipe.seed });
  const label: OcrLabel = { ...rendered.label, corners };
  const derived = deriveCages(warpToBoard(image, label.corners), label);

  const tally = byTag.get(recipe.styleTag) ?? { characters: 0, correct: 0 };
  for (const reading of readAll(derived.clueCrops, templateClueReader)) {
    if (reading.expected === undefined) continue;
    const truth = clueText(reading.expected);
    const got = reading.result === null ? '' : clueText({ target: reading.result.target, operator: reading.result.operator ?? '' });
    tally.characters += truth.length;
    for (let i = 0; i < truth.length; i++) if (got[i] === truth[i]) tally.correct++;
  }
  byTag.set(recipe.styleTag, tally);
}

function sum(tags: readonly StyleTag[]): Tally {
  return tags.reduce(
    (total, tag) => {
      const tally = byTag.get(tag) ?? { characters: 0, correct: 0 };
      return { characters: total.characters + tally.characters, correct: total.correct + tally.correct };
    },
    { characters: 0, correct: 0 },
  );
}

function table(rows: [string, Tally][]): string {
  const header = ['styleTag', 'characters correct', 'accuracy'];
  const cells = rows.map(([name, { characters, correct }]) => [
    name,
    `${correct}/${characters}`,
    characters > 0 ? `${((correct / characters) * 100).toFixed(1)}%` : 'n/a',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i].length)));
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(line)].join('\n');
}

const perTag = DISTORTED.map((tag): [string, Tally] => [tag, sum([tag])]);
console.log(`Template reader, per-character accuracy, ${recipes.length} eval recipes (declined clues count as wrong)`);
console.log(table([...perTag, ['distorted (noise+glare+perspective)', sum(DISTORTED)]]));
console.log('');
console.log(table([['clean', sum(['clean'])]]));
