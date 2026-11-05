import React from 'react';
import { parseBoard, parseConstraintLine } from '../solver';
import type { Operator } from '../solver';
import type { PlayPuzzle } from './types';
import PlayCell from './PlayCell';
import type { CellBorders } from './PlayCell';
import './PlayBoard.css';

// The solver's ASCII operators, shown the way the puzzle is printed.
const OPERATOR_SYMBOLS: Record<Operator, string> = {
  '+': '+',
  '-': '−',
  'x': '×',
  '/': '÷',
  '': '',
};

interface PlayBoardProps {
  puzzle: PlayPuzzle;
  values: number[];
  pencils: number[][];
  locked: boolean[];
  wrong: boolean[];
  focused: number | null;
  pencilMode: boolean;
  checkRound: number;
  onFocusCell: (cellIndex: number) => void;
}

interface CageLayout {
  letters: string[]; // cage letter per cell, row-major
  formulas: Record<string, string>; // cage letter -> "12+"
}

class PlayBoard extends React.Component<PlayBoardProps> {
  // Parsing is cheap but runs on every keystroke otherwise; the puzzle object
  // only changes when a new game starts.
  layoutFor: PlayPuzzle | null = null;
  layout: CageLayout = { letters: [], formulas: {} };

  getLayout(): CageLayout {
    if (this.layoutFor !== this.props.puzzle) {
      const { boardStrings, constraintString } = this.props.puzzle;
      const formulas: Record<string, string> = {};
      parseConstraintLine(constraintString).forEach((constraint) => {
        formulas[constraint.name] = constraint.value + OPERATOR_SYMBOLS[constraint.operator];
      });
      this.layout = { letters: parseBoard(boardStrings).flat(), formulas };
      this.layoutFor = this.props.puzzle;
    }
    return this.layout;
  }

  getBorders(letters: string[], cellIndex: number): CellBorders {
    const size = this.props.puzzle.boardSize;
    const letter = letters[cellIndex];
    const column = cellIndex % size;
    return {
      left: column === 0 || letters[cellIndex - 1] !== letter,
      right: column === size - 1 || letters[cellIndex + 1] !== letter,
      top: cellIndex - size < 0 || letters[cellIndex - size] !== letter,
      bottom: cellIndex + size >= size * size || letters[cellIndex + size] !== letter,
    };
  }

  getAriaLabel(cellIndex: number, formula: string): string {
    const size = this.props.puzzle.boardSize;
    const parts = [`row ${Math.floor(cellIndex / size) + 1}`, `column ${(cellIndex % size) + 1}`, `cage ${formula}`];
    const value = this.props.values[cellIndex];
    const pencils = this.props.pencils[cellIndex];
    if (value > 0) {
      parts.push(`value ${value}`);
    } else if (pencils.length > 0) {
      parts.push(`pencil marks ${[...pencils].sort().join(' ')}`);
    } else {
      parts.push('empty');
    }
    if (this.props.wrong[cellIndex]) parts.push('wrong');
    if (this.props.locked[cellIndex]) parts.push('locked');
    return parts.join(', ');
  }

  getRows() {
    const size = this.props.puzzle.boardSize;
    const { letters, formulas } = this.getLayout();
    const labelled = new Set<string>();
    // With nothing focused, the first cell is the grid's single tab stop.
    const tabStop = this.props.focused === null ? 0 : this.props.focused;
    const rows = [];

    for (let row = 0; row < size; row++) {
      const cells = [];
      for (let column = 0; column < size; column++) {
        const cellIndex = row * size + column;
        const letter = letters[cellIndex];
        const formula = formulas[letter] || '';
        // Cells are visited in row-major order, so the first one seen in a
        // cage is its lowest index: that cell carries the label.
        const label = labelled.has(letter) ? '' : formula;
        labelled.add(letter);

        cells.push(
          <PlayCell
            key={cellIndex}
            index={cellIndex}
            value={this.props.values[cellIndex]}
            pencils={this.props.pencils[cellIndex]}
            locked={this.props.locked[cellIndex]}
            wrong={this.props.wrong[cellIndex]}
            focused={this.props.focused === cellIndex}
            tabbable={tabStop === cellIndex}
            borders={this.getBorders(letters, cellIndex)}
            label={label}
            ariaLabel={this.getAriaLabel(cellIndex, formula)}
            onFocusClick={this.props.onFocusCell}
          />
        );
      }
      rows.push(<div key={row} className="PlayBoardRow" role="row">{cells}</div>);
    }

    return rows;
  }

  render() {
    const size = this.props.puzzle.boardSize;
    const containerStyle = { '--board-size': size } as React.CSSProperties;
    const gridStyle = { gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` };

    return (
      <div
        className="PlayBoard"
        style={containerStyle}
        role="grid"
        aria-label="KenKen board"
        data-testid="play-board"
        data-seed={this.props.puzzle.seed}
        data-size={size}
        data-pencil-mode={this.props.pencilMode ? 'true' : 'false'}
        data-check-round={this.props.checkRound % 2}
      >
        <div className="PlayBoardGrid" role="presentation" style={gridStyle}>
          {this.getRows()}
        </div>
      </div>
    );
  }
}

export default PlayBoard;
