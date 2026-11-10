// The pipeline is mocked (scan returns a canned ScanResult); the ingest store is
// the real one, primed with setImage. jsdom has no download machinery, so Blob
// and URL.createObjectURL/revokeObjectURL are stubbed with vi.stubGlobal to
// capture exactly what would have been saved, and the link click is a no-op.
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import ScanPanel, { downloadJson } from './ScanPanel';
import type { ScanPanelProps } from './ScanPanel';
import { clearImage, setImage } from './ingest/store';
import { labelToBoard, validateLabel } from './labelToBoard';
import type { ScanResult } from './pipeline/run';
import type { OcrImage, OcrLabel, Quad, ScannedBoard } from './types';

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

// The user's corrected board: the missing clue filled in.
const CORRECTED: ScannedBoard = {
  ...SCANNED,
  clues: { ...SCANNED.clues, d: { target: 3, operator: '/' } },
};

const IMAGE: OcrImage = { width: 2, height: 2, data: new Uint8ClampedArray(16) };

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

function capturedLabel(): OcrLabel {
  expect(CapturingBlob.last).not.toBeNull();
  expect(CapturingBlob.last!.options).toEqual({ type: 'application/json' });
  return JSON.parse(CapturingBlob.last!.parts.join(''));
}

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

  it('downloads the editor board plus the detected corners as a valid label', async () => {
    const { createObjectURL, revokeObjectURL, links } = stubDownload();
    renderPanel({ board: CORRECTED });
    await primeImage();

    const download = byTestId('scan-download') as HTMLButtonElement;
    expect(download.textContent).toBe('Download label JSON');
    expect(download.disabled).toBe(false);
    act(() => download.click());

    const label = capturedLabel();
    expect(validateLabel(label)).toEqual([]);
    expect(label.corners).toEqual(CORNERS);
    // The user's corrections, not the raw scan.
    expect(label.clues).toEqual(CORRECTED.clues);
    expect(label.cageLetters).toEqual(CORRECTED.cageLetters);
    expect(label.source).toEqual({ kind: 'photo' });

    expect(links).toEqual([{ download: 'kenken-label.json', href: 'blob:fake-url', connected: true }]);
    // The temporary link is removed again after the click.
    expect(container.ownerDocument.querySelector('a[download]')).toBeNull();
    expect(createObjectURL).toHaveBeenCalledWith(CapturingBlob.last);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    expect(byTestId('scan-errors')).toBeNull();
  });

  it('shows validator errors instead of downloading an invalid editor board', async () => {
    const { click } = stubDownload();
    // The raw scan, still missing cage d's clue.
    renderPanel({ board: SCANNED });
    await primeImage();

    act(() => (byTestId('scan-download') as HTMLButtonElement).click());

    expect(byTestId('scan-errors')!.textContent).toContain('cage "d" has no clue');
    expect(CapturingBlob.last).toBeNull();
    expect(click).not.toHaveBeenCalled();
    // The actions stay: the user can correct the board and try again.
    expect(byTestId('scan-load')).not.toBeNull();
  });

  it('disables the download while the editor board is empty', async () => {
    renderPanel({ board: null });
    await primeImage();
    expect((byTestId('scan-download') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a failed scan as errors with no actions, and never loads', async () => {
    const failed: ScanResult = { lowConfidenceCages: [], errors: ['corners: no board frame found (confidence 0.00)'] };
    const { onLoadBoard } = renderPanel({ scan: vi.fn(() => failed), board: CORRECTED });
    await primeImage();

    const errors = byTestId('scan-errors')!;
    expect(errors.querySelectorAll('li')).toHaveLength(1);
    expect(errors.textContent).toBe('corners: no board frame found (confidence 0.00)');
    expect(container.textContent).toContain('nothing was loaded into the editor');
    expect(byTestId('scan-load')).toBeNull();
    expect(byTestId('scan-download')).toBeNull();
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

describe('downloadJson', () => {
  it('saves pretty-printed JSON under the given name and revokes the URL', () => {
    const { revokeObjectURL, links } = stubDownload();
    downloadJson({ a: [1] }, 'out.json');
    expect(CapturingBlob.last!.parts.join('')).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(links.map((link) => link.download)).toEqual(['out.json']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
