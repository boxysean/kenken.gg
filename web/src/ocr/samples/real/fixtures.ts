// The real-photo fixtures: one directory per photographed puzzle under this
// one, read by the ratchet test (real.test.ts) and the scripts/real-*.ts tools.
// Node-only: it reads files next to itself.
//
// A fixture directory holds
//   photo.<webp|jpg|jpeg|png>  the photo as it came off the phone (Sean's own);
//   photo.png                  the same photo decoded the way the app's ingest
//                              decodes it, written by `npm run real:ingest`,
//                              which is what the pipeline is fed here (node has
//                              no JPEG or WebP decoder of its own);
//   label.json                 the OcrLabel exported from the app (cage names
//                              normalised: see normaliseCageNames.ts);
//   meta.json                  optional: `solution` (the puzzle's unique
//                              solution as the app showed it, checked against
//                              the solver) and `notes`.
//
// The label must carry corners: a board-only export (`kind: 'manual'`) cannot
// score corner detection, the warp, or anything downstream of it, so it is
// refused here rather than scored as a mystery failure.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normaliseCageNames } from '../../normaliseCageNames';
import { decodePng } from '../../render/png';
import type { OcrImage, OcrLabel, PhotoLabel } from '../../types';

export const REAL_SAMPLES_DIR = fileURLToPath(new URL('./', import.meta.url));

export const ORIGINAL_EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png'] as const;

export interface FixtureMeta {
  solution?: string[];
  notes?: string;
}

export interface RealFixture {
  id: string;
  dir: string;
  // The phone's file, whatever its format; null if only photo.png is present.
  original: string | null;
  decoded: string; // photo.png
  label: PhotoLabel;
  // Names normaliseCageNames had to change in label.json; empty once it is committed normalised.
  renamed: Record<string, string>;
  meta: FixtureMeta;
}

export function listFixtureIds(): string[] {
  return readdirSync(REAL_SAMPLES_DIR)
    .filter((entry) => statSync(`${REAL_SAMPLES_DIR}${entry}`).isDirectory() && existsSync(`${REAL_SAMPLES_DIR}${entry}/label.json`))
    .sort();
}

export function originalPhoto(dir: string): string | null {
  for (const extension of ORIGINAL_EXTENSIONS) {
    const path = `${dir}photo.${extension}`;
    // photo.png is the decoded copy unless it is the only photo there is.
    if (extension === 'png' && existsSync(`${dir}photo.png`) && ORIGINAL_EXTENSIONS.slice(0, -1).some((e) => existsSync(`${dir}photo.${e}`))) continue;
    if (existsSync(path)) return path;
  }
  return null;
}

export function loadFixture(id: string): RealFixture {
  const dir = `${REAL_SAMPLES_DIR}${id}/`;
  const raw: OcrLabel = JSON.parse(readFileSync(`${dir}label.json`, 'utf8'));
  const { label, renamed } = normaliseCageNames(raw);
  if (label.corners === undefined) {
    throw new Error(
      `${id}: label.json has no corners (a board-only export). A real-photo fixture needs the four corners clicked in "Label a photo" and exported as kenken-label.json.`,
    );
  }
  const meta: FixtureMeta = existsSync(`${dir}meta.json`) ? JSON.parse(readFileSync(`${dir}meta.json`, 'utf8')) : {};
  return { id, dir, original: originalPhoto(dir), decoded: `${dir}photo.png`, label: label as PhotoLabel, renamed, meta };
}

export function loadFixtures(): RealFixture[] {
  return listFixtureIds().map(loadFixture);
}

export function readPhoto(fixture: RealFixture): OcrImage {
  if (!existsSync(fixture.decoded)) {
    throw new Error(`${fixture.id}: no photo.png; run \`npm run real:ingest\` to decode the photo first`);
  }
  return decodePng(readFileSync(fixture.decoded));
}
