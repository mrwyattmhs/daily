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

// Deep enough that a long weekend, a broken workflow or a school holiday can't
// drain it before someone notices. Each day is about 13KB.
const DEFAULT_DAYS = Number(process.env.PUZZLE_DAYS || 30);
// Past days kept for the day picker. Older files are pruned.
const KEEP_PAST = Number(process.env.PUZZLE_KEEP_PAST || 7);

const MODEL = process.env.PUZZLE_MODEL || 'claude-haiku-4-5-20251001';

const vocab = JSON.parse(readFileSync(join(ROOT, 'v1/data/vocab.json'), 'utf8'));
const words5 = JSON.parse(readFileSync(join(ROOT, 'v1/data/words5.json'), 'utf8'));

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** Spell a small count, so copy reads naturally and can't go stale. */
function countWord(n) {
  return COUNT_WORDS[n] ?? String(n);
}

/**
 * Deterministic fallback copy. Used when no API key is set or the call fails,
 * so a build never breaks over a missing greeting.
 */
function fallbackCopy(dk, types) {
  const tips = {
    sudoku: 'Scan for the digit that appears most often already — it usually has one forced home left.',
    shikaku: 'Start with prime numbers. A 5 or a 7 can only be a 1-wide strip, so its shape is fixed.',
    slitherlink:
      'A 0 is the strongest clue on the board. Mark all four of its sides as empty before anything else.',
    wordsearch: 'Hunt for uncommon letters first — one X or Q narrows a word to a couple of places.',
  };
  const day = Math.floor(Date.parse(`${dk}T00:00:00Z`) / 86400000);
  const pick = types[day % types.length];
  return {
    // Derived, not hardcoded: this line said "Four puzzles" for a week after a
    // fifth was added.
    greeting: `${countWord(types.length)} puzzles. Pencil optional, patience required.`,
    tipFor: pick,
    tip: tips[pick] ?? tips.sudoku,
    noteTitle: 'Today',
    note: 'Every grid below was checked for a single solution before it was published.',
    source: 'fallback',
  };
}

async function fetchCopy(dk, puzzles) {
  const key = process.env.ANTHROPIC_API_KEY;
  const types = puzzles.map((p) => p.type);
  if (!key) {
    console.log('  copy: no ANTHROPIC_API_KEY, using fallback');
    return fallbackCopy(dk, types);
  }

  const readable = new Date(`${dk}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const lineup = puzzles.map((p) => `${p.type} (${p.difficulty})`).join(', ');

  const prompt = `You write the daily copy for a high school math teacher's puzzle page.

Date: ${readable}
Today's lineup: ${lineup}

Return ONLY a JSON object, no markdown fences and no preamble, with these keys:
- "greeting": one sentence, under 15 words, for high school students. Dry and warm, never peppy. No exclamation marks.
- "tipFor": exactly one of: ${types.map((t) => `"${t}"`).join(', ')}
- "tip": one solving strategy for that puzzle type, under 30 words, concrete and actionable. Describe a technique, not encouragement.
- "noteTitle": two or three words.
- "note": one interesting sentence about mathematics, under 30 words. Something a 16-year-old would find genuinely surprising. Not a motivational quote.

Do not reference specific puzzle contents; you have not seen them.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = data.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .replace(/```json|```/g, '')
      .trim();
    const parsed = JSON.parse(text);
    if (!parsed.greeting || !parsed.tip) throw new Error('missing required keys');
    if (!types.includes(parsed.tipFor)) parsed.tipFor = types[0];
    console.log(`  copy: generated with ${MODEL}`);
    return { ...parsed, source: MODEL };
  } catch (err) {
    console.warn(`  copy: API call failed (${err.message}); using fallback`);
    return fallbackCopy(dk, types);
  }
}

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

    if (p.type === 'wordle') {
      const answer = p.solution?.answer ?? '';
      if (!/^[A-Z]{5}$/.test(answer)) problems.push(`wordle: bad answer "${answer}"`);
      if (!words5.words.includes(answer)) problems.push('wordle: answer not in the pool');
      if (p.maxGuesses < 1) problems.push('wordle: maxGuesses < 1');
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

async function buildOne(dk, { force = false } = {}) {
  const out = join(PUZZLE_DIR, `${dk}.json`);
  if (existsSync(out) && !force) {
    console.log(`= ${dk} already exists, skipping`);
    return JSON.parse(readFileSync(out, 'utf8'));
  }

  const started = Date.now();
  const set = buildDailySet(dk, { vocab, words5 });
  // Written into the day's file rather than produced at page-build time: the
  // page is now a static shell and never knows which date it will show.
  set.copy = await fetchCopy(dk, set.puzzles);
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
const days = daysFlag === -1 ? DEFAULT_DAYS : Number(args[daysFlag + 1]);
const explicit = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const start = explicit ?? dateKey(new Date(), TZ);

for (let i = 0; i < days; i++) await buildOne(addDays(start, i), { force });

// Prune days that have fallen out of the picker's window. Old puzzles aren't
// worth retaining and the archive of rendered HTML was the bulk of repo growth.
const { readdirSync, rmSync } = await import('node:fs');
const todayKey = dateKey(new Date(), TZ);
const cutoff = addDays(todayKey, -KEEP_PAST);
let pruned = 0;
for (const f of readdirSync(PUZZLE_DIR)) {
  const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
  if (!m || m[1] >= cutoff) continue;
  rmSync(join(PUZZLE_DIR, f));
  pruned++;
}
if (pruned) console.log(`  pruned ${pruned} day(s) older than ${cutoff}`);

// Index of available days, so the page can pick a date and list recent ones.
const available = readdirSync(PUZZLE_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => f.replace('.json', ''))
  .sort();
writeFileSync(
  join(PUZZLE_DIR, 'index.json'),
  `${JSON.stringify({ updatedAt: new Date().toISOString(), dates: available }, null, 2)}\n`,
);
console.log(`  index.json: ${available.length} day(s)`);
