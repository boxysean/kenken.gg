// Checks every label JSON in a folder: valid, and exactly one solution. Prints
// one line per file and exits non-zero if any is not ok. The logic lives in
// src/ocr/labelCheck.ts, where it is typechecked and tested.
// Run with `npm run check:labels -- [folder]` (default e2e/__fixtures__/raw-samples).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLabel, formatVerdict } from '../src/ocr/labelCheck';
import type { LabelVerdict } from '../src/ocr/labelCheck';

const folder = process.argv[2] ?? 'e2e/__fixtures__/raw-samples';

let names: string[];
try {
  names = readdirSync(folder).filter((name) => name.endsWith('.json')).sort();
} catch (error) {
  console.error(`cannot read ${folder}: ${error instanceof Error ? error.message : String(error)}`);
  console.error('usage: npm run check:labels -- <folder of label .json files>');
  process.exit(2);
}

let failed = 0;
for (const name of names) {
  let verdict: LabelVerdict;
  try {
    verdict = checkLabel(JSON.parse(readFileSync(join(folder, name), 'utf8')));
  } catch (error) {
    // Unreadable or not JSON at all: still one line, still a failure.
    verdict = { status: 'invalid', reasons: [error instanceof Error ? error.message : String(error)] };
  }
  console.log(formatVerdict(name, verdict));
  if (verdict.status !== 'ok') failed++;
}

if (failed > 0) process.exitCode = 1;
