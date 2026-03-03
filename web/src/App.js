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
import { solveFromAPI } from './solver';

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

    this.TOOLTIP_COLOR[SolveLifecycle.Success] = "rgba(0, 255, 0, 0.3)";
    this.TOOLTIP_COLOR[SolveLifecycle.Failure] = "rgba(255, 0, 0, 0.3)";
    this.TOOLTIP_COLOR[SolveLifecycle.Inputting] = "rgba(0, 0, 0, 0.3)";

    this.state = {
      boardSize: 5,
      showTooltip: true,
      debugOverlay: window.location.href.includes("debug=true"),
      ...this.DEFAULT_STATE,
    };
  }

  componentDidMount() {
    document.addEventListener("keydown", this.escFunction.bind(this), false);
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
    console.log(this.state.cellToConstraint);
    console.log(this.state.constraintCharToFormula);

    var constraintString = _.uniq(
      Object.values(this.state.cellToConstraint)
        .map((constraint) => constraint.name + "=" + constraint.formula)
      ).join(" ");

    var boardStrings = _.chunk(
      Object.values(this.state.cellToConstraint).map((constraint) => constraint.name),
      this.state.boardSize
    ).map((chunk) => chunk.join(" "));

    console.log("SUBMITTING");
    console.log(constraintString);
    console.log(boardStrings);

    try {
      var boardOutput = solveFromAPI(boardStrings, constraintString);
      console.log(boardOutput);
      this.setState({
        answers: boardOutput.split(/\s/),
        solveLifecycle: SolveLifecycle.Success,
        showTooltip: true,
      });
    } catch (error) {
      this.setState({
        solveLifecycle: SolveLifecycle.Failure,
        showTooltip: true,
      });
      console.log(error);
    }
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

  canSubmit() {
    return this.isBoardFull() && [SolveLifecycle.Failure, SolveLifecycle.Inputting].indexOf(this.state.solveLifecycle) >= 0;
  }

  render() {
    return (
      <div
        className="App"
        onMouseUp={(event) => this.processRelease(event)}
        onTouchMove={(event) => this.processTouchMove(event)}
        onTouchEnd={(event) => this.processRelease(event)}
      >
        <Helmet>
          <title>kenken.gg</title>
        </Helmet>

        <h1 className="Title">kenken.gg</h1>

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

        <p><a href="/about.html">About</a></p>
      </div>
    );
  }
}

export default App;
