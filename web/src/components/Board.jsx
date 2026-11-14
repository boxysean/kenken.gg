import React from 'react';
import _ from 'lodash';

import Cell from './Cell';
import './Board.css';
import SolveLifecycle from '../SolveLifecycle';

class Board extends React.Component {
  getCells(selectedCells) {
    var cells = [];

    var constraintsUsed = new Set();

    for (var i = 0; i < this.props.size; i++) {
      for (var j = 0; j < this.props.size; j++) {
        var cellIndex = i * this.props.size + j;

        var c = this.props.constraints[cellIndex];

        var borders = {
          left: (cellIndex % this.props.size) - 1 < 0 || (!_.isEqual(this.props.constraints[cellIndex - 1], c)),
          right: (cellIndex % this.props.size) + 1 >= this.props.size || (!_.isEqual(this.props.constraints[cellIndex + 1], c)),
          top: cellIndex - this.props.size < 0 || (!_.isEqual(this.props.constraints[cellIndex - this.props.size], c)),
          bottom: cellIndex + this.props.size >= this.props.size * this.props.size || (!_.isEqual(this.props.constraints[cellIndex + this.props.size], c)),
        };

        var cellDisplay;

        if (this.props.answers[cellIndex]) {
          cellDisplay = this.props.answers[cellIndex];
        } else if (c && !constraintsUsed.has(c.name)) {
          cellDisplay = c.formula;
          constraintsUsed.add(c.name);
        } else {
          cellDisplay = '';
        }

        const element = <Cell
          cellIndex={cellIndex}
          processBegin={this.props.processBegin}
          processHover={this.props.processHover}
          isSelected={selectedCells.has(cellIndex)}
          constraint={c}
          display={cellDisplay}
          borders={borders}
        ></Cell>;
        cells.push(element);
      }
    }

    return cells;
  }

  render() {
    var boardContainerStyle = {
      '--board-size': this.props.size,
    };

    if ([SolveLifecycle.Inputting, SolveLifecycle.Failure].indexOf(this.props.solveLifecycle) >= 0) {
      boardContainerStyle['cursor'] = 'pointer';
    }

    var gridColumnTemplateStyle = {
      'gridTemplateColumns': `repeat(${this.props.size}, minmax(0, 1fr))`
    };

    return (
      <div className="BoardContainer" style={boardContainerStyle}>
        <div className="Board" style={gridColumnTemplateStyle}>
          {this.getCells(this.props.selectedCells).map(cell => cell)}
        </div>

        {this.props.children}
      </div>
    );
  }
}

export default Board;
