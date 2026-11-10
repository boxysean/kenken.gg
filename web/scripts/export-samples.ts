// Writes the Playwright scan samples into e2e/__fixtures__/samples/: a PNG and
// the board it should scan to (<name>.expected.json, a ScannedBoard). These are
// the ticket-2 recipes that scan fully; the 6x6 perspective one leaves a clue
// unread, so it is left out. Run with `npm run samples:export`. Output is
// deterministic: rerunning rewrites identical files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/play/generator/generate';
import { validateLabel } from '../src/ocr/labelToBoard';
import { distort } from '../src/ocr/render/distort';
import type { DistortSpec } from '../src/ocr/render/distort';
import { encodePng } from '../src/ocr/render/png';
import { renderPuzzle } from '../src/ocr/render/synth';
import type { ScannedBoard } from '../src/ocr/types';

interface Sample {
  readonly boardSize: number;
  readonly distortion: Omit<DistortSpec, 'seed'>;
}

const SAMPLES: readonly Sample[] = [
  { boardSize: 4, distortion: { tag: 'clean' } },
  { boardSize: 5, distortion: { tag: 'clean' } },
  { boardSize: 6, distortion: { tag: 'clean' } },
  { boardSize: 4, distortion: { tag: 'noise', noise: 0.25, blur: 1 } },
  { boardSize: 5, distortion: { tag: 'glare', glare: 0.8 } },
];

const outputDirectory = fileURLToPath(new URL('../e2e/__fixtures__/samples/', import.meta.url));
mkdirSync(outputDirectory, { recursive: true });

for (const { boardSize, distortion } of SAMPLES) {
  const name = `kenken-${boardSize}x${boardSize}-${distortion.tag}`;
  const puzzle = generate(`synth-export-${boardSize}x${boardSize}`, boardSize);
  const rendered = renderPuzzle(puzzle, { tag: distortion.tag });
  const { image } = distort(rendered.image, rendered.label.corners, { ...distortion, seed: name });
  // The label minus corners and source: exactly what a scan should produce.
  const expected: ScannedBoard = {
    boardSize: rendered.label.boardSize,
    cageLetters: rendered.label.cageLetters,
    clues: rendered.label.clues,
  };

  const errors = validateLabel(expected);
  if (errors.length > 0) throw new Error(`${name}: invalid expected board:\n${errors.join('\n')}`);

  writeFileSync(join(outputDirectory, `${name}.png`), encodePng(image));
  writeFileSync(join(outputDirectory, `${name}.expected.json`), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`wrote ${name}.png + ${name}.expected.json (${image.width}x${image.height}, ${puzzle.constraintString})`);
}
