import React from 'react';
import './Cell.css';
import classNames from 'classnames';

let cx = classNames;


class Cell extends React.Component {
  setConstraint(value, operator) {
    this.setState({
      constraint: value + operator,
    })
  }

  render() {
    console.log(this.props.constraint);

    let className = cx({
      Cell: true,
      isSelected: this.props.isSelected,
      isGreyedOut: this.props.constraint != null,
      borderLeft: this.props.borders.left,
      borderRight: this.props.borders.right,
      borderTop: this.props.borders.top,
      borderBottom: this.props.borders.bottom,
    });

    return (
      <div className={className}
        onMouseMove={(event) => this.props.processHover(this.props.cellIndex)}
        onMouseDown={(event) => this.props.processBegin(this.props.cellIndex)}
        onTouchStart={(event) => this.props.processBegin(this.props.cellIndex)}
        id={"cell-" + this.props.cellIndex}
      >
        {this.props.display}
      </div>
    );
  }
}

export default Cell;
