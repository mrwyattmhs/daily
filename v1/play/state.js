/**
 * Shared plumbing for the interactive puzzles.
 *
 * Progress is saved to localStorage keyed by date and puzzle type, so a student
 * can close the tab and come back. Every access is wrapped: private browsing,
 * a full quota, and disabled storage all throw, and none of them should cost
 * someone their puzzle.
 */

const PREFIX = 'daily-puzzles';

export function storageKey(puzzle) {
  return `${PREFIX}:${puzzle.date ?? 'nodate'}:${puzzle.type}`;
}

export function loadState(puzzle) {
  try {
    const raw = window.localStorage.getItem(storageKey(puzzle));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // A stale entry from a previous version would corrupt the board silently.
    if (parsed && parsed.seed === puzzle.seed) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveState(puzzle, data) {
  try {
    window.localStorage.setItem(
      storageKey(puzzle),
      JSON.stringify({ ...data, seed: puzzle.seed }),
    );
  } catch {
    /* storage unavailable or full; play continues without saving */
  }
}

export function clearState(puzzle) {
  try {
    window.localStorage.removeItem(storageKey(puzzle));
  } catch {
    /* ignore */
  }
}

/** Debounce saves so dragging doesn't hammer localStorage. */
export function debounce(fn, ms = 250) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

/**
 * Build the control strip every puzzle shares. `buttons` is a list of
 * { label, kind, onClick }; `kind` styles it ('primary' | 'danger' | undefined).
 */
export function controls(buttons) {
  return el(
    'div',
    { class: 'pz-controls' },
    buttons.map((b) =>
      el('button', {
        type: 'button',
        class: `pz-btn${b.kind ? ` pz-btn-${b.kind}` : ''}`,
        text: b.label,
        onClick: b.onClick,
        'data-action': b.action ?? b.label.toLowerCase().replace(/\s+/g, '-'),
      }),
    ),
  );
}

/** Status line. Call `set(text, tone)` with tone 'ok' | 'warn' | 'done' | ''. */
export function statusLine() {
  const node = el('p', { class: 'pz-status', role: 'status', 'aria-live': 'polite' });
  return {
    node,
    set(text, tone = '') {
      node.textContent = text;
      node.className = `pz-status${tone ? ` pz-status-${tone}` : ''}`;
    },
  };
}

/**
 * Which pointer types should scroll rather than draw. Touch drags on a grid
 * need `touch-action: none` in CSS or the page scrolls instead of selecting.
 */
export function trackDrag(target, { onStart, onMove, onEnd }) {
  let active = null;

  target.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    active = event.pointerId;
    target.setPointerCapture?.(event.pointerId);
    onStart?.(event);
    event.preventDefault();
  });

  target.addEventListener('pointermove', (event) => {
    if (active !== event.pointerId) return;
    onMove?.(event);
  });

  const finish = (event) => {
    if (active !== event.pointerId) return;
    active = null;
    onEnd?.(event);
  };
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);
}
