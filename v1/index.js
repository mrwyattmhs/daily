/**
 * Puzzle generators, v1.
 *
 * Public entry point. Generators return data only — no DOM, no rendering, no
 * styling — so any site can present them however it likes.
 *
 *   import { generate, buildDailySet, rngForDate } from '/daily/v1/index.js';
 *
 *   const sudoku = generate('sudoku', rngForDate('2026-08-27'), { difficulty: 'hard' });
 *   const daily  = buildDailySet('2026-08-27');
 *
 * This folder is frozen once other sites depend on it. Breaking changes go in
 * a new /v2/ folder so nothing updates underneath a consumer.
 */

import { Rng, rngForDate, dateKey } from './rng.js';
import * as sudoku from './generators/sudoku.js';
import * as shikaku from './generators/shikaku.js';
import * as slitherlink from './generators/slitherlink.js';
import * as wordsearch from './generators/wordsearch.js';

export { Rng, rngForDate, dateKey };
export { edgeSegments } from './generators/slitherlink.js';

const REGISTRY = { sudoku, shikaku, slitherlink, wordsearch };

/** Metadata for every generator: type, name, blurb, difficulties. */
export const manifest = Object.values(REGISTRY).map((m) => m.meta);

/** Generator type names. */
export const types = Object.keys(REGISTRY);

/**
 * Generate one puzzle.
 * @param {string} type One of `types`.
 * @param {Rng} rng
 * @param {object} [opts] Passed through to the generator.
 */
export function generate(type, rng, opts = {}) {
  const mod = REGISTRY[type];
  if (!mod) throw new Error(`unknown puzzle type "${type}" (have: ${types.join(', ')})`);
  return mod.generate(rng, opts);
}

/**
 * Every puzzle carries the seed and date it came from, so any output can be
 * reproduced exactly from the JSON alone.
 */
function stamp(puzzle, date, seed) {
  return { ...puzzle, date, seed };
}

/** Rotate deterministically through a list based on the date. */
function rotate(list, dk) {
  const days = Math.floor(Date.parse(`${dk}T00:00:00Z`) / 86400000);
  return list[((days % list.length) + list.length) % list.length];
}

/**
 * The day's puzzle set: one of each type, seeded so the same date always
 * produces the same puzzles.
 *
 * @param {string} dk Date key, `YYYY-MM-DD`.
 * @param {object} [opts]
 * @param {object} [opts.vocab] Parsed data/vocab.json, for the word search.
 *   Omit it and the word search is skipped.
 * @param {string} [opts.unit] Force a vocabulary unit instead of rotating.
 * @param {object} [opts.difficulty] Per-type difficulty overrides,
 *   e.g. `{ sudoku: 'hard' }`.
 */
export function buildDailySet(dk, opts = {}) {
  const base = rngForDate(dk);
  const diff = opts.difficulty ?? {};

  // Difficulty ramps across the week: gentler on Monday, hardest on Friday.
  const weekday = new Date(`${dk}T00:00:00Z`).getUTCDay();
  const ramp = ['medium', 'easy', 'easy', 'medium', 'medium', 'hard', 'medium'][weekday];

  const puzzles = [
    stamp(
      generate('sudoku', base.fork('sudoku'), { difficulty: diff.sudoku ?? ramp }),
      dk,
      `${dk}/sudoku`,
    ),
    stamp(
      generate('shikaku', base.fork('shikaku'), { difficulty: diff.shikaku ?? ramp }),
      dk,
      `${dk}/shikaku`,
    ),
    stamp(
      generate('slitherlink', base.fork('slitherlink'), {
        difficulty: diff.slitherlink ?? ramp,
      }),
      dk,
      `${dk}/slitherlink`,
    ),
  ];

  if (opts.vocab) {
    const keys = Object.keys(opts.vocab.units).sort();
    const unitKey = opts.unit && opts.vocab.units[opts.unit] ? opts.unit : rotate(keys, dk);
    const unit = opts.vocab.units[unitKey];
    puzzles.push(
      stamp(
        generate('wordsearch', base.fork('wordsearch'), {
          words: unit.words,
          theme: unit.label,
          difficulty: diff.wordsearch ?? ramp,
        }),
        dk,
        `${dk}/wordsearch`,
      ),
    );
  }

  return {
    date: dk,
    generatedAt: new Date().toISOString(),
    version: 'v1',
    puzzles,
  };
}
