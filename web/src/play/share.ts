// Share text for a solved puzzle. It carries the result only, never grid
// data, so posting it cannot spoil the puzzle for anyone else.

export function shareText(options: { date?: string; boardSize: number; elapsed: number; hints: number }): string {
  const { date, boardSize, elapsed, hints } = options;
  const size = `${boardSize}×${boardSize}`;
  const title = date === undefined ? `KenKen practice ${size}` : `KenKen ${date} · ${size}`;
  return `${title}\n✅ solved in ${formatElapsed(elapsed)} · ${formatHints(hints)}\nkenken.gg`;
}

// m:ss; minutes are not wrapped into hours, a long solve just reads 75:03.
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

export function formatHints(hints: number): string {
  return `${hints} ${hints === 1 ? 'hint' : 'hints'}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    // Denied, or not a secure context: try the old way below.
  }
  return copyWithTextarea(text);
}

// execCommand is deprecated but still the only route on plain http and in
// older in-app browsers.
function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  const previousFocus = document.activeElement as HTMLElement | null;
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch (error) {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }
}
