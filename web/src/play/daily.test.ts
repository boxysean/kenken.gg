import { dailyBoardSize, dailyPuzzle, dailySeed, todayUtcDate } from './daily';

test('todayUtcDate formats the UTC calendar date', () => {
  expect(todayUtcDate(new Date(Date.UTC(2024, 4, 1, 23, 59, 59)))).toBe('2024-05-01');
  // Half past midnight UTC on the next day is a different puzzle everywhere.
  expect(todayUtcDate(new Date(Date.UTC(2024, 4, 2, 0, 0, 1)))).toBe('2024-05-02');
  expect(todayUtcDate(new Date(Date.UTC(2024, 0, 9, 12)))).toBe('2024-01-09');
  // Local time must not leak into the date: this instant is 2024-05-01 in UTC.
  expect(todayUtcDate(new Date('2024-05-01T23:30:00Z'))).toBe('2024-05-01');
});

test('dailySeed is derived from the date and rejects malformed dates', () => {
  expect(dailySeed('2024-05-01')).toBe('daily-2024-05-01');
  expect(() => dailySeed('2024-5-1')).toThrow();
  expect(() => dailySeed('not-a-date')).toThrow();
  expect(() => dailySeed('2024-02-30')).toThrow();
});

test('board size rotates through 4..9 and repeats every six days', () => {
  const sizes = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06', '2024-01-07'].map(
    dailyBoardSize,
  );
  expect(sizes).toEqual([4, 5, 6, 7, 8, 9, 4]);
  // Before the epoch the modulo still lands inside 4..9.
  for (let offset = -20; offset <= 20; offset++) {
    const date = new Date(Date.UTC(2024, 0, 1) + offset * 86400000).toISOString().slice(0, 10);
    expect(dailyBoardSize(date)).toBeGreaterThanOrEqual(4);
    expect(dailyBoardSize(date)).toBeLessThanOrEqual(9);
  }
});

test('the same date yields the same puzzle', () => {
  const first = dailyPuzzle('2024-05-01');
  const second = dailyPuzzle('2024-05-01');
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  expect(first.boardSize).toBe(dailyBoardSize('2024-05-01'));
  expect(first.seed).toBe(dailySeed('2024-05-01'));
});

test('consecutive days yield different puzzles', () => {
  const days = ['2024-05-01', '2024-05-02', '2024-05-03'];
  const puzzles = days.map((date) => JSON.stringify(dailyPuzzle(date)));
  expect(new Set(puzzles).size).toBe(days.length);
}, 120000);
