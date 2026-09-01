/**
 * Trophy badge.
 *
 * Shows the running tally plus one dot per puzzle in today's set. Dots rather
 * than a bare number because progress you can see at a glance is what makes the
 * last one worth finishing.
 */

import { el } from './state.js';
import * as progress from './progress.js';
import { celebrate } from './celebrate.js';

const LABELS = {
  sudoku: 'Sudoku',
  shikaku: 'Rectangles',
  slitherlink: 'Loop',
  wordsearch: 'Word search',
  wordle: 'Word guess',
};

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {string} opts.date The page's date, not today's — an archived page
 *   celebrates the day it shows.
 * @param {string[]} opts.types Puzzle types present on this page, in order.
 */
export function mountTrophy(root, { date, types }) {
  const total = el('strong', { class: 'pz-trophy-count' });
  const detail = el('span', { class: 'pz-trophy-detail' });
  const dots = el('span', { class: 'pz-trophy-dots', 'aria-hidden': 'true' });

  const dotNodes = new Map();
  for (const type of types) {
    const dot = el('span', { class: 'pz-trophy-dot', title: LABELS[type] ?? type });
    dotNodes.set(type, dot);
    dots.append(dot);
  }

  const bar = el(
    'div',
    { class: 'pz-trophy', role: 'status', 'aria-live': 'polite' },
    total,
    dots,
    detail,
  );

  function paint() {
    const done = progress.solvedOn(date).filter((t) => types.includes(t));
    const count = progress.totalSolved();
    const perfect = progress.perfectDays();

    total.textContent = `${count} solved`;

    for (const [type, dot] of dotNodes) {
      dot.classList.toggle('pz-trophy-dot-on', done.includes(type));
    }

    const parts = [`${done.length}/${types.length} today`];
    if (perfect > 0) parts.push(`${perfect} full ${perfect === 1 ? 'day' : 'days'}`);
    detail.textContent = parts.join(' \u00b7 ');

    // Screen readers get the same information the dots convey visually.
    bar.setAttribute(
      'aria-label',
      `${count} puzzles solved in total. ${done.length} of ${types.length} done today.`,
    );

    // Every puzzle on the page solved, and not already celebrated for this
    // date, so a returning visitor doesn't get fireworks on every load.
    if (done.length === types.length && types.length > 0) {
      if (progress.markCelebrated(date)) {
        bar.classList.add('pz-trophy-perfect');
        celebrate({ message: `All ${types.length}` });
      }
      bar.classList.add('pz-trophy-perfect');
    }
  }

  progress.subscribe(paint);
  root.append(bar);
  paint();
  return { paint };
}
