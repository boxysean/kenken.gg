// localStorage for play mode. Storage can be missing (private mode), full, or
// hold anything a previous build wrote, so every access is guarded and every
// read is validated: failing to persist must never break play.
import type { PlayPuzzle } from './types';

export const KEY_DAILY = 'kenken:daily:v1';
export const KEY_PREFS = 'kenken:prefs:v1';

export interface DailySave {
  date: string;
  puzzle: PlayPuzzle;
  values: number[];
  pencils: number[][];
  // Absent in saves written before locks were stored: a revealed cell must stay
  // revealed across a reload, or the hint the player paid for is given back.
  locked?: boolean[];
  elapsed: number;
  hints: number;
  won: boolean;
}

export interface Prefs {
  lastPracticeSize: number;
  mode: 'solver' | 'play';
}

const DEFAULT_PREFS: Prefs = { lastPracticeSize: 5, mode: 'solver' };
const MIN_SIZE = 4;
const MAX_SIZE = 9;
const SAVE_DEBOUNCE_MS = 500;
// A 9x9 save with every pencil mark set is about 3KB; anything bigger means
// the shape has gone wrong, and it should not crowd out the rest of the origin.
const MAX_SAVE_BYTES = 4096;

let pendingSave: DailySave | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadDaily(): DailySave | null {
  const parsed = readJson(KEY_DAILY);
  return isDailySave(parsed) ? parsed : null;
}

// The timer saves every second and edits can come faster, so writes are
// debounced; flushDaily() forces the last one out when the page is hidden.
export function saveDaily(save: DailySave): void {
  pendingSave = save;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDaily, SAVE_DEBOUNCE_MS);
}

export function flushDaily(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  if (pendingSave === null) return;
  const save = pendingSave;
  pendingSave = null;

  let json = JSON.stringify(save);
  if (json.length > MAX_SAVE_BYTES) {
    // Pencil marks are the only part that grows with play; losing them is
    // better than losing the values and the clock.
    json = JSON.stringify({ ...save, pencils: save.pencils.map(() => []) });
  }
  if (json.length > MAX_SAVE_BYTES) return;
  writeString(KEY_DAILY, json);
}

export function clearDaily(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  pendingSave = null;
  try {
    window.localStorage.removeItem(KEY_DAILY);
  } catch (error) {
    // Nothing stored or no storage: either way there is nothing to clear.
  }
}

// Each field falls back on its own, so one bad value does not cost the other.
export function loadPrefs(): Prefs {
  const parsed = readJson(KEY_PREFS);
  if (!isObject(parsed)) return { ...DEFAULT_PREFS };
  return {
    lastPracticeSize: isIntIn(parsed.lastPracticeSize, MIN_SIZE, MAX_SIZE)
      ? parsed.lastPracticeSize
      : DEFAULT_PREFS.lastPracticeSize,
    mode: parsed.mode === 'play' || parsed.mode === 'solver' ? parsed.mode : DEFAULT_PREFS.mode,
  };
}

export function savePrefs(prefs: Prefs): void {
  writeString(KEY_PREFS, JSON.stringify(prefs));
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Quota or private mode: play carries on unsaved.
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isIntArray(value: unknown, length: number, min: number, max: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((x) => isIntIn(x, min, max));
}

function isPuzzle(value: unknown): value is PlayPuzzle {
  if (!isObject(value) || !isIntIn(value.boardSize, MIN_SIZE, MAX_SIZE)) return false;
  const size = value.boardSize;
  return (
    Array.isArray(value.boardStrings) &&
    value.boardStrings.length === size &&
    value.boardStrings.every((row: unknown) => typeof row === 'string') &&
    typeof value.constraintString === 'string' &&
    isIntArray(value.solution, size * size, 1, size) &&
    typeof value.seed === 'string' &&
    isObject(value.difficulty)
  );
}

function isDailySave(value: unknown): value is DailySave {
  if (!isObject(value) || !isPuzzle(value.puzzle)) return false;
  const size = value.puzzle.boardSize;
  const cells = size * size;
  return (
    typeof value.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    isIntArray(value.values, cells, 0, size) &&
    Array.isArray(value.pencils) &&
    value.pencils.length === cells &&
    value.pencils.every((marks: unknown) => Array.isArray(marks) && marks.every((x) => isIntIn(x, 1, size))) &&
    // Optional: an old save simply has no locks, and the caller defaults them.
    (value.locked === undefined ||
      (Array.isArray(value.locked) && value.locked.length === cells && value.locked.every((x: unknown) => typeof x === 'boolean'))) &&
    isIntIn(value.elapsed, 0, Number.MAX_SAFE_INTEGER) &&
    isIntIn(value.hints, 0, cells) &&
    typeof value.won === 'boolean'
  );
}
