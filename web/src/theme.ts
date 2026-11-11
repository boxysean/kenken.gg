// Chooses the visual theme. The CSS carries one token block per theme, keyed on
// a data-theme attribute; this module only decides which name goes there. A
// `?theme=` parameter picks one and is remembered, so a shared link sticks
// across reloads. Storage is guarded the same way as play mode's: a missing or
// full store must never stop the page from rendering.

export const THEMES = ['brutalist', 'paper', 'blueprint', 'editorial'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'brutalist';
export const THEME_STORAGE_KEY = 'kenken:theme:v1';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

// Values arrive from URLs typed by hand and from storage written by older
// builds, so anything unrecognised falls back rather than throwing.
export function normalizeTheme(value: unknown): Theme {
  if (typeof value !== 'string') return DEFAULT_THEME;
  const name = value.trim().toLowerCase();
  return isTheme(name) ? name : DEFAULT_THEME;
}

// An explicit parameter always wins, even a bad one: someone who typed
// `?theme=` expects that to override what was remembered. Only an empty value
// counts as absent.
export function themeFromQuery(search: string): Theme | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const value = new URLSearchParams(query).get('theme');
  if (value === null || value.trim() === '') return null;
  return normalizeTheme(value);
}

export function loadStoredTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch (error) {
    // Private mode or storage disabled: behave as if nothing was stored.
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    // Quota or private mode: the theme still applies, it just is not remembered.
  }
}

export function resolveTheme(search: string, stored: Theme | null): Theme {
  const fromQuery = themeFromQuery(search);
  if (fromQuery !== null) return fromQuery;
  return isTheme(stored) ? stored : DEFAULT_THEME;
}
