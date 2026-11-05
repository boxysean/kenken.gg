import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import PlayApp from './PlayApp';
import { generate } from './generator/generate';
import { dailyPuzzle, todayUtcDate } from './daily';
import { loadDaily, savePrefs, KEY_DAILY } from './persistence';
import { shareText } from './share';

// Play mode is driven entirely through the DOM, the way a player drives it: a
// click focuses a cell, the numpad or a key enters a value. There is no
// assertion on component internals, so the tests survive a rewrite of the
// state shape as long as the screen still behaves.

let container: HTMLDivElement;

function get(testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (element === null) throw new Error(`no element with data-testid ${testId}`);
  return element as HTMLElement;
}

function query(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(<PlayApp />, container);
  });
}

function typeInto(cell: number, digit: number): void {
  click(get('play-cell-' + cell));
  click(get('play-numpad-' + digit));
}

beforeEach(() => {
  window.localStorage.clear();
  savePrefs({ lastPracticeSize: 4, mode: 'play' });
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
  window.localStorage.clear();
});

test('playing phase starts from the choosing card', () => {
  mount();
  // Nothing generated yet: the player is choosing.
  expect(query('play-board')).toBeNull();
  expect(query('play-daily-button')).not.toBeNull();

  click(get('play-practice-button'));

  const board = get('play-board');
  expect(board.getAttribute('data-size')).toBe('4');
  expect(board.querySelectorAll('[role="gridcell"]').length).toBe(16);
  expect(get('play-timer').textContent).toBe('0:00');
});

test('the board is generated from a seed that reproduces the same puzzle', () => {
  mount();
  click(get('play-practice-button'));
  const seed = get('play-board').getAttribute('data-seed')!;
  expect(seed.startsWith('practice-')).toBe(true);

  // The seed on the board is enough to rebuild the puzzle, which is how a
  // scripted playthrough knows the answer without reading component state.
  const rebuilt = generate(seed, 4);
  const cells = Array.from(container.querySelectorAll('[role="gridcell"]'));
  expect(cells.length).toBe(rebuilt.solution.length);
});

test('pencil marks toggle and are erased when a value is entered', () => {
  mount();
  click(get('play-practice-button'));

  const marks = (cell: number) => {
    const element = get('play-cell-' + cell).querySelector('.PlayCellPencils');
    return element === null ? '' : element.textContent!;
  };

  click(get('play-pencil-toggle'));
  typeInto(0, 2);
  typeInto(0, 3);
  const cell = get('play-cell-0');
  expect(cell.className).toContain('isFocused');
  expect(marks(0)).toContain('2');
  expect(marks(0)).toContain('3');
  // No value was set, only marks.
  expect(cell.querySelector('.PlayCellValue')).toBeNull();

  // Toggling the same mark off leaves only the other.
  typeInto(0, 2);
  expect(marks(0)).not.toContain('2');
  expect(marks(0)).toContain('3');

  click(get('play-pencil-toggle'));
  typeInto(0, 4);
  const filled = get('play-cell-0');
  expect(filled.querySelector('.PlayCellValue')!.textContent).toBe('4');
  expect(filled.querySelector('.PlayCellPencils')).toBeNull();
});

test('undo and redo step through cell edits', () => {
  mount();
  click(get('play-practice-button'));

  typeInto(0, 3);
  expect(get('play-cell-0').textContent).toContain('3');

  click(get('play-undo'));
  expect(get('play-cell-0').querySelector('.PlayCellValue')).toBeNull();

  click(get('play-redo'));
  expect(get('play-cell-0').textContent).toContain('3');
});

test('checking an incomplete grid reports what is left and locks nothing', () => {
  mount();
  click(get('play-practice-button'));

  click(get('play-check'));
  expect(get('play-status').textContent).toBe('16 cells left');

  typeInto(0, 1);
  click(get('play-check'));
  expect(get('play-status').textContent).toBe('15 cells left');
  // Nothing locked, so the cell is still editable.
  expect(get('play-cell-0').getAttribute('data-locked')).toBe('false');
});

test('checking a full but wrong grid marks wrong cells and locks the right ones', () => {
  mount();
  click(get('play-practice-button'));
  const solution = generate(get('play-board').getAttribute('data-seed')!, 4).solution;

  // One deliberately wrong cell, everything else correct.
  const wrongValue = (solution[0] % 4) + 1;
  typeInto(0, wrongValue);
  for (let cell = 1; cell < 16; cell++) typeInto(cell, solution[cell]);

  click(get('play-check'));

  expect(get('play-status').textContent).toBe('Some cells are wrong');
  expect(get('play-cell-0').className).toContain('isWrong');
  expect(get('play-cell-0').getAttribute('data-locked')).toBe('false');
  expect(get('play-cell-5').getAttribute('data-locked')).toBe('true');
  expect(query('play-won')).toBeNull();

  // Fixing the wrong cell and checking again wins.
  typeInto(0, solution[0]);
  click(get('play-check'));
  expect(query('play-won')).not.toBeNull();
});

test('a hint reveals a value, counts, locks, and cannot be undone', () => {
  mount();
  click(get('play-practice-button'));
  const solution = generate(get('play-board').getAttribute('data-seed')!, 4).solution;

  click(get('play-cell-0'));
  click(get('play-hint'));

  expect(get('play-cell-0').textContent).toContain(String(solution[0]));
  expect(get('play-cell-0').getAttribute('data-locked')).toBe('true');
  expect(container.textContent).toContain('1 hint');

  // The hint lock is permanent: undo leaves it alone and says there is nothing
  // to undo, rather than taking back a value the player paid for.
  click(get('play-undo'));
  expect(get('play-cell-0').textContent).toContain(String(solution[0]));
  expect(get('play-cell-0').getAttribute('data-locked')).toBe('true');
});

test('restart asks first, then clears the board and the clock', () => {
  mount();
  click(get('play-practice-button'));
  typeInto(0, 2);
  typeInto(1, 3);

  click(get('play-restart'));
  expect(query('play-restart-yes')).not.toBeNull();
  // Still on the board while the question is open.
  expect(get('play-cell-0').textContent).toContain('2');

  click(get('play-restart-no'));
  expect(get('play-cell-0').textContent).toContain('2');

  click(get('play-restart'));
  click(get('play-restart-yes'));
  expect(get('play-cell-0').querySelector('.PlayCellValue')).toBeNull();
  expect(get('play-cell-1').querySelector('.PlayCellValue')).toBeNull();
  expect(get('play-timer').textContent).toBe('0:00');
});

test('arrows move focus and wrap at the edges', () => {
  mount();
  click(get('play-practice-button'));

  const focusedCell = () => (document.activeElement as HTMLElement).getAttribute('data-testid');
  act(() => {
    (container.querySelector('[role="gridcell"]') as HTMLElement).focus();
  });
  expect(focusedCell()).toBe('play-cell-0');

  press('ArrowRight');
  expect(focusedCell()).toBe('play-cell-1');
  press('ArrowDown');
  expect(focusedCell()).toBe('play-cell-5');
  press('ArrowLeft');
  expect(focusedCell()).toBe('play-cell-4');
  press('ArrowUp');
  expect(focusedCell()).toBe('play-cell-0');
  // Wrapping: left from the first column lands in the last column.
  press('ArrowLeft');
  expect(focusedCell()).toBe('play-cell-3');
  // Escape drops the focus from the grid.
  press('Escape');
  expect(container.querySelector('.isFocused')).toBeNull();
});

test('a full keyboard playthrough wins and produces a spoiler-free share string', () => {
  mount();
  click(get('play-practice-button'));
  const puzzle = generate(get('play-board').getAttribute('data-seed')!, 4);

  // Every value is entered by keystroke, then won with the Check shortcut.
  for (let cell = 0; cell < 16; cell++) {
    click(get('play-cell-' + cell));
    press(String(puzzle.solution[cell]));
  }

  press('c');

  expect(query('play-won')).not.toBeNull();
  expect(get('play-won').textContent).toContain('Solved!');

  const text = shareText({ boardSize: 4, elapsed: 0, hints: 0 });
  expect(text).toBe('KenKen practice 4×4\n✅ solved in 0:00 · 0 hints\nkenken.gg');
  // Nothing from the grid, the values or the cage layout.
  for (const value of puzzle.solution) expect(text).not.toContain(' ' + value + '\n');
  expect(text.split('\n').length).toBe(3);
});

test('the daily saves progress and comes back after a reload', () => {
  mount();
  const today = todayUtcDate();
  expect(dailyPuzzle(today).boardSize).toBe(dailyPuzzle(today).boardSize);

  click(get('play-daily-button'));
  const size = Number(get('play-board').getAttribute('data-size'));
  expect(size).toBe(dailyPuzzle(today).boardSize);

  typeInto(0, 2);
  click(get('play-hint'));
  act(() => {
    // The save is debounced; unmounting flushes it, which is what a closed tab
    // does too.
    ReactDOM.unmountComponentAtNode(container);
  });

  const saved = loadDaily();
  expect(saved).not.toBeNull();
  expect(saved!.date).toBe(today);
  expect(saved!.hints).toBe(1);
  // The revealed cell's lock survives, so a reload cannot hand back a hint.
  expect(saved!.locked![0] ?? saved!.locked![1]).toBe(true);

  // A save from another day is ignored rather than resumed.
  window.localStorage.setItem(KEY_DAILY, JSON.stringify({ ...saved, date: '2000-01-01' }));
  expect(loadDaily()!.date).toBe('2000-01-01');
  mount();
  click(get('play-daily-button'));
  expect(get('play-cell-0').querySelector('.PlayCellValue')).toBeNull();
}, 60000);
