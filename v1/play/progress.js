/**
 * Solve tally.
 *
 * Deliberately separate from each puzzle's saved board state, for two reasons:
 * board state is discarded when a date's puzzle changes (a stale board would
 * corrupt play, so `loadState` throws it away on a seed mismatch), and that
 * would silently wipe the tally too. This record has no seed check and is meant
 * to outlive schema changes, including new puzzle types.
 *
 * Only genuine solves are recorded. Reveal and Give up never call `record`.
 *
 * It's per-browser and trivially editable from the console. That's fine — it's
 * a tally for fun, not a grade.
 */

const KEY = 'daily-puzzles:progress';
const VERSION = 1;

const listeners = new Set();

function blank() {
  return { v: VERSION, solved: {}, celebrated: [] };
}

function read() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return blank();
    return {
      v: VERSION,
      solved: parsed.solved && typeof parsed.solved === 'object' ? parsed.solved : {},
      celebrated: Array.isArray(parsed.celebrated) ? parsed.celebrated : [],
    };
  } catch {
    return blank();
  }
}

function write(data) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable; the tally just won't persist */
  }
}

function notify() {
  const snapshot = read();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error('daily-puzzles: progress listener failed', err);
    }
  }
}

/**
 * Record a solved puzzle. Idempotent: completion checks run on every keystroke,
 * so this is called repeatedly with the same arguments and must not double
 * count. Returns true only when something actually changed.
 */
export function record(date, type) {
  if (!date || !type) return false;
  const data = read();
  const list = data.solved[date] ?? [];
  if (list.includes(type)) return false;
  data.solved[date] = [...list, type];
  write(data);
  notify();
  return true;
}

/** Puzzle types solved on a given date. */
export function solvedOn(date) {
  return read().solved[date] ?? [];
}

/** Total solves across every date. */
export function totalSolved() {
  const { solved } = read();
  return Object.values(solved).reduce((n, list) => n + list.length, 0);
}

/**
 * Days where every puzzle was solved. Derived from the celebrated list rather
 * than recomputed, because a past day's puzzle count isn't stored anywhere and
 * could change if a type is added later.
 */
export function perfectDays() {
  return read().celebrated.length;
}

export function hasCelebrated(date) {
  return read().celebrated.includes(date);
}

/** Returns false if this date was already celebrated, so it only fires once. */
export function markCelebrated(date) {
  const data = read();
  if (data.celebrated.includes(date)) return false;
  data.celebrated = [...data.celebrated, date];
  write(data);
  notify();
  return true;
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Wipe the tally. */
export function reset() {
  write(blank());
  notify();
}

export function snapshot() {
  return read();
}
