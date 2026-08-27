#!/usr/bin/env node
/**
 * Validation suite. Every check here re-derives the answer independently of the
 * code that produced it, so a bug in a solver can't validate itself.
 *
 *   npm test
 *
 * The exhaustive slitherlink check (tests/slitherlink-exhaustive.js) is not run
 * here — it enumerates 2^(rows*cols) grid states and takes about a minute per
 * puzzle. Run it by hand after changing the loop solver.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Rng, generate, buildDailySet } from '../v1/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vocab = JSON.parse(readFileSync(join(ROOT, 'v1/data/vocab.json'), 'utf8'));

let failures = 0;
function check(name, problems) {
  if (problems.length === 0) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`);
    for (const p of [...new Set(problems)].slice(0, 5)) console.log(`         ${p}`);
  }
}

/* ---------- sudoku ---------- */

function checkSudoku(p) {
  const e = [];
  const { puzzle, solution } = p;
  if (puzzle.length !== 81 || solution.length !== 81) e.push('wrong length');
  for (let u = 0; u < 9; u++) {
    const row = new Set();
    const col = new Set();
    const box = new Set();
    for (let k = 0; k < 9; k++) {
      row.add(solution[u * 9 + k]);
      col.add(solution[k * 9 + u]);
      const br = Math.floor(u / 3) * 3 + Math.floor(k / 3);
      const bc = (u % 3) * 3 + (k % 3);
      box.add(solution[br * 9 + bc]);
    }
    if (row.size !== 9) e.push(`row ${u} not a permutation`);
    if (col.size !== 9) e.push(`col ${u} not a permutation`);
    if (box.size !== 9) e.push(`box ${u} not a permutation`);
  }
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== 0 && puzzle[i] !== solution[i]) e.push('clue contradicts solution');
  }
  // Independent solution count, plain depth-first, no shared heuristics.
  const count = (g, cap = 2) => {
    const i = g.indexOf(0);
    if (i === -1) return 1;
    const r = Math.floor(i / 9);
    const c = i % 9;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    let t = 0;
    for (let v = 1; v <= 9; v++) {
      let ok = true;
      for (let k = 0; k < 9; k++) if (g[r * 9 + k] === v || g[k * 9 + c] === v) ok = false;
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) if (g[(br + dr) * 9 + bc + dc] === v) ok = false;
      }
      if (!ok) continue;
      g[i] = v;
      t += count(g, cap - t);
      g[i] = 0;
      if (t >= cap) return t;
    }
    return t;
  };
  if (count(puzzle.slice(), 2) !== 1) e.push('not uniquely solvable');
  return e;
}

/* ---------- shikaku ---------- */

function checkShikaku(p) {
  const e = [];
  const cover = new Int16Array(p.rows * p.cols).fill(-1);
  p.solution.forEach((s, k) => {
    if (s.h * s.w !== s.value) e.push('area does not equal value');
    if (s.r0 < 0 || s.c0 < 0 || s.r0 + s.h > p.rows || s.c0 + s.w > p.cols) e.push('out of bounds');
    for (let r = s.r0; r < s.r0 + s.h; r++) {
      for (let c = s.c0; c < s.c0 + s.w; c++) {
        const i = r * p.cols + c;
        if (cover[i] !== -1) e.push('rectangles overlap');
        cover[i] = k;
      }
    }
  });
  if (cover.some((v) => v === -1)) e.push('grid not fully covered');
  const per = new Map();
  for (const cl of p.clues) {
    const k = cover[cl.r * p.cols + cl.c];
    per.set(k, (per.get(k) ?? 0) + 1);
    if (p.solution[k]?.value !== cl.value) e.push('clue value mismatch');
  }
  if (per.size !== p.solution.length) e.push('rectangle without a clue');
  if ([...per.values()].some((n) => n !== 1)) e.push('rectangle with two clues');
  if (p.clues.length !== p.solution.length) e.push('clue count != rectangle count');
  return e;
}

/* ---------- slitherlink ---------- */

function checkSlitherlink(p) {
  const e = [];
  const { rows, cols, clues, solution } = p;
  const hCount = (rows + 1) * cols;
  const H = (r, c) => r * cols + c;
  const V = (r, c) => hCount + r * (cols + 1) + c;
  const inside = (r, c) =>
    r >= 0 && r < rows && c >= 0 && c < cols && solution.interior[r * cols + c] === 1;

  // Rebuild the loop from the interior mask rather than trusting solution.edges.
  const on = new Set();
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) if (inside(r - 1, c) !== inside(r, c)) on.add(H(r, c));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) if (inside(r, c - 1) !== inside(r, c)) on.add(V(r, c));
  }
  if (on.size !== solution.edges.length || solution.edges.some((x) => !on.has(x))) {
    e.push('edges disagree with interior mask');
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const want = clues[r * cols + c];
      if (want < 0) continue;
      if (want < 0 || want > 3) e.push('clue out of range');
      let n = 0;
      for (const x of [H(r, c), H(r + 1, c), V(r, c), V(r, c + 1)]) if (on.has(x)) n++;
      if (n !== want) e.push(`clue mismatch at ${r},${c}`);
    }
  }

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      let d = 0;
      if (c > 0 && on.has(H(r, c - 1))) d++;
      if (c < cols && on.has(H(r, c))) d++;
      if (r > 0 && on.has(V(r - 1, c))) d++;
      if (r < rows && on.has(V(r, c))) d++;
      if (d !== 0 && d !== 2) e.push(`vertex degree ${d}`);
    }
  }

  // Walk the edge set: a single loop visits every on-edge exactly once.
  const vertsOf = (x) => {
    if (x < hCount) {
      const r = Math.floor(x / cols);
      const c = x % cols;
      return [r * (cols + 1) + c, r * (cols + 1) + c + 1];
    }
    const i = x - hCount;
    const r = Math.floor(i / (cols + 1));
    const c = i % (cols + 1);
    return [r * (cols + 1) + c, (r + 1) * (cols + 1) + c];
  };
  const edges = [...on];
  if (edges.length < 4) e.push('loop too short');
  else {
    const inc = new Map();
    for (const x of edges) {
      for (const v of vertsOf(x)) {
        if (!inc.has(v)) inc.set(v, []);
        inc.get(v).push(x);
      }
    }
    const used = new Set();
    let cur = edges[0];
    let at = vertsOf(cur)[0];
    const start = at;
    for (let guard = 0; guard <= edges.length; guard++) {
      used.add(cur);
      const [a, b] = vertsOf(cur);
      at = at === a ? b : a;
      if (at === start) break;
      const next = (inc.get(at) ?? []).find((x) => !used.has(x));
      if (next === undefined) {
        e.push('walk hit a dead end');
        break;
      }
      cur = next;
    }
    if (used.size !== edges.length) e.push('more than one loop');
  }
  return e;
}

/* ---------- word search ---------- */

const DIR = {
  E: [0, 1], W: [0, -1], S: [1, 0], N: [-1, 0],
  SE: [1, 1], NW: [-1, -1], SW: [1, -1], NE: [-1, 1],
};

function checkWordsearch(p) {
  const e = [];
  if (p.grid.length !== p.rows * p.cols) e.push('grid size mismatch');
  if (p.grid.some((ch) => !/^[A-Z]$/.test(ch))) e.push('cell outside A-Z');
  for (const pl of p.solution.placements) {
    const [dr, dc] = DIR[pl.direction] ?? [];
    if (dr === undefined) {
      e.push(`bad direction ${pl.direction}`);
      continue;
    }
    let r = pl.row;
    let c = pl.col;
    for (const ch of pl.letters) {
      if (r < 0 || r >= p.rows || c < 0 || c >= p.cols) {
        e.push(`${pl.word} runs off the grid`);
        break;
      }
      if (p.grid[r * p.cols + c] !== ch) {
        e.push(`${pl.word} not present at stated position`);
        break;
      }
      r += dr;
      c += dc;
    }
  }
  if (p.words.length !== p.solution.placements.length) e.push('word list length mismatch');
  if (p.unplaced.length) e.push(`unplaced: ${p.unplaced.join(', ')}`);
  return e;
}

const CHECKS = {
  sudoku: checkSudoku,
  shikaku: checkShikaku,
  slitherlink: checkSlitherlink,
  wordsearch: checkWordsearch,
};

/* ---------- run ---------- */

console.log('\nSudoku, all difficulties');
for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
  const problems = [];
  const rated = [];
  for (let i = 0; i < 4; i++) {
    const p = generate('sudoku', new Rng(`t-sudoku-${difficulty}-${i}`), { difficulty });
    problems.push(...checkSudoku(p));
    rated.push(p.difficulty);
  }
  check(`${difficulty} (rated: ${rated.join(', ')})`, problems);
}

console.log('\nRectangles, all difficulties');
for (const difficulty of ['easy', 'medium', 'hard']) {
  const problems = [];
  for (let i = 0; i < 4; i++) {
    problems.push(...checkShikaku(generate('shikaku', new Rng(`t-sk-${difficulty}-${i}`), { difficulty })));
  }
  check(difficulty, problems);
}

console.log('\nLoop, all difficulties');
for (const difficulty of ['easy', 'medium', 'hard']) {
  const problems = [];
  for (let i = 0; i < 3; i++) {
    problems.push(
      ...checkSlitherlink(generate('slitherlink', new Rng(`t-sl-${difficulty}-${i}`), { difficulty })),
    );
  }
  check(difficulty, problems);
}

console.log('\nWord search, every vocabulary unit');
for (const [key, unit] of Object.entries(vocab.units)) {
  const p = generate('wordsearch', new Rng(`t-ws-${key}`), { words: unit.words, theme: unit.label });
  check(`${key} (${p.rows}x${p.cols}, ${p.words.length} terms)`, checkWordsearch(p));
}

console.log('\nDaily sets');
for (const date of ['2026-01-01', '2026-02-28', '2026-06-15', '2026-08-27', '2026-12-31']) {
  const set = buildDailySet(date, { vocab });
  const problems = [];
  for (const p of set.puzzles) problems.push(...(CHECKS[p.type]?.(p) ?? [`no check for ${p.type}`]));
  if (set.puzzles.length !== 4) problems.push(`expected 4 puzzles, got ${set.puzzles.length}`);
  check(`${date} (${set.puzzles.map((p) => p.difficulty).join(', ')})`, problems);
}

console.log('\nDeterminism');
{
  const strip = (s) => JSON.stringify({ ...s, generatedAt: null });
  const a = strip(buildDailySet('2026-08-27', { vocab }));
  const b = strip(buildDailySet('2026-08-27', { vocab }));
  const c = strip(buildDailySet('2026-08-28', { vocab }));
  check('same date gives identical puzzles', a === b ? [] : ['two builds of one date differ']);
  check('different dates give different puzzles', a !== c ? [] : ['two dates produced the same set']);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
