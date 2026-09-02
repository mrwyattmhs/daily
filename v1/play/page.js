/**
 * Client-side page builder.
 *
 * The page used to be rendered at build time for one specific date, which made
 * the site only as punctual as the nightly job — and GitHub's scheduler was
 * running hours late. Now index.html is a date-agnostic shell: it reads the
 * reader's date on load and fetches the matching puzzle file, all of which are
 * committed weeks ahead. The day rolls over at midnight Eastern whether or not
 * the workflow ran, and the job becomes a buffer top-up rather than a deadline.
 */

import { renderPuzzle } from '../render/svg.js';
import { el } from './state.js';
import { hydrate } from './index.js';

const TZ = 'America/New_York';

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

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** Today's date in the school's timezone, not the visitor's. */
export function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const dayNumber = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

function longDate(dk) {
  const d = new Date(`${dk}T12:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    rest: d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    short: d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
  };
}

/* ---------- sheets ---------- */

function sheet(puzzle, index, tip) {
  const label = LABELS[puzzle.type] ?? { name: puzzle.type, rule: '' };
  const id = `p-${puzzle.type}`;

  const meta = [];
  if (puzzle.type === 'sudoku') meta.push(`${puzzle.clues} clues`);
  if (puzzle.type === 'shikaku') meta.push(`${puzzle.clues.length} rectangles`);
  if (puzzle.type === 'slitherlink') meta.push(`${puzzle.stats.clueCount} clues`);
  if (puzzle.type === 'wordsearch') meta.push(`${puzzle.words.length} terms`);
  if (puzzle.type === 'wordle') meta.push(`${puzzle.maxGuesses} tries`);
  if (puzzle.theme) meta.push(puzzle.theme);

  const head = el(
    'header',
    { class: 'sheet-head' },
    el('p', { class: 'sheet-index', text: `Sheet ${String(index + 1).padStart(2, '0')}` }),
    el('h2', { class: 'sheet-title', text: label.name }),
    el(
      'p',
      { class: 'sheet-meta' },
      el('span', { class: `chip chip-${puzzle.difficulty}`, text: puzzle.difficulty }),
      ...meta.map((m) => el('span', { text: m })),
    ),
    el('p', { class: 'sheet-rule', text: label.rule }),
  );

  const children = [head];
  if (tip) {
    children.push(
      el(
        'aside',
        { class: 'tip' },
        el('span', { class: 'tip-label', text: 'Try this' }),
        el('p', { text: tip }),
      ),
    );
  }

  // The interactive board mounts here. A static SVG is drawn first so there is
  // something to look at (and to print) if a board fails to mount.
  const slot = el('div', { class: 'pz-play', 'data-play-slot': puzzle.type });
  const fallback = el('figure', { class: 'pz-fallback grid-wrap' });
  if (puzzle.type === 'wordle') {
    fallback.append(
      el('p', {
        class: 'pz-nojs',
        text: 'This one fills in as you guess, so there is nothing to show yet.',
      }),
    );
  } else {
    fallback.innerHTML = renderPuzzle(puzzle, { showSolution: false });
  }

  children.push(slot, fallback);
  return el('section', { class: 'sheet', id, 'data-sheet': puzzle.type }, ...children);
}

/* ---------- page ---------- */

function masthead(dk, set, { chosen = false, note = null } = {}) {
  const { weekday, rest } = longDate(dk);
  const copy = set.copy ?? {};

  const nodes = [
    el('p', { class: 'masthead-byline', text: 'Mr. Wyatt · Mathematics' }),
    el(
      'h1',
      { class: 'datestamp' },
      el('span', { class: 'weekday', text: weekday }),
      el('span', { class: 'rest', text: rest }),
    ),
    el('p', {
      class: 'greeting',
      text:
        copy.greeting ??
        `${COUNT_WORDS[set.puzzles.length] ?? set.puzzles.length} puzzles. Pencil optional, patience required.`,
    }),
  ];

  // Exactly one explanation, never two. Picking a day from the dropdown gets a
  // way back; falling back because today is missing gets the reason instead.
  if (note) {
    nodes.push(el('p', { class: 'stale-note', text: note }));
  } else if (chosen && dk !== todayKey()) {
    nodes.push(
      el(
        'p',
        { class: 'stale-note' },
        `You're looking at ${longDate(dk).short}. `,
        el('a', { href: '?', text: 'Back to today' }),
      ),
    );
  }

  nodes.push(el('div', { 'data-trophy-slot': true }));
  return el('header', { class: 'masthead' }, ...nodes);
}

/** Past days only. Future files exist but listing them would give the game away. */
function picker(dk, available) {
  const today = todayKey();
  const past = available.filter((d) => d <= today).slice(-7).reverse();
  if (past.length < 2) return null;

  const select = el('select', {
    class: 'daypick',
    'aria-label': 'Choose a day',
    onChange: (event) => {
      const value = event.target.value;
      window.location.search = value === today ? '' : `?date=${value}`;
    },
  });
  for (const d of past) {
    const opt = el('option', { value: d, text: d === today ? 'Today' : longDate(d).short });
    if (d === dk) opt.selected = true;
    select.append(opt);
  }
  return el('div', { class: 'daypick-wrap' }, el('span', { text: 'Day' }), select);
}

function nav(set) {
  const bar = el('nav', { class: 'index-bar', 'aria-label': 'Puzzles' });
  for (const p of set.puzzles) {
    bar.append(el('a', { href: `#p-${p.type}`, text: (LABELS[p.type] ?? { name: p.type }).name }));
  }
  return bar;
}

function footer(dk, set) {
  const copy = set.copy ?? {};
  return el(
    'footer',
    { class: 'foot' },
    el('p', {
      text: `Puzzles generated ${(set.generatedAt ?? '').slice(0, 10)} · library ${set.version ?? 'v1'} · copy ${copy.source ?? 'built in'}`,
    }),
    el('p', { text: 'Every grid is checked for a single solution before publishing.' }),
    el('p', {}, 'Pull this day as data: ', el('code', { text: `puzzles/${dk}.json` })),
  );
}

/* ---------- boot ---------- */

async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function fail(root, message, detail) {
  root.replaceChildren(
    el(
      'div',
      { class: 'boot-error' },
      el('h1', { text: message }),
      el('p', { text: detail }),
    ),
  );
}

/**
 * Choose which day to show: an explicit ?date= if it exists, otherwise today,
 * otherwise the most recent day the buffer actually has. That last fallback is
 * what stops an exhausted buffer from turning into a blank page.
 */
async function resolveDate(available) {
  const params = new URLSearchParams(window.location.search);
  const asked = params.get('date');
  const today = todayKey();

  if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && available.includes(asked)) {
    return { dk: asked, note: null, chosen: true };
  }
  if (available.includes(today)) return { dk: today, note: null, chosen: false };

  const past = available.filter((d) => d <= today);
  if (past.length) {
    const newest = past[past.length - 1];
    return {
      dk: newest,
      note: `No puzzles for today yet, so this is ${longDate(newest).short}.`,
      chosen: false,
    };
  }
  return { dk: null, note: null, chosen: false };
}

export async function boot(root = document.querySelector('#app')) {
  if (!root) return;
  try {
    const manifest = await loadJSON('puzzles/index.json');
    const available = Array.isArray(manifest.dates) ? manifest.dates.slice().sort() : [];

    const { dk, note, chosen } = await resolveDate(available);
    if (!dk) {
      fail(root, 'No puzzles available', 'The buffer is empty. Run the daily job to generate some.');
      return;
    }

    const set = await loadJSON(`puzzles/${dk}.json`);

    const wrap = el('div', { class: 'wrap' });
    wrap.append(masthead(dk, set, { chosen, note }));

    const bar = nav(set);
    const pick = picker(dk, available);
    if (pick) bar.append(pick);
    wrap.append(bar);

    const main = el('main');
    const tipFor = set.copy?.tipFor;
    set.puzzles.forEach((p, i) => {
      main.append(sheet(p, i, tipFor === p.type ? set.copy.tip : null));
    });
    wrap.append(main);

    if (set.copy?.note) {
      wrap.append(
        el(
          'section',
          { class: 'note' },
          el('h2', { text: set.copy.noteTitle ?? 'Today' }),
          el('p', { text: set.copy.note }),
        ),
      );
    }

    wrap.append(footer(dk, set));
    root.replaceChildren(wrap);
    document.title = `Daily Puzzles · ${longDate(dk).rest}`;

    // The interactive layer reads the same payload from an inline script tag,
    // so give it one rather than duplicating the mount logic here.
    const data = el('script', { type: 'application/json', id: 'puzzle-data' });
    data.textContent = JSON.stringify(set);
    document.body.append(data);
    hydrate();

    scheduleRollover(dk);
  } catch (err) {
    console.error(err);
    fail(root, 'Could not load today’s puzzles', String(err.message ?? err));
  }
}

/**
 * A page left open overnight would still show yesterday. Check periodically and
 * reload once the date actually changes.
 */
function scheduleRollover(shownDate) {
  if (new URLSearchParams(window.location.search).get('date')) return;
  setInterval(() => {
    if (todayKey() !== shownDate) window.location.reload();
  }, 60_000);
}
