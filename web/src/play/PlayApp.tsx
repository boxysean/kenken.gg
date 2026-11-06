import React from 'react';
import update from 'immutability-helper';
import { generate } from './generator/generate';
import { dailyBoardSize, dailyPuzzle, todayUtcDate } from './daily';
import type { PlayPuzzle } from './types';
import PlayBoard from './PlayBoard';
import PlayLifecycle from './PlayLifecycle';
import { flushDaily, loadDaily, loadPrefs, saveDaily, savePrefs } from './persistence';
import type { DailySave } from './persistence';
import { copyText, formatElapsed, formatHints, shareText } from './share';
import './PlayApp.css';

const MAX_HISTORY = 200;
const MIN_PRACTICE_SIZE = 4;
const MAX_PRACTICE_SIZE = 9;
const CONFETTI_PIECES = 8;

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

interface CellContent {
  value: number;
  pencils: number[];
}

interface CellEdit {
  cell: number;
  before: CellContent;
  after: CellContent;
}

// Everything Restart resets and Back sets aside.
interface Game {
  puzzle: PlayPuzzle;
  dailyDate: string | null; // null for practice
  values: number[]; // 0 for empty
  pencils: number[][];
  locked: boolean[]; // checked correct or revealed by a hint
  elapsed: number; // seconds
  hints: number;
}

interface PlayAppState {
  lifecycle: PlayLifecycle;
  game: Game | null;
  wrong: boolean[];
  focused: number | null;
  pencilMode: boolean;
  undo: CellEdit[];
  redo: CellEdit[];
  checkRound: number;
  status: string;
  confirmingRestart: boolean;
  practiceSize: number;
  // A practice game left with Back; practice is never persisted, so this is
  // the only way back into it.
  practiceStash: Game | null;
  dailySave: DailySave | null;
}

function freshGame(puzzle: PlayPuzzle, dailyDate: string | null): Game {
  const cells = puzzle.boardSize * puzzle.boardSize;
  return {
    puzzle,
    dailyDate,
    values: new Array(cells).fill(0),
    pencils: Array.from({ length: cells }, () => []),
    locked: new Array(cells).fill(false),
    elapsed: 0,
    hints: 0,
  };
}

function practiceSeed(): string {
  return 'practice-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function withContent(game: Game, cell: number, content: CellContent): Game {
  return update(game, {
    values: { [cell]: { $set: content.value } },
    pencils: { [cell]: { $set: content.pencils } },
  });
}

function sameContent(a: CellContent, b: CellContent): boolean {
  return a.value === b.value && a.pencils.length === b.pencils.length && a.pencils.every((x, i) => x === b.pencils[i]);
}

// Edits to cells that have since locked are dropped rather than replayed:
// a locked cell is settled, and undo must never take a revealed value back.
function popUnlocked(stack: CellEdit[], locked: boolean[]): [CellEdit | null, CellEdit[]] {
  const rest = [...stack];
  let edit = rest.pop();
  while (edit !== undefined && locked[edit.cell]) {
    edit = rest.pop();
  }
  return [edit === undefined ? null : edit, rest];
}

// Mouse users keep DOM focus on the board when they tap a control, so typed
// digits keep going to the cell (keys aimed at buttons are ignored).
function keepCellFocus(event: React.MouseEvent) {
  event.preventDefault();
}

class PlayApp extends React.Component<{}, PlayAppState> {
  timer: ReturnType<typeof setInterval> | null = null;
  hidden = false;
  unmounted = false;
  // Motion for the win celebration; off when the player asks for reduced motion.
  celebrate = true;

  constructor(props: {}) {
    super(props);

    this.state = {
      lifecycle: PlayLifecycle.Choosing,
      game: null,
      wrong: [],
      focused: null,
      pencilMode: false,
      undo: [],
      redo: [],
      checkRound: 0,
      status: '',
      confirmingRestart: false,
      practiceSize: loadPrefs().lastPracticeSize,
      practiceStash: null,
      dailySave: loadDaily(),
    };

    this.tick = this.tick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.focusCell = this.focusCell.bind(this);
  }

  componentDidMount() {
    this.celebrate = typeof window.matchMedia !== 'function'
      || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.hidden = document.visibilityState === 'hidden';
    this.timer = setInterval(this.tick, 1000);
    document.addEventListener('keydown', this.handleKeyDown, false);
    document.addEventListener('visibilitychange', this.handleVisibilityChange, false);
  }

  componentWillUnmount() {
    this.unmounted = true;
    if (this.timer !== null) clearInterval(this.timer);
    document.removeEventListener('keydown', this.handleKeyDown, false);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange, false);
    flushDaily();
  }

  // Every change to a daily game goes through here, so the save can never
  // drift from what is on screen.
  componentDidUpdate(prevProps: {}, prevState: PlayAppState) {
    const { game, lifecycle } = this.state;
    if (game === null || game.dailyDate === null) return;
    if (game === prevState.game && lifecycle === prevState.lifecycle) return;
    saveDaily({
      date: game.dailyDate,
      puzzle: game.puzzle,
      values: game.values,
      pencils: game.pencils,
      locked: game.locked,
      elapsed: game.elapsed,
      hints: game.hints,
      won: lifecycle === PlayLifecycle.Won,
    });
  }

  tick() {
    const { game, lifecycle } = this.state;
    if (game === null || lifecycle !== PlayLifecycle.Playing || this.hidden) return;
    this.setState({ game: { ...game, elapsed: game.elapsed + 1 } });
  }

  handleVisibilityChange() {
    this.hidden = document.visibilityState === 'hidden';
    // A hidden tab may never come back (mobile kills it), so don't leave the
    // last moves waiting on the debounce.
    if (this.hidden) flushDaily();
  }

  startGame(game: Game, won: boolean = false) {
    const cells = game.puzzle.boardSize * game.puzzle.boardSize;
    this.setState({
      lifecycle: won ? PlayLifecycle.Won : PlayLifecycle.Playing,
      game,
      wrong: new Array(cells).fill(false),
      focused: null,
      pencilMode: false,
      undo: [],
      redo: [],
      checkRound: 0,
      status: '',
      confirmingRestart: false,
    });
  }

  chooseDaily() {
    const today = todayUtcDate();
    const save = loadDaily();
    if (save === null || save.date !== today) {
      this.startGame(freshGame(dailyPuzzle(today), today));
      return;
    }
    const cells = save.puzzle.boardSize * save.puzzle.boardSize;
    this.startGame(
      {
        puzzle: save.puzzle,
        dailyDate: today,
        values: save.values,
        pencils: save.pencils,
        // Saves written before locks were stored have none; a won board is all
        // correct, so it locks whole, and an unfinished one re-locks nothing.
        locked: save.locked ?? new Array(cells).fill(save.won),
        elapsed: save.elapsed,
        hints: save.hints,
      },
      save.won
    );
  }

  choosePractice() {
    const stash = this.state.practiceStash;
    if (stash !== null && stash.puzzle.boardSize === this.state.practiceSize) {
      this.setState({ practiceStash: null });
      this.startGame(stash);
      return;
    }
    this.newPractice();
  }

  newPractice() {
    const puzzle = generate(practiceSeed(), this.state.practiceSize);
    this.setState({ practiceStash: null });
    this.startGame(freshGame(puzzle, null));
  }

  changePracticeSize(event: React.ChangeEvent<HTMLInputElement>) {
    const size = parseInt(event.target.value, 10);
    if (!(size >= MIN_PRACTICE_SIZE && size <= MAX_PRACTICE_SIZE)) return;
    this.setState({ practiceSize: size });
    savePrefs({ ...loadPrefs(), lastPracticeSize: size });
  }

  backToChoosing() {
    const { game, lifecycle } = this.state;
    let practiceStash = this.state.practiceStash;
    if (game !== null && game.dailyDate === null) {
      practiceStash = lifecycle === PlayLifecycle.Playing ? game : null;
    }
    // Write any pending save first so the daily card reads the latest state.
    flushDaily();
    this.setState({
      lifecycle: PlayLifecycle.Choosing,
      game: null,
      focused: null,
      status: '',
      confirmingRestart: false,
      practiceStash,
      dailySave: loadDaily(),
    });
  }

  focusCell(cellIndex: number) {
    if (this.state.focused !== cellIndex) {
      this.setState({ focused: cellIndex });
    }
  }

  clearFocus() {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.getAttribute('role') === 'gridcell') active.blur();
    this.setState({ focused: null });
  }

  moveFocus(rowStep: number, columnStep: number) {
    const size = this.state.game!.puzzle.boardSize;
    const { focused } = this.state;
    if (focused === null) {
      this.setState({ focused: 0 });
      return;
    }
    const row = (Math.floor(focused / size) + rowStep + size) % size;
    const column = ((focused % size) + columnStep + size) % size;
    this.setState({ focused: row * size + column });
  }

  // The focused cell if it can take an edit; otherwise says why not.
  editableFocusedCell(): number | null {
    const { focused, game } = this.state;
    if (focused === null) {
      this.setState({ status: 'Pick a cell first' });
      return null;
    }
    if (game!.locked[focused]) {
      this.setState({ status: 'That cell is locked' });
      return null;
    }
    return focused;
  }

  enterDigit(digit: number) {
    const cell = this.editableFocusedCell();
    if (cell === null) return;
    const game = this.state.game!;
    const before = { value: game.values[cell], pencils: game.pencils[cell] };
    let after: CellContent;
    if (this.state.pencilMode) {
      const pencils = before.pencils.indexOf(digit) >= 0
        ? before.pencils.filter((mark) => mark !== digit)
        : [...before.pencils, digit].sort((a, b) => a - b);
      // Pencilling a filled cell means the player doubts it, so the value goes.
      after = { value: 0, pencils };
    } else {
      after = { value: digit, pencils: before.pencils };
    }
    this.applyEdit({ cell, before, after });
  }

  clearCell() {
    const cell = this.editableFocusedCell();
    if (cell === null) return;
    const game = this.state.game!;
    const before = { value: game.values[cell], pencils: game.pencils[cell] };
    this.applyEdit({ cell, before, after: { value: 0, pencils: [] } });
  }

  applyEdit(edit: CellEdit) {
    if (sameContent(edit.before, edit.after)) return;
    const next = withContent(this.state.game!, edit.cell, edit.after);
    const undo = [...this.state.undo, edit].slice(-MAX_HISTORY);
    if (this.maybeWin(next, undo)) return;
    this.setState({
      game: next,
      wrong: update(this.state.wrong, { [edit.cell]: { $set: false } }),
      undo,
      redo: [],
      status: '',
    });
  }

  undo() {
    const game = this.state.game!;
    const [edit, undo] = popUnlocked(this.state.undo, game.locked);
    if (edit === null) {
      this.setState({ undo, status: 'Nothing to undo' });
      return;
    }
    const next = withContent(game, edit.cell, edit.before);
    if (this.maybeWin(next, undo)) return;
    this.setState({
      game: next,
      wrong: update(this.state.wrong, { [edit.cell]: { $set: false } }),
      undo,
      redo: [...this.state.redo, edit].slice(-MAX_HISTORY),
      focused: edit.cell,
      status: '',
    });
  }

  redo() {
    const game = this.state.game!;
    const [edit, redo] = popUnlocked(this.state.redo, game.locked);
    if (edit === null) {
      this.setState({ redo, status: 'Nothing to redo' });
      return;
    }
    const next = withContent(game, edit.cell, edit.after);
    const undo = [...this.state.undo, edit].slice(-MAX_HISTORY);
    if (this.maybeWin(next, undo)) return;
    this.setState({
      game: next,
      wrong: update(this.state.wrong, { [edit.cell]: { $set: false } }),
      undo,
      redo,
      focused: edit.cell,
      status: '',
    });
  }

  togglePencilMode() {
    this.setState({ pencilMode: !this.state.pencilMode });
  }

  check() {
    const game = this.state.game!;
    const { values, puzzle } = game;
    const left = values.filter((value) => value === 0).length;
    if (left > 0) {
      this.setState({ status: `${left} ${left === 1 ? 'cell' : 'cells'} left` });
      return;
    }
    const wrong = values.map((value, i) => value !== puzzle.solution[i]);
    if (!wrong.some(Boolean)) {
      this.win(game);
      return;
    }
    this.setState({
      game: { ...game, locked: game.locked.map((locked, i) => locked || !wrong[i]) },
      wrong,
      checkRound: this.state.checkRound + 1,
      status: 'Some cells are wrong',
    });
  }

  // A correct, complete board is a win; a complete-but-wrong board stays silent.
  // Silence is deliberate: wrong cells belong to check(), and auto-flagging them
  // would make Check redundant.
  maybeWin(game: Game, undo: CellEdit[]): boolean {
    if (!game.values.every((value) => value !== 0)) return false;
    if (!game.values.every((value, i) => value === game.puzzle.solution[i])) return false;
    this.win(game, undo);
    return true;
  }

  win(game: Game, undo?: CellEdit[]) {
    this.setState({
      lifecycle: PlayLifecycle.Won,
      game: { ...game, locked: game.locked.map(() => true) },
      undo: undo === undefined ? this.state.undo : undo,
      wrong: game.values.map(() => false),
      focused: null,
      status: '',
      confirmingRestart: false,
    });
  }

  // Not on the undo stack: a hint is spent once it is seen.
  hint() {
    const game = this.state.game!;
    const { focused } = this.state;
    const { solution } = game.puzzle;
    let target: number | null = focused !== null && !game.locked[focused] ? focused : null;
    if (target === null) {
      const index = game.values.findIndex((value, i) => !game.locked[i] && value !== solution[i]);
      target = index >= 0 ? index : null;
    }
    if (target === null) {
      this.setState({ status: 'Nothing left to reveal — try Check' });
      return;
    }

    const next = update(withContent(game, target, { value: solution[target], pencils: [] }), {
      locked: { [target]: { $set: true } },
      hints: { $set: game.hints + 1 },
    });
    if (this.maybeWin(next, this.state.undo)) return;
    this.setState({
      game: next,
      wrong: update(this.state.wrong, { [target]: { $set: false } }),
      focused: target,
      status: '',
    });
  }

  restart() {
    const game = this.state.game!;
    this.startGame(freshGame(game.puzzle, game.dailyDate));
  }

  share() {
    const game = this.state.game!;
    const text = shareText({
      date: game.dailyDate === null ? undefined : game.dailyDate,
      boardSize: game.puzzle.boardSize,
      elapsed: game.elapsed,
      hints: game.hints,
    });
    copyText(text).then((copied) => {
      if (this.unmounted) return;
      this.setState({ status: copied ? 'Copied' : "Couldn't copy: the browser blocked the clipboard" });
    });
  }

  handleKeyDown(event: KeyboardEvent) {
    if (this.state.lifecycle !== PlayLifecycle.Playing || this.state.game === null) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(target.tagName)) return;

    const key = event.key;
    const arrow = ARROWS[key];
    if (arrow !== undefined) {
      event.preventDefault();
      this.moveFocus(arrow[0], arrow[1]);
      return;
    }
    if (/^[1-9]$/.test(key)) {
      if (Number(key) <= this.state.game.puzzle.boardSize) {
        event.preventDefault();
        this.enterDigit(Number(key));
      }
      return;
    }

    switch (key) {
      case 'Backspace':
      case 'Delete':
        event.preventDefault();
        this.clearCell();
        break;
      case 'p':
      case 'P':
        this.togglePencilMode();
        break;
      case 'c':
      case 'C':
        this.check();
        break;
      case 'h':
      case 'H':
        this.hint();
        break;
      case 'u':
      case 'U':
        this.undo();
        break;
      case 'Escape':
        this.clearFocus();
        break;
      default:
        break;
    }
  }

  dailyStatus(today: string): string {
    const save = this.state.dailySave;
    if (save === null || save.date !== today) return 'Not started';
    if (save.won) return `Solved in ${formatElapsed(save.elapsed)} · ${formatHints(save.hints)}`;
    return `In progress · ${formatElapsed(save.elapsed)}`;
  }

  renderChoosing() {
    const today = todayUtcDate();
    const save = this.state.dailySave;
    const dailySize = dailyBoardSize(today);
    const dailyStarted = save !== null && save.date === today;
    const size = this.state.practiceSize;
    const stash = this.state.practiceStash;
    const canResumePractice = stash !== null && stash.puzzle.boardSize === size;

    return (
      <div className="PlayChoose">
        <section className="PlayCard" aria-labelledby="play-daily-heading">
          <h2 id="play-daily-heading" className="PlayCardTitle">Daily</h2>
          <p className="PlayCardMeta">
            {today} · {dailySize}×{dailySize}
          </p>
          <p className="PlayCardStatus">{this.dailyStatus(today)}</p>
          <div className="PlayCardActions">
            <button
              type="button"
              className="PlayButton PlayButtonPrimary"
              data-testid="play-daily-button"
              onClick={() => this.chooseDaily()}
            >
              {!dailyStarted ? 'Play daily' : save!.won ? 'View daily' : 'Resume daily'}
            </button>
          </div>
        </section>

        <section className="PlayCard" aria-labelledby="play-practice-heading">
          <h2 id="play-practice-heading" className="PlayCardTitle">Practice</h2>
          <label className="PlaySize">
            <span className="PlaySizeLabel">
              Board size: {size}×{size}
            </span>
            <input
              type="range"
              min={MIN_PRACTICE_SIZE}
              max={MAX_PRACTICE_SIZE}
              value={size}
              onChange={(event) => this.changePracticeSize(event)}
            />
          </label>
          <p className="PlayCardStatus">{canResumePractice ? 'In progress' : 'A new puzzle every time'}</p>
          <div className="PlayCardActions">
            <button
              type="button"
              className="PlayButton PlayButtonPrimary"
              data-testid="play-practice-button"
              onClick={() => this.choosePractice()}
            >
              {canResumePractice ? 'Resume practice' : 'Play practice'}
            </button>
            <button
              type="button"
              className="PlayButton"
              data-testid="play-new-puzzle"
              onClick={() => this.newPractice()}
            >
              New puzzle
            </button>
          </div>
        </section>
      </div>
    );
  }

  renderHeader(game: Game) {
    const size = game.puzzle.boardSize;
    const title = game.dailyDate === null ? `Practice ${size}×${size}` : `Daily ${game.dailyDate}`;

    if (this.state.lifecycle === PlayLifecycle.Won) {
      const celebrate = this.celebrate;
      return (
        <div
          className={'PlayWonPanel' + (celebrate ? ' isCelebrating' : '')}
          data-testid="play-won"
          role="status"
          aria-live="polite"
        >
          {celebrate ? (
            <span className="PlayConfetti" aria-hidden="true">
              {Array.from({ length: CONFETTI_PIECES }, (_, i) => (
                <span key={i} style={{ '--i': i } as React.CSSProperties} />
              ))}
            </span>
          ) : null}
          <strong className="PlayWonTitle">Solved!</strong>
          <span className="PlayWonMeta">
            {title} in {formatElapsed(game.elapsed)} · {formatHints(game.hints)}
          </span>
        </div>
      );
    }

    return (
      <div className="PlayHeader">
        <span className="PlayHeaderTitle">{title}</span>
        <span className="PlayTimer" data-testid="play-timer" role="timer">
          {formatElapsed(game.elapsed)}
        </span>
        <span className="PlayHintCount">{formatHints(game.hints)}</span>
      </div>
    );
  }

  renderRestart() {
    if (!this.state.confirmingRestart) {
      return (
        <button
          type="button"
          className="PlayButton"
          data-testid="play-restart"
          onMouseDown={keepCellFocus}
          onClick={() => this.setState({ confirmingRestart: true })}
        >
          Restart
        </button>
      );
    }

    return (
      <span className="PlayConfirm" role="group" aria-label="Confirm restart">
        Restart?
        <button
          type="button"
          className="PlayButton PlayButtonDanger"
          data-testid="play-restart-yes"
          onClick={() => this.restart()}
        >
          Yes
        </button>
        <button
          type="button"
          className="PlayButton"
          data-testid="play-restart-no"
          onClick={() => this.setState({ confirmingRestart: false })}
        >
          No
        </button>
      </span>
    );
  }

  renderControls(game: Game) {
    const digits = Array.from({ length: game.puzzle.boardSize }, (_, i) => i + 1);

    return (
      <div className="PlayControls">
        <div className="PlayNumpad" role="group" aria-label="Numbers">
          {digits.map((digit) => (
            <button
              key={digit}
              type="button"
              className="PlayButton PlayNumpadKey"
              data-testid={'play-numpad-' + digit}
              onMouseDown={keepCellFocus}
              onClick={() => this.enterDigit(digit)}
            >
              {digit}
            </button>
          ))}
        </div>

        <div className="PlayTools">
          <button
            type="button"
            className="PlayButton PlayButtonPrimary"
            data-testid="play-check"
            onMouseDown={keepCellFocus}
            onClick={() => this.check()}
          >
            Check
          </button>
          <button
            type="button"
            className="PlayButton"
            data-testid="play-pencil-toggle"
            aria-pressed={this.state.pencilMode}
            onMouseDown={keepCellFocus}
            onClick={() => this.togglePencilMode()}
          >
            Pencil {this.state.pencilMode ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="PlayButton"
            data-testid="play-undo"
            onMouseDown={keepCellFocus}
            onClick={() => this.undo()}
          >
            Undo
          </button>
          <button
            type="button"
            className="PlayButton"
            data-testid="play-redo"
            onMouseDown={keepCellFocus}
            onClick={() => this.redo()}
          >
            Redo
          </button>
          <button
            type="button"
            className="PlayButton"
            data-testid="play-hint"
            onMouseDown={keepCellFocus}
            onClick={() => this.hint()}
          >
            Hint
          </button>
          {this.renderRestart()}
          <button
            type="button"
            className="PlayButton"
            data-testid="play-back"
            onClick={() => this.backToChoosing()}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  renderWonActions() {
    return (
      <div className="PlayTools PlayWonActions">
        <button
          type="button"
          className="PlayButton PlayButtonPrimary"
          data-testid="play-share"
          onClick={() => this.share()}
        >
          Share
        </button>
        <button
          type="button"
          className="PlayButton"
          data-testid="play-next-practice"
          onClick={() => this.newPractice()}
        >
          Next practice
        </button>
        <button
          type="button"
          className="PlayButton"
          data-testid="play-back-to-choosing"
          onClick={() => this.backToChoosing()}
        >
          Back to choosing
        </button>
      </div>
    );
  }

  renderGame(game: Game) {
    const won = this.state.lifecycle === PlayLifecycle.Won;

    return (
      <div className="PlayGame">
        {this.renderHeader(game)}

        <div className={'PlayBoardFrame' + (won && this.celebrate ? ' isCelebrating' : '')}>
          <PlayBoard
            puzzle={game.puzzle}
            values={game.values}
            pencils={game.pencils}
            locked={game.locked}
            wrong={this.state.wrong}
            focused={this.state.focused}
            pencilMode={this.state.pencilMode}
            checkRound={this.state.checkRound}
            onFocusCell={this.focusCell}
          />
        </div>

        {won ? this.renderWonActions() : this.renderControls(game)}

        <p className="PlayStatus" data-testid="play-status" role="status">
          {this.state.status}
        </p>
      </div>
    );
  }

  render() {
    const { game, lifecycle } = this.state;

    return (
      <div className="PlayApp" data-play-state={lifecycle}>
        {lifecycle === PlayLifecycle.Choosing || game === null ? this.renderChoosing() : this.renderGame(game)}
      </div>
    );
  }
}

export default PlayApp;
