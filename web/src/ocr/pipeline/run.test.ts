// @vitest-environment node
// End to end on the ticket-2 fixtures: photo in, board out, with no label passed
// anywhere. The fixture PNGs are re-rendered rather than decoded, exactly as in
// cages.test.ts (deterministic renderer and distort, corners checked against
// each committed label). Runs under node: jsdom's import.meta.url is not a file URL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../../play/generator/generate';
import { distort } from '../render/distort';
import { renderPuzzle } from '../render/synth';
import type { OcrImage, OcrLabel, ScannedBoard } from '../types';
import { templateClueReader } from './clueTemplate';
import type { ClueReader } from './clueReader';
import { MIN_CORNER_CONFIDENCE, scanPhoto } from './run';
import type { ScanResult } from './run';

const FIXTURES = fileURLToPath(new URL('../../../e2e/__fixtures__/raw-samples/', import.meta.url));

const SAMPLES = [
  { name: 'kenken-4x4-clean', boardSize: 4, distortion: { tag: 'clean' as const } },
  { name: 'kenken-5x5-clean', boardSize: 5, distortion: { tag: 'clean' as const } },
  { name: 'kenken-6x6-clean', boardSize: 6, distortion: { tag: 'clean' as const } },
  { name: 'kenken-4x4-noise', boardSize: 4, distortion: { tag: 'noise' as const, noise: 0.25, blur: 1 } },
  { name: 'kenken-5x5-glare', boardSize: 5, distortion: { tag: 'glare' as const, glare: 0.8 } },
  { name: 'kenken-6x6-perspective', boardSize: 6, distortion: { tag: 'perspective' as const, rotation: 6, perspective: 0.06 } },
];

function loadFixture(sample: (typeof SAMPLES)[number]): { image: OcrImage; label: OcrLabel } {
  const puzzle = generate(`synth-export-${sample.boardSize}x${sample.boardSize}`, sample.boardSize);
  const rendered = renderPuzzle(puzzle, { tag: sample.distortion.tag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...sample.distortion, seed: sample.name });
  const label: OcrLabel = JSON.parse(readFileSync(`${FIXTURES}${sample.name}.json`, 'utf8'));
  // The reconstruction must be the committed fixture: corners match the label's.
  for (const key of ['tl', 'tr', 'br', 'bl'] as const) {
    expect(Math.hypot(corners[key].x - label.corners[key].x, corners[key].y - label.corners[key].y)).toBeLessThan(1e-6);
  }
  return { image, label };
}

// Renames cages to integers in order of first appearance, row-major, so two
// partitions compare equal whatever their letters are called.
function canonical(board: ScannedBoard): number[][] {
  const ids = new Map<string, number>();
  return board.cageLetters.map((row) =>
    row.split(' ').map((letter) => {
      if (!ids.has(letter)) ids.set(letter, ids.size);
      return ids.get(letter)!;
    }),
  );
}

// Maps each scanned letter to the label's letter for the same cells. Only
// meaningful once the partitions are known to match.
function letterMap(board: ScannedBoard, label: ScannedBoard): Map<string, string> {
  const map = new Map<string, string>();
  board.cageLetters.forEach((row, rowIndex) => {
    const labelRow = label.cageLetters[rowIndex].split(' ');
    row.split(' ').forEach((letter, column) => map.set(letter, labelRow[column]));
  });
  return map;
}

describe('scanPhoto', () => {
  describe('on the fixture set', () => {
    // Scanned once per fixture and shared by the per-image and aggregate tests;
    // loading happens inside a test so loadFixture's corner checks run there.
    const cache = new Map<string, { label: OcrLabel; result: ScanResult }>();
    function scanned(sample: (typeof SAMPLES)[number]): { label: OcrLabel; result: ScanResult } {
      let entry = cache.get(sample.name);
      if (entry === undefined) {
        const { image, label } = loadFixture(sample);
        entry = { label, result: scanPhoto(image, templateClueReader) };
        cache.set(sample.name, entry);
      }
      return entry;
    }

    for (const sample of SAMPLES) {
      it(`${sample.name}: the right cages, and never a wrong clue`, () => {
        const { label, result } = scanned(sample);
        expect(result.errors).toEqual([]);
        expect(result.board).toBeDefined();
        expect(result.corners).toBeDefined();
        const board = result.board!;
        expect(board.boardSize).toBe(label.boardSize);
        expect(canonical(board)).toEqual(canonical(label));

        const toLabel = letterMap(board, label);
        for (const [letter, clue] of Object.entries(board.clues)) {
          expect(clue, `${sample.name} cage ${letter}`).toEqual(label.clues[toLabel.get(letter)!]);
        }
        // Every cage is either read or flagged for review, never silently dropped.
        const letters = new Set(board.cageLetters.join(' ').split(' '));
        expect(Object.keys(board.clues).length + result.lowConfidenceCages.length).toBe(letters.size);
        for (const letter of result.lowConfidenceCages) {
          expect(board.clues).not.toHaveProperty(letter);
        }
      });
    }

    it('fully reads at least 80% of the images', () => {
      const partial: string[] = [];
      for (const sample of SAMPLES) {
        const { result } = scanned(sample);
        if (result.lowConfidenceCages.length > 0) partial.push(`${sample.name}: ${result.lowConfidenceCages.join(', ')}`);
      }
      const fullPasses = SAMPLES.length - partial.length;
      expect(fullPasses / SAMPLES.length, partial.join('\n')).toBeGreaterThanOrEqual(0.8);
    });
  });

  it('reports a blank image as a corners failure without throwing', () => {
    const white: OcrImage = { width: 200, height: 150, data: new Uint8ClampedArray(200 * 150 * 4).fill(255) };
    let result: ScanResult | undefined;
    expect(() => {
      result = scanPhoto(white, templateClueReader);
    }).not.toThrow();
    expect(result!.errors).toEqual(['corners: no board frame found (confidence 0.00)']);
    expect(result!.board).toBeUndefined();
    expect(result!.corners).toBeUndefined();
    expect(result!.lowConfidenceCages).toEqual([]);
    expect(MIN_CORNER_CONFIDENCE).toBeGreaterThan(0);
  });

  it('collects a throwing reader as a clues error, keeping the corners', () => {
    const { image } = loadFixture(SAMPLES[0]);
    const broken: ClueReader = {
      read() {
        throw new Error('reader exploded');
      },
    };
    const result = scanPhoto(image, broken);
    expect(result.errors).toEqual(['clues: reader exploded']);
    expect(result.board).toBeUndefined();
    expect(result.corners).toBeDefined();
  });

  it('maps a constant reading (operator null) to the "" operator', () => {
    const { image } = loadFixture(SAMPLES[0]);
    const constant: ClueReader = { read: () => ({ target: 3, operator: null, confidence: 1 }) };
    const result = scanPhoto(image, constant);
    expect(result.errors).toEqual([]);
    expect(Object.values(result.board!.clues).every((clue) => clue.target === 3 && clue.operator === '')).toBe(true);
  });
});
