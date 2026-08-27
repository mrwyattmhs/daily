/**
 * Interactive word search.
 *
 * Drag from the first letter to the last. A freehand drag rarely lands exactly
 * on a straight line, so the selection snaps to whichever of the eight
 * directions best matches the drag — otherwise the puzzle feels broken on a
 * touchscreen even when the user did the right thing.
 */

import { el, controls, statusLine, loadState, saveState, clearState, debounce } from './state.js';

const DIRECTIONS = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [-1, -1], [1, -1], [-1, 1],
];

const normalize = (word) => word.toUpperCase().replace(/[^A-Z]/g, '');

export function mountWordsearch(puzzle, root) {
  const { rows, cols, grid, words } = puzzle;
  const targets = words.map((w) => ({ display: w, letters: normalize(w) }));

  const saved = loadState(puzzle);
  /** word index -> array of cell indices */
  let found = saved?.found && typeof saved.found === 'object' ? { ...saved.found } : {};
  let revealed = false;

  // See sudoku.js: don't persist while the answers are on screen.
  const persist = debounce(() => {
    if (revealed) return;
    saveState(puzzle, { found });
  }, 200);
  let stash = null;
  const status = statusLine();

  const board = el('div', {
    class: 'pz-wordgrid',
    role: 'application',
    'aria-label': `Word search, ${rows} by ${cols}`,
    style: `--pz-cols:${cols}`,
  });

  const cellNodes = [];
  for (let i = 0; i < rows * cols; i++) {
    const node = el('span', {
      class: 'pz-letter',
      'data-index': i,
      text: grid[i],
      'aria-hidden': 'true',
    });
    cellNodes.push(node);
    board.append(node);
  }

  const list = el('ul', { class: 'pz-wordlist' });
  const listNodes = targets.map((t, k) =>
    list.appendChild(el('li', { class: 'pz-word', 'data-word': k, text: t.display })),
  );

  /* ---------- geometry ---------- */

  const cellFromPoint = (x, y) => {
    const node = document.elementFromPoint(x, y);
    if (!node) return null;
    const letter = node.closest?.('.pz-letter');
    if (!letter || !board.contains(letter)) return null;
    return Number(letter.dataset.index);
  };

  /**
   * Snap a drag from `a` to `b` onto one of the eight directions, choosing the
   * one whose ray comes closest to the drag vector, then clipping the run to
   * the grid.
   */
  function snap(a, b) {
    const ar = Math.floor(a / cols);
    const ac = a % cols;
    const br = Math.floor(b / cols);
    const bc = b % cols;
    const dr = br - ar;
    const dc = bc - ac;
    if (dr === 0 && dc === 0) return [a];

    const length = Math.hypot(dr, dc);
    let best = null;
    for (const [ur, uc] of DIRECTIONS) {
      const unit = Math.hypot(ur, uc);
      // Cosine similarity between the drag and this direction.
      const score = (dr * ur + dc * uc) / (length * unit);
      if (!best || score > best.score) best = { score, ur, uc, unit };
    }
    // Project the drag onto the chosen direction to get the run length.
    const steps = Math.max(
      0,
      Math.round((dr * best.ur + dc * best.uc) / (best.unit * best.unit)),
    );

    const cells = [];
    for (let k = 0; k <= steps; k++) {
      const r = ar + best.ur * k;
      const c = ac + best.uc * k;
      if (r < 0 || r >= rows || c < 0 || c >= cols) break;
      cells.push(r * cols + c);
    }
    return cells;
  }

  /* ---------- rendering ---------- */

  let selection = [];

  function paint() {
    const foundCells = new Set();
    for (const cells of Object.values(found)) for (const i of cells) foundCells.add(i);
    const selected = new Set(selection);

    for (let i = 0; i < cellNodes.length; i++) {
      cellNodes[i].classList.toggle('pz-letter-found', foundCells.has(i));
      cellNodes[i].classList.toggle('pz-letter-selected', selected.has(i));
    }
    listNodes.forEach((node, k) => node.classList.toggle('pz-word-found', k in found));

    const count = Object.keys(found).length;
    if (revealed) status.set('All answers shown.', 'warn');
    else if (count === targets.length) status.set('Solved. Every term found.', 'done');
    else status.set(`${count} of ${targets.length} found.`);
  }

  /* ---------- input ---------- */

  let anchor = null;

  board.addEventListener('pointerdown', (event) => {
    if (revealed) return;
    if (event.button !== undefined && event.button !== 0) return;
    const i = cellFromPoint(event.clientX, event.clientY);
    if (i === null) return;
    event.preventDefault();
    board.setPointerCapture?.(event.pointerId);
    anchor = i;
    selection = [i];
    paint();
  });

  board.addEventListener('pointermove', (event) => {
    if (anchor === null) return;
    const i = cellFromPoint(event.clientX, event.clientY);
    if (i === null) return;
    selection = snap(anchor, i);
    paint();
  });

  function commit() {
    if (anchor === null) return;
    const cells = selection;
    anchor = null;
    selection = [];

    if (cells.length < 3) {
      paint();
      if (cells.length > 1) status.set('Too short to be a word.', 'warn');
      return;
    }

    const forward = cells.map((i) => grid[i]).join('');
    const backward = [...forward].reverse().join('');

    let matched = -1;
    for (let k = 0; k < targets.length; k++) {
      if (k in found) continue;
      if (targets[k].letters === forward || targets[k].letters === backward) {
        matched = k;
        break;
      }
    }

    if (matched === -1) {
      // paint() rewrites the status line, so the message has to come after it.
      paint();
      status.set(`"${forward}" isn't on the list.`, 'warn');
      return;
    }

    found[matched] = cells;
    persist();
    paint();
    if (Object.keys(found).length < targets.length) {
      status.set(`Found ${targets[matched].display}.`, 'ok');
    }
  }

  board.addEventListener('pointerup', commit);
  board.addEventListener('pointercancel', () => {
    anchor = null;
    selection = [];
    paint();
  });

  const bar = controls([
    {
      label: 'Reveal',
      kind: 'danger',
      action: 'reveal',
      onClick: () => {
        revealed = !revealed;
        if (revealed) {
          stash = found;
          found = {};
          puzzle.solution.placements.forEach((pl, k) => {
            found[k] = pl.cells;
          });
        } else {
          found = stash ?? {};
          stash = null;
        }
        paint();
      },
    },
    {
      label: 'Clear',
      action: 'clear',
      onClick: () => {
        if (!window.confirm('Clear your work on this word search?')) return;
        found = {};
        revealed = false;
        clearState(puzzle);
        paint();
      },
    },
  ]);

  root.append(
    board,
    list,
    bar,
    status.node,
    el('p', { class: 'pz-hint', text: 'Drag from the first letter to the last.' }),
  );

  paint();
}
