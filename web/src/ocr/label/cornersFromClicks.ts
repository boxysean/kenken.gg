// Hand-labelled corners: four clicks on a photo, in tl, tr, br, bl order. The
// photo is shown scaled to fit the page, but a label's corners are in natural
// image pixels (the pixels the scanner and the training crops see), so every
// click is converted on the way in and every marker on the way out.
import type { Point, Quad } from '../types';

export type DisplaySize = { width: number; height: number };

export const CORNER_ORDER = ['tl', 'tr', 'br', 'bl'] as const;

export type CornerName = (typeof CORNER_ORDER)[number];

export function nextCornerName(count: number): CornerName | null {
  return count < CORNER_ORDER.length ? CORNER_ORDER[count] : null;
}

// A zero size means the image has not laid out (or not loaded) yet; scaling by
// it would yield Infinity or NaN corners that only fail much later, in training.
function scale(to: number, from: number, what: string): number {
  if (!Number.isFinite(from) || from <= 0) {
    throw new Error(`${what} ${from} is not a positive finite number`);
  }
  return to / from;
}

export function naturalPoint(click: Point, displayed: DisplaySize, natural: DisplaySize): Point {
  return {
    x: Math.round(click.x * scale(natural.width, displayed.width, 'displayed width')),
    y: Math.round(click.y * scale(natural.height, displayed.height, 'displayed height')),
  };
}

// The inverse of naturalPoint, unrounded: markers may sit between CSS pixels.
export function displayPoint(point: Point, displayed: DisplaySize, natural: DisplaySize): Point {
  return {
    x: point.x * scale(displayed.width, natural.width, 'natural width'),
    y: point.y * scale(displayed.height, natural.height, 'natural height'),
  };
}

// A fifth click is ignored rather than replacing a corner: which one it meant
// to move is a guess, and Undo makes the intent explicit.
export function addCorner(
  clicks: readonly Point[],
  click: Point,
  displayed: DisplaySize,
  natural: DisplaySize,
): Point[] {
  if (clicks.length >= CORNER_ORDER.length) return clicks.slice(0, CORNER_ORDER.length);
  return [...clicks, naturalPoint(click, displayed, natural)];
}

export function clicksToQuad(clicks: readonly Point[]): Quad | null {
  if (clicks.length !== CORNER_ORDER.length) return null;
  const [tl, tr, br, bl] = clicks;
  return { tl: { ...tl }, tr: { ...tr }, br: { ...br }, bl: { ...bl } };
}
