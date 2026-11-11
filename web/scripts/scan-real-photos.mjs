// Drives the REAL app flow (Scan a photo -> grid detect -> clue read -> editor -> Solve!)
// over a list of photographs, in Chromium against the built app, and dumps one JSON
// record per image. Not part of the test suite: a reporting harness for the OCR photos run.
//   node scripts/scan-real-photos.mjs out.json img1.jpg img2.jpg ...
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const out = process.argv[2];
const images = process.argv.slice(3).map((p) => resolve(p));
const PORT = Number(process.env.PORT || 4399);
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;

// Serve the built app for the run's duration when SERVE=1, so the server cannot die
// between tool calls (vite preview lives inside this process tree here).
let server = null;
if (process.env.SERVE === '1') {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'inherit',
    detached: false,
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
const records = [];

for (const image of images) {
  const rec = { image: basename(image), file: image };
  try {
    await page.goto(BASE, { waitUntil: 'load' });
    const solverToggle = page.getByTestId('mode-toggle-solver');
    if ((await solverToggle.getAttribute('aria-pressed')) !== 'true') await solverToggle.click();
    // The model must really be loaded: a silent fallback to the template reader fails here.
    await page.locator('.ScanPanel').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector('.ScanPanel')?.getAttribute('data-reader') === 'onnx',
      null,
      { timeout: 30_000 },
    );
    rec.reader = await page.locator('.ScanPanel').getAttribute('data-reader');

    const t0 = Date.now();
    await page.setInputFiles('[data-testid="scan-input"]', image);
    // Either the summary (scan produced a board) or the errors list (scan failed) lands.
    await Promise.race([
      page.getByTestId('scan-summary').waitFor({ state: 'visible', timeout: 120_000 }),
      page.getByTestId('scan-errors').waitFor({ state: 'visible', timeout: 120_000 }),
    ]);
    rec.summary = (await page.getByTestId('scan-summary').count())
      ? (await page.getByTestId('scan-summary').innerText()).replace(/\s+/g, ' ').trim()
      : null;
    rec.errors = (await page.getByTestId('scan-errors').count())
      ? (await page.getByTestId('scan-errors').innerText()).split('\n').map((s) => s.trim()).filter(Boolean)
      : [];

    if (rec.summary) {
      await page.getByTestId('scan-load').click();
      const loaded = await page.locator('.Board .Cell').first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
      if (loaded) {
        const count = await page.locator('.Board .Cell').count();
        rec.boardSize = Math.round(Math.sqrt(count));
        rec.cells = [];
        for (let i = 0; i < count; i++) {
          const cell = page.locator(`#cell-${i}`);
          const cls = ((await cell.getAttribute('class')) ?? '').split(/\s+/);
          rec.cells.push({
            i,
            label: (await cell.locator('.CellLabel').innerText()).trim(),
            l: cls.includes('borderLeft'),
            r: cls.includes('borderRight'),
            t: cls.includes('borderTop'),
            b: cls.includes('borderBottom'),
          });
        }
        // Solve! in the editor's own solver (a Web Worker in the page).
        const solve = page.getByRole('button', { name: 'Solve!' });
        if (await solve.count()) {
          await solve.first().click();
          await page.waitForFunction(
            () => {
              const s = document.querySelector('.App')?.getAttribute('data-solve-state');
              return s === '3' || s === '4';
            },
            null,
            { timeout: 60_000 },
          ).catch(() => {});
          rec.solveState = await page.locator('.App').getAttribute('data-solve-state');
          rec.solved = rec.solveState === '3';
        }
      } else {
        rec.loadedNoCells = true;
      }
    }
    rec.ms = Date.now() - t0;
  } catch (error) {
    rec.fatal = error instanceof Error ? error.message : String(error);
  }
  records.push(rec);
  console.error(`done ${rec.image}: ${rec.fatal ? 'FATAL ' + rec.fatal : rec.summary ?? rec.errors.join('; ')}`);
}

await browser.close();
if (server) server.kill('SIGTERM');
writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`);
console.log(`wrote ${out} (${records.length} records)`);
