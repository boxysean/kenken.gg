// jsdom has neither createImageBitmap nor a working canvas, so both are stubbed with
// vi.stubGlobal: createImageBitmap reports the photo's natural size and a fake
// OffscreenCanvas hands back a blank RGBA buffer of whatever size was asked for.
// That lets the real decodeFile run end to end (EXIF read, downscale, orientation)
// and the test asserts on what lands in the real ingest store.
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import ScanButton from './ScanButton';
import { clearImage, getImage, setImage } from './ingest/store';
import { INGEST_MAX_DIM } from './ingest/decode';

// A JPEG that is only SOI + an EXIF APP1 (big-endian, one Orientation entry) + EOI.
function jpegBytes(orientation: number): Uint8Array<ArrayBuffer> {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...exif, 0xff, 0xd9]);
}

class FakeOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return {
      drawImage: vi.fn(),
      getImageData: (x: number, y: number, w: number, h: number) =>
        ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    };
  }
}

function stubPhoto(width: number, height: number) {
  const createImageBitmap = vi.fn(async () => ({ width, height, close: vi.fn() }));
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return createImageBitmap;
}

let container: HTMLDivElement;

// React 16 listens for events on the document, so the container must be attached.
function renderScanButton(element: React.ReactElement = <ScanButton />) {
  act(() => {
    ReactDOM.render(element, container);
  });
}

async function chooseFile(file: File) {
  const input = container.querySelector('[data-testid="scan-input"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  const button = container.querySelector('[data-testid="scan-button"]') as HTMLButtonElement;
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The button is disabled while decoding (jsdom reads the File via FileReader,
  // which takes real time); wait for the decode to settle.
  for (let tick = 0; tick < 200 && button.disabled; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(button.disabled).toBe(false);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  vi.unstubAllGlobals();
  act(() => clearImage());
});

describe('ScanButton', () => {
  it('renders the button and a hidden image-only file input', () => {
    renderScanButton();
    const button = container.querySelector('[data-testid="scan-button"]') as HTMLButtonElement;
    const input = container.querySelector('[data-testid="scan-input"]') as HTMLInputElement;
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('Scan a photo');
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    expect(container.querySelector('[data-testid="scan-preview"]')).toBeNull();
  });

  it('opens the file picker when the button is clicked', () => {
    renderScanButton();
    const input = container.querySelector('[data-testid="scan-input"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    act(() => {
      (container.querySelector('[data-testid="scan-button"]') as HTMLButtonElement).click();
    });
    expect(click).toHaveBeenCalled();
  });

  it('decodes an orientation-6 JPEG upright and downscaled into the store', async () => {
    const createImageBitmap = stubPhoto(4000, 3000);
    renderScanButton();

    await chooseFile(new File([jpegBytes(6)], 'board.jpg', { type: 'image/jpeg' }));

    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    const image = getImage();
    expect(image).not.toBeNull();
    // 4000x3000 stored sideways: scaled to 1280x960, then rotated to portrait.
    expect(image!.width).toBe(960);
    expect(image!.height).toBe(INGEST_MAX_DIM);
    expect(image!.data.length).toBe(960 * 1280 * 4);
    expect(container.querySelector('[data-testid="scan-error"]')).toBeNull();
    const preview = container.querySelector('[data-testid="scan-preview"]');
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain('960 × 1280');
  });

  it('keeps small photos at their natural size', async () => {
    stubPhoto(300, 200);
    renderScanButton();

    await chooseFile(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'board.png', { type: 'image/png' }));

    expect(getImage()).toMatchObject({ width: 300, height: 200 });
  });

  it('shows a user-facing error for a .txt file without touching the store', async () => {
    const createImageBitmap = stubPhoto(100, 100);
    renderScanButton();

    await chooseFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }));

    const error = container.querySelector('[data-testid="scan-error"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toBe("That file type isn't supported. Use a JPEG, PNG, or WebP photo.");
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(getImage()).toBeNull();
    expect(container.querySelector('[data-testid="scan-preview"]')).toBeNull();
  });

  it('shows an error when the browser has no createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    renderScanButton();

    await chooseFile(new File([jpegBytes(1)], 'board.jpg', { type: 'image/jpeg' }));

    expect(container.querySelector('[data-testid="scan-error"]')).not.toBeNull();
    expect(getImage()).toBeNull();
  });

  it('uses an injected decode function', async () => {
    const decoded = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
    const decode = vi.fn(async () => decoded);
    renderScanButton(<ScanButton decode={decode} />);

    await chooseFile(new File([jpegBytes(1)], 'board.jpg', { type: 'image/jpeg' }));

    expect(decode).toHaveBeenCalledTimes(1);
    expect(getImage()).toBe(decoded);
  });

  it('previews an image set on the store from elsewhere, and unsubscribes on unmount', () => {
    renderScanButton();
    act(() => setImage({ width: 4, height: 3, data: new Uint8ClampedArray(48) }));
    expect(container.querySelector('[data-testid="scan-preview"]')!.textContent).toContain('4 × 3');

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    // A store update after unmount must not reach (and warn about) the dead component.
    const consoleError = vi.spyOn(console, 'error');
    act(() => setImage({ width: 1, height: 1, data: new Uint8ClampedArray(4) }));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
