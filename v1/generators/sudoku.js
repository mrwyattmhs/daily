/**
 * Sudoku.
 *
 * Build a full valid grid by randomized backtracking, then remove clues one at
 * a time, keeping a removal only if the puzzle still has exactly one solution.
 * Difficulty is rated by which human technique is needed, not by clue count —
 * clue count is a poor proxy.
 */

const N = 9;
const CELLS = 81;

// Precomputed peer sets: for each cell, the 20 cells sharing a row, column, or box.
const PEERS = (() => {
  const peers = [];
  for (let i = 0; i < CELLS; i++) {
    const r = Math.floor(i / N);
    const c = i % N;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    const set = new Set();
    for (let k = 0; k < N; k++) {
      set.add(r * N + k);
      set.add(k * N + c);
    }
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) set.add((br + dr) * N + bc + dc);
    }
    set.delete(i);
    peers.push([...set]);
  }
  return peers;
})();

// The 27 units (9 rows, 9 columns, 9 boxes), used by the difficulty rater.
const UNITS = (() => {
  const units = [];
  for (let r = 0; r < N; r++) units.push(Array.from({ length: N }, (_, c) => r * N + c));
  for (let c = 0; c < N; c++) units.push(Array.from({ length: N }, (_, r) => r * N + c));
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const u = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) u.push((br * 3 + dr) * N + bc * 3 + dc);
      }
      units.push(u);
    }
  }
  return units;
})();

function canPlace(grid, i, v) {
  for (const p of PEERS[i]) if (grid[p] === v) return false;
  return true;
}

/** Fill an empty grid with a random complete solution. */
function fillGrid(grid, rng, i = 0) {
  if (i === CELLS) return true;
  if (grid[i] !== 0) return fillGrid(grid, rng, i + 1);
  const vals = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const v of vals) {
    if (!canPlace(grid, i, v)) continue;
    grid[i] = v;
    if (fillGrid(grid, rng, i + 1)) return true;
    grid[i] = 0;
  }
  return false;
}

/**
 * Count solutions, stopping at `cap`. Returns the count (so 2 means
 * "2 or more"). Picks the most-constrained empty cell to keep the tree small.
 */
function countSolutions(grid, cap = 2) {
  let best = -1;
  let bestCands = null;
  for (let i = 0; i < CELLS; i++) {
    if (grid[i] !== 0) continue;
    const cands = [];
    for (let v = 1; v <= 9; v++) if (canPlace(grid, i, v)) cands.push(v);
    if (cands.length === 0) return 0;
    if (bestCands === null || cands.length < bestCands.length) {
      best = i;
      bestCands = cands;
      if (cands.length === 1) break;
    }
  }
  if (best === -1) return 1; // no empty cells: solved
  let total = 0;
  for (const v of bestCands) {
    grid[best] = v;
    total += countSolutions(grid, cap - total);
    grid[best] = 0;
    if (total >= cap) return total;
  }
  return total;
}

/* ---------- difficulty rating ---------- */

function candidateMap(grid) {
  const cands = new Array(CELLS).fill(0).map(() => new Set());
  for (let i = 0; i < CELLS; i++) {
    if (grid[i] !== 0) continue;
    for (let v = 1; v <= 9; v++) if (canPlace(grid, i, v)) cands[i].add(v);
  }
  return cands;
}

/**
 * Solve using only human techniques, in increasing order of difficulty.
 * Returns the hardest technique level required, or null if the puzzle can't be
 * finished without guessing.
 *   1 = naked singles only
 *   2 = hidden singles needed
 *   3 = locked candidates (pointing / box-line) needed
 */
function rateByTechnique(puzzle) {
  const grid = puzzle.slice();
  let cands = candidateMap(grid);
  let hardest = 1;

  const place = (i, v) => {
    grid[i] = v;
    cands[i].clear();
    for (const p of PEERS[i]) cands[p].delete(v);
  };

  for (;;) {
    if (!grid.includes(0)) return hardest;

    // Naked single: a cell with exactly one candidate.
    let moved = false;
    for (let i = 0; i < CELLS; i++) {
      if (grid[i] === 0 && cands[i].size === 1) {
        place(i, [...cands[i]][0]);
        moved = true;
      }
      if (grid[i] === 0 && cands[i].size === 0) return null; // contradiction
    }
    if (moved) continue;

    // Hidden single: a value with only one possible home in some unit.
    for (const unit of UNITS) {
      for (let v = 1; v <= 9; v++) {
        if (unit.some((i) => grid[i] === v)) continue;
        const spots = unit.filter((i) => grid[i] === 0 && cands[i].has(v));
        if (spots.length === 1) {
          place(spots[0], v);
          hardest = Math.max(hardest, 2);
          moved = true;
        }
      }
    }
    if (moved) continue;

    // Locked candidates: if all homes for v in a box share a row/column, v is
    // eliminated from the rest of that row/column — and vice versa.
    for (let v = 1; v <= 9; v++) {
      for (const unit of UNITS) {
        const spots = unit.filter((i) => grid[i] === 0 && cands[i].has(v));
        if (spots.length < 2 || spots.length > 3) continue;
        const rows = new Set(spots.map((i) => Math.floor(i / N)));
        const cols = new Set(spots.map((i) => i % N));
        const boxes = new Set(
          spots.map((i) => Math.floor(Math.floor(i / N) / 3) * 3 + Math.floor((i % N) / 3)),
        );
        const targets = [];
        if (rows.size === 1) targets.push(UNITS[[...rows][0]]);
        if (cols.size === 1) targets.push(UNITS[9 + [...cols][0]]);
        if (boxes.size === 1) targets.push(UNITS[18 + [...boxes][0]]);
        for (const t of targets) {
          for (const i of t) {
            if (grid[i] === 0 && !spots.includes(i) && cands[i].has(v)) {
              cands[i].delete(v);
              hardest = Math.max(hardest, 3);
              moved = true;
            }
          }
        }
      }
    }
    if (moved) continue;

    return null; // stuck: needs a technique we don't model, or a guess
  }
}

const LEVEL_NAMES = { 1: 'easy', 2: 'medium', 3: 'hard', 4: 'expert' };

/* ---------- generation ---------- */

/** One candidate puzzle: dig out as many clues as uniqueness allows. */
function attempt(rng, symmetric) {
  const solution = new Array(CELLS).fill(0);
  fillGrid(solution, rng);

  const puzzle = solution.slice();
  const order = rng.shuffle(Array.from({ length: CELLS }, (_, i) => i));
  for (const i of order) {
    const uniq = symmetric ? [...new Set([i, CELLS - 1 - i])] : [i];
    if (uniq.every((j) => puzzle[j] === 0)) continue;
    const saved = uniq.map((j) => puzzle[j]);
    uniq.forEach((j) => (puzzle[j] = 0));
    if (countSolutions(puzzle.slice(), 2) !== 1) {
      uniq.forEach((j, k) => (puzzle[j] = saved[k]));
    }
  }
  return { puzzle, solution, level: rateByTechnique(puzzle) ?? 4 };
}

/**
 * Hand clues back until the puzzle is no harder than `targetLevel`.
 *
 * Adding a single clue can drop the rating by more than one level, so prefer a
 * cell that lands exactly on the target; only accept an undershoot if no single
 * cell does. Without this, a "medium" request lands on "easy" fairly often.
 */
function soften(cand, rng, targetLevel) {
  const { puzzle, solution } = cand;
  while (cand.level > targetLevel) {
    const blanks = rng.shuffle(
      Array.from({ length: CELLS }, (_, i) => i).filter((i) => puzzle[i] === 0),
    );
    if (blanks.length === 0) break;

    let fallback = null;
    let landed = false;
    for (const i of blanks) {
      puzzle[i] = solution[i];
      const level = rateByTechnique(puzzle) ?? 4;
      if (level === targetLevel) {
        cand.level = level;
        landed = true;
        break;
      }
      if (level < cand.level && fallback === null) fallback = { i, level };
      puzzle[i] = 0;
    }
    if (landed) break;
    if (fallback !== null) {
      puzzle[fallback.i] = solution[fallback.i];
      cand.level = fallback.level;
      continue;
    }
    // No single clue lowers the rating. Add one anyway and keep going — more
    // clues always trend easier, so this terminates.
    const i = blanks[0];
    puzzle[i] = solution[i];
    cand.level = rateByTechnique(puzzle) ?? 4;
  }
  return cand;
}

/**
 * @param {Rng} rng
 * @param {object} [opts]
 * @param {'easy'|'medium'|'hard'|'expert'} [opts.difficulty='medium']
 * @param {boolean} [opts.symmetric] Remove clues in 180°-rotational pairs.
 *   Defaults to true for easy/medium, false for hard/expert (asymmetric digging
 *   removes more clues, which is what makes a puzzle hard).
 * @param {number} [opts.maxAttempts=24] Candidates to search for hard targets.
 */
export function generate(rng, opts = {}) {
  const { difficulty = 'medium', maxAttempts = 24 } = opts;
  const targetLevel = { easy: 1, medium: 2, hard: 3, expert: 4 }[difficulty] ?? 2;
  const symmetric = opts.symmetric ?? targetLevel <= 2;

  let best = null;
  for (let k = 0; k < maxAttempts; k++) {
    const cand = attempt(rng.fork(`try-${k}`), symmetric);

    // Digging maximises removals, so candidates skew hard. An easy or medium
    // target is always reachable by handing clues back; a hard one is not, so
    // for those we keep searching for a candidate that's naturally hard enough.
    if (targetLevel <= 2) return finish(soften(cand, rng, targetLevel));

    if (!best || cand.level > best.level) best = cand;
    if (best.level >= targetLevel) break;
  }
  // Overshoot (e.g. an expert candidate for a "hard" request) is fixable by
  // handing clues back. Undershoot is not — in that case return the hardest we
  // found and label it honestly rather than claiming a difficulty it lacks.
  if (best.level > targetLevel) soften(best, rng, targetLevel);
  return finish(best);
}

function finish(cand) {
  return {
    type: 'sudoku',
    difficulty: LEVEL_NAMES[cand.level],
    size: N,
    clues: cand.puzzle.filter((v) => v !== 0).length,
    // Row-major, 0 = blank.
    puzzle: cand.puzzle,
    solution: cand.solution,
  };
}

export const meta = {
  type: 'sudoku',
  name: 'Sudoku',
  blurb: 'Fill the grid so every row, column, and 3×3 box holds 1 through 9.',
  difficulties: ['easy', 'medium', 'hard', 'expert'],
};
