#!/usr/bin/env node
/**
 * Build index.html for one day.
 *
 *   node scripts/build-site.js              # today
 *   node scripts/build-site.js 2026-09-01
 *
 * Puzzle data is read from puzzles/YYYY-MM-DD.json and rendered locally. The
 * Anthropic API is used only for the day's short written copy — the greeting,
 * one strategy tip, and a math note.
 *
 * Puzzle data is deliberately never sent to the model. It would cost tokens on
 * every build, and a model reformatting a grid could only ever make it worse.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dateKey } from '../v1/index.js';
import { renderPuzzle } from '../v1/render/svg.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TZ = process.env.PUZZLE_TZ || 'America/New_York';
const MODEL = process.env.PUZZLE_MODEL || 'claude-haiku-4-5-20251001';

const SITE_TITLE = process.env.PUZZLE_SITE_TITLE || 'Daily Puzzles';
const SITE_BYLINE = process.env.PUZZLE_SITE_BYLINE || 'Mr. Wyatt · Mathematics';

/* ---------- the day's copy ---------- */

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
    greeting: 'Four puzzles. Pencil optional, patience required.',
    tipFor: pick,
    tip: tips[pick] ?? tips.sudoku,
    noteTitle: 'Today',
    note: 'Every puzzle below has exactly one solution, checked before it was published.',
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

/* ---------- page ---------- */

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const LABELS = {
  sudoku: { name: 'Sudoku', rule: 'Every row, column, and 3×3 box holds 1 through 9.' },
  shikaku: {
    name: 'Rectangles',
    rule: 'Divide the grid into rectangles. Each holds one number, equal to its area.',
  },
  slitherlink: {
    name: 'Loop',
    rule: 'Draw one closed loop on the grid lines. A number counts how many of that cell’s sides it uses.',
  },
  wordsearch: { name: 'Word search', rule: 'Any direction, including backwards and diagonal.' },
  wordle: {
    name: 'Word guess',
    rule: 'Guess the five-letter word in six tries. Any five letters are accepted.',
  },
};

function puzzleSection(p, index, tip) {
  const label = LABELS[p.type] ?? { name: p.type, rule: '' };
  const id = `p-${p.type}`;
  const meta = [];
  if (p.type === 'sudoku') meta.push(`${p.clues} clues`);
  if (p.type === 'shikaku') meta.push(`${p.clues.length} rectangles`);
  if (p.type === 'slitherlink') meta.push(`${p.stats.clueCount} clues`);
  if (p.type === 'wordsearch') meta.push(`${p.words.length} terms`);
  if (p.type === 'wordle') meta.push(`${p.maxGuesses} tries`);
  if (p.theme) meta.push(p.theme);

  const wordList =
    p.type === 'wordsearch'
      ? `<ul class="wordlist">${p.words
          .slice()
          .sort((a, b) => a.localeCompare(b))
          .map((w) => `<li>${esc(w)}</li>`)
          .join('')}</ul>`
      : '';

  // Every other puzzle ships static SVG for print and no-JS. A word guess has
  // nothing to draw — the board is blank until someone plays, and printing the
  // answer would defeat it — so it gets a plain notice instead.
  const fallback =
    p.type === 'wordle'
      ? `<figure class="pz-fallback grid-wrap">
    <p class="pz-nojs">This one needs JavaScript, and there's nothing to print — the board fills in as you guess.</p>
  </figure>`
      : `<figure class="pz-fallback grid-wrap" data-solved="false">
    <div class="grid-layer grid-puzzle">${renderPuzzle(p, { showSolution: false })}</div>
    <div class="grid-layer grid-answer">${renderPuzzle(p, { showSolution: true })}</div>
    ${wordList}
    <button class="reveal" type="button" aria-expanded="false" data-target="${id}">Show solution</button>
  </figure>`;

  return `
<section class="sheet" id="${id}" data-sheet="${esc(p.type)}">
  <header class="sheet-head">
    <p class="sheet-index">Sheet ${String(index + 1).padStart(2, '0')}</p>
    <h2 class="sheet-title">${esc(label.name)}</h2>
    <p class="sheet-meta"><span class="chip chip-${esc(p.difficulty)}">${esc(p.difficulty)}</span>${meta
      .map((m) => `<span>${esc(m)}</span>`)
      .join('')}</p>
    <p class="sheet-rule">${label.rule}</p>
  </header>
  ${tip ? `<aside class="tip"><span class="tip-label">Try this</span><p>${esc(tip)}</p></aside>` : ''}
  <div class="pz-play" data-play-slot="${esc(p.type)}"></div>
  ${fallback}
</section>`;
}

function page(set, copy) {
  const dk = set.date;
  const d = new Date(`${dk}T12:00:00Z`);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const rest = d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const sections = set.puzzles
    .map((p, i) => puzzleSection(p, i, copy.tipFor === p.type ? copy.tip : null))
    .join('\n');

  const nav = set.puzzles
    .map((p) => `<a href="#p-${p.type}">${esc((LABELS[p.type] ?? { name: p.type }).name)}</a>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SITE_TITLE)} · ${esc(rest)}</title>
<meta name="description" content="Four hand-verified math puzzles for ${esc(rest)}: sudoku, rectangles, loop, and a word search.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="v1/play/play.css">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
<style>
:root {
  --paper: #eeeff2;
  --paper-deep: #e3e5ea;
  --ink: #1f1e24;
  --ink-soft: #55535f;
  --ditto: #55429b;
  --ditto-pale: #c9c2e6;
  --flag: #c8452a;
  --rule: #b9bcc6;

  --puzzle-ink: var(--ink);
  --puzzle-rule: var(--rule);
  --puzzle-accent: var(--ditto);
  --puzzle-tint: rgba(85, 66, 155, 0.13);
  --puzzle-tint-2: rgba(85, 66, 155, 0.045);
  --puzzle-paper: var(--paper);

  --display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --body: "Newsreader", Georgia, serif;
  --mono: "Courier Prime", ui-monospace, monospace;
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; scroll-padding-top: 4.5rem; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--body);
  font-size: 1.0625rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* Duplicator paper: faint fibre noise, kept very low so grids stay crisp. */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.055'/%3E%3C/svg%3E");
}

.wrap { position: relative; z-index: 1; max-width: 46rem; margin: 0 auto; padding: 0 1.25rem 5rem; }

/* ---- masthead: the signature. Two-colour ditto print, slightly off-register. ---- */

.masthead { padding: 4.5rem 0 2rem; }

.masthead-byline {
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ditto);
  margin: 0 0 1.75rem;
}

.datestamp { position: relative; margin: 0; line-height: 0.86; }

.datestamp .weekday,
.datestamp .rest { display: block; font-family: var(--display); }

.datestamp .weekday {
  font-size: clamp(3.25rem, 13vw, 6.5rem);
  font-weight: 800;
  letter-spacing: -0.045em;
  color: var(--ink);
  /* The signature: a violet second impression, printed a hair off-register.
     Kept tight — push it further and it stops being a misprint and starts
     being a drop shadow. */
  text-shadow: -0.032em -0.022em 0 var(--ditto-pale);
}

.datestamp .rest {
  font-size: clamp(1rem, 3.4vw, 1.5rem);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--ditto);
  margin-top: 0.7rem;
}

.greeting {
  font-size: clamp(1.125rem, 3vw, 1.4rem);
  font-style: italic;
  color: var(--ink-soft);
  max-width: 30ch;
  margin: 2rem 0 0;
}

/* ---- sticky index ---- */

.index-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 1.25rem;
  padding: 0.85rem 0;
  margin-bottom: 2.5rem;
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--rule);
  border-top: 2px solid var(--ink);
}

.index-bar a {
  font-family: var(--mono);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-soft);
  text-decoration: none;
}

.index-bar a:hover,
.index-bar a:focus-visible { color: var(--ditto); text-decoration: underline; }

/* ---- sheets ---- */

.sheet { padding: 2.5rem 0 3rem; border-top: 1px solid var(--rule); }
.sheet:first-of-type { border-top: none; padding-top: 0.5rem; }

.sheet-head { margin-bottom: 1.5rem; }

.sheet-index {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ditto);
  margin: 0 0 0.35rem;
}

.sheet-title {
  font-family: var(--display);
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  margin: 0 0 0.7rem;
}

.sheet-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.85rem;
  font-family: var(--mono);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin: 0 0 0.6rem;
}

.chip {
  padding: 0.1rem 0.5rem 0.14rem;
  border: 1px solid currentColor;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.7rem;
}
.chip-easy { color: #3f6b4a; }
.chip-medium { color: var(--ditto); }
.chip-hard { color: var(--flag); }
.chip-expert { color: var(--flag); font-weight: 700; }

.sheet-rule { margin: 0; color: var(--ink-soft); max-width: 46ch; }

.tip {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0 0 1.5rem;
  padding: 0.9rem 1.1rem;
  background: var(--paper-deep);
  border-left: 3px solid var(--ditto);
}

.tip-label {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ditto);
}

.tip p { margin: 0; }

/* ---- grids ---- */

.grid-wrap { margin: 0; }
.grid-layer { display: none; }
.grid-wrap[data-solved="false"] .grid-puzzle { display: block; }
.grid-wrap[data-solved="true"] .grid-answer { display: block; }

.puzzle-svg { display: block; width: 100%; max-width: 30rem; height: auto; }

.pz-num { font-family: var(--mono); font-size: 21px; font-weight: 700; }
.pz-given { font-weight: 700; }
.pz-solved { font-weight: 400; }
.pz-letter { font-family: var(--mono); font-size: 17px; letter-spacing: 0; }

.wordlist {
  columns: 2;
  column-gap: 2rem;
  list-style: none;
  padding: 0;
  margin: 1.5rem 0 0;
  max-width: 30rem;
  font-family: var(--mono);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.wordlist li { break-inside: avoid; padding: 0.1rem 0; }

.reveal {
  appearance: none;
  margin-top: 1.75rem;
  padding: 0.55rem 1.1rem;
  font-family: var(--mono);
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink);
  background: transparent;
  border: 1.5px solid var(--ink);
  border-radius: 2px;
  cursor: pointer;
}
.reveal:hover { color: var(--paper); background: var(--ditto); border-color: var(--ditto); }
.reveal[aria-expanded="true"] { color: var(--paper); background: var(--flag); border-color: var(--flag); }

:focus-visible { outline: 2px solid var(--ditto); outline-offset: 3px; }

/* ---- note + footer ---- */

.note { padding: 2.5rem 0; border-top: 2px solid var(--ink); }
.note h2 {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ditto);
  margin: 0 0 0.5rem;
}
.note p { margin: 0; font-size: 1.1875rem; max-width: 42ch; }

.foot {
  padding-top: 2rem;
  border-top: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: 0.72rem;
  line-height: 1.9;
  color: var(--ink-soft);
}
.foot a { color: var(--ditto); }
.foot code { background: var(--paper-deep); padding: 0.1rem 0.3rem; }

/* ---- print: this is a worksheet, so it has to print cleanly ---- */

@media print {
  :root { --paper: #fff; --paper-deep: #f2f2f2; --ditto: #333; --ditto-pale: transparent; --flag: #333; }
  body { font-size: 11pt; }
  body::before, .index-bar, .reveal, .tip, .foot { display: none; }
  .wrap { max-width: none; padding: 0; }
  .masthead { padding: 0 0 1rem; }
  .datestamp .weekday { font-size: 28pt; text-shadow: none; }
  .sheet { page-break-before: always; border-top: none; padding: 0; }
  .sheet:first-of-type { page-break-before: avoid; }
  /* Answers stay hidden on paper. */
  .grid-wrap[data-solved="true"] .grid-answer { display: none; }
  .grid-wrap[data-solved="true"] .grid-puzzle { display: block; }
  .puzzle-svg { max-width: 15.5cm; }
}
</style>
</head>
<body>
<div class="wrap">

<header class="masthead">
  <p class="masthead-byline">${esc(SITE_BYLINE)}</p>
  <h1 class="datestamp">
    <span class="weekday">${esc(weekday)}</span>
    <span class="rest">${esc(rest)}</span>
  </h1>
  <p class="greeting">${esc(copy.greeting)}</p>
</header>

<nav class="index-bar" aria-label="Puzzles">${nav}</nav>

<main>
${sections}
</main>

<section class="note">
  <h2>${esc(copy.noteTitle || 'Note')}</h2>
  <p>${esc(copy.note || '')}</p>
</section>

<footer class="foot">
  <p>Built ${esc(set.generatedAt.slice(0, 16).replace('T', ' '))} UTC · library ${esc(set.version)} · copy ${esc(copy.source)}</p>
  <p>Every puzzle is checked for a unique solution before publishing.</p>
  <p>Pull today's puzzles as data: <code>puzzles/${esc(dk)}.json</code> · <a href="puzzles/index.json">all dates</a></p>
</footer>

</div>
<script type="application/json" id="puzzle-data">${JSON.stringify(set).replace(/</g, '\\u003c')}</script>
<script>
// Fallback controls: these run whether or not the interactive layer loads.
for (const button of document.querySelectorAll('.reveal')) {
  button.addEventListener('click', () => {
    const figure = document.getElementById(button.dataset.target).querySelector('.grid-wrap');
    const solved = figure.dataset.solved === 'true';
    figure.dataset.solved = String(!solved);
    button.setAttribute('aria-expanded', String(!solved));
    button.textContent = solved ? 'Show solution' : 'Hide solution';
  });
}
</script>
<script type="module">
import { hydrate } from './v1/play/index.js';
hydrate();
</script>
</body>
</html>
`;
}

/* ---------- main ---------- */

const explicit = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const dk = explicit ?? dateKey(new Date(), TZ);
const puzzleFile = join(ROOT, 'puzzles', `${dk}.json`);

if (!existsSync(puzzleFile)) {
  console.error(`No puzzles for ${dk}. Run: node scripts/generate-daily.js ${dk}`);
  process.exit(1);
}

const set = JSON.parse(readFileSync(puzzleFile, 'utf8'));
const copy = await fetchCopy(dk, set.puzzles);
const html = page(set, copy);

writeFileSync(join(ROOT, 'index.html'), html);
mkdirSync(join(ROOT, 'archive'), { recursive: true });
writeFileSync(join(ROOT, 'archive', `${dk}.html`), html);

console.log(`  built index.html + archive/${dk}.html (${(html.length / 1024).toFixed(1)} KB)`);
