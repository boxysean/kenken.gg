// Chooses the top-level view: draw-and-solve, play, or label a photo for the
// training set. Same vocabulary as theme.ts: a `?mode=` parameter wins over the
// remembered preference (kept in play's prefs blob), so `/?mode=label` is a
// link that opens the labelling view. Unlike the theme, the mode is also
// written back to the URL, so a reload stays where the user was.

export const MODES = ['solver', 'play', 'label'] as const;
export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = 'solver';

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

// Values arrive from URLs typed by hand and from storage written by older
// builds, so anything unrecognised falls back rather than throwing.
export function normalizeMode(value: unknown): Mode {
  if (typeof value !== 'string') return DEFAULT_MODE;
  const name = value.trim().toLowerCase();
  return isMode(name) ? name : DEFAULT_MODE;
}

// An explicit parameter always wins, even a bad one, exactly as `?theme=` does.
// Only an empty value counts as absent.
export function modeFromQuery(search: string): Mode | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const value = new URLSearchParams(query).get('mode');
  if (value === null || value.trim() === '') return null;
  return normalizeMode(value);
}

export function resolveMode(search: string, stored: Mode | null | undefined): Mode {
  const fromQuery = modeFromQuery(search);
  if (fromQuery !== null) return fromQuery;
  return isMode(stored) ? stored : DEFAULT_MODE;
}

// The search string with `mode` set and every other parameter (`theme`,
// `debug`, ...) kept, leading `?` included. Pure, so the caller decides how to
// apply it; App uses history.replaceState so mode changes do not fill the back
// button.
export function writeModeToUrl(mode: Mode, search: string): string {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  params.set('mode', mode);
  return `?${params.toString()}`;
}
