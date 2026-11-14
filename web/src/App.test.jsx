import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import App from './App';
import SolveLifecycle from './SolveLifecycle';

it('renders without crashing', () => {
  const div = document.createElement('div');
  ReactDOM.render(<App />, div);
  ReactDOM.unmountComponentAtNode(div);
});

it('opens an empty board for hand-labelling, with no board to export until cages are drawn', () => {
  const div = document.createElement('div');
  const app = ReactDOM.render(<App />, div);
  app.loadBoard({ boardSize: 3, boardStrings: ['a a b', 'c a b', 'c d d'], constraintString: 'a=6x b=1- c=5+ d=3/' });
  expect(app.currentBoard()).not.toBeNull();

  app.loadEmptyBoard(6);
  expect(app.state.boardSize).toBe(6);
  expect(app.state.cellToConstraint).toEqual({});
  expect(app.state.constraintCharToFormula).toEqual({});
  expect(app.state.answers).toEqual([]);
  expect(app.state.solveLifecycle).toBe(SolveLifecycle.Inputting);
  expect(app.currentBoard()).toBeNull();
  ReactDOM.unmountComponentAtNode(div);
});

it('renders the export control in the solver view before any photo, enabled once a cage is drawn', () => {
  const div = document.createElement('div');
  // React 16 listens for events on the document, so the container must be attached.
  document.body.appendChild(div);
  let app;
  act(() => {
    app = ReactDOM.render(<App />, div);
  });
  act(() => app.changeMode('solver'));

  const exportButton = () => div.querySelector('[data-testid="export-button"]');
  const reason = () => div.querySelector('[data-testid="export-disabled-reason"]');
  expect(div.querySelector('[data-testid="label-image"]')).toBeNull();
  expect(exportButton()).not.toBeNull();
  expect(exportButton().textContent).toBe('Export JSON');
  expect(exportButton().disabled).toBe(true);
  expect(reason().textContent).toBe('Draw at least one cage on the board to export it.');
  // No photo, so no style tag.
  expect(div.querySelector('[data-testid="export-style"]')).toBeNull();

  // One cage, drawn as the editor does it: select a cell, then confirm the modal.
  act(() => app.processBegin(0));
  act(() => app.processRelease(0));
  act(() => app.processModal('3', ''));
  expect(app.currentBoard()).not.toBeNull();
  expect(exportButton().disabled).toBe(false);
  expect(reason()).toBeNull();

  act(() => {
    ReactDOM.unmountComponentAtNode(div);
  });
  div.remove();
});

it('keeps the photo corners for the export, and reset() clears them', () => {
  const div = document.createElement('div');
  let app;
  act(() => {
    app = ReactDOM.render(<App />, div);
  });
  act(() => app.changeMode('solver'));
  expect(app.state.corners).toBeNull();

  const corners = { tl: { x: 1, y: 2 }, tr: { x: 3, y: 2 }, br: { x: 3, y: 4 }, bl: { x: 1, y: 4 } };
  act(() => app.setCorners(corners));
  expect(app.state.corners).toEqual(corners);
  act(() => app.loadBoard({ boardSize: 3, boardStrings: ['a a b', 'c a b', 'c d d'], constraintString: 'a=6x b=1- c=5+ d=3/' }));
  // The style tag input only appears with corners.
  expect(div.querySelector('[data-testid="export-style"]')).not.toBeNull();

  act(() => app.reset());
  expect(app.state.corners).toBeNull();
  act(() => {
    ReactDOM.unmountComponentAtNode(div);
  });
});
