// The learned clue reader: each character of a clue crop is classified by the
// ticket-9 CNN (models/char.onnx) under onnxruntime-web's wasm backend.
//
// ClueReader.read is synchronous (the pipeline in pipeline/run.ts calls it inline)
// but onnxruntime only runs asynchronously. So the reader works in two steps:
//   prepare(image) runs the unchanged pipeline once with a recording reader to
//     collect the clue crops it will ask about, then classifies every character
//     canvas in them through the model, memoised by canvas content;
//   read(crop) segments the crop the same way and looks each canvas up.
// A canvas that was never classified makes read() return null ("needs review"),
// never a guess. ScanPanel awaits prepare() before it scans.
import * as ort from 'onnxruntime-web';
import modelAssetUrl from '../models/char.onnx?url';
// The package's exports map does not expose dist/, so the wasm is addressed by path.
import wasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import { ALL_GLYPH_CHARS } from '../render/glyphs';
import type { GlyphChar } from '../render/glyphs';
import type { Operator } from '../../solver/Operator';
import type { OcrImage } from '../types';
import { binarize } from '../pipeline/binarize';
import type { ClueReader, ClueReading } from '../pipeline/clueReader';
import { CLUE_CONFIDENCE_THRESHOLD, templateClueReader } from '../pipeline/clueTemplate';
import { scanPhoto } from '../pipeline/run';
import { CANVAS_SIZE, canvasToInput, characterCanvas } from './preprocess';

// The model's output order, which is also the renderer's glyph order.
export const MODEL_CLASSES: readonly GlyphChar[] = ALL_GLYPH_CHARS;

// Same segmentation rules as clueTemplate.ts: specks are components whose longer
// side is under this fraction of the tallest component's height.
const SPECK_FRACTION = 0.4;

const OPERATOR_CHARS: ReadonlySet<GlyphChar> = new Set<GlyphChar>(['+', '-', 'x', '/']);

// Predictions are memoised by canvas; past this many entries the memo starts over.
const MAX_MEMO_ENTRIES = 4096;

const isNode = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node !== undefined;

// The browser bundle (ort.bundle.min.mjs) inlines its JS glue, so only the .wasm
// has to be found; pointing at Vite's asset URL works under the dev server (where
// the prebundled module's own import.meta.url would be wrong) and in the build.
// Node (vitest) resolves to the node build, which finds its wasm itself.
if (!isNode) ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// No SharedArrayBuffer without cross-origin isolation, which a plain page lacks.
ort.env.wasm.numThreads = 1;

export interface CharacterPrediction {
  char: GlyphChar;
  probabilities: Float32Array;
  confidence: number;
}

export type Classify = (input: Float32Array) => Promise<CharacterPrediction>;

async function modelSource(modelUrl: string | URL): Promise<string | Uint8Array> {
  const url = String(modelUrl);
  // Node only (the parity test): onnxruntime reads a file path from disk itself.
  if (url.startsWith('file:')) return decodeURIComponent(new URL(url).pathname);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`model fetch ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// One InferenceSession, shared by every call of the returned classifier. Runs
// are queued one at a time: a wasm session does not take overlapping runs.
// confidence is the top-1 softmax probability; at the reader's 0.5 threshold that
// also means the winner holds more mass than every other class put together.
export async function loadClassifier(modelUrl: string | URL): Promise<Classify> {
  const source = await modelSource(modelUrl);
  const session =
    typeof source === 'string'
      ? await ort.InferenceSession.create(source, { executionProviders: ['wasm'] })
      : await ort.InferenceSession.create(source, { executionProviders: ['wasm'] });
  let queue: Promise<unknown> = Promise.resolve();
  return (input: Float32Array) => {
    const run = queue.then(async () => {
      const feeds = { input: new ort.Tensor('float32', input, [1, 1, CANVAS_SIZE, CANVAS_SIZE]) };
      const output = await session.run(feeds);
      const probabilities = output.probabilities.data as Float32Array;
      let best = 0;
      for (let i = 1; i < probabilities.length; i++) if (probabilities[i] > probabilities[best]) best = i;
      return { char: MODEL_CLASSES[best], probabilities, confidence: probabilities[best] };
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

interface Box {
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number; // inclusive
}

// 8-connected component bounding boxes, in row-major discovery order.
function componentBoxes(ink: Uint8Array, width: number, height: number): Box[] {
  const seen = new Uint8Array(ink.length);
  const found: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (ink[start] !== 1 || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const box: Box = { x0: width, y0: height, x1: -1, y1: -1 };
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (ink[next] === 1 && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    found.push(box);
  }
  return found;
}

// One 16x16 canvas per character, left to right; null when the crop is blank or
// a glyph is clipped by the crop border (as clueTemplate rejects them).
export function characterCanvases(crop: OcrImage): Uint8Array[] | null {
  const { width, height } = crop;
  const { ink } = binarize(crop);
  const all = componentBoxes(ink, width, height);
  if (all.length === 0) return null;

  const tallest = Math.max(...all.map((box) => box.y1 - box.y0 + 1));
  const kept = all.filter((box) => Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1) >= SPECK_FRACTION * tallest);
  for (const box of kept) {
    if (box.x0 === 0 || box.y0 === 0 || box.x1 === width - 1 || box.y1 === height - 1) return null;
  }

  kept.sort((a, b) => a.x0 + a.x1 - (b.x0 + b.x1) || a.y0 + a.y1 - (b.y0 + b.y1));
  const canvases: Uint8Array[] = [];
  for (const box of kept) {
    const canvas = characterCanvas(ink, width, height, { start: box.x0, end: box.x1 });
    if (canvas === null) return null;
    canvases.push(canvas);
  }
  return canvases;
}

// Parses glyph chars as <digits><optional operator>; null if not that shape.
// The same rule as clueTemplate.ts's parse.
function parse(chars: readonly GlyphChar[]): { target: number; operator: Operator | null } | null {
  let digits = 0;
  while (digits < chars.length && !OPERATOR_CHARS.has(chars[digits])) digits++;
  if (digits === 0) return null;
  const rest = chars.slice(digits);
  if (rest.length > 1) return null;
  if (chars[0] === '0') return null; // targets are positive with no leading zero
  return { target: Number(chars.slice(0, digits).join('')), operator: rest.length === 1 ? (rest[0] as Operator) : null };
}

function canvasKey(canvas: Uint8Array): string {
  return String.fromCharCode(...canvas);
}

// A reader that needs an asynchronous step before the pipeline can call read().
export interface PreparedClueReader extends ClueReader {
  readonly name: 'onnx';
  // Classifies every character the scan will ask read() about. Pass the same
  // scan function the caller will use, so the crops match.
  prepare(image: OcrImage, scan?: typeof scanPhoto): Promise<void>;
}

export function isPreparedClueReader(reader: ClueReader): reader is PreparedClueReader {
  return typeof (reader as Partial<PreparedClueReader>).prepare === 'function';
}

// Builds the ONNX reader around a classifier (exported for tests).
export function onnxReaderFrom(classify: Classify): PreparedClueReader {
  const memo = new Map<string, CharacterPrediction>();

  async function classifyCanvases(canvases: readonly Uint8Array[]): Promise<void> {
    for (const canvas of canvases) {
      const key = canvasKey(canvas);
      if (memo.has(key)) continue;
      const prediction = await classify(canvasToInput(canvas));
      if (memo.size >= MAX_MEMO_ENTRIES) memo.clear();
      memo.set(key, prediction);
    }
  }

  return {
    name: 'onnx',
    async prepare(image: OcrImage, scan: typeof scanPhoto = scanPhoto): Promise<void> {
      const canvases: Uint8Array[] = [];
      scan(image, {
        read(crop: OcrImage): null {
          canvases.push(...(characterCanvases(crop) ?? []));
          return null;
        },
      });
      await classifyCanvases(canvases);
    },
    read(crop: OcrImage): ClueReading | null {
      const canvases = characterCanvases(crop);
      if (canvases === null) return null;
      const predictions: CharacterPrediction[] = [];
      for (const canvas of canvases) {
        const prediction = memo.get(canvasKey(canvas));
        if (prediction === undefined) return null;
        predictions.push(prediction);
      }
      const parsed = parse(predictions.map(({ char }) => char));
      // The weakest character decides, as in the template reader.
      const confidence = Math.min(...predictions.map((prediction) => prediction.confidence));
      if (parsed === null || confidence < CLUE_CONFIDENCE_THRESHOLD) return null;
      return { target: parsed.target, operator: parsed.operator, confidence };
    },
  };
}

// The app's default reader. Never rejects: if the model or the wasm runtime cannot
// be loaded it warns and hands back the template reader, so scanning still works.
export async function makeOnnxReader(options: { modelUrl?: string } = {}): Promise<ClueReader> {
  try {
    return onnxReaderFrom(await loadClassifier(options.modelUrl ?? modelAssetUrl));
  } catch (error) {
    console.warn('ONNX clue reader unavailable, using the template reader:', error);
    return templateClueReader;
  }
}
