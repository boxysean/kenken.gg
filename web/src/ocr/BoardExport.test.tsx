// jsdom has no download machinery, so Blob and URL.createObjectURL/revokeObjectURL
// are stubbed with vi.stubGlobal to capture exactly what would have been saved,
// and the link click is a no-op that records the link.
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import BoardExport, { DISABLED_REASON } from './BoardExport';
import type { BoardExportProps } from './BoardExport';
import { boardToLabel } from './boardToLabel';
import { boardExport, downloadJson } from './export';
import { labelToBoard, validateLabel } from './labelToBoard';
import type { OcrLabel, Quad, ScannedBoard } from './types';

// A real, uniquely solvable 4x4 (the kenken-4x4-clean fixture's cages).
const BOARD: ScannedBoard = {
  boardSize: 4,
  cageLetters: ['a b b c', 'a d d c', 'e e f c', 'g g f f'],
  clues: {
    a: { target: 2, operator: '-' },
    b: { target: 2, operator: '/' },
    c: { target: 6, operator: 'x' },
    d: { target: 3, operator: '-' },
    e: { target: 2, operator: '-' },
    f: { target: 12, operator: 'x' },
    g: { target: 1, operator: '-' },
  },
};

const CORNERS: Quad = {
  tl: { x: 90, y: 120 },
  tr: { x: 810, y: 105 },
  br: { x: 840, y: 570 },
  bl: { x: 60, y: 540 },
};

// Cage "d" has lost its clue, and the last cell is empty.
const INVALID: ScannedBoard = {
  ...BOARD,
  cageLetters: ['a b b c', 'a d d c', 'e e f c', 'g g f '],
  clues: Object.fromEntries(Object.entries(BOARD.clues).filter(([letter]) => letter !== 'd')),
};

class CapturingBlob {
  static last: CapturingBlob | null = null;
  constructor(public parts: unknown[], public options?: { type?: string }) {
    CapturingBlob.last = this;
  }
}

function stubDownload() {
  CapturingBlob.last = null;
  vi.stubGlobal('Blob', CapturingBlob);
  const createObjectURL = vi.fn(() => 'blob:fake-url');
  const revokeObjectURL = vi.fn();
  // A subclass, not a plain object, so `new URL(...)` keeps working elsewhere.
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  // jsdom would try (and fail, noisily) to navigate to the blob URL. Records
  // each clicked link, with what it looked like at click time.
  const links: { download: string; href: string | null; connected: boolean }[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    links.push({ download: this.download, href: this.getAttribute('href'), connected: this.isConnected });
  });
  return { createObjectURL, revokeObjectURL, click, links };
}

let container: HTMLDivElement;
let stubs: ReturnType<typeof stubDownload>;

function byTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

function button(): HTMLButtonElement {
  return byTestId('export-button') as HTMLButtonElement;
}

// React 16 listens for events on the document, so the container must be attached.
function render(props: BoardExportProps = {}) {
  act(() => {
    ReactDOM.render(<BoardExport {...props} />, container);
  });
}

function typeStyleTag(value: string) {
  const input = byTestId('export-style') as HTMLInputElement;
  // React tracks the value itself; set it through the native setter so onChange sees the change.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function exportNow() {
  act(() => button().click());
}

function captured(): OcrLabel {
  expect(CapturingBlob.last).not.toBeNull();
  expect(CapturingBlob.last!.options).toEqual({ type: 'application/json' });
  return JSON.parse(CapturingBlob.last!.parts.join(''));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  stubs = stubDownload();
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BoardExport', () => {
  it('is always rendered, disabled with a reason while the board is empty', () => {
    render({ board: null });
    expect(button().textContent).toBe('Export JSON');
    expect(button().disabled).toBe(true);
    expect(byTestId('export-disabled-reason')!.textContent).toBe('Draw at least one cage on the board to export it.');
    expect(DISABLED_REASON).toBe('Draw at least one cage on the board to export it.');
    expect(byTestId('export-style')).toBeNull();

    render({});
    expect(button().disabled).toBe(true);
    expect(byTestId('export-disabled-reason')).not.toBeNull();
  });

  it('with a board and no corners, downloads a board-only kenken-board.json', () => {
    render({ board: BOARD });
    expect(button().disabled).toBe(false);
    expect(byTestId('export-disabled-reason')).toBeNull();
    // A style tag describes a photo, so there is none to type without one.
    expect(byTestId('export-style')).toBeNull();
    exportNow();

    const label = captured();
    expect(stubs.links).toEqual([{ download: 'kenken-board.json', href: 'blob:fake-url', connected: true }]);
    expect(label.boardSize).toBe(4);
    expect(label.cageLetters).toEqual(BOARD.cageLetters);
    expect(label.clues).toEqual(BOARD.clues);
    expect(label.source).toEqual({ kind: 'manual' });
    expect('corners' in label).toBe(false);
    expect(validateLabel(label)).toEqual([]);
    expect(labelToBoard(label)).toEqual(labelToBoard(BOARD));
    expect(byTestId('export-errors')).toBeNull();
  });

  it('with corners, downloads kenken-label.json equal to boardToLabel', () => {
    render({ board: BOARD, corners: CORNERS });
    exportNow();

    const label = captured();
    expect(stubs.links.map((link) => link.download)).toEqual(['kenken-label.json']);
    expect(label).toEqual(boardToLabel(BOARD, CORNERS, { kind: 'photo' }));
    expect(validateLabel(label)).toEqual([]);
    // The temporary link is removed again after the click.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(stubs.createObjectURL).toHaveBeenCalledWith(CapturingBlob.last);
    expect(stubs.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('records a trimmed style tag when there are corners, and omits it when blank', () => {
    render({ board: BOARD, corners: CORNERS });
    const input = byTestId('export-style') as HTMLInputElement;
    expect(input.placeholder).toBe('newspaper');
    expect(input.value).toBe('');

    typeStyleTag('  newspaper ');
    exportNow();
    expect(captured().source).toEqual({ kind: 'photo', styleTag: 'newspaper' });

    typeStyleTag('   ');
    exportNow();
    const source = captured().source;
    expect(source).toEqual({ kind: 'photo' });
    expect('styleTag' in source).toBe(false);
  });

  it('lists the problems with an invalid board and downloads nothing', () => {
    render({ board: INVALID, corners: CORNERS });
    exportNow();

    const errors = byTestId('export-errors')!;
    expect(errors.tagName).toBe('UL');
    expect(errors.getAttribute('role')).toBe('alert');
    expect(Array.from(errors.querySelectorAll('li')).map((li) => li.textContent)).toEqual(validateLabel(INVALID));
    expect(errors.textContent).toContain('cage "d" has no clue');
    expect(errors.textContent).toContain('row 3, column 3 is empty');
    expect(CapturingBlob.last).toBeNull();
    expect(stubs.click).not.toHaveBeenCalled();
  });

  it('refuses a board-only label with a cell missing its cage letter', () => {
    render({ board: { ...BOARD, cageLetters: ['a b b c', 'a d d c', 'e e f c', 'g g f '] } });
    exportNow();
    expect(byTestId('export-errors')!.textContent).toContain('row 3, column 3 is empty');
    expect(CapturingBlob.last).toBeNull();
    expect(stubs.click).not.toHaveBeenCalled();
  });

  it('refuses a cage named by an unprintable character', () => {
    const { b, ...rest } = BOARD.clues;
    const board: ScannedBoard = {
      ...BOARD,
      cageLetters: BOARD.cageLetters.map((row) => row.replace(/b/g, '\u007f')),
      clues: { ...rest, '\u007f': b },
    };
    render({ board });
    exportNow();
    expect(byTestId('export-errors')!.textContent).toContain('which is not a printable cage letter');
    expect(stubs.click).not.toHaveBeenCalled();
  });

  it('clears the problems when the board, corners or style tag change', () => {
    render({ board: INVALID, corners: CORNERS });
    exportNow();
    expect(byTestId('export-errors')).not.toBeNull();
    typeStyleTag('newspaper');
    expect(byTestId('export-errors')).toBeNull();

    exportNow();
    expect(byTestId('export-errors')).not.toBeNull();
    render({ board: INVALID, corners: { ...CORNERS, tl: { x: 1, y: 1 } } });
    expect(byTestId('export-errors')).toBeNull();

    exportNow();
    expect(byTestId('export-errors')).not.toBeNull();
    render({ board: { ...INVALID, boardSize: 5 }, corners: { ...CORNERS, tl: { x: 1, y: 1 } } });
    expect(byTestId('export-errors')).toBeNull();
  });

  it('keeps the problems across a re-render with an equal (but new) board object', () => {
    render({ board: INVALID });
    exportNow();
    render({ board: JSON.parse(JSON.stringify(INVALID)) });
    expect(byTestId('export-errors')).not.toBeNull();
  });

  it('clears the problems after a successful export', () => {
    render({ board: INVALID });
    exportNow();
    expect(byTestId('export-errors')).not.toBeNull();
    render({ board: BOARD });
    exportNow();
    expect(byTestId('export-errors')).toBeNull();
    expect(stubs.links.map((link) => link.download)).toEqual(['kenken-board.json']);
  });
});

describe('boardExport', () => {
  it('never invents corners, and copies the board', () => {
    const { value, filename } = boardExport(BOARD, null);
    expect(filename).toBe('kenken-board.json');
    expect('corners' in value).toBe(false);
    expect(value.cageLetters).not.toBe(BOARD.cageLetters);
    expect(value.clues).not.toBe(BOARD.clues);
    expect(value.clues.a).not.toBe(BOARD.clues.a);
    expect(boardExport(BOARD).filename).toBe('kenken-board.json');
  });

  it('passes the source through with corners, and ignores it without', () => {
    expect(boardExport(BOARD, CORNERS, { kind: 'photo', styleTag: 'x' }).value.source).toEqual({ kind: 'photo', styleTag: 'x' });
    expect(boardExport(BOARD, null, { kind: 'photo', styleTag: 'x' }).value.source).toEqual({ kind: 'manual' });
  });
});

describe('downloadJson', () => {
  it('saves pretty-printed JSON under the given name and revokes the URL', () => {
    downloadJson({ a: [1] }, 'out.json');
    expect(CapturingBlob.last!.parts.join('')).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(stubs.links.map((link) => link.download)).toEqual(['out.json']);
    expect(stubs.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('defaults to kenken-label.json', () => {
    downloadJson({});
    expect(stubs.links.map((link) => link.download)).toEqual(['kenken-label.json']);
  });
});
