// Hand-labelling, through the real UI: pick a committed photo, click its four
// corners, open an empty board, draw the cages with the mouse and export. The
// photo's label is the answer key, so the exported corners must land on its
// corners in the photo's own pixels, whatever size the photo is displayed at.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { labelToBoard, validateLabel } from '../src/ocr/labelToBoard';
import type { OcrLabel } from '../src/ocr/types';

const RAW = fileURLToPath(new URL('./__fixtures__/raw-samples/', import.meta.url));
const PHOTO = `${RAW}kenken-4x4-clean.png`;
const fixture: OcrLabel = JSON.parse(readFileSync(`${RAW}kenken-4x4-clean.json`, 'utf8'));

const CORNERS = ['tl', 'tr', 'br', 'bl'] as const;

const OPERATOR_BUTTON: Record<string, string> = {
  '+': 'Add',
  '-': 'Subtract',
  x: 'Multiply',
  '/': 'Divide',
  '': 'No operator',
};

// The photo is 432 px wide and the desktop layout shows it at that size, which
// would make display and photo pixels the same and the corner check vacuous.
// A phone-width viewport shrinks it under max-width: 100%.
test.use({ viewport: { width: 375, height: 812 } });

async function openPhoto(page: Page) {
  await page.goto('/');
  const solverToggle = page.getByTestId('mode-toggle-solver');
  if ((await solverToggle.getAttribute('aria-pressed')) !== 'true') await solverToggle.click();

  await page.setInputFiles('[data-testid="label-input"]', PHOTO);
  const image = page.getByTestId('label-image');
  await expect(image).toBeVisible();
  // page.mouse works in viewport coordinates, so the image has to be on screen.
  await image.scrollIntoViewIfNeeded();
  // naturalWidth is 0 until the image has decoded.
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  return image;
}

async function clickCorners(page: Page) {
  const image = await openPhoto(page);
  const geometry = await image.evaluate((img: HTMLImageElement) => {
    const { left, top, width, height } = img.getBoundingClientRect();
    return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, rect: { left, top, width, height } };
  });
  const { naturalWidth, naturalHeight, rect } = geometry;
  // Unscaled, a click handler that forgot to convert would still pass; barely
  // scaled, it would be off by less than the rounding allowance below.
  expect(rect.width, 'the photo must be displayed scaled for this test to mean anything').not.toBe(naturalWidth);
  expect(rect.width).toBeLessThan(naturalWidth * 0.9);

  for (const name of CORNERS) {
    const corner = fixture.corners[name];
    await page.mouse.click(
      rect.left + (corner.x / naturalWidth) * rect.width,
      rect.top + (corner.y / naturalHeight) * rect.height,
    );
  }
  return rect;
}

// Row-major indices of each cage's cells, cages in first-occurrence order (the
// order the editor hands out letters in), each cage's cells ordered as a walk
// through neighbouring cells, so a straight mouse move between consecutive
// centres never strays into another cage.
function cagePaths(label: OcrLabel): number[][] {
  const n = label.boardSize;
  const letters = label.cageLetters.flatMap((row) => row.split(' '));
  const order: string[] = [];
  for (const letter of letters) if (!order.includes(letter)) order.push(letter);

  return order.map((letter) => {
    const cells = new Set(letters.flatMap((l, index) => (l === letter ? [index] : [])));
    const path = [Math.min(...cells)];
    cells.delete(path[0]);
    while (cells.size > 0) {
      const last = path[path.length - 1];
      const next = [...cells].find((index) =>
        (Math.abs(index - last) === 1 && Math.floor(index / n) === Math.floor(last / n)) ||
        Math.abs(index - last) === n);
      if (next === undefined) throw new Error(`cage ${letter} has no simple path from its first cell`);
      path.push(next);
      cells.delete(next);
    }
    return path;
  });
}

async function drawCage(page: Page, path: number[], letter: string, label: OcrLabel) {
  const centres = [];
  for (const index of path) {
    const box = await page.locator(`#cell-${index}`).boundingBox();
    if (!box) throw new Error(`#cell-${index} is not laid out`);
    centres.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  await page.mouse.move(centres[0].x, centres[0].y);
  await page.mouse.down();
  for (const { x, y } of centres.slice(1)) await page.mouse.move(x, y);
  await page.mouse.up();

  const clue = label.clues[letter];
  const value = page.locator('input[aria-label="Cage value"]');
  await value.fill(String(clue.target));
  await page.getByRole('button', { name: OPERATOR_BUTTON[clue.operator], exact: true }).click();
  // The next mousedown would land on the backdrop while the modal is still up.
  await expect(value).toHaveCount(0);
}

async function openEditor(page: Page) {
  await page.getByTestId('label-size').selectOption('4');
  await page.getByTestId('label-open').click();
  await expect(page.locator('.Board .Cell')).toHaveCount(16);
  // Opening hides the "Draw your board" tooltip, but it fades out over the
  // board and swallows any mousedown until it has gone.
  await expect(page.locator('.TooltipContainer')).toHaveCount(0);
  await page.locator('.Board').scrollIntoViewIfNeeded();
}

test('a hand-labelled photo exports its corners in photo pixels', async ({ page }) => {
  const rect = await clickCorners(page);

  const markers = page.getByTestId('label-marker');
  await expect(markers).toHaveText(['1', '2', '3', '4']);
  await expect(page.getByTestId('label-next')).toHaveText('All four corners marked');
  // A fifth click is a slip, not a fifth corner.
  await page.mouse.click(rect.left + rect.width / 2, rect.top + rect.height / 2);
  await expect(markers).toHaveCount(4);

  await openEditor(page);
  // Opening the editor must not throw the corners away.
  await expect(markers).toHaveText(['1', '2', '3', '4']);

  const letters = fixture.cageLetters.flatMap((row) => row.split(' '));
  for (const path of cagePaths(fixture)) await drawCage(page, path, letters[path[0]], fixture);

  await page.getByTestId('label-style').fill('newspaper');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('label-export').click(),
  ]);
  await expect(page.getByTestId('label-errors')).toHaveCount(0);
  const label: OcrLabel = JSON.parse(readFileSync(await download.path(), 'utf8'));

  expect(validateLabel(label)).toEqual([]);
  expect(label.source).toEqual({ kind: 'photo', styleTag: 'newspaper' });
  // Integer clicks on a scaled image round by up to a pixel or so either way;
  // corners left in display pixels would be tens of pixels off.
  for (const name of CORNERS) {
    expect(Math.abs(label.corners[name].x - fixture.corners[name].x), `${name}.x`).toBeLessThanOrEqual(2);
    expect(Math.abs(label.corners[name].y - fixture.corners[name].y), `${name}.y`).toBeLessThanOrEqual(2);
  }
  const exported = labelToBoard(label);
  const expected = labelToBoard(fixture);
  expect(exported.boardStrings).toEqual(expected.boardStrings);
  expect(exported.constraintString).toEqual(expected.constraintString);
});

test('a half-drawn board is refused, not downloaded', async ({ page }) => {
  await clickCorners(page);
  await expect(page.getByTestId('label-marker')).toHaveCount(4);
  await openEditor(page);

  const letters = fixture.cageLetters.flatMap((row) => row.split(' '));
  const [first] = cagePaths(fixture);
  await drawCage(page, first, letters[first[0]], fixture);

  await page.getByTestId('label-style').fill('newspaper');
  const download = page.waitForEvent('download', { timeout: 1000 });
  await page.getByTestId('label-export').click();
  await expect(page.getByTestId('label-errors')).toBeVisible();
  expect(await page.getByTestId('label-errors').locator('li').count()).toBeGreaterThanOrEqual(1);
  await expect(download).rejects.toThrow();
});
