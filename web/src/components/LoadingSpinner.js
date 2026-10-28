import React from 'react';
import { Spinner } from "react-loading-io";

import './LoadingSpinner.css';

class LoadingSpinner extends React.Component {
  render() {
    var loadingDisplayStyle = {};

    if (!this.props.showSpinner) {
      loadingDisplayStyle['display'] = 'none';
    }

    return (
      <div className="LoadingSpinner"  style={loadingDisplayStyle}>
        <Spinner color="var(--accent, #4338ca)" size={100} />
      </div>
    );
  }
}

export default LoadingSpinner;
