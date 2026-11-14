// Every committed sample, through the real UI: pick the PNG, let the in-page
// pipeline scan it, load it into the solver editor and check the editor board
// cell by cell against the sample's expected board. A sample is an image that
// once failed (or must never fail); see docs/ocr.md for how to add one.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { labelToBoard } from '../src/ocr/labelToBoard';
import type { ScannedBoard } from '../src/ocr/types';

const SAMPLES = fileURLToPath(new URL('./__fixtures__/samples/', import.meta.url));

interface CellState {
  label: string;
  borderLeft: boolean;
  borderRight: boolean;
  borderTop: boolean;
  borderBottom: boolean;
}

// What the solver editor (components/Board.jsx + Cell.jsx) draws for a board once
// App.loadBoard has taken it: the outer frame is always bordered, an inner edge
// is bordered iff the neighbour is in another cage, and each cage's raw formula
// ("12x", "2-", "3" for a constant) sits on its first cell in row-major order.
function expectedCells(board: ScannedBoard): CellState[] {
  const { boardStrings, constraintString, boardSize: n } = labelToBoard(board);
  const formulas = new Map<string, string>();
  for (const token of constraintString.split(' ').filter((t) => t !== '')) {
    const match = /^([^=]*)=([0-9]+)([+\-x/]?)$/.exec(token);
    if (match) formulas.set(match[1], match[2] + match[3]);
  }
  const letters = boardStrings.flatMap((row) => row.split(' '));
  const labelled = new Set<string>();
  return letters.map((letter, index) => {
    const row = Math.floor(index / n);
    const column = index % n;
    const first = !labelled.has(letter);
    labelled.add(letter);
    return {
      label: first ? formulas.get(letter) ?? '' : '',
      borderLeft: column === 0 || letters[index - 1] !== letter,
      borderRight: column === n - 1 || letters[index + 1] !== letter,
      borderTop: row === 0 || letters[index - n] !== letter,
      borderBottom: row === n - 1 || letters[index + n] !== letter,
    };
  });
}

const names = readdirSync(SAMPLES)
  .filter((file) => file.endsWith('.png'))
  .map((file) => file.replace(/\.png$/, ''))
  .sort();

test('there are committed samples', () => {
  expect(names.length).toBeGreaterThanOrEqual(5);
});

for (const name of names) {
  test(`${name} scans into the editor exactly`, async ({ page }) => {
    const expected: ScannedBoard = JSON.parse(readFileSync(`${SAMPLES}${name}.expected.json`, 'utf8'));

    await page.goto('/');
    const solverToggle = page.getByTestId('mode-toggle-solver');
    if ((await solverToggle.getAttribute('aria-pressed')) !== 'true') await solverToggle.click();

    // The model really loaded: a silent fallback to the template reader fails here.
    await expect(page.locator('.ScanPanel')).toHaveAttribute('data-reader', 'onnx', { timeout: 30_000 });

    await page.setInputFiles('[data-testid="scan-input"]', `${SAMPLES}${name}.png`);
    await expect(page.getByTestId('scan-summary')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('scan-errors')).toHaveCount(0);

    await page.getByTestId('scan-load').click();

    const n = expected.boardSize;
    await expect(page.locator('.Board .Cell')).toHaveCount(n * n);
    const actual: CellState[] = [];
    for (let index = 0; index < n * n; index++) {
      const cell = page.locator(`#cell-${index}`);
      const classes = ((await cell.getAttribute('class')) ?? '').split(/\s+/);
      actual.push({
        label: await cell.locator('.CellLabel').innerText(),
        borderLeft: classes.includes('borderLeft'),
        borderRight: classes.includes('borderRight'),
        borderTop: classes.includes('borderTop'),
        borderBottom: classes.includes('borderBottom'),
      });
    }
    expect(actual).toEqual(expectedCells(expected));
  });
}
