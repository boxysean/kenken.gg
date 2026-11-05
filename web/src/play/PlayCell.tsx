import React from 'react';
import classNames from 'classnames';
import './PlayCell.css';

const cx = classNames;
const PENCIL_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export interface CellBorders {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

interface PlayCellProps {
  index: number;
  value: number;
  pencils: number[];
  locked: boolean;
  wrong: boolean;
  focused: boolean;
  tabbable: boolean;
  borders: CellBorders;
  label: string;
  ariaLabel: string;
  onFocusClick: (index: number) => void;
}

class PlayCell extends React.Component<PlayCellProps> {
  element = React.createRef<HTMLDivElement>();

  // Arrow keys move the focused cell in state; follow it with DOM focus, but
  // only when focus is already in the grid, so a numpad tap or the timer
  // never pulls focus off a button the player is using.
  componentDidUpdate(prevProps: PlayCellProps) {
    const element = this.element.current;
    if (!element || !this.props.focused || prevProps.focused) return;
    const active = document.activeElement;
    if (active && active !== element && active.getAttribute('role') === 'gridcell') {
      element.focus();
    }
  }

  renderContent() {
    if (this.props.value > 0) {
      return <span className="PlayCellValue">{this.props.value}</span>;
    }
    if (this.props.pencils.length > 0) {
      return (
        <span className="PlayCellPencils" aria-hidden="true">
          {PENCIL_SLOTS.map((digit) => (
            <span key={digit}>{this.props.pencils.indexOf(digit) >= 0 ? digit : ''}</span>
          ))}
        </span>
      );
    }
    return null;
  }

  render() {
    const className = cx({
      PlayCell: true,
      isFocused: this.props.focused,
      isLocked: this.props.locked,
      isWrong: this.props.wrong,
      borderLeft: this.props.borders.left,
      borderRight: this.props.borders.right,
      borderTop: this.props.borders.top,
      borderBottom: this.props.borders.bottom,
    });

    return (
      <div
        ref={this.element}
        className={className}
        role="gridcell"
        tabIndex={this.props.tabbable ? 0 : -1}
        aria-label={this.props.ariaLabel}
        aria-readonly={this.props.locked}
        aria-invalid={this.props.wrong}
        aria-selected={this.props.focused}
        data-testid={'play-cell-' + this.props.index}
        data-locked={this.props.locked ? 'true' : 'false'}
        onClick={() => this.props.onFocusClick(this.props.index)}
        onFocus={() => this.props.onFocusClick(this.props.index)}
      >
        {this.props.label !== '' && <span className="PlayCellLabel" aria-hidden="true">{this.props.label}</span>}
        {this.renderContent()}
      </div>
    );
  }
}

export default PlayCell;
