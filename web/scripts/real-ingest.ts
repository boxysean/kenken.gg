// Prepares the real-photo fixtures under src/ocr/samples/real/<id>/ for the
// suite: decodes each photo into photo.png exactly as the app's ingest would
// (Chromium's decoder, the INGEST_MAX_DIM cap, EXIF orientation applied), and
// rewrites label.json with its cage names normalised and the label checked.
// Node has no JPEG or WebP decoder, hence Playwright's Chromium; the pixels then
// go through the repo's own PNG encoder so a rerun writes an identical file.
//
//   npm run real:ingest              every fixture missing its photo.png
//   npm run real:ingest -- --force   redo them all
//   npm run real:ingest -- photo-02  just one
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { INGEST_MAX_DIM } from '../src/ocr/ingest/decode';
import { applyOrientation, readExifOrientation } from '../src/ocr/ingest/exif';
import { checkLabel, formatVerdict } from '../src/ocr/labelCheck';
import { normaliseCageNames } from '../src/ocr/normaliseCageNames';
import { decodePng, encodePng } from '../src/ocr/render/png';
import { listFixtureIds, originalPhoto, REAL_SAMPLES_DIR } from '../src/ocr/samples/real/fixtures';
import type { OcrLabel } from '../src/ocr/types';

const args = process.argv.slice(2);
const force = args.includes('--force');
const wanted = args.filter((arg) => !arg.startsWith('--'));
const ids = wanted.length > 0 ? wanted : listFixtureIds();

// Old exports' names are control characters, so show them as code points.
const show = (name: string): string => (/^[ -~]$/.test(name) ? JSON.stringify(name) : `U+${name.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);

const MIME: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

let failed = false;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const id of ids) {
    const dir = `${REAL_SAMPLES_DIR}${id}/`;
    const original = originalPhoto(dir);
    if (original === null) {
      console.error(`${id}: no photo.<webp|jpg|jpeg|png> in ${dir}`);
      failed = true;
      continue;
    }

    // The label: normalised names, written back only if that changed anything.
    const labelPath = `${dir}label.json`;
    const raw: OcrLabel = JSON.parse(readFileSync(labelPath, 'utf8'));
    const { label, renamed } = normaliseCageNames(raw);
    if (Object.keys(renamed).length > 0) {
      writeFileSync(labelPath, `${JSON.stringify(label, null, 2)}\n`);
      console.log(`${id}: renamed cages ${Object.entries(renamed).map(([from, to]) => `${show(from)} -> ${to}`).join(', ')}`);
    }
    const verdict = checkLabel(label);
    console.log(formatVerdict(`${id}: label.json`, verdict));
    if (verdict.status !== 'ok') failed = true;
    if (label.corners === undefined) {
      console.error(`${id}: label.json has no corners; the suite needs the four corners clicked in "Label a photo"`);
      failed = true;
    }

    const decoded = `${dir}photo.png`;
    if (existsSync(decoded) && !force && original !== decoded) {
      console.log(`${id}: photo.png present (use --force to redo)`);
      continue;
    }
    if (original === decoded) {
      console.log(`${id}: photo.png is the original; left as is`);
      continue;
    }

    const bytes = readFileSync(original);
    const extension = original.slice(original.lastIndexOf('.') + 1).toLowerCase();
    // Chromium decodes and scales as decode.ts does, with the stored pixels (no
    // EXIF rotation); the PNG it hands back is decoded here and oriented.
    const dataUrl: string = await page.evaluate(
      async ({ base64, type, maxDim }) => {
        const binary = atob(base64);
        const buffer = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
        const bitmap = await createImageBitmap(new Blob([buffer], { type }), { imageOrientation: 'none' });
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        return canvas.toDataURL('image/png');
      },
      { base64: bytes.toString('base64'), type: MIME[extension], maxDim: INGEST_MAX_DIM },
    );
    const stored = decodePng(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    const orientation = readExifOrientation(new Uint8Array(bytes));
    const image = applyOrientation(stored, orientation);
    writeFileSync(decoded, encodePng(image));
    console.log(`${id}: wrote photo.png (${image.width}x${image.height}, EXIF orientation ${orientation})`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
