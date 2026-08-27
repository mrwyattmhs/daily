/**
 * Optional SVG renderers.
 *
 * Deliberately separate from ../index.js: generators return data only, so a
 * consuming site can ignore this module entirely and draw puzzles its own way.
 * Everything here returns an SVG string and takes colours from CSS custom
 * properties, so the host page controls the palette.
 *
 * Expected CSS variables (with fallbacks baked in):
 *   --puzzle-ink     grid lines and given clues
 *   --puzzle-rule    light interior grid lines
 *   --puzzle-accent  solved values, loop, highlights
 *   --puzzle-tint    fills
 */

const INK = 'var(--puzzle-ink, #201f26)';
const RULE = 'var(--puzzle-rule, #b9bcc6)';
const ACCENT = 'var(--puzzle-accent, #5b4a9f)';
const TINT = 'var(--puzzle-tint, rgba(91,74,159,0.12))';

const CELL = 40;
const PAD = 14;

function open(w, h, label) {
  return (
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="${label}" class="puzzle-svg">`
  );
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- sudoku ---------- */

export function sudokuSvg(p, { showSolution = false } = {}) {
  const n = 9;
  const size = n * CELL;
  const w = size + PAD * 2;
  let s = open(w, w, 'Sudoku grid');

  s += `<rect x="${PAD}" y="${PAD}" width="${size}" height="${size}" fill="none" stroke="${INK}" stroke-width="2.6"/>`;

  for (let i = 1; i < n; i++) {
    const at = PAD + i * CELL;
    const major = i % 3 === 0;
    const stroke = major ? INK : RULE;
    const width = major ? 2.2 : 0.9;
    s += `<line x1="${at}" y1="${PAD}" x2="${at}" y2="${PAD + size}" stroke="${stroke}" stroke-width="${width}"/>`;
    s += `<line x1="${PAD}" y1="${at}" x2="${PAD + size}" y2="${at}" stroke="${stroke}" stroke-width="${width}"/>`;
  }

  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / n);
    const c = i % n;
    const x = PAD + c * CELL + CELL / 2;
    const y = PAD + r * CELL + CELL / 2;
    const given = p.puzzle[i];
    if (given !== 0) {
      s += `<text x="${x}" y="${y}" class="pz-num pz-given" text-anchor="middle" dominant-baseline="central" fill="${INK}">${given}</text>`;
    } else if (showSolution) {
      s += `<text x="${x}" y="${y}" class="pz-num pz-solved" text-anchor="middle" dominant-baseline="central" fill="${ACCENT}">${p.solution[i]}</text>`;
    }
  }
  return `${s}</svg>`;
}

/* ---------- shikaku ---------- */

/**
 * Two rectangles are adjacent if they share part of an edge. Used to tint
 * neighbours differently — a single flat tint over every rectangle makes the
 * answer key unreadable, because the borders vanish into the fill.
 */
function shikakuTints(rects) {
  const touches = (a, b) => {
    const vAdj =
      (a.c0 + a.w === b.c0 || b.c0 + b.w === a.c0) &&
      a.r0 < b.r0 + b.h &&
      b.r0 < a.r0 + a.h;
    const hAdj =
      (a.r0 + a.h === b.r0 || b.r0 + b.h === a.r0) &&
      a.c0 < b.c0 + b.w &&
      b.c0 < a.c0 + a.w;
    return vAdj || hAdj;
  };

  // Greedy colouring, fewest-available-colour-first. Three shades is plenty in
  // practice; borders carry the real information if two neighbours collide.
  const colors = new Array(rects.length).fill(-1);
  for (let i = 0; i < rects.length; i++) {
    const used = new Set();
    for (let j = 0; j < rects.length; j++) {
      if (j !== i && colors[j] !== -1 && touches(rects[i], rects[j])) used.add(colors[j]);
    }
    let c = 0;
    while (used.has(c) && c < 3) c++;
    colors[i] = c;
  }
  return colors;
}

export function shikakuSvg(p, { showSolution = false } = {}) {
  const w = p.cols * CELL + PAD * 2;
  const h = p.rows * CELL + PAD * 2;
  let s = open(w, h, 'Rectangle division puzzle');

  if (showSolution) {
    const shades = ['none', TINT, 'var(--puzzle-tint-2, rgba(85,66,155,0.045))', 'none'];
    const colors = shikakuTints(p.solution);
    p.solution.forEach((rect, i) => {
      const fill = shades[colors[i]] ?? 'none';
      if (fill === 'none') return;
      s += `<rect x="${PAD + rect.c0 * CELL}" y="${PAD + rect.r0 * CELL}" width="${rect.w * CELL}" height="${rect.h * CELL}" fill="${fill}"/>`;
    });
  } else {
    // Light interior grid — only useful while the puzzle is unsolved. In the
    // answer view it competes with the rectangle borders.
    for (let c = 1; c < p.cols; c++) {
      const x = PAD + c * CELL;
      s += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${PAD + p.rows * CELL}" stroke="${RULE}" stroke-width="0.9"/>`;
    }
    for (let r = 1; r < p.rows; r++) {
      const y = PAD + r * CELL;
      s += `<line x1="${PAD}" y1="${y}" x2="${PAD + p.cols * CELL}" y2="${y}" stroke="${RULE}" stroke-width="0.9"/>`;
    }
  }

  if (showSolution) {
    for (const rect of p.solution) {
      s += `<rect x="${PAD + rect.c0 * CELL}" y="${PAD + rect.r0 * CELL}" width="${rect.w * CELL}" height="${rect.h * CELL}" fill="none" stroke="${ACCENT}" stroke-width="2.4" stroke-linejoin="round"/>`;
    }
  }

  s += `<rect x="${PAD}" y="${PAD}" width="${p.cols * CELL}" height="${p.rows * CELL}" fill="none" stroke="${INK}" stroke-width="2.6"/>`;

  for (const clue of p.clues) {
    const x = PAD + clue.c * CELL + CELL / 2;
    const y = PAD + clue.r * CELL + CELL / 2;
    s += `<circle cx="${x}" cy="${y}" r="${CELL * 0.36}" fill="var(--puzzle-paper, #fff)" stroke="${INK}" stroke-width="1.4"/>`;
    s += `<text x="${x}" y="${y}" class="pz-num pz-given" text-anchor="middle" dominant-baseline="central" fill="${INK}">${clue.value}</text>`;
  }
  return `${s}</svg>`;
}

/* ---------- slitherlink ---------- */

export function slitherlinkSvg(p, { showSolution = false } = {}) {
  const w = p.cols * CELL + PAD * 2;
  const h = p.rows * CELL + PAD * 2;
  let s = open(w, h, 'Loop puzzle');

  if (showSolution) {
    for (let i = 0; i < p.rows * p.cols; i++) {
      if (p.solution.interior[i] !== 1) continue;
      const r = Math.floor(i / p.cols);
      const c = i % p.cols;
      s += `<rect x="${PAD + c * CELL}" y="${PAD + r * CELL}" width="${CELL}" height="${CELL}" fill="${TINT}"/>`;
    }
  }

  // Lattice of dots the loop runs between.
  for (let r = 0; r <= p.rows; r++) {
    for (let c = 0; c <= p.cols; c++) {
      s += `<circle cx="${PAD + c * CELL}" cy="${PAD + r * CELL}" r="2.1" fill="${RULE}"/>`;
    }
  }

  if (showSolution) {
    const hCount = (p.rows + 1) * p.cols;
    const d = [];
    for (const e of p.solution.edges) {
      if (e < hCount) {
        const r = Math.floor(e / p.cols);
        const c = e % p.cols;
        d.push(`M${PAD + c * CELL} ${PAD + r * CELL}H${PAD + (c + 1) * CELL}`);
      } else {
        const idx = e - hCount;
        const r = Math.floor(idx / (p.cols + 1));
        const c = idx % (p.cols + 1);
        d.push(`M${PAD + c * CELL} ${PAD + r * CELL}V${PAD + (r + 1) * CELL}`);
      }
    }
    s += `<path d="${d.join('')}" fill="none" stroke="${ACCENT}" stroke-width="4.2" stroke-linecap="round"/>`;
  }

  for (let i = 0; i < p.rows * p.cols; i++) {
    const v = p.clues[i];
    if (v < 0) continue;
    const r = Math.floor(i / p.cols);
    const c = i % p.cols;
    s += `<text x="${PAD + c * CELL + CELL / 2}" y="${PAD + r * CELL + CELL / 2}" class="pz-num pz-given" text-anchor="middle" dominant-baseline="central" fill="${INK}">${v}</text>`;
  }
  return `${s}</svg>`;
}

/* ---------- word search ---------- */

export function wordsearchSvg(p, { showSolution = false } = {}) {
  const cell = 34;
  const w = p.cols * cell + PAD * 2;
  const h = p.rows * cell + PAD * 2;
  let s = open(w, h, 'Word search grid');

  if (showSolution) {
    for (const pl of p.solution.placements) {
      const first = pl.cells[0];
      const last = pl.cells[pl.cells.length - 1];
      const x1 = PAD + (first % p.cols) * cell + cell / 2;
      const y1 = PAD + Math.floor(first / p.cols) * cell + cell / 2;
      const x2 = PAD + (last % p.cols) * cell + cell / 2;
      const y2 = PAD + Math.floor(last / p.cols) * cell + cell / 2;
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ACCENT}" stroke-width="${cell * 0.74}" stroke-linecap="round" opacity="0.22"/>`;
    }
  }

  for (let i = 0; i < p.rows * p.cols; i++) {
    const r = Math.floor(i / p.cols);
    const c = i % p.cols;
    s += `<text x="${PAD + c * cell + cell / 2}" y="${PAD + r * cell + cell / 2}" class="pz-letter" text-anchor="middle" dominant-baseline="central" fill="${INK}">${esc(p.grid[i])}</text>`;
  }
  return `${s}</svg>`;
}

const RENDERERS = {
  sudoku: sudokuSvg,
  shikaku: shikakuSvg,
  slitherlink: slitherlinkSvg,
  wordsearch: wordsearchSvg,
};

/** Render any puzzle by type. */
export function renderPuzzle(puzzle, opts = {}) {
  const fn = RENDERERS[puzzle.type];
  if (!fn) throw new Error(`no renderer for "${puzzle.type}"`);
  return fn(puzzle, opts);
}
