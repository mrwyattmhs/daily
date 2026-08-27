/**
 * Shikaku — a rectangle-division puzzle.
 *
 * Divide the grid into rectangles so each rectangle contains exactly one
 * number, and that number equals the rectangle's area.
 *
 * Generating a valid partition is easy; generating one with a *unique* solution
 * is not, so we partition, place the numbers, then verify with an exact-cover
 * solver and retry on failure.
 */

/** All (height, width) pairs whose product is `area`. */
function factorPairs(area) {
  const pairs = [];
  for (let h = 1; h <= area; h++) {
    if (area % h === 0) pairs.push([h, area / h]);
  }
  return pairs;
}

/**
 * Partition the grid into rectangles.
 *
 * Repeatedly take the topmost-leftmost uncovered cell and place a rectangle
 * with that cell as its top-left corner. A 1×1 always fits, so this never
 * dead-ends — but 1×1s make dull puzzles, so candidates are weighted toward
 * mid-sized areas.
 */
function partition(rng, rows, cols, maxArea) {
  const covered = new Uint8Array(rows * cols);
  const rects = [];

  const fits = (r0, c0, h, w) => {
    if (r0 + h > rows || c0 + w > cols) return false;
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        if (covered[r * cols + c]) return false;
      }
    }
    return true;
  };

  for (let i = 0; i < rows * cols; i++) {
    if (covered[i]) continue;
    const r0 = Math.floor(i / cols);
    const c0 = i % cols;

    const options = [];
    const weights = [];
    for (let h = 1; h <= rows - r0; h++) {
      for (let w = 1; w <= cols - c0; w++) {
        const area = h * w;
        if (area > maxArea) continue;
        if (!fits(r0, c0, h, w)) continue;
        options.push({ r0, c0, h, w, area });
        // Favour areas of 3-8; penalise 1×1 hard and squat 2s lightly.
        let weight = area === 1 ? 0.35 : area === 2 ? 1.6 : area <= 8 ? 3.2 : 1.1;
        // Slightly favour non-square rectangles: they read as more interesting.
        if (h !== w) weight *= 1.25;
        weights.push(weight);
      }
    }
    const chosen = rng.weighted(options, weights);
    for (let r = chosen.r0; r < chosen.r0 + chosen.h; r++) {
      for (let c = chosen.c0; c < chosen.c0 + chosen.w; c++) covered[r * cols + c] = 1;
    }
    rects.push(chosen);
  }
  return rects;
}

/**
 * For each clue, every rectangle that could serve it: correct area, covers the
 * clue cell, inside the grid, and containing no other clue.
 */
function candidatesFor(clues, rows, cols) {
  const clueAt = new Map(clues.map((cl, k) => [cl.r * cols + cl.c, k]));
  return clues.map((clue, self) => {
    const out = [];
    for (const [h, w] of factorPairs(clue.value)) {
      if (h > rows || w > cols) continue;
      for (let r0 = Math.max(0, clue.r - h + 1); r0 <= Math.min(clue.r, rows - h); r0++) {
        for (let c0 = Math.max(0, clue.c - w + 1); c0 <= Math.min(clue.c, cols - w); c0++) {
          let ok = true;
          const cells = [];
          for (let r = r0; r < r0 + h && ok; r++) {
            for (let c = c0; c < c0 + w; c++) {
              const idx = r * cols + c;
              const other = clueAt.get(idx);
              if (other !== undefined && other !== self) {
                ok = false;
                break;
              }
              cells.push(idx);
            }
          }
          if (ok) out.push({ r0, c0, h, w, cells });
        }
      }
    }
    return out;
  });
}

/**
 * Count solutions up to `cap`, using most-constrained-clue-first ordering.
 * Also records, for rating, whether the search ever had to guess.
 */
function solve(clues, cands, rows, cols, cap = 2) {
  const cover = new Int16Array(rows * cols).fill(-1);
  const placed = new Array(clues.length).fill(null);
  let count = 0;
  let guessed = false;
  let firstSolution = null;

  const canPlace = (rect) => {
    for (const idx of rect.cells) if (cover[idx] !== -1) return false;
    return true;
  };

  const recurse = () => {
    if (count >= cap) return;

    // Most-constrained clue: fewest currently-viable rectangles.
    let target = -1;
    let viable = null;
    for (let k = 0; k < clues.length; k++) {
      if (placed[k]) continue;
      const options = cands[k].filter(canPlace);
      if (options.length === 0) return; // dead end
      if (viable === null || options.length < viable.length) {
        target = k;
        viable = options;
        if (options.length === 1) break;
      }
    }

    if (target === -1) {
      // Every clue placed. Since total clue area equals the grid area, the
      // grid is necessarily fully covered.
      count++;
      if (!firstSolution) firstSolution = placed.map((p, k) => ({ ...p, value: clues[k].value }));
      return;
    }

    if (viable.length > 1) guessed = true;
    for (const rect of viable) {
      if (!canPlace(rect)) continue;
      placed[target] = rect;
      for (const idx of rect.cells) cover[idx] = target;
      recurse();
      for (const idx of rect.cells) cover[idx] = -1;
      placed[target] = null;
      if (count >= cap) return;
    }
  };

  recurse();
  return { count, guessed, solution: firstSolution };
}

/**
 * Solve using only forced moves — place a rectangle only when it's the single
 * viable option for a clue. Used for difficulty rating: a puzzle that falls to
 * forced moves alone requires no search from a human either.
 */
function forcedOnly(clues, cands, rows, cols) {
  const cover = new Int16Array(rows * cols).fill(-1);
  const placed = new Array(clues.length).fill(false);
  let remaining = clues.length;
  let rounds = 0;

  const canPlace = (rect) => {
    for (const idx of rect.cells) if (cover[idx] !== -1) return false;
    return true;
  };

  for (;;) {
    let moved = false;
    for (let k = 0; k < clues.length; k++) {
      if (placed[k]) continue;
      const options = cands[k].filter(canPlace);
      if (options.length === 1) {
        for (const idx of options[0].cells) cover[idx] = k;
        placed[k] = true;
        remaining--;
        moved = true;
      }
    }
    rounds++;
    if (!moved) break;
  }
  return { solved: remaining === 0, remaining, rounds };
}

const SIZES = {
  easy: { rows: 7, cols: 7, maxArea: 8 },
  medium: { rows: 9, cols: 9, maxArea: 10 },
  hard: { rows: 10, cols: 10, maxArea: 12 },
};

/**
 * @param {Rng} rng
 * @param {object} [opts]
 * @param {'easy'|'medium'|'hard'} [opts.difficulty='medium']
 * @param {number} [opts.rows] Override the difficulty preset.
 * @param {number} [opts.cols]
 * @param {number} [opts.maxArea] Largest rectangle area allowed.
 * @param {number} [opts.maxAttempts=400]
 */
export function generate(rng, opts = {}) {
  const preset = SIZES[opts.difficulty ?? 'medium'] ?? SIZES.medium;
  const rows = opts.rows ?? preset.rows;
  const cols = opts.cols ?? preset.cols;
  const maxArea = opts.maxArea ?? preset.maxArea;
  const maxAttempts = opts.maxAttempts ?? 400;
  const wantSearch = (opts.difficulty ?? 'medium') !== 'easy';

  let fallback = null;

  for (let k = 0; k < maxAttempts; k++) {
    const r = rng.fork(`sk-${k}`);
    const rects = partition(r, rows, cols, maxArea);

    // Reject partitions that are mostly tiny pieces — they're valid but dull.
    const singles = rects.filter((x) => x.area === 1).length;
    if (singles > Math.max(1, Math.floor(rects.length * 0.12))) continue;

    // The number can sit in any cell of its rectangle; which cell it is
    // changes the puzzle substantially.
    const clues = rects.map((rect) => ({
      r: rect.r0 + r.int(rect.h),
      c: rect.c0 + r.int(rect.w),
      value: rect.area,
    }));

    const cands = candidatesFor(clues, rows, cols);
    if (cands.some((c) => c.length === 0)) continue; // shouldn't happen; cheap guard

    const { count, solution } = solve(clues, cands, rows, cols, 2);
    if (count !== 1) continue;

    // Rate by how much survives pure forced-move deduction: what's left is
    // exactly what a human has to reason harder about.
    const forced = forcedOnly(clues, cands, rows, cols);
    const rating = forced.solved ? 'easy' : forced.remaining <= 4 ? 'medium' : 'hard';

    const result = {
      type: 'shikaku',
      difficulty: rating,
      rows,
      cols,
      // Clue list: {r, c, value}. Everything else is blank.
      clues,
      // Solution rectangles: {r0, c0, h, w, value}.
      solution: solution.map(({ r0, c0, h, w, value }) => ({ r0, c0, h, w, value })),
      stats: {
        rectangles: rects.length,
        avgArea: +((rows * cols) / rects.length).toFixed(2),
        forcedRounds: forced.rounds,
        unforced: forced.remaining,
      },
    };

    if (rating === (opts.difficulty ?? 'medium')) return result;
    // Keep the closest miss in case the target never turns up.
    if (!fallback || (wantSearch && !forced.solved)) fallback = result;
  }

  if (fallback) return fallback;
  throw new Error(`shikaku: no unique puzzle found in ${maxAttempts} attempts`);
}

export const meta = {
  type: 'shikaku',
  name: 'Rectangles',
  blurb:
    'Divide the grid into rectangles. Each rectangle holds exactly one number, and that number is its area.',
  difficulties: ['easy', 'medium', 'hard'],
};
