// The daily puzzle: one seed and board size per UTC calendar day, so every
// player gets the same puzzle on the same day wherever they are.
import { generate } from './generator/generate';
import type { PlayPuzzle } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EPOCH = Date.UTC(2024, 0, 1);
const MIN_BOARD_SIZE = 4;
const BOARD_SIZE_COUNT = 6; // 4x4 through 9x9

export function todayUtcDate(now: Date = new Date()): string {
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dailySeed(date: string): string {
  parseUtcDate(date);
  return `daily-${date}`;
}

// Cycles 4, 5, ..., 9 starting from 4x4 on 2024-01-01.
export function dailyBoardSize(date: string): number {
  const days = Math.round((parseUtcDate(date) - EPOCH) / MS_PER_DAY);
  return MIN_BOARD_SIZE + (((days % BOARD_SIZE_COUNT) + BOARD_SIZE_COUNT) % BOARD_SIZE_COUNT);
}

export function dailyPuzzle(date: string): PlayPuzzle {
  return generate(dailySeed(date), dailyBoardSize(date));
}

// Milliseconds since the Unix epoch at UTC midnight of `date` ("YYYY-MM-DD").
function parseUtcDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`daily: expected a date as YYYY-MM-DD, got ${JSON.stringify(date)}`);
  }
  const [year, month, day] = date.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);
  // Date.UTC rolls over out-of-range parts (2024-02-30 becomes 2024-03-01), so
  // a real calendar date is one that survives the round trip unchanged.
  const roundTrip = new Date(time);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    throw new Error(`daily: ${JSON.stringify(date)} is not a real calendar date`);
  }
  return time;
}
