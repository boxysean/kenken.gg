import React from 'react';
import ReactDOM from 'react-dom';
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
