#!/usr/bin/env node
/**
 * Generate one day's puzzles and write puzzles/YYYY-MM-DD.json.
 *
 *   node scripts/generate-daily.js              # today, America/New_York
 *   node scripts/generate-daily.js 2026-09-01   # a specific date
 *   node scripts/generate-daily.js --days 7     # today plus the next 6
 *
 * Uniqueness checking is the expensive part, and it runs here rather than in
 * the browser so a slow seed can never stall the page.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDailySet, dateKey } from '../v1/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUZZLE_DIR = join(ROOT, 'puzzles');
const TZ = process.env.PUZZLE_TZ || 'America/New_York';

const vocab = JSON.parse(readFileSync(join(ROOT, 'v1/data/vocab.json'), 'utf8'));

function addDays(dk, n) {
  const d = new Date(`${dk}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Re-check the generated puzzles before publishing. Cheap insurance: a bad
 * push here would put a broken puzzle in front of a class.
 */
function verify(set) {
  const problems = [];

  for (const p of set.puzzles) {
    if (p.type === 'sudoku') {
      const { puzzle, solution } = p;
      if (puzzle.length !== 81 || solution.length !== 81) problems.push('sudoku: wrong size');
      for (let i = 0; i < 81; i++) {
        if (puzzle[i] !== 0 && puzzle[i] !== solution[i]) problems.push('sudoku: clue conflicts');
      }
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
        if (row.size !== 9 || col.size !== 9 || box.size !== 9) {
          problems.push('sudoku: solution invalid');
        }
      }
    }

    if (p.type === 'shikaku') {
      const cover = new Int16Array(p.rows * p.cols).fill(-1);
      for (const [k, s] of p.solution.entries()) {
        if (s.h * s.w !== s.value) problems.push('shikaku: area != value');
        for (let r = s.r0; r < s.r0 + s.h; r++) {
          for (let c = s.c0; c < s.c0 + s.w; c++) {
            const i = r * p.cols + c;
            if (i < 0 || i >= cover.length || cover[i] !== -1) {
              problems.push('shikaku: overlap or out of bounds');
            } else cover[i] = k;
          }
        }
      }
      if (cover.some((v) => v === -1)) problems.push('shikaku: grid not fully covered');
      const per = new Map();
      for (const cl of p.clues) {
        const k = cover[cl.r * p.cols + cl.c];
        per.set(k, (per.get(k) ?? 0) + 1);
        if (p.solution[k]?.value !== cl.value) problems.push('shikaku: clue value mismatch');
      }
      if (per.size !== p.solution.length) problems.push('shikaku: rectangle without a clue');
      if ([...per.values()].some((n) => n !== 1)) problems.push('shikaku: rectangle with two clues');
    }

    if (p.type === 'slitherlink') {
      const { rows, cols, clues, solution } = p;
      const hCount = (rows + 1) * cols;
      const H = (r, c) => r * cols + c;
      const V = (r, c) => hCount + r * (cols + 1) + c;
      const inside = (r, c) =>
        r >= 0 && r < rows && c >= 0 && c < cols && solution.interior[r * cols + c] === 1;
      const on = new Set();
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c < cols; c++) if (inside(r - 1, c) !== inside(r, c)) on.add(H(r, c));
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c <= cols; c++) if (inside(r, c - 1) !== inside(r, c)) on.add(V(r, c));
      }
      if (on.size !== solution.edges.length || solution.edges.some((e) => !on.has(e))) {
        problems.push('slitherlink: edges disagree with interior');
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const want = clues[r * cols + c];
          if (want < 0) continue;
          let n = 0;
          for (const e of [H(r, c), H(r + 1, c), V(r, c), V(r, c + 1)]) if (on.has(e)) n++;
          if (n !== want) problems.push(`slitherlink: clue mismatch at ${r},${c}`);
        }
      }
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          let d = 0;
          if (c > 0 && on.has(H(r, c - 1))) d++;
          if (c < cols && on.has(H(r, c))) d++;
          if (r > 0 && on.has(V(r - 1, c))) d++;
          if (r < rows && on.has(V(r, c))) d++;
          if (d !== 0 && d !== 2) problems.push('slitherlink: bad vertex degree');
        }
      }
    }

    if (p.type === 'wordsearch') {
      const DIR = {
        E: [0, 1], W: [0, -1], S: [1, 0], N: [-1, 0],
        SE: [1, 1], NW: [-1, -1], SW: [1, -1], NE: [-1, 1],
      };
      if (p.grid.some((ch) => !/^[A-Z]$/.test(ch))) problems.push('wordsearch: bad cell');
      for (const pl of p.solution.placements) {
        const [dr, dc] = DIR[pl.direction];
        let r = pl.row;
        let c = pl.col;
        for (const ch of pl.letters) {
          if (r < 0 || r >= p.rows || c < 0 || c >= p.cols || p.grid[r * p.cols + c] !== ch) {
            problems.push(`wordsearch: ${pl.word} not in grid`);
            break;
          }
          r += dr;
          c += dc;
        }
      }
      if (p.unplaced.length) problems.push(`wordsearch: unplaced ${p.unplaced.join(', ')}`);
    }
  }

  return [...new Set(problems)];
}

function buildOne(dk, { force = false } = {}) {
  const out = join(PUZZLE_DIR, `${dk}.json`);
  if (existsSync(out) && !force) {
    console.log(`= ${dk} already exists, skipping`);
    return JSON.parse(readFileSync(out, 'utf8'));
  }

  const started = Date.now();
  const set = buildDailySet(dk, { vocab });
  const problems = verify(set);
  if (problems.length) {
    console.error(`FAILED ${dk}:`);
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error(`verification failed for ${dk}`);
  }

  mkdirSync(PUZZLE_DIR, { recursive: true });
  writeFileSync(out, `${JSON.stringify(set, null, 2)}\n`);

  const summary = set.puzzles.map((p) => `${p.type}/${p.difficulty}`).join(' ');
  console.log(`+ ${dk} (${Date.now() - started}ms) ${summary}`);
  return set;
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const daysFlag = args.indexOf('--days');
const days = daysFlag === -1 ? 1 : Number(args[daysFlag + 1]);
const explicit = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const start = explicit ?? dateKey(new Date(), TZ);

for (let i = 0; i < days; i++) buildOne(addDays(start, i), { force });

// Index of available days, so a site can list or link past puzzles.
const { readdirSync } = await import('node:fs');
const available = readdirSync(PUZZLE_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => f.replace('.json', ''))
  .sort();
writeFileSync(
  join(PUZZLE_DIR, 'index.json'),
  `${JSON.stringify({ updatedAt: new Date().toISOString(), dates: available }, null, 2)}\n`,
);
console.log(`  index.json: ${available.length} day(s)`);
