// Drives the real panel. jsdom neither decodes images nor lays them out, so the
// <img> gets its natural size and bounding rect stubbed before a dispatched
// load event; Blob and URL are stubbed with vi.stubGlobal (as in
// ScanPanel.test.tsx) to capture exactly what would have been saved.
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import LabelPanel from './LabelPanel';
import type { LabelPanelProps } from './LabelPanel';
import { boardToLabel } from './boardToLabel';
import { labelToBoard, validateLabel } from './labelToBoard';
import type { OcrLabel, Point, Quad, ScannedBoard } from './types';

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

// Displayed at 300x200 over a natural 900x600: every click scales by 3.
const DISPLAYED = { width: 300, height: 200 };
const NATURAL = { width: 900, height: 600 };
const CLICKS: Point[] = [{ x: 30, y: 40 }, { x: 270, y: 35 }, { x: 280, y: 190 }, { x: 20, y: 180 }];
const CORNERS: Quad = {
  tl: { x: 90, y: 120 },
  tr: { x: 810, y: 105 },
  br: { x: 840, y: 570 },
  bl: { x: 60, y: 540 },
};

class CapturingBlob {
  static last: CapturingBlob | null = null;
  constructor(public parts: unknown[], public options?: { type?: string }) {
    CapturingBlob.last = this;
  }
}

let container: HTMLDivElement;
let revokeObjectURL: ReturnType<typeof vi.fn<[string], void>>;
let clickedLinks: string[];

function byTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

function markers(): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-testid="label-marker"]'));
}

function render(props: Partial<LabelPanelProps> = {}) {
  const onOpenBoard = vi.fn();
  act(() => {
    ReactDOM.render(<LabelPanel onOpenBoard={onOpenBoard} {...props} />, container);
  });
  return { onOpenBoard };
}

// Picks a file, then plays the browser's part: decode (natural size), lay out
// (bounding rect), fire load.
function pickPhoto(name = 'photo.jpg') {
  const input = byTestId('label-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], name, { type: 'image/jpeg' })] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const image = byTestId('label-image') as HTMLImageElement;
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: NATURAL.width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: NATURAL.height });
  image.getBoundingClientRect = () => ({
    left: 0, top: 0, right: DISPLAYED.width, bottom: DISPLAYED.height,
    x: 0, y: 0, width: DISPLAYED.width, height: DISPLAYED.height, toJSON: () => ({}),
  });
  act(() => {
    image.dispatchEvent(new Event('load'));
  });
  return image;
}

function clickImage({ x, y }: Point) {
  act(() => {
    byTestId('label-image')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  });
}

function clickAll(points: readonly Point[] = CLICKS) {
  points.forEach(clickImage);
}

function exportLabel(styleTag?: string) {
  if (styleTag !== undefined) {
    const input = byTestId('label-style') as HTMLInputElement;
    // React tracks the value itself; set it through the native setter so onChange sees the change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, styleTag);
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  act(() => (byTestId('label-export') as HTMLButtonElement).click());
}

function capturedLabel(): OcrLabel {
  expect(CapturingBlob.last).not.toBeNull();
  return JSON.parse(CapturingBlob.last!.parts.join(''));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  CapturingBlob.last = null;
  vi.stubGlobal('Blob', CapturingBlob);
  let next = 0;
  const createObjectURL = vi.fn(() => `blob:fake-${++next}`);
  revokeObjectURL = vi.fn<[string], void>();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  clickedLinks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickedLinks.push(this.download);
  });
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LabelPanel', () => {
  it('shows only the button until a photo is picked', () => {
    render();
    expect(byTestId('label-button')!.textContent).toBe('Label a photo');
    expect((byTestId('label-input') as HTMLInputElement).accept).toBe('image/jpeg,image/png,image/webp');
    expect(byTestId('label-image')).toBeNull();
    expect(byTestId('label-next')).toBeNull();
  });

  it('shows the photo through an object URL, and revokes it on replace and unmount', () => {
    render();
    const image = pickPhoto();
    expect(image.getAttribute('src')).toBe('blob:fake-1');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    clickImage(CLICKS[0]);
    pickPhoto('second.jpg');
    expect(byTestId('label-image')!.getAttribute('src')).toBe('blob:fake-2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
    // The new photo starts over.
    expect(markers()).toHaveLength(0);

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-2');
  });

  it('prompts for each corner in turn and numbers the markers', () => {
    render();
    pickPhoto();
    const prompts = [byTestId('label-next')!.textContent];
    for (const click of CLICKS) {
      clickImage(click);
      prompts.push(byTestId('label-next')!.textContent);
    }
    expect(prompts).toEqual([
      'Click the top-left corner',
      'Click the top-right corner',
      'Click the bottom-right corner',
      'Click the bottom-left corner',
      'All four corners marked',
    ]);
    expect(markers().map((marker) => marker.textContent)).toEqual(['1', '2', '3', '4']);
    // Percentages of the natural size: (90, 120) of 900x600.
    expect(markers()[0].style.left).toBe('10%');
    expect(markers()[0].style.top).toBe('20%');
  });

  it('ignores clicks before the image has loaded', () => {
    render();
    const input = byTestId('label-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg')] });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickImage(CLICKS[0]);
    expect(markers()).toHaveLength(0);
  });

  it('ignores a fifth click', () => {
    render();
    pickPhoto();
    clickAll();
    clickImage({ x: 150, y: 100 });
    expect(markers()).toHaveLength(4);
  });

  it('undoes the last corner and lets the next click replace it', () => {
    render();
    pickPhoto();
    const undo = () => byTestId('label-undo') as HTMLButtonElement;
    expect(undo().disabled).toBe(true);

    clickAll();
    act(() => undo().click());
    expect(markers()).toHaveLength(3);
    expect(byTestId('label-next')!.textContent).toBe('Click the bottom-left corner');
    expect(byTestId('label-open')).toBeNull();

    clickImage({ x: 150, y: 100 });
    expect(markers()).toHaveLength(4);
    expect(markers()[3].style.left).toBe('50%');

    for (let i = 0; i < 4; i++) act(() => undo().click());
    expect(markers()).toHaveLength(0);
    expect(undo().disabled).toBe(true);
  });

  it('opens an empty board of the chosen size in the editor', () => {
    const { onOpenBoard } = render();
    pickPhoto();
    clickAll(CLICKS.slice(0, 3));
    expect(byTestId('label-open')).toBeNull();
    clickImage(CLICKS[3]);

    const select = byTestId('label-size') as HTMLSelectElement;
    expect(select.value).toBe('5');
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['4', '5', '6', '7', '8', '9']);
    select.value = '7';
    act(() => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => (byTestId('label-open') as HTMLButtonElement).click());
    expect(onOpenBoard).toHaveBeenCalledTimes(1);
    expect(onOpenBoard).toHaveBeenCalledWith(7);
    // The corners stay put for the export.
    expect(markers()).toHaveLength(4);
  });

  it('offers the export only once there are four corners and an editor board', () => {
    render({ board: null });
    pickPhoto();
    clickAll();
    expect(byTestId('label-export')).toBeNull();
    expect(byTestId('label-style')).toBeNull();

    render({ board: BOARD });
    expect(byTestId('label-export')!.textContent).toBe('Export label JSON');
    expect((byTestId('label-style') as HTMLInputElement).placeholder).toBe('newspaper');
  });

  it('exports corners in natural pixels, not the displayed ones', () => {
    render({ board: BOARD });
    pickPhoto();
    clickAll();
    exportLabel();
    const label = capturedLabel();
    expect(label.corners.tl).toEqual({ x: 90, y: 120 });
    expect(label.corners).toEqual(CORNERS);
  });

  it('exports a valid label equal to boardToLabel, which round-trips through labelToBoard', () => {
    render({ board: BOARD });
    pickPhoto();
    clickAll();
    exportLabel();

    const label = capturedLabel();
    expect(clickedLinks).toEqual(['kenken-label.json']);
    expect(validateLabel(label)).toEqual([]);
    expect(label).toEqual(boardToLabel(BOARD, CORNERS, { kind: 'photo' }));
    expect(label.source).toEqual({ kind: 'photo' });
    const roundTrip = labelToBoard(label);
    const original = labelToBoard(BOARD);
    expect(roundTrip.boardStrings).toEqual(original.boardStrings);
    expect(roundTrip.constraintString).toEqual(original.constraintString);
    expect(byTestId('label-errors')).toBeNull();
  });

  it('records a trimmed style tag, and omits it when blank', () => {
    render({ board: BOARD });
    pickPhoto();
    clickAll();

    exportLabel('  newspaper ');
    expect(capturedLabel().source).toEqual({ kind: 'photo', styleTag: 'newspaper' });

    exportLabel('   ');
    const source = capturedLabel().source;
    expect(source).toEqual({ kind: 'photo' });
    expect('styleTag' in source).toBe(false);
  });

  it('shows the problems with an invalid board and downloads nothing', () => {
    // Cage "d" has lost its clue, and the last cell is empty.
    const invalid: ScannedBoard = {
      ...BOARD,
      cageLetters: ['a b b c', 'a d d c', 'e e f c', 'g g f '],
      clues: Object.fromEntries(Object.entries(BOARD.clues).filter(([letter]) => letter !== 'd')),
    };
    render({ board: invalid });
    pickPhoto();
    clickAll();
    exportLabel();

    const errors = byTestId('label-errors')!;
    expect(errors.getAttribute('role')).toBe('alert');
    expect(errors.textContent).toContain('cage "d" has no clue');
    expect(errors.textContent).toContain('row 3, column 3 is empty');
    expect(CapturingBlob.last).toBeNull();
    expect(clickedLinks).toEqual([]);
  });
});
