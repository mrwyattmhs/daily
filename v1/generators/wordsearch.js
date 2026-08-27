/**
 * Word search.
 *
 * The algorithm is the easy part; the word list is what makes it useful. Pass
 * your own `words` (a unit vocabulary list beats anything generic) or name a
 * unit from data/vocab.json.
 */

const DIRECTIONS = [
  { dr: 0, dc: 1, name: 'E' },
  { dr: 0, dc: -1, name: 'W' },
  { dr: 1, dc: 0, name: 'S' },
  { dr: -1, dc: 0, name: 'N' },
  { dr: 1, dc: 1, name: 'SE' },
  { dr: -1, dc: -1, name: 'NW' },
  { dr: 1, dc: -1, name: 'SW' },
  { dr: -1, dc: 1, name: 'NE' },
];

/** Strip to A-Z so "least common multiple" and "y-intercept" both work. */
function normalize(word) {
  return word.toUpperCase().replace(/[^A-Z]/g, '');
}

function tryPlace(grid, rows, cols, letters, dir, r0, c0) {
  const cells = [];
  let r = r0;
  let c = c0;
  for (const ch of letters) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    const existing = grid[r * cols + c];
    if (existing !== '' && existing !== ch) return null;
    cells.push({ r, c, ch });
    r += dir.dr;
    c += dir.dc;
  }
  return cells;
}

const WS_PRESETS = {
  // Reverse and diagonal directions are what actually make a word search
  // hard, far more than grid size does.
  easy: { allowReverse: false, allowDiagonal: true, maxWords: 10 },
  medium: { allowReverse: true, allowDiagonal: true, maxWords: 12 },
  hard: { allowReverse: true, allowDiagonal: true, maxWords: 14 },
};

/**
 * @param {Rng} rng
 * @param {object} opts
 * @param {string[]} opts.words Required. Answers to hide.
 * @param {'easy'|'medium'|'hard'} [opts.difficulty='medium'] Sets the direction
 *   options and word count. Individual options below override it.
 * @param {number} [opts.rows] Defaults to fit the longest word with margin.
 * @param {number} [opts.cols]
 * @param {boolean} [opts.allowReverse] Include W, N, NW, SW directions.
 * @param {boolean} [opts.allowDiagonal]
 * @param {string} [opts.theme] Label shown to the solver.
 * @param {number} [opts.maxWordLength=13] Drop longer terms. One 19-letter
 *   phrase forces a 21×21 grid, which stops fitting on a page.
 * @param {number} [opts.maxWords] Keep at most this many, chosen at random so
 *   the same unit yields a different puzzle each time it comes up.
 */
export function generate(rng, opts = {}) {
  const raw = (opts.words ?? []).filter(Boolean);
  if (raw.length === 0) throw new Error('wordsearch: needs at least one word');

  const level = opts.difficulty ?? 'medium';
  const preset = WS_PRESETS[level] ?? WS_PRESETS.medium;
  const allowReverse = opts.allowReverse ?? preset.allowReverse;
  const allowDiagonal = opts.allowDiagonal ?? preset.allowDiagonal;
  const maxWordLength = opts.maxWordLength ?? 13;
  const maxWords = opts.maxWords ?? preset.maxWords;

  const seen = new Set();
  let entries = [];
  for (const w of raw) {
    const letters = normalize(w);
    if (letters.length < 3 || letters.length > maxWordLength) continue;
    if (seen.has(letters)) continue;
    seen.add(letters);
    entries.push({ display: w.trim(), letters });
  }
  if (entries.length === 0) {
    throw new Error(`wordsearch: no words between 3 and ${maxWordLength} letters`);
  }
  if (entries.length > maxWords) entries = rng.shuffle(entries).slice(0, maxWords);

  // Longest first: long words are hardest to place, so they get first pick.
  entries.sort((a, b) => b.letters.length - a.letters.length);

  const longest = entries[0].letters.length;
  const rows = opts.rows ?? Math.max(12, longest + 2);
  const cols = opts.cols ?? Math.max(12, longest + 2);

  let dirs = DIRECTIONS;
  if (!allowDiagonal) dirs = dirs.filter((d) => d.dr === 0 || d.dc === 0);
  if (!allowReverse) dirs = dirs.filter((d) => d.dr >= 0 && d.dc >= 0);

  const grid = new Array(rows * cols).fill('');
  const placements = [];
  const unplaced = [];

  for (const entry of entries) {
    // Try random (direction, start) pairs; prefer placements that overlap
    // existing letters, since crossings make a tighter, harder puzzle.
    const options = [];
    for (const dir of rng.shuffle([...dirs])) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cells = tryPlace(grid, rows, cols, entry.letters, dir, r, c);
          if (!cells) continue;
          const overlap = cells.filter(({ r: rr, c: cc }) => grid[rr * cols + cc] !== '').length;
          options.push({ cells, dir, overlap });
        }
      }
    }
    if (options.length === 0) {
      unplaced.push(entry.display);
      continue;
    }
    const chosen = rng.weighted(options, options.map((o) => 1 + o.overlap * 2.5));
    for (const { r, c, ch } of chosen.cells) grid[r * cols + c] = ch;
    placements.push({
      word: entry.display,
      letters: entry.letters,
      row: chosen.cells[0].r,
      col: chosen.cells[0].c,
      direction: chosen.dir.name,
      cells: chosen.cells.map(({ r, c }) => r * cols + c),
    });
  }

  // Fill the gaps using the letter frequencies of the hidden words. Uniform
  // random filler makes answers stand out — a Q or Z in the filler is a
  // giveaway when no answer contains one.
  const freq = new Map();
  for (const e of entries) {
    for (const ch of e.letters) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const alphabet = [...freq.keys()];
  const weights = alphabet.map((ch) => freq.get(ch));
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === '') grid[i] = rng.weighted(alphabet, weights);
  }

  return {
    type: 'wordsearch',
    difficulty: level,
    theme: opts.theme ?? null,
    rows,
    cols,
    // Row-major single characters.
    grid,
    // The list shown to the solver, in display form.
    words: placements.map((p) => p.word),
    unplaced,
    solution: { placements },
  };
}

export const meta = {
  type: 'wordsearch',
  name: 'Word search',
  blurb: 'Find every term in the list. Words run in any direction, including backwards and diagonally.',
  difficulties: ['easy', 'medium', 'hard'],
};
