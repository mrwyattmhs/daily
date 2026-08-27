/**
 * Daily word guess.
 *
 * The generator is the simplest here — pick a word, seeded by date. The part
 * worth care is `scoreGuess`, which is where nearly every hobby implementation
 * goes wrong.
 */

import { Rng } from '../rng.js';

const RARE = new Set(['J', 'Q', 'X', 'Z', 'V', 'K', 'W']);

/**
 * The pool ordering must be identical on every date, or the "walk the list"
 * property collapses. Seeding the shuffle from the day's RNG gives a fresh
 * permutation each day, which is really random picking with replacement — and
 * that collides fast: answers started repeating within ten days. This seed is
 * fixed forever. Changing it reshuffles all future answers, so bump the suffix
 * rather than editing it if you ever want a different order.
 */
const ORDER_SEED = 'wordle-order-v1';

/**
 * Score a guess against an answer.
 *
 * Returns an array of 'correct' | 'present' | 'absent', one per letter.
 *
 * The naive rule — green on a match, else yellow if the letter appears
 * anywhere — is wrong whenever a letter repeats. Guessing ERASE against SPEED
 * must return the second E as absent, because SPEED's two Es are already
 * accounted for. So this runs two passes: greens first, decrementing a pool of
 * unmatched answer letters, then yellows drawn only from what's left.
 */
export function scoreGuess(guess, answer) {
  const g = String(guess).toUpperCase();
  const a = String(answer).toUpperCase();
  if (g.length !== a.length) throw new Error('scoreGuess: length mismatch');

  const result = new Array(g.length).fill('absent');
  const pool = new Map();

  // Pass one: exact positions. Everything not matched goes into the pool.
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) result[i] = 'correct';
    else pool.set(a[i], (pool.get(a[i]) ?? 0) + 1);
  }

  // Pass two: right letter, wrong place — but only while the pool has one left.
  for (let i = 0; i < g.length; i++) {
    if (result[i] === 'correct') continue;
    const remaining = pool.get(g[i]) ?? 0;
    if (remaining > 0) {
      result[i] = 'present';
      pool.set(g[i], remaining - 1);
    }
  }

  return result;
}

/** Per-letter keyboard state, strongest verdict wins across all guesses. */
export function keyboardState(guesses, answer) {
  const rank = { absent: 1, present: 2, correct: 3 };
  const best = new Map();
  for (const guess of guesses) {
    const marks = scoreGuess(guess, answer);
    for (let i = 0; i < guess.length; i++) {
      const letter = guess[i].toUpperCase();
      const mark = marks[i];
      if (!best.has(letter) || rank[mark] > rank[best.get(letter)]) best.set(letter, mark);
    }
  }
  return best;
}

/** Repeated letters and rare letters are what actually make a word hard. */
function rate(word) {
  const distinct = new Set(word).size;
  const rare = [...word].filter((ch) => RARE.has(ch)).length;
  if (distinct < word.length || rare >= 2) return 'hard';
  if (rare === 1) return 'medium';
  return 'easy';
}

/**
 * Deterministic shuffle of indices, so the whole pool is used before any word
 * repeats. Picking `pool[day % pool.length]` directly would walk the list in
 * alphabetical order, which is guessable after a week.
 */
function shuffledOrder(pool, rng) {
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * @param {Rng} rng
 * @param {object} opts
 * @param {string[]} opts.words Required. Answer pool, five letters each.
 * @param {'easy'|'medium'|'hard'} [opts.difficulty] Filters the pool. Falls
 *   back to the whole pool if the bucket is too small to rotate through.
 * @param {number} [opts.dayNumber] Days since epoch, used to walk the shuffled
 *   pool. Defaults to deriving it from `opts.date`.
 * @param {string} [opts.date] `YYYY-MM-DD`, used when dayNumber is absent.
 * @param {number} [opts.maxGuesses=6]
 * @param {string} [opts.orderSeed] Overrides the fixed shuffle seed.
 */
export function generate(rng, opts = {}) {
  const raw = (opts.words ?? []).map((w) => String(w).toUpperCase().trim());
  const pool = [...new Set(raw.filter((w) => /^[A-Z]{5}$/.test(w)))];
  if (pool.length === 0) throw new Error('wordle: needs a pool of five-letter words');

  const wanted = opts.difficulty;
  let bucket = pool;
  if (wanted) {
    const filtered = pool.filter((w) => rate(w) === wanted);
    // A bucket smaller than a school year would repeat noticeably, so only use
    // it when it's big enough to be worth the extra targeting.
    if (filtered.length >= 60) bucket = filtered;
  }

  const day =
    opts.dayNumber ??
    (opts.date ? Math.floor(Date.parse(`${opts.date}T00:00:00Z`) / 86400000) : 0);

  // Seeded from a constant, never from the date: the ordering is fixed and the
  // day only chooses a position in it. That is what guarantees the whole pool
  // is used before anything repeats.
  const order = shuffledOrder(bucket, new Rng(opts.orderSeed ?? ORDER_SEED));
  const answer = bucket[order[((day % order.length) + order.length) % order.length]];

  return {
    type: 'wordle',
    difficulty: rate(answer),
    length: 5,
    maxGuesses: opts.maxGuesses ?? 6,
    poolSize: bucket.length,
    // The answer has to reach the browser for guesses to be scored offline.
    // Consistent with the other puzzles, which all ship their solutions.
    solution: { answer },
  };
}

export const meta = {
  type: 'wordle',
  name: 'Word guess',
  blurb: 'Guess the five-letter word in six tries. Each guess tells you which letters are right.',
  difficulties: ['easy', 'medium', 'hard'],
};
