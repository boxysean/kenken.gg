import React from 'react';
import _ from 'lodash';
import Button from 'react-pushy-buttons';

import './Modal.css';

class Modal extends React.Component {
  SHORTCUTS = ['+', '-', 'x', '/', '*'];

  handleChange({ target }) {
    // Handle shortcut
    var foundShortcut = false;
    var that = this;

    _.forEach(target.value, function(ch) {
      var shortcutIndex = that.SHORTCUTS.indexOf(ch);

      if (shortcutIndex >= 0) {
        var operator = that.SHORTCUTS[shortcutIndex];
        that.handleButton(null, operator);
        foundShortcut = true;
      }
    });

    if (!foundShortcut) {
      this.setState({
        value: target.value,
      });
    }
  }

  handleButton(event, operator) {
    this.props.processModal(this.state.value, operator);

    this.setState({
      value: null,
    });
  }

  close(event) {
    this.props.closeModal();
  }

  render() {
    return (
      <div className="Modal ModalOn">
        <div className="ModalContent">
          <button type="button" onClick={(event) => this.close(event)} className="Close" aria-label="Close">&times;</button>
          <div>
            <input
              className="ModalInput"
              aria-label="Cage value"
              inputMode="numeric"
              autoFocus
              onChange={event => this.handleChange(event)}>
            </input>
          </div>
          <div className="ModalButtons">
            <Button aria-label="Add" onClick={(event) => this.handleButton(event, "+")}>+</Button>
            <Button aria-label="Subtract" onClick={(event) => this.handleButton(event, "-")}>-</Button>
            <Button aria-label="Multiply" onClick={(event) => this.handleButton(event, "x")}>x</Button>
            <Button aria-label="Divide" onClick={(event) => this.handleButton(event, "/")}>/</Button>
            <Button aria-label="No operator" onClick={(event) => this.handleButton(event, "")}>&nbsp;</Button>
          </div>
        </div>
      </div>
    );
  }
}

export default Modal;
