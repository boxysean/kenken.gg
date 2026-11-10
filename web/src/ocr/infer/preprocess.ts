// The one normalisation path from a binarised clue crop to the character model's
// input. The training exporter (scripts/export-crops.ts) and the in-browser ONNX
// reader both build their 16x16 canvases with characterCanvas, so the pixels the
// model was trained on and the pixels it sees at inference cannot drift apart.
// Pure arrays only: no DOM, no canvas, no onnxruntime.

export const CANVAS_SIZE = 16;

// Inclusive column range.
export interface Run {
  start: number;
  end: number;
}

// Fits the ink inside one run's columns into a 16x16 canvas, ink 255 on 0,
// nearest-neighbour from the binarised mask. Null when the run holds no ink.
export function characterCanvas(ink: Uint8Array, width: number, height: number, run: Run): Uint8Array | null {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = run.start; x <= run.end; x++) {
      if (ink[y * width + x] === 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const longest = Math.max(boxWidth, boxHeight);
  const scaledWidth = Math.max(1, Math.floor((boxWidth * CANVAS_SIZE) / longest));
  const scaledHeight = Math.max(1, Math.floor((boxHeight * CANVAS_SIZE) / longest));
  const left = Math.floor((CANVAS_SIZE - scaledWidth) / 2);
  const top = Math.floor((CANVAS_SIZE - scaledHeight) / 2);

  const canvas = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
  for (let dy = 0; dy < scaledHeight; dy++) {
    const sy = minY + Math.floor((dy * boxHeight) / scaledHeight);
    for (let dx = 0; dx < scaledWidth; dx++) {
      const sx = minX + Math.floor((dx * boxWidth) / scaledWidth);
      if (ink[sy * width + sx] === 1) canvas[(top + dy) * CANVAS_SIZE + left + dx] = 255;
    }
  }
  return canvas;
}

// The model's input for one canvas: float32 pixel / 255, laid out as the
// row-major [1, 1, 16, 16] NCHW tensor data.
export function canvasToInput(canvas: Uint8Array): Float32Array {
  const input = new Float32Array(CANVAS_SIZE * CANVAS_SIZE);
  for (let i = 0; i < input.length; i++) input[i] = canvas[i] / 255;
  return input;
}
