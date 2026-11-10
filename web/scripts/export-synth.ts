// Writes synthetic KenKen PNG + label JSON pairs into e2e/__fixtures__/raw-samples/.
// Run with `npm run synth:export`. Output is deterministic: rerunning rewrites identical files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/play/generator/generate';
import { validateLabel } from '../src/ocr/labelToBoard';
import { distort } from '../src/ocr/render/distort';
import type { DistortSpec } from '../src/ocr/render/distort';
import { encodePng } from '../src/ocr/render/png';
import { renderPuzzle } from '../src/ocr/render/synth';
import type { OcrLabel } from '../src/ocr/types';

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
  { boardSize: 6, distortion: { tag: 'perspective', rotation: 6, perspective: 0.06 } },
];

const outputDirectory = fileURLToPath(new URL('../e2e/__fixtures__/raw-samples/', import.meta.url));
mkdirSync(outputDirectory, { recursive: true });

for (const { boardSize, distortion } of SAMPLES) {
  const name = `kenken-${boardSize}x${boardSize}-${distortion.tag}`;
  const puzzle = generate(`synth-export-${boardSize}x${boardSize}`, boardSize);
  const rendered = renderPuzzle(puzzle, { tag: distortion.tag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...distortion, seed: name });
  const label: OcrLabel = { ...rendered.label, corners };

  const errors = validateLabel(label);
  if (errors.length > 0) throw new Error(`${name}: invalid label:\n${errors.join('\n')}`);

  const pngPath = join(outputDirectory, `${name}.png`);
  const jsonPath = join(outputDirectory, `${name}.json`);
  writeFileSync(pngPath, encodePng(image));
  writeFileSync(jsonPath, `${JSON.stringify(label, null, 2)}\n`);
  console.log(`wrote ${name}.png + ${name}.json (${image.width}x${image.height}, ${puzzle.constraintString})`);
}
