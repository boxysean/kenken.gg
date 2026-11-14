import {
  DEFAULT_MODE,
  MODES,
  isMode,
  modeFromQuery,
  normalizeMode,
  resolveMode,
  writeModeToUrl,
} from './mode';
import type { Mode } from './mode';
import { KEY_PREFS, loadPrefs, savePrefs } from './play/persistence';

afterEach(() => {
  window.localStorage.clear();
});

describe('mode names', () => {
  it('lists exactly the three modes, solver first', () => {
    expect(MODES).toEqual(['solver', 'play', 'label']);
    expect(DEFAULT_MODE).toBe('solver');
  });

  it('recognises only the exact names', () => {
    for (const mode of MODES) expect(isMode(mode)).toBe(true);
    for (const value of ['LABEL', ' play', 'scan', '', null, undefined, 1]) {
      expect(isMode(value)).toBe(false);
    }
  });

  it('normalizes known names', () => {
    for (const mode of MODES) expect(normalizeMode(mode)).toBe(mode);
    expect(normalizeMode('LABEL')).toBe('label');
    expect(normalizeMode(' play ')).toBe('play');
  });

  it('falls back to solver for anything else', () => {
    for (const value of ['scan', '', null, undefined, 42]) {
      expect(normalizeMode(value)).toBe('solver');
    }
  });
});

describe('modeFromQuery', () => {
  it('is null when the parameter is absent or empty', () => {
    expect(modeFromQuery('')).toBeNull();
    expect(modeFromQuery('?debug=true')).toBeNull();
    expect(modeFromQuery('?mode=')).toBeNull();
    expect(modeFromQuery('?mode=%20')).toBeNull();
  });

  it('reads a known name in any case, with or without the leading ?', () => {
    expect(modeFromQuery('?mode=label')).toBe('label');
    expect(modeFromQuery('mode=label')).toBe('label');
    expect(modeFromQuery('?mode=PLAY')).toBe('play');
    expect(modeFromQuery('?theme=editorial&mode=label&debug=true')).toBe('label');
  });

  it('turns an unknown value into the default rather than ignoring it', () => {
    expect(modeFromQuery('?mode=nonsense')).toBe('solver');
  });
});

describe('resolveMode', () => {
  it('prefers the query over storage', () => {
    expect(resolveMode('?mode=label', 'play')).toBe('label');
  });

  it('lets an unknown query override storage with the default', () => {
    expect(resolveMode('?mode=nonsense', 'label')).toBe('solver');
  });

  it('uses storage when the query is absent', () => {
    expect(resolveMode('', 'play')).toBe('play');
    expect(resolveMode('?mode=', 'label')).toBe('label');
  });

  it('defaults when neither is present or storage is invalid', () => {
    expect(resolveMode('', null)).toBe('solver');
    expect(resolveMode('', undefined)).toBe('solver');
    expect(resolveMode('', 'scan' as Mode)).toBe('solver');
  });
});

describe('writeModeToUrl', () => {
  it('adds the mode to an empty search', () => {
    expect(writeModeToUrl('label', '')).toBe('?mode=label');
    expect(writeModeToUrl('play', '?')).toBe('?mode=play');
  });

  it('replaces an existing mode rather than adding a second', () => {
    expect(writeModeToUrl('play', '?mode=label')).toBe('?mode=play');
    expect(writeModeToUrl('solver', 'mode=nonsense')).toBe('?mode=solver');
  });

  it('keeps theme, debug and any other parameter', () => {
    const search = writeModeToUrl('label', '?theme=editorial&debug=true&x=1');
    const params = new URLSearchParams(search.slice(1));
    expect(params.get('mode')).toBe('label');
    expect(params.get('theme')).toBe('editorial');
    expect(params.get('debug')).toBe('true');
    expect(params.get('x')).toBe('1');
    // App's ?debug=true check is a substring match on the URL.
    expect(search).toContain('debug=true');
  });

  it('round-trips through modeFromQuery', () => {
    for (const mode of MODES) {
      expect(modeFromQuery(writeModeToUrl(mode, '?theme=paper'))).toBe(mode);
    }
  });
});

describe('remembered mode', () => {
  it('stores and reloads label', () => {
    savePrefs({ ...loadPrefs(), mode: 'label' });
    expect(loadPrefs().mode).toBe('label');
  });

  it('still reads a prefs blob written before label existed', () => {
    window.localStorage.setItem(KEY_PREFS, JSON.stringify({ lastPracticeSize: 6, mode: 'play' }));
    expect(loadPrefs()).toEqual({ lastPracticeSize: 6, mode: 'play' });
  });

  it('falls back to solver for an unknown stored mode', () => {
    window.localStorage.setItem(KEY_PREFS, JSON.stringify({ lastPracticeSize: 6, mode: 'scan' }));
    expect(loadPrefs().mode).toBe('solver');
  });
});
