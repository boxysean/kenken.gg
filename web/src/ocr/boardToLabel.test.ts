import labelsJson from './__fixtures__/labels.json?raw';
import { boardToLabel } from './boardToLabel';
import { labelToBoard, validateLabel } from './labelToBoard';
import type { BoardConversion } from './labelToBoard';
import type { OcrLabel } from './types';

const fixtures = JSON.parse(labelsJson) as { valid: { name: string; label: OcrLabel; expected: BoardConversion }[] };

describe('boardToLabel', () => {
  for (const { name, label, expected } of fixtures.valid) {
    describe(name, () => {
      it('round-trips through labelToBoard', () => {
        expect(labelToBoard(boardToLabel(label, label.corners))).toEqual(expected);
      });

      it('produces a valid label carrying the corners and a photo source', () => {
        const result = boardToLabel(label, label.corners);
        expect(validateLabel(result)).toEqual([]);
        expect(result.corners).toEqual(label.corners);
        expect(result.source).toEqual({ kind: 'photo' });
        expect(result.boardSize).toBe(label.boardSize);
        expect(result.cageLetters).toEqual(label.cageLetters);
        expect(result.clues).toEqual(label.clues);
      });

      it('returns a fresh copy the caller can mutate without touching the input', () => {
        const before = JSON.stringify(label);
        const result = boardToLabel(label, label.corners, label.source);
        expect(result.cageLetters).not.toBe(label.cageLetters);
        expect(result.clues).not.toBe(label.clues);

        result.cageLetters[0] = 'z';
        result.cageLetters.push('extra');
        for (const clue of Object.values(result.clues)) {
          clue.target = 999;
          clue.operator = '+';
        }
        result.clues.zz = { target: 1, operator: '' };
        result.corners.tl.x = -1;
        result.source.kind = 'photo';

        expect(JSON.stringify(label)).toBe(before);
      });
    });
  }
});
