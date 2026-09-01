/**
 * Interactive layer entry point.
 *
 *   import { hydrate } from '/daily/v1/play/index.js';
 *   hydrate();
 *
 * The page ships static SVG for every puzzle, and this replaces it. That
 * ordering is deliberate: with no JavaScript, a broken CDN, or a thrown error
 * here, the reader still gets a printable puzzle instead of an empty box.
 */

import { mountSudoku } from './sudoku.js';
import { mountShikaku } from './shikaku.js';
import { mountSlitherlink } from './slitherlink.js';
import { mountWordsearch } from './wordsearch.js';
import { mountWordle } from './wordle.js';
import { mountTrophy } from './trophy.js';
import * as progress from './progress.js';

const MOUNTS = {
  sudoku: mountSudoku,
  shikaku: mountShikaku,
  slitherlink: mountSlitherlink,
  wordsearch: mountWordsearch,
  wordle: mountWordle,
};

export { mountSudoku, mountShikaku, mountSlitherlink, mountWordsearch, mountWordle, mountTrophy };
export { progress };
export { celebrate } from './celebrate.js';

/**
 * Mount one puzzle into an element, replacing whatever is there.
 *
 * @param {object} puzzle
 * @param {HTMLElement} target
 * @param {object} [opts]
 * @param {(type: string) => void} [opts.onSolved] Fired once, on a genuine
 *   solve only. Reveal and Give up never fire it.
 */
export function mount(puzzle, target, opts = {}) {
  const fn = MOUNTS[puzzle.type];
  if (!fn) throw new Error(`no interactive view for "${puzzle.type}"`);
  target.replaceChildren();
  fn(puzzle, target, opts);
  return target;
}

/**
 * Find the puzzle data embedded in the page and upgrade each sheet.
 *
 * @param {object} [opts]
 * @param {string} [opts.dataId='puzzle-data'] Element holding the JSON payload.
 * @param {string} [opts.slot='[data-play-slot]'] Where interactive views go.
 * @param {boolean} [opts.trophy=true] Mount the solve tally, if the page has a
 *   `[data-trophy-slot]` element.
 */
export function hydrate(opts = {}) {
  const dataId = opts.dataId ?? 'puzzle-data';
  const script = document.getElementById(dataId);
  if (!script) return [];

  let set;
  try {
    set = JSON.parse(script.textContent);
  } catch (err) {
    console.error('daily-puzzles: could not parse puzzle data', err);
    return [];
  }

  const date = set.date;
  const onSolved = (type) => {
    // Idempotent, so it's safe that completion checks fire on every keystroke.
    progress.record(date, type);
  };

  const mounted = [];
  for (const puzzle of set.puzzles ?? []) {
    const slot = document.querySelector(`[data-play-slot="${puzzle.type}"]`);
    if (!slot) continue;
    try {
      mount(puzzle, slot, { onSolved });
      // Only hide the static fallback once the interactive view is really up.
      const sheet = slot.closest('[data-sheet]');
      sheet?.classList.add('is-interactive');
      mounted.push(puzzle.type);
    } catch (err) {
      console.error(`daily-puzzles: ${puzzle.type} failed to mount`, err);
    }
  }

  // The tally counts only the puzzles that actually mounted, so a board that
  // failed to load can't make the day impossible to complete.
  if (opts.trophy !== false && mounted.length) {
    const slot = document.querySelector('[data-trophy-slot]');
    if (slot) {
      try {
        mountTrophy(slot, { date, types: mounted });
      } catch (err) {
        console.error('daily-puzzles: trophy failed to mount', err);
      }
    }
  }

  return mounted;
}
