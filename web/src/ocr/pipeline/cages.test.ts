// @vitest-environment node
// The ticket-2 fixture PNGs are re-rendered rather than decoded (the repo has
// no PNG decoder): the renderer and distort are deterministic, so the bytes are
// those of the committed files, and the corners are checked against each label.
// Runs under node, not jsdom: jsdom's import.meta.url is not a file URL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import labelsJson from '../__fixtures__/labels.json?raw';
import { generate } from '../../play/generator/generate';
import type { PlayPuzzle } from '../../play/types';
import { labelToBoard } from '../labelToBoard';
import { distort } from '../render/distort';
import { renderPuzzle } from '../render/synth';
import type { OcrImage, OcrLabel, ScannedBoard } from '../types';
import { deriveCages } from './cages';
import type { DerivedCages } from './cages';
import { warpToBoard } from './warp';

const FIXTURES = fileURLToPath(new URL('../../../e2e/__fixtures__/raw-samples/', import.meta.url));

const SAMPLES = [
  { name: 'kenken-4x4-clean', boardSize: 4, distortion: { tag: 'clean' as const } },
  { name: 'kenken-5x5-clean', boardSize: 5, distortion: { tag: 'clean' as const } },
  { name: 'kenken-6x6-clean', boardSize: 6, distortion: { tag: 'clean' as const } },
  { name: 'kenken-4x4-noise', boardSize: 4, distortion: { tag: 'noise' as const, noise: 0.25, blur: 1 } },
  { name: 'kenken-5x5-glare', boardSize: 5, distortion: { tag: 'glare' as const, glare: 0.8 } },
  { name: 'kenken-6x6-perspective', boardSize: 6, distortion: { tag: 'perspective' as const, rotation: 6, perspective: 0.06 } },
];

function loadFixture(sample: (typeof SAMPLES)[number]): { flat: OcrImage; label: OcrLabel } {
  const puzzle = generate(`synth-export-${sample.boardSize}x${sample.boardSize}`, sample.boardSize);
  const rendered = renderPuzzle(puzzle, { tag: sample.distortion.tag });
  const { image, corners } = distort(rendered.image, rendered.label.corners, { ...sample.distortion, seed: sample.name });
  const label: OcrLabel = JSON.parse(readFileSync(`${FIXTURES}${sample.name}.json`, 'utf8'));
  // The reconstruction must be the committed fixture: corners match the label's.
  for (const key of ['tl', 'tr', 'br', 'bl'] as const) {
    expect(Math.hypot(corners[key].x - label.corners[key].x, corners[key].y - label.corners[key].y)).toBeLessThan(1e-6);
  }
  return { flat: warpToBoard(image, corners), label };
}

function cells(board: ScannedBoard): string[][] {
  return board.cageLetters.map((row) => row.split(' '));
}

// Renames cages to integers in order of first appearance, row-major, so two
// partitions compare equal whatever their letters are called.
function canonical(board: ScannedBoard): number[][] {
  const ids = new Map<string, number>();
  return cells(board).map((row) =>
    row.map((letter) => {
      if (!ids.has(letter)) ids.set(letter, ids.size);
      return ids.get(letter)!;
    }),
  );
}

function hasDarkPixel(image: OcrImage): boolean {
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2] < 128) return true;
  }
  return false;
}

function clueOfCell(label: ScannedBoard, row: number, col: number): ScannedBoard['clues'][string] {
  return label.clues[cells(label)[row][col]];
}

describe('deriveCages', () => {
  describe('on the fixture set', () => {
    // Derived once per fixture and shared by the per-image and aggregate tests;
    // loading happens inside a test so loadFixture's corner checks run there.
    const cache = new Map<string, { label: OcrLabel; derived: DerivedCages }>();
    function derive(sample: (typeof SAMPLES)[number]): { label: OcrLabel; derived: DerivedCages } {
      let result = cache.get(sample.name);
      if (result === undefined) {
        const { flat, label } = loadFixture(sample);
        result = { label, derived: deriveCages(flat, label) };
        cache.set(sample.name, result);
      }
      return result;
    }

    for (const sample of SAMPLES) {
      it(`${sample.name}: one non-empty crop per cage, each expecting its cage's clue`, () => {
        const { label, derived } = derive(sample);
        expect(derived.board.boardSize).toBe(label.boardSize);
        expect(Object.keys(derived.board.clues)).toHaveLength(0);
        const cageCount = new Set(cells(derived.board).flat()).size;
        expect(derived.clueCrops).toHaveLength(cageCount);
        for (const { crop, topLeftCell, expected } of derived.clueCrops) {
          const where = `${sample.name} cell ${JSON.stringify(topLeftCell)}`;
          expect(crop.width * crop.height, where).toBeGreaterThan(0);
          expect(hasDarkPixel(crop), where).toBe(true);
          expect(expected, where).toEqual(clueOfCell(label, topLeftCell.row, topLeftCell.col));
        }
      });
    }

    it('recovers the partition on >= 95% of images and classifies >= 95% of edges', () => {
      let partitionsRight = 0;
      let edgesRight = 0;
      let edgeCount = 0;
      const misses: string[] = [];
      for (const sample of SAMPLES) {
        const { label, derived } = derive(sample);
        if (JSON.stringify(canonical(derived.board)) === JSON.stringify(canonical(label))) partitionsRight++;
        else misses.push(`${sample.name}: ${JSON.stringify(derived.board.cageLetters)}`);
        const letters = cells(label);
        for (const edge of derived.edges) {
          const labelExpectedThick =
            edge.dir === 'v'
              ? letters[edge.row][edge.col - 1] !== letters[edge.row][edge.col]
              : letters[edge.row - 1][edge.col] !== letters[edge.row][edge.col];
          edgeCount++;
          if (edge.isThick === labelExpectedThick) edgesRight++;
          else misses.push(`${sample.name}: ${JSON.stringify(edge)}`);
        }
      }
      expect(partitionsRight / SAMPLES.length, misses.join('\n')).toBeGreaterThanOrEqual(0.95);
      expect(edgesRight / edgeCount, misses.join('\n')).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe('single-cell cages', () => {
    const fixtures = JSON.parse(labelsJson) as { valid: { name: string; label: OcrLabel }[] };

    for (const { name, label } of fixtures.valid) {
      it(`${name}: a 1x1 cage yields one non-empty crop with its clue`, () => {
        const conversion = labelToBoard(label);
        // The renderer reads only the board strings, constraints and size.
        const puzzle: PlayPuzzle = {
          ...conversion,
          solution: [],
          difficulty: { cageSizeHistogram: [], singleCellCages: 0, forcedCells: 0 },
          seed: name,
        };
        const rendered = renderPuzzle(puzzle);
        const derived = deriveCages(warpToBoard(rendered.image, rendered.label.corners), label);

        const letters = cells(label);
        const size = (letter: string): number => letters.flat().filter((other) => other === letter).length;
        const singles = derived.clueCrops.filter(({ topLeftCell: { row, col } }) => size(letters[row][col]) === 1);
        expect(singles.length).toBeGreaterThan(0);
        for (const { crop, topLeftCell, expected } of singles) {
          const { row, col } = topLeftCell;
          expect(derived.clueCrops.filter((other) => other.topLeftCell.row === row && other.topLeftCell.col === col)).toHaveLength(1);
          expect(hasDarkPixel(crop)).toBe(true);
          expect(expected).toEqual(clueOfCell(label, row, col));
        }
      });
    }
  });

  it('leaves every expected clue undefined without a label', () => {
    const { flat } = loadFixture(SAMPLES[0]);
    const derived = deriveCages(flat);
    expect(derived.clueCrops.length).toBeGreaterThan(0);
    expect(derived.clueCrops.every((crop) => crop.expected === undefined)).toBe(true);
  });
});
