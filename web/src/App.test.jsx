import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import App from './App';
import SolveLifecycle from './SolveLifecycle';
import { loadPrefs } from './play/persistence';

// changeMode writes both the prefs blob and the URL, so neither may leak into
// the next test.
afterEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
});

// React 16 listens for events on the document, so the container is attached.
function mount() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  let app;
  act(() => {
    app = ReactDOM.render(<App />, div);
  });
  return { div, app };
}

function unmount(div) {
  act(() => {
    ReactDOM.unmountComponentAtNode(div);
  });
  div.remove();
}

function solveButton(div) {
  return Array.from(div.querySelectorAll('button')).find((button) => button.textContent === 'Solve!') || null;
}

function tab(div, mode) {
  return div.querySelector(`[data-testid="mode-toggle-${mode}"]`);
}

function views(div) {
  return {
    board: div.querySelector('.Board') !== null,
    solve: solveButton(div) !== null,
    scan: div.querySelector('[data-testid="scan-input"]') !== null,
    label: div.querySelector('[data-testid="label-input"]') !== null,
    export: div.querySelector('[data-testid="export-button"]') !== null,
    play: div.querySelector('.PlayApp') !== null,
  };
}

describe('modes', () => {
  it('shows only the solver in Solver mode: no scan, label or export controls', () => {
    const { div, app } = mount();
    act(() => app.changeMode('solver'));
    expect(views(div)).toEqual({ board: true, solve: true, scan: false, label: false, export: false, play: false });
    unmount(div);
  });

  it('shows scan, label, the editor and export in Label mode, and no solve button', () => {
    const { div, app } = mount();
    act(() => app.changeMode('label'));
    expect(views(div)).toEqual({ board: true, solve: false, scan: true, label: true, export: true, play: false });

    // In the order the labelling flow runs: scan, label, editor, export.
    const panel = div.querySelector('[role="tabpanel"]');
    const order = ['scan-input', 'label-input', 'export-button'].map((id) => panel.querySelector(`[data-testid="${id}"]`));
    const board = panel.querySelector('.Board');
    const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(order[0], order[1])).toBe(true);
    expect(follows(order[1], board)).toBe(true);
    expect(follows(board, order[2])).toBe(true);
    unmount(div);
  });

  it('shows only PlayApp in Play mode', () => {
    const { div, app } = mount();
    act(() => app.changeMode('play'));
    expect(views(div)).toEqual({ board: false, solve: false, scan: false, label: false, export: false, play: true });
    unmount(div);
  });

  it('remembers the mode in prefs and writes it to the URL, keeping other parameters', () => {
    window.history.replaceState({}, '', '/?theme=editorial&debug=true');
    const historyLength = window.history.length;
    const { div, app } = mount();
    act(() => app.changeMode('label'));
    expect(loadPrefs().mode).toBe('label');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('mode')).toBe('label');
    expect(params.get('theme')).toBe('editorial');
    expect(params.get('debug')).toBe('true');
    // Replaced, not pushed.
    expect(window.history.length).toBe(historyLength);

    act(() => app.changeMode('play'));
    expect(loadPrefs().mode).toBe('play');
    expect(new URLSearchParams(window.location.search).get('mode')).toBe('play');
    unmount(div);
  });

  it('opens the Label tab from ?mode=label', () => {
    window.history.replaceState({}, '', '/?mode=label');
    const { div } = mount();
    expect(tab(div, 'label').getAttribute('aria-selected')).toBe('true');
    expect(tab(div, 'solver').getAttribute('aria-selected')).toBe('false');
    expect(div.querySelector('[role="tabpanel"]').getAttribute('aria-label')).toBe('Label');
    expect(views(div).label).toBe(true);
    unmount(div);
  });

  it('lets ?mode= win over the remembered mode', () => {
    const first = mount();
    act(() => first.app.changeMode('play'));
    unmount(first.div);

    window.history.replaceState({}, '', '/?mode=label');
    const { div } = mount();
    expect(tab(div, 'label').getAttribute('aria-selected')).toBe('true');
    unmount(div);
  });

  it('keeps the remembered mode across a reload with no parameter', () => {
    const first = mount();
    act(() => first.app.changeMode('label'));
    unmount(first.div);

    window.history.replaceState({}, '', '/');
    const { div } = mount();
    expect(tab(div, 'label').getAttribute('aria-selected')).toBe('true');
    unmount(div);
  });

  it('falls back to Solver for an unknown ?mode=', () => {
    window.history.replaceState({}, '', '/?mode=nonsense');
    const { div } = mount();
    expect(tab(div, 'solver').getAttribute('aria-selected')).toBe('true');
    expect(views(div)).toEqual({ board: true, solve: true, scan: false, label: false, export: false, play: false });
    unmount(div);
  });
});

describe('mode tabs', () => {
  function press(element, key) {
    act(() => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
    });
  }

  function selected(div) {
    return Array.from(div.querySelectorAll('[role="tab"]'))
      .filter((element) => element.getAttribute('aria-selected') === 'true')
      .map((element) => element.getAttribute('data-testid'));
  }

  it('is a tablist of three tabs controlling one tabpanel', () => {
    const { div, app } = mount();
    act(() => app.changeMode('solver'));
    const tablist = div.querySelector('[role="tablist"]');
    expect(tablist.getAttribute('aria-label')).toBe('Mode');
    expect(div.querySelector('[role="group"]')).toBeNull();

    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    expect(tabs.map((element) => element.textContent)).toEqual(['Solver', 'Play', 'Label']);
    expect(tabs.map((element) => element.getAttribute('data-testid'))).toEqual([
      'mode-toggle-solver', 'mode-toggle-play', 'mode-toggle-label',
    ]);
    expect(tabs.map((element) => element.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((element) => element.tabIndex)).toEqual([0, -1, -1]);
    tabs.forEach((element) => expect(element.hasAttribute('aria-pressed')).toBe(false));

    const panels = div.querySelectorAll('[role="tabpanel"]');
    expect(panels.length).toBe(1);
    expect(panels[0].getAttribute('aria-label')).toBe('Solver');
    expect(tabs[0].getAttribute('aria-controls')).toBe(panels[0].id);
    expect(new Set(tabs.map((element) => element.id)).size).toBe(3);
    unmount(div);
  });

  it('moves and selects with ArrowRight/ArrowLeft (wrapping), Home and End; focus follows', () => {
    const { div, app } = mount();
    act(() => app.changeMode('solver'));
    tab(div, 'solver').focus();

    press(tab(div, 'solver'), 'ArrowRight');
    expect(selected(div)).toEqual(['mode-toggle-play']);
    expect(document.activeElement).toBe(tab(div, 'play'));
    expect(tab(div, 'play').tabIndex).toBe(0);
    expect(tab(div, 'solver').tabIndex).toBe(-1);
    expect(views(div).play).toBe(true);

    press(tab(div, 'play'), 'End');
    expect(selected(div)).toEqual(['mode-toggle-label']);
    expect(document.activeElement).toBe(tab(div, 'label'));
    expect(div.querySelector('[role="tabpanel"]').getAttribute('aria-label')).toBe('Label');

    press(tab(div, 'label'), 'ArrowRight');
    expect(selected(div)).toEqual(['mode-toggle-solver']);
    expect(document.activeElement).toBe(tab(div, 'solver'));

    press(tab(div, 'solver'), 'ArrowLeft');
    expect(selected(div)).toEqual(['mode-toggle-label']);

    press(tab(div, 'label'), 'Home');
    expect(selected(div)).toEqual(['mode-toggle-solver']);
    expect(document.activeElement).toBe(tab(div, 'solver'));
    expect(loadPrefs().mode).toBe('solver');
    unmount(div);
  });

  it('selects a tab on click', () => {
    const { div } = mount();
    act(() => tab(div, 'label').click());
    expect(selected(div)).toEqual(['mode-toggle-label']);
    expect(views(div).export).toBe(true);
    unmount(div);
  });
});

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

it('renders the export control in the label view before any photo, enabled once a cage is drawn', () => {
  const div = document.createElement('div');
  // React 16 listens for events on the document, so the container must be attached.
  document.body.appendChild(div);
  let app;
  act(() => {
    app = ReactDOM.render(<App />, div);
  });
  act(() => app.changeMode('label'));

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
  act(() => app.changeMode('label'));
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
