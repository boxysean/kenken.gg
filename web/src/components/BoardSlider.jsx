import React from 'react';
import './BoardSlider.css';

class BoardSlider extends React.Component {
  onChange({ target }) {
    this.props.onChange(parseInt(target.value));
  }

  render() {
    return (
      <div>
        <p>
          <input
            type="range"
            min="3"
            max="9"
            onChange={(event) => this.onChange(event)}
            value={this.props.boardSize}
          ></input>
          &nbsp;&nbsp;Board Size: {this.props.boardSize}
        </p>
      </div>
    );
  }
}

export default BoardSlider;
