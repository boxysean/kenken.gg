// The pipeline is mocked (scan returns a canned ScanResult); the ingest store is
// the real one, primed with setImage. The export itself is BoardExport's, tested
// in BoardExport.test.tsx; this panel only reports the corners up.
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import ScanPanel from './ScanPanel';
import type { ScanPanelProps } from './ScanPanel';
import { clearImage, setImage } from './ingest/store';
import { labelToBoard } from './labelToBoard';
import type { ScanResult } from './pipeline/run';
import type { OcrImage, Quad, ScannedBoard } from './types';

const CORNERS: Quad = {
  tl: { x: 12, y: 10 },
  tr: { x: 300, y: 14 },
  br: { x: 296, y: 305 },
  bl: { x: 9, y: 299 },
};

// Four cages, three read; cage "d" needs review.
const SCANNED: ScannedBoard = {
  boardSize: 3,
  cageLetters: ['a a b', 'c a b', 'c d d'],
  clues: {
    a: { target: 6, operator: 'x' },
    b: { target: 1, operator: '-' },
    c: { target: 5, operator: '+' },
  },
};

const OK_RESULT: ScanResult = { board: SCANNED, corners: CORNERS, lowConfidenceCages: ['d'], errors: [] };

const IMAGE: OcrImage = { width: 2, height: 2, data: new Uint8ClampedArray(16) };

let container: HTMLDivElement;

function byTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

// React 16 listens for events on the document, so the container must be attached.
function renderPanel(props: Partial<ScanPanelProps> = {}) {
  const onLoadBoard = vi.fn();
  const scan = vi.fn((): ScanResult => OK_RESULT);
  act(() => {
    ReactDOM.render(<ScanPanel onLoadBoard={onLoadBoard} scan={scan} {...props} />, container);
  });
  return { onLoadBoard, scan };
}

// The panel defers the scan by one tick so its "Scanning…" status can paint.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function primeImage(image: OcrImage = IMAGE) {
  act(() => setImage(image));
  await settle();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => clearImage());
});

describe('ScanPanel', () => {
  it('renders the scan button and nothing else before a photo is picked', () => {
    const { scan } = renderPanel();
    expect(byTestId('scan-button')).not.toBeNull();
    expect(byTestId('scan-summary')).toBeNull();
    expect(byTestId('scan-load')).toBeNull();
    expect(scan).not.toHaveBeenCalled();
  });

  it('scans the stored image and summarises cages, clues and cages needing review', async () => {
    const reader = { read: () => null };
    const { scan } = renderPanel({ reader });
    act(() => setImage(IMAGE));
    expect(byTestId('scan-status')!.textContent).toBe('Scanning…');
    await settle();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(IMAGE, reader);
    expect(byTestId('scan-status')).toBeNull();
    expect(byTestId('scan-summary')!.textContent).toBe('4 cages found · 3 clues read · 1 cages needing review');
    expect(byTestId('scan-errors')).toBeNull();
  });

  it('scans an image already in the store on mount', async () => {
    act(() => setImage(IMAGE));
    const { scan } = renderPanel();
    await settle();
    expect(scan).toHaveBeenCalledWith(IMAGE, expect.anything());
    expect(byTestId('scan-summary')).not.toBeNull();
  });

  it('loads exactly labelToBoard(board) into the editor', async () => {
    const { onLoadBoard } = renderPanel();
    await primeImage();

    const load = byTestId('scan-load') as HTMLButtonElement;
    expect(load.textContent).toBe('Load into editor');
    act(() => load.click());

    expect(onLoadBoard).toHaveBeenCalledTimes(1);
    expect(onLoadBoard.mock.calls[0][0]).toEqual(labelToBoard(SCANNED));
  });

  it('has no export of its own: that is BoardExport\'s', async () => {
    renderPanel();
    await primeImage();
    expect(byTestId('scan-load')).not.toBeNull();
    expect(byTestId('scan-download')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(2); // the picker and "Load into editor"
  });

  it('reports the detected corners up on a successful scan', async () => {
    const onCorners = vi.fn();
    renderPanel({ onCorners });
    await primeImage();
    expect(onCorners).toHaveBeenLastCalledWith(CORNERS);
  });

  it('reports null corners when the scan fails', async () => {
    const onCorners = vi.fn();
    const failed: ScanResult = { lowConfidenceCages: [], errors: ['corners: no board frame found (confidence 0.00)'] };
    // Twice: a success first, so null is a change and not just the initial state.
    const scan = vi.fn().mockReturnValueOnce(OK_RESULT).mockReturnValueOnce(failed);
    renderPanel({ scan, onCorners });
    await primeImage();
    expect(onCorners).toHaveBeenLastCalledWith(CORNERS);

    await primeImage({ ...IMAGE });
    expect(onCorners).toHaveBeenLastCalledWith(null);
    expect(onCorners).not.toHaveBeenCalledWith(undefined);
  });

  it('reports null corners when the image is cleared', async () => {
    const onCorners = vi.fn();
    renderPanel({ onCorners });
    await primeImage();
    expect(onCorners).toHaveBeenLastCalledWith(CORNERS);

    act(() => clearImage());
    expect(onCorners).toHaveBeenLastCalledWith(null);
  });

  it('never reports corners for a stale scan', async () => {
    const onCorners = vi.fn();
    const second: OcrImage = { width: 3, height: 3, data: new Uint8ClampedArray(36) };
    const failed: ScanResult = { lowConfidenceCages: [], errors: ['corners: no board frame found (confidence 0.00)'] };
    const scan = vi.fn((image: OcrImage): ScanResult => (image === second ? failed : OK_RESULT));
    renderPanel({ scan, onCorners });

    act(() => setImage(IMAGE));
    act(() => setImage(second));
    await settle();

    expect(onCorners).not.toHaveBeenCalledWith(CORNERS);
    expect(onCorners).toHaveBeenLastCalledWith(null);
  });

  it('does not rescan when the parent re-renders with a new onCorners callback', async () => {
    const { scan } = renderPanel({ onCorners: vi.fn() });
    await primeImage();
    renderPanel({ scan, onCorners: vi.fn() });
    await settle();
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('renders a failed scan as errors with no actions, and never loads', async () => {
    const failed: ScanResult = { lowConfidenceCages: [], errors: ['corners: no board frame found (confidence 0.00)'] };
    const { onLoadBoard } = renderPanel({ scan: vi.fn(() => failed) });
    await primeImage();

    const errors = byTestId('scan-errors')!;
    expect(errors.querySelectorAll('li')).toHaveLength(1);
    expect(errors.textContent).toBe('corners: no board frame found (confidence 0.00)');
    expect(container.textContent).toContain('nothing was loaded into the editor');
    expect(byTestId('scan-load')).toBeNull();
    expect(byTestId('scan-summary')).toBeNull();
    expect(onLoadBoard).not.toHaveBeenCalled();
  });

  it('keeps only the latest image\'s result when images arrive back to back', async () => {
    const second: OcrImage = { width: 3, height: 3, data: new Uint8ClampedArray(36) };
    const scan = vi.fn((image: OcrImage): ScanResult =>
      image === second ? OK_RESULT : { lowConfidenceCages: [], errors: ['cages: stale'] });
    renderPanel({ scan });

    act(() => setImage(IMAGE));
    act(() => setImage(second));
    await settle();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(second, expect.anything());
    expect(byTestId('scan-errors')).toBeNull();
    expect(byTestId('scan-summary')).not.toBeNull();
  });

  it('clears the result when the store is cleared', async () => {
    renderPanel();
    await primeImage();
    expect(byTestId('scan-summary')).not.toBeNull();

    act(() => clearImage());
    expect(byTestId('scan-summary')).toBeNull();
    expect(byTestId('scan-load')).toBeNull();
  });

  it('collects a throwing scan as an error rather than crashing', async () => {
    renderPanel({ scan: vi.fn(() => { throw new Error('boom'); }) });
    await primeImage();
    expect(byTestId('scan-errors')!.textContent).toBe('scan: boom');
    expect(byTestId('scan-load')).toBeNull();
  });

  it('does not scan or set state after unmount', async () => {
    const { scan } = renderPanel();
    act(() => setImage(IMAGE));
    const consoleError = vi.spyOn(console, 'error');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    await settle();
    expect(scan).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
