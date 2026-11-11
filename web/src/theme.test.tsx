import React from 'react';
import ReactDOM from 'react-dom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import App from './App';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  loadStoredTheme,
  normalizeTheme,
  resolveTheme,
  saveTheme,
  themeFromQuery,
} from './theme';
import type { Theme } from './theme';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
});

describe('theme names', () => {
  it('lists exactly the four themes, brutalist first', () => {
    expect(THEMES).toEqual(['brutalist', 'paper', 'blueprint', 'editorial']);
    expect(DEFAULT_THEME).toBe('brutalist');
  });

  it('normalizes known names', () => {
    for (const theme of THEMES) expect(normalizeTheme(theme)).toBe(theme);
    expect(normalizeTheme('PAPER')).toBe('paper');
    expect(normalizeTheme(' blueprint ')).toBe('blueprint');
  });

  it('falls back to brutalist for anything else', () => {
    for (const value of ['neon', '', null, undefined, 42]) {
      expect(normalizeTheme(value)).toBe('brutalist');
    }
  });
});

describe('themeFromQuery', () => {
  it('is null when the parameter is absent or empty', () => {
    expect(themeFromQuery('')).toBeNull();
    expect(themeFromQuery('?debug=true')).toBeNull();
    expect(themeFromQuery('?theme=')).toBeNull();
  });

  it('reads a known name in any case, with or without the leading ?', () => {
    expect(themeFromQuery('?theme=paper')).toBe('paper');
    expect(themeFromQuery('theme=paper')).toBe('paper');
    expect(themeFromQuery('?theme=PAPER')).toBe('paper');
    expect(themeFromQuery('?debug=true&theme=editorial')).toBe('editorial');
  });

  it('turns an unknown value into the default rather than ignoring it', () => {
    expect(themeFromQuery('?theme=bogus')).toBe('brutalist');
  });
});

describe('resolveTheme', () => {
  it('prefers the query over storage', () => {
    expect(resolveTheme('?theme=paper', 'blueprint')).toBe('paper');
  });

  it('lets an unknown query override storage with the default', () => {
    expect(resolveTheme('?theme=neon', 'blueprint')).toBe('brutalist');
  });

  it('uses storage when the query is absent', () => {
    expect(resolveTheme('', 'blueprint')).toBe('blueprint');
    expect(resolveTheme('?theme=', 'editorial')).toBe('editorial');
  });

  it('defaults when neither is present or storage is invalid', () => {
    expect(resolveTheme('', null)).toBe('brutalist');
    expect(resolveTheme('', 'neon' as Theme)).toBe('brutalist');
  });
});

describe('theme storage', () => {
  it('round-trips a saved theme', () => {
    saveTheme('blueprint');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('blueprint');
    expect(loadStoredTheme()).toBe('blueprint');
  });

  it('returns null when nothing or something unknown is stored', () => {
    expect(loadStoredTheme()).toBeNull();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(loadStoredTheme()).toBeNull();
  });

  it('survives a store that throws on write', () => {
    // jsdom's localStorage resolves methods on Storage.prototype, so a spy on
    // the instance is never reached; the call assertions below prove this one is.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveTheme('paper')).not.toThrow();
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'paper');
  });

  it('survives a store that throws on read', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'paper');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadStoredTheme()).toBeNull();
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });
});

describe('root data-theme attribute', () => {
  let container: HTMLDivElement;

  function mount(): HTMLElement {
    container = document.createElement('div');
    ReactDOM.render(<App />, container);
    return container.firstElementChild as HTMLElement;
  }

  afterEach(() => {
    if (container) ReactDOM.unmountComponentAtNode(container);
  });

  it('is brutalist with no parameter and nothing stored', () => {
    expect(mount().getAttribute('data-theme')).toBe('brutalist');
  });

  it('applies ?theme= and remembers it across a reload', () => {
    window.history.replaceState({}, '', '/?theme=editorial');
    expect(mount().getAttribute('data-theme')).toBe('editorial');
    expect(loadStoredTheme()).toBe('editorial');

    window.history.replaceState({}, '', '/');
    ReactDOM.unmountComponentAtNode(container);
    expect(mount().getAttribute('data-theme')).toBe('editorial');
  });

  it('renders brutalist for an unknown parameter', () => {
    window.history.replaceState({}, '', '/?theme=neon');
    expect(mount().getAttribute('data-theme')).toBe('brutalist');
  });
});

// The theme tokens live twice: in App.css for the app and in public/main.css
// for the static pages. Nothing but these tests keeps them in step.
describe('theme CSS', () => {
  const BEGIN = '/* tokens:begin */';
  const END = '/* tokens:end */';
  // jsdom replaces the global URL, and Node's fs rejects jsdom's, so resolve
  // through a path instead of handing readFileSync a URL object.
  const here = dirname(fileURLToPath(import.meta.url));
  const appCss = readFileSync(resolve(here, './App.css'), 'utf8');
  const mainCss = readFileSync(resolve(here, '../public/main.css'), 'utf8');

  function tokenRegion(css: string, file: string): string {
    const begin = css.indexOf(BEGIN);
    const end = css.indexOf(END);
    if (begin < 0 || end < begin) throw new Error(`${file} has no ${BEGIN} ... ${END} region`);
    return css.slice(begin + BEGIN.length, end).trim();
  }

  interface Block {
    prelude: string;
    body: string;
  }

  // Top-level `prelude { body }` pairs, braces balanced, comments removed.
  function blocks(css: string): Block[] {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const found: Block[] = [];
    let depth = 0;
    let start = 0;
    let open = 0;
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '{') {
        if (depth === 0) open = i;
        depth++;
      } else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          found.push({ prelude: source.slice(start, open).trim(), body: source.slice(open + 1, i) });
          start = i + 1;
        }
      }
    }
    return found;
  }

  // Custom-property declarations of the first top-level block with this
  // prelude; nested blocks inside it are not part of its declarations.
  function declarations(css: string, prelude: string): Record<string, string> {
    const block = blocks(css).find((candidate) => candidate.prelude === prelude);
    if (block === undefined) throw new Error(`no block ${prelude}`);
    const flat = block.body.replace(/\{[^{}]*\}/g, '');
    const result: Record<string, string> = {};
    for (const match of flat.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      result[match[1]] = match[2].trim();
    }
    return result;
  }

  it('keeps the token regions identical in both files', () => {
    expect(
      tokenRegion(appCss, 'src/App.css'),
      'tokens region in src/App.css differs from public/main.css',
    ).toBe(tokenRegion(mainCss, 'public/main.css'));
  });

  const tokens = tokenRegion(appCss, 'src/App.css');
  const root = declarations(tokens, ':root');
  const darkMedia = blocks(tokens).find(
    (block) => block.prelude === '@media (prefers-color-scheme: dark)',
  );
  const darkRoot = darkMedia === undefined ? {} : declarations(darkMedia.body, ':root');

  for (const theme of THEMES) {
    const own = theme === 'brutalist' ? {} : declarations(tokens, `[data-theme="${theme}"]`);
    const schemes: Array<[string, Record<string, string>]> = [
      ['light', { ...root, ...own }],
      ['dark', { ...root, ...darkRoot, ...own }],
    ];
    for (const [scheme, values] of schemes) {
      it(`draws cage edges heavier than grid lines in ${theme} (${scheme})`, () => {
        const cage = values['--cage-border-width'];
        const grid = values['--grid-line-width'];
        expect(cage, `${theme} ${scheme} --cage-border-width`).toMatch(/px$/);
        expect(grid, `${theme} ${scheme} --grid-line-width`).toMatch(/px$/);
        expect(
          parseFloat(cage) > parseFloat(grid),
          `${theme} ${scheme}: cage ${cage} must exceed grid ${grid}`,
        ).toBe(true);
      });
    }
  }
});
