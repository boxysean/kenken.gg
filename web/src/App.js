import React from 'react';
import { Helmet } from 'react-helmet';
import _ from 'lodash';
import './App.css';

import Board from './components/Board';
import BoardSlider from './components/BoardSlider';
import ClearButton from './components/ClearButton';
import LoadingSpinner from './components/LoadingSpinner';
import Modal from './components/Modal';
import SolveButton from './components/SolveButton';
import SolveLifecycle from './SolveLifecycle';
import Tooltip from './components/Tooltip';
import { solveInWorker } from './solver/workerClient';
import PlayApp from './play/PlayApp';
import ScanPanel from './ocr/ScanPanel';
import { loadPrefs, savePrefs } from './play/persistence';
import { loadStoredTheme, resolveTheme, saveTheme } from './theme';

import update from 'immutability-helper';

class App extends React.Component {
  DEFAULT_STATE = {
    modal: false,
    selected: new Set(),
    selecting: false,
    cellToConstraint: {},
    constraintCharToFormula: {},
    answers: [],
    solveLifecycle: SolveLifecycle.Inputting,
  };

  TOOLTIP_MESSAGE = {};  // Why can't I set an object key with a dot?
  TOOLTIP_COLOR = {};

  constructor(props) {
    super(props);

    this.TOOLTIP_MESSAGE[SolveLifecycle.Success] = "Success!";
    this.TOOLTIP_MESSAGE[SolveLifecycle.Failure] = "Failed solving! :-(";
    this.TOOLTIP_MESSAGE[SolveLifecycle.Inputting] = "Draw your KenKen board here!";

    this.TOOLTIP_COLOR[SolveLifecycle.Success] = "rgba(220, 252, 231, 0.95)";
    this.TOOLTIP_COLOR[SolveLifecycle.Failure] = "rgba(254, 226, 226, 0.95)";
    this.TOOLTIP_COLOR[SolveLifecycle.Inputting] = "rgba(226, 232, 240, 0.95)";

    this.state = {
      boardSize: 5,
      showTooltip: true,
      debugOverlay: window.location.href.includes("debug=true"),
      mode: loadPrefs().mode,
      // Not in DEFAULT_STATE, so reset() leaves the theme alone.
      theme: resolveTheme(window.location.search, loadStoredTheme()),
      ...this.DEFAULT_STATE,
    };
  }

  componentDidMount() {
    document.addEventListener("keydown", this.escFunction.bind(this), false);
    saveTheme(this.state.theme);
  }

  reset() {
    this.setState(this.DEFAULT_STATE);
  }

  processBegin(cellIndex) {
    if ([SolveLifecycle.Inputting, SolveLifecycle.Failure].indexOf(this.state.solveLifecycle) >= 0) {
      this.setState({
        selected: new Set([cellIndex]),
        selecting: true,
      });
    }
  }

  processHover(cellIndex) {
    if (this.state.selecting) {
      this.setState({
        selected: this.state.selected.add(cellIndex),
      });
    }
  }

  processRelease(cellIndex) {
    if (!this.state.modal && this.state.selecting) {
      this.setState({
        modal: true,
      });
    }
  }

  resetModal() {
    this.setState({
      modal: false,
      selected: new Set(),
      selecting: false,
    });
  }

  escFunction(event) {
    if (event.keyCode === 27) {
      this.resetModal();
    }
  }

  processModal(value, operator) {
    var nextConstraintChar = String.fromCharCode(1 +
      Object.values(this.state.cellToConstraint)
        .map((constraint) => constraint.name.charCodeAt(0))
        .reduce(
          (accumulator, constraintName) => Math.max(accumulator, constraintName),
          'a'.charCodeAt(0) - 1
        )
    );

    var formula = value + operator;

    this.setState({
      cellToConstraint: update(
        this.state.cellToConstraint,
        Array.from(this.state.selected)
          .reduce(function(obj, x) {
            if (!isNaN(x)) {  // There's a bug in mobile Firefox, where x can be NaN
              obj[x] = {$set: {"name": nextConstraintChar, "formula": formula}};
            }

            return obj;
          }, {})
      ),
      constraintCharToFormula: update(
        this.state.constraintCharToFormula,
        {[nextConstraintChar]: {$set: formula}}
      )
    });

    this.resetModal();
  }

  submit() {
    var constraintString = _.uniq(
      Object.values(this.state.cellToConstraint)
        .map((constraint) => constraint.name + "=" + constraint.formula)
      ).join(" ");

    var boardStrings = _.chunk(
      Object.values(this.state.cellToConstraint).map((constraint) => constraint.name),
      this.state.boardSize
    ).map((chunk) => chunk.join(" "));

    this.setState({
      solveLifecycle: SolveLifecycle.Pending,
      showTooltip: false,
    })

    // The solver runs in a Web Worker in the page itself; no network call is made.
    solveInWorker(boardStrings, constraintString)
      .then((data) => {
        if (!data.solved || data.boardOutput === null) {
          this.setState({
            solveLifecycle: SolveLifecycle.Failure,
            showTooltip: true,
          });
          return;
        }
        this.setState({
          answers: data.boardOutput.split(/\s/),
          solveLifecycle: SolveLifecycle.Success,
          showTooltip: true,
        });
      })
      .catch(error => {
        this.setState({
          solveLifecycle: SolveLifecycle.Failure,
          showTooltip: true,
        });
        console.error(error);
      });
  }

  changeBoardSize(size) {
    this.setState({
      boardSize: size,
    });

    this.reset();
  }

  processTouchMove(event) {
    // This handles touches. The onTouchMove handler is not called by the cells over which the pointer is on, only the cell it originated from.
    const touch = event.targetTouches[0];
    var cell = document.elementFromPoint(touch.clientX, touch.clientY);
    var id = parseInt(cell.id.replace("cell-", ""));
    this.processHover(id);
  }

  isBoardFull() {
    return Object.keys(this.state.cellToConstraint).length === this.state.boardSize * this.state.boardSize;
  }

  touchTooltip() {
    this.setState({
      showTooltip: false,
    });
  }

  changeMode(mode) {
    this.setState({
      mode: mode,
    });

    savePrefs({ ...loadPrefs(), mode: mode });
  }

  canSubmit() {
    return this.isBoardFull() && [SolveLifecycle.Failure, SolveLifecycle.Inputting].indexOf(this.state.solveLifecycle) >= 0;
  }

  // Replaces the editor's board with a scanned one (a BoardConversion: the same
  // strings submit() builds). The board is back in the Inputting state so any
  // misread cage or clue can be corrected by hand before solving.
  loadBoard(conversion) {
    const boardSize = conversion.boardSize;

    const constraintCharToFormula = {};
    conversion.constraintString.split(" ").filter((token) => token !== "").forEach((token) => {
      const match = /^([^=]*)=([0-9]+)([+\-x/]?)$/.exec(token);
      if (match) {
        constraintCharToFormula[match[1]] = match[2] + match[3];
      }
    });

    const cellToConstraint = {};
    conversion.boardStrings.forEach((row, rowIndex) => {
      row.split(" ").forEach((letter, column) => {
        // A cage whose clue was not read gets an empty formula: it still draws
        // its borders, and the user fills the clue in.
        cellToConstraint[rowIndex * boardSize + column] = {
          name: letter,
          formula: constraintCharToFormula[letter] || "",
        };
      });
    });

    this.setState({
      boardSize: boardSize,
      cellToConstraint: cellToConstraint,
      constraintCharToFormula: constraintCharToFormula,
      answers: [],
      solveLifecycle: SolveLifecycle.Inputting,
      showTooltip: false,
      selected: new Set(),
      selecting: false,
      modal: false,
    });
  }

  // The editor's board as a ScannedBoard, for exporting the user's corrections
  // as a label; null while the board is empty. Unset cells become empty tokens,
  // which validateLabel reports, so a half-drawn board can't be exported.
  currentBoard() {
    const boardSize = this.state.boardSize;
    const cellToConstraint = this.state.cellToConstraint;
    if (Object.keys(cellToConstraint).length === 0) {
      return null;
    }

    const cageLetters = _.range(boardSize).map((rowIndex) =>
      _.range(boardSize).map((column) => {
        const constraint = cellToConstraint[rowIndex * boardSize + column];
        return constraint ? constraint.name : "";
      }).join(" ")
    );

    const clues = {};
    Object.values(cellToConstraint).forEach((constraint) => {
      const match = /^([0-9]+)([+\-x/]?)$/.exec(constraint.formula);
      if (match && !(constraint.name in clues)) {
        clues[constraint.name] = { target: parseInt(match[1], 10), operator: match[2] };
      }
    });

    return { boardSize: boardSize, cageLetters: cageLetters, clues: clues };
  }

  renderSolver() {
    return (
      <>
        <BoardSlider
          boardSize={this.state.boardSize}
          onChange={this.changeBoardSize.bind(this)}
        ></BoardSlider>

        {this.state.modal &&
          <Modal
            processModal={this.processModal.bind(this)}
            closeModal={this.resetModal.bind(this)}
          ></Modal>
        }

        <Board
          size={this.state.boardSize}
          processHover={this.processHover.bind(this)}
          processBegin={this.processBegin.bind(this)}
          selectedCells={this.state.selected}
          constraints={this.state.cellToConstraint}
          answers={this.state.answers}
          solveLifecycle={this.state.solveLifecycle}
        >
          <Tooltip
            touchTooltip={this.touchTooltip.bind(this)}
            showTooltip={this.state.showTooltip}
            color={this.TOOLTIP_COLOR[this.state.solveLifecycle]}
          >
            <p>{this.TOOLTIP_MESSAGE[this.state.solveLifecycle]}</p>
          </Tooltip>

          <LoadingSpinner showSpinner={this.state.solveLifecycle === SolveLifecycle.Pending} />
        </Board>

        {this.state.solveLifecycle !== SolveLifecycle.Success &&
          <SolveButton
            onSubmit={this.submit.bind(this)}
            canSubmit={this.canSubmit()}
          ></SolveButton>
        }

        {this.state.solveLifecycle === SolveLifecycle.Success &&
          <ClearButton
            onSubmit={this.reset.bind(this)}
          ></ClearButton>
        }

        <ScanPanel onLoadBoard={this.loadBoard.bind(this)} board={this.currentBoard()} />

        {this.state.debugOverlay &&
          <ul>
            <li>Can Submit? {this.canSubmit() ? "yes!" : "no"}</li>
            <li>State? {this.state.solveLifecycle}</li>
            <li>Board full? {this.isBoardFull() ? "yes!" : "no"}</li>
            <li>Board size? {this.state.boardSize}</li>
            <li>Board cells filled? {Object.keys(this.state.cellToConstraint).length}</li>
            <li>Board cells constraints? {JSON.stringify(this.state.cellToConstraint)}</li>
          </ul>
        }
      </>
    );
  }

  render() {
    return (
      <div
        className="App"
        data-theme={this.state.theme}
        data-solve-state={this.state.solveLifecycle}
        onMouseUp={(event) => this.processRelease(event)}
        onTouchMove={(event) => this.processTouchMove(event)}
        onTouchEnd={(event) => this.processRelease(event)}
      >
        <Helmet>
          <title>kenken.gg</title>
        </Helmet>

        <h1 className="Title">kenken.gg</h1>

        <div className="ModeToggle" role="group" aria-label="Mode">
          <button
            type="button"
            className="ModeToggleButton"
            data-testid="mode-toggle-solver"
            aria-pressed={this.state.mode === 'solver'}
            onClick={() => this.changeMode('solver')}
          >Solver</button>
          <button
            type="button"
            className="ModeToggleButton"
            data-testid="mode-toggle-play"
            aria-pressed={this.state.mode === 'play'}
            onClick={() => this.changeMode('play')}
          >Play</button>
        </div>

        {this.state.mode === 'play' ? <PlayApp /> : this.renderSolver()}

        <p><a href="/about.html">About</a></p>
      </div>
    );
  }
}

export default App;
