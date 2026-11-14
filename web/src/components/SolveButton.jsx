import React from 'react';
import Button from 'react-pushy-buttons';
import './SolveButton.css';
import './pushy-buttons.css'
import classNames from 'classnames';

let cx = classNames;

class SolveButton extends React.Component {
  render() {
    let className = cx({
      ButtonWrapper: true,
      ButtonWrapperDisabled: !this.props.canSubmit,
    });

    return (
      <div className={className}>
        <Button
          size="lg"
          color="green"
          onClick={this.props.onSubmit}
          disabled={!this.props.canSubmit}
        >
          Solve!
        </Button>
      </div>
    );
  }
}

export default SolveButton;
