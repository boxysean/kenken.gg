import React from 'react';
import Button from 'react-pushy-buttons';

import './ClearButton.css';

class ClearButton extends React.Component {
  render() {
    return (
      <div className="ButtonWrapper">
        <Button
          size="lg"
          color="blue"
          onClick={this.props.onSubmit}
        >
          Clear
        </Button>
      </div>
    );
  }
}

export default ClearButton;
