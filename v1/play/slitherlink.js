/**
 * Interactive loop puzzle (slitherlink).
 *
 * Each edge cycles blank -> line -> cross -> blank. Crosses are how a solver
 * records "definitely not here", and without them the puzzle is much harder to
 * reason about on screen than on paper.
 *
 * Edges are one or two pixels wide, which is far too small to hit — especially
 * on a phone — so every edge gets an invisible rectangular hit target roughly
 * the size of a fingertip.
 */

import { svg, el, controls, statusLine, loadState, saveState, clearState, debounce } from './state.js';

const BLANK = 0;
const LINE = 1;
const CROSS = 2;

const CELL = 40;
const PAD = 18;

export function mountSlitherlink(puzzle, root) {
  const { rows, cols, clues } = puzzle;
  const hCount = (rows + 1) * cols;
  const vCount = rows * (cols + 1);
  const edgeCount = hCount + vCount;

  const H = (r, c) => r * cols + c;
  const V = (r, c) => hCount + r * (cols + 1) + c;

  const saved = loadState(puzzle);
  const state =
    saved?.edges?.length === edgeCount ? saved.edges.slice() : new Array(edgeCount).fill(BLANK);
  let revealed = false;

  // See sudoku.js: the debounced save must not fire while the solution is
  // displayed, or it overwrites the student's saved work.
  const persist = debounce(() => {
    if (revealed) return;
    saveState(puzzle, { edges: state });
  }, 200);
  let stash = null;
  const status = statusLine();

  /** Geometry of an edge, in grid units. */
  function geo(e) {
    if (e < hCount) {
      const r = Math.floor(e / cols);
      const c = e % cols;
      return { horizontal: true, r, c, x1: c, y1: r, x2: c + 1, y2: r };
    }
    const i = e - hCount;
    const r = Math.floor(i / (cols + 1));
    const c = i % (cols + 1);
    return { horizontal: false, r, c, x1: c, y1: r, x2: c, y2: r + 1 };
  }

  const vertexEdges = (() => {
    const map = Array.from({ length: (rows + 1) * (cols + 1) }, () => []);
    for (let e = 0; e < edgeCount; e++) {
      const g = geo(e);
      const a = g.y1 * (cols + 1) + g.x1;
      const b = g.y2 * (cols + 1) + g.x2;
      map[a].push(e);
      map[b].push(e);
    }
    return map;
  })();

  const cellEdges = (cell) => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    return [H(r, c), H(r + 1, c), V(r, c), V(r, c + 1)];
  };

  /* ---------- svg scaffold ---------- */

  const width = cols * CELL + PAD * 2;
  const height = rows * CELL + PAD * 2;
  const board = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'pz-svg pz-loop',
    role: 'application',
    'aria-label': `Loop puzzle, ${rows} by ${cols}`,
    tabindex: '0',
  });

  const layerLines = svg('g', {});
  const layerMarks = svg('g', {});
  const layerHits = svg('g', {});
  const layerClues = svg('g', {});
  const layerDots = svg('g', {});

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      layerDots.append(
        svg('circle', { cx: PAD + c * CELL, cy: PAD + r * CELL, r: 2.4, class: 'pz-dot' }),
      );
    }
  }

  const clueNodes = [];
  for (let i = 0; i < rows * cols; i++) {
    const v = clues[i];
    if (v < 0) {
      clueNodes.push(null);
      continue;
    }
    const r = Math.floor(i / cols);
    const c = i % cols;
    const node = svg('text', {
      x: PAD + c * CELL + CELL / 2,
      y: PAD + r * CELL + CELL / 2,
      class: 'pz-clue',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      text: String(v),
    });
    clueNodes.push(node);
    layerClues.append(node);
  }

  const lineNodes = [];
  const markNodes = [];

  for (let e = 0; e < edgeCount; e++) {
    const g = geo(e);
    const x1 = PAD + g.x1 * CELL;
    const y1 = PAD + g.y1 * CELL;
    const x2 = PAD + g.x2 * CELL;
    const y2 = PAD + g.y2 * CELL;

    lineNodes.push(
      layerLines.appendChild(svg('line', { x1, y1, x2, y2, class: 'pz-edge' })),
    );

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const arm = CELL * 0.13;
    markNodes.push(
      layerMarks.appendChild(
        svg('path', {
          d: `M${mx - arm} ${my - arm}L${mx + arm} ${my + arm}M${mx + arm} ${my - arm}L${mx - arm} ${my + arm}`,
          class: 'pz-cross',
        }),
      ),
    );

  }

  // One transparent surface over the whole board, with the target edge computed
  // from the pointer position. Fixed-size hit rectangles were only ~18px across
  // on a phone, and they overlapped near junctions so the wrong edge could win
  // on z-order alone. Nearest-edge gives every pixel to its closest edge and
  // scales with the board.
  const surface = svg('rect', {
    x: 0, y: 0, width, height, class: 'pz-surface',
  });
  layerHits.append(surface);

  board.append(layerLines, layerMarks, layerClues, layerDots, layerHits);

  /** Pointer position in cell units, relative to the grid origin. */
  function pointerCell(event) {
    const box = board.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * (width / box.width) - PAD) / CELL,
      y: ((event.clientY - box.top) * (height / box.height) - PAD) / CELL,
    };
  }

  /**
   * Closest edge to a point, with its distance in cell units. Distance to an
   * axis-aligned segment: clamp along the segment, then measure across.
   */
  function nearestEdge(px, py) {
    let edge = -1;
    let best = Infinity;
    for (let e = 0; e < edgeCount; e++) {
      const g = geo(e);
      const d = g.horizontal
        ? Math.hypot(px - Math.min(Math.max(px, g.x1), g.x2), py - g.y1)
        : Math.hypot(px - g.x1, py - Math.min(Math.max(py, g.y1), g.y2));
      if (d < best) {
        best = d;
        edge = e;
      }
    }
    return { edge, dist: best };
  }

  // A cell centre is 0.5 from its nearest edge, so this leaves a small dead
  // zone in the middle of each cell and tapping a clue number does nothing.
  const REACH = 0.38;

  /* ---------- rules ---------- */

  const lineCountAround = (cell) => cellEdges(cell).filter((e) => state[e] === LINE).length;

  function problems() {
    const badClues = new Set();
    const satisfied = new Set();
    for (let i = 0; i < rows * cols; i++) {
      if (clues[i] < 0) continue;
      const edges = cellEdges(i);
      const n = edges.filter((e) => state[e] === LINE).length;
      const undecided = edges.filter((e) => state[e] === BLANK).length;
      if (n > clues[i]) badClues.add(i);
      // A clue counts as done only once all four of its edges are decided.
      // Matching the count alone would grey out every 0 the instant the page
      // loads, and 0s are the most useful clues on the board.
      else if (n === clues[i] && undecided === 0) satisfied.add(i);
    }
    const badVertices = [];
    for (let v = 0; v < vertexEdges.length; v++) {
      const deg = vertexEdges[v].filter((e) => state[e] === LINE).length;
      if (deg > 2) badVertices.push(v);
    }
    return { badClues, satisfied, badVertices };
  }

  /** True when the drawn lines are exactly the solution's loop. */
  function isSolved() {
    const drawn = [];
    for (let e = 0; e < edgeCount; e++) if (state[e] === LINE) drawn.push(e);
    const target = puzzle.solution.edges;
    if (drawn.length !== target.length) return false;
    const set = new Set(target);
    return drawn.every((e) => set.has(e));
  }

  /* ---------- rendering ---------- */

  function paint() {
    for (let e = 0; e < edgeCount; e++) {
      lineNodes[e].classList.toggle('pz-edge-on', state[e] === LINE);
      if (state[e] === LINE) lineNodes[e].classList.remove('pz-edge-hover');
      markNodes[e].classList.toggle('pz-cross-on', state[e] === CROSS);
    }

    const { badClues, satisfied, badVertices } = problems();
    for (let i = 0; i < clueNodes.length; i++) {
      const node = clueNodes[i];
      if (!node) continue;
      node.classList.toggle('pz-clue-done', satisfied.has(i) && !badClues.has(i));
      node.classList.toggle('pz-clue-bad', badClues.has(i));
    }
    board.classList.toggle('pz-has-error', badClues.size > 0 || badVertices.length > 0);

    const drawn = state.filter((s) => s === LINE).length;
    if (revealed) status.set('Solution shown.', 'warn');
    else if (isSolved()) status.set('Solved. One closed loop, every number satisfied.', 'done');
    else if (badVertices.length) {
      status.set(`${badVertices.length} junction(s) have three or more lines.`, 'warn');
    } else if (badClues.size) status.set(`${badClues.size} number(s) have too many lines.`, 'warn');
    else status.set(`${drawn} segments drawn, ${satisfied.size} numbers finished.`);
  }

  /* ---------- input ---------- */

  function cycle(e, backwards = false) {
    if (revealed) return;
    const order = [BLANK, LINE, CROSS];
    const at = order.indexOf(state[e]);
    const next = backwards ? (at + 2) % 3 : (at + 1) % 3;
    state[e] = order[next];
    persist();
    paint();
  }

  surface.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const { x, y } = pointerCell(event);
    const { edge, dist } = nearestEdge(x, y);
    if (edge === -1 || dist > REACH) return;
    event.preventDefault();
    board.focus({ preventScroll: true });
    focus = edge;
    cycle(edge, event.shiftKey);
  });

  // Preview which edge a tap would hit, so near-misses are visible before
  // committing rather than after.
  let hovered = -1;
  surface.addEventListener('pointermove', (event) => {
    const { x, y } = pointerCell(event);
    const { edge, dist } = nearestEdge(x, y);
    const next = dist > REACH ? -1 : edge;
    if (next === hovered) return;
    if (hovered !== -1 && state[hovered] !== LINE) {
      lineNodes[hovered].classList.remove('pz-edge-hover');
    }
    hovered = next;
    if (hovered !== -1 && state[hovered] !== LINE) {
      lineNodes[hovered].classList.add('pz-edge-hover');
    }
  });

  surface.addEventListener('pointerleave', () => {
    if (hovered !== -1) lineNodes[hovered].classList.remove('pz-edge-hover');
    hovered = -1;
  });

  // Right-click goes straight to a cross, which is what most solvers expect.
  surface.addEventListener('contextmenu', (event) => {
    const { x, y } = pointerCell(event);
    const { edge, dist } = nearestEdge(x, y);
    if (edge === -1 || dist > REACH) return;
    event.preventDefault();
    state[edge] = state[edge] === CROSS ? BLANK : CROSS;
    persist();
    paint();
  });

  // Keyboard: move a cursor between edges and toggle with space or enter.
  let focus = 0;
  const cursorRing = svg('rect', { class: 'pz-edge-cursor', width: 0, height: 0 });
  layerMarks.append(cursorRing);

  function showCursor(visible) {
    if (!visible) {
      cursorRing.setAttribute('width', 0);
      cursorRing.setAttribute('height', 0);
      return;
    }
    const g = geo(focus);
    const mx = PAD + ((g.x1 + g.x2) / 2) * CELL;
    const my = PAD + ((g.y1 + g.y2) / 2) * CELL;
    const w = g.horizontal ? CELL * 0.7 : CELL * 0.3;
    const h = g.horizontal ? CELL * 0.3 : CELL * 0.7;
    cursorRing.setAttribute('x', mx - w / 2);
    cursorRing.setAttribute('y', my - h / 2);
    cursorRing.setAttribute('width', w);
    cursorRing.setAttribute('height', h);
  }

  board.addEventListener('focus', () => showCursor(true));
  board.addEventListener('blur', () => showCursor(false));

  board.addEventListener('keydown', (event) => {
    const g = geo(focus);
    let next = focus;
    // Move to the nearest edge in the requested direction. Horizontal and
    // vertical edges interleave, so stepping means changing family sometimes.
    if (event.key === 'ArrowRight') {
      next = g.horizontal ? (g.c + 1 < cols ? H(g.r, g.c + 1) : focus) : V(g.r, Math.min(cols, g.c + 1));
    } else if (event.key === 'ArrowLeft') {
      next = g.horizontal ? (g.c > 0 ? H(g.r, g.c - 1) : focus) : V(g.r, Math.max(0, g.c - 1));
    } else if (event.key === 'ArrowDown') {
      next = g.horizontal ? H(Math.min(rows, g.r + 1), g.c) : (g.r + 1 < rows ? V(g.r + 1, g.c) : focus);
    } else if (event.key === 'ArrowUp') {
      next = g.horizontal ? H(Math.max(0, g.r - 1), g.c) : (g.r > 0 ? V(g.r - 1, g.c) : focus);
    } else if (event.key === 'Tab') {
      return;
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      cycle(focus, event.shiftKey);
      return;
    } else if (event.key === 'x' || event.key === 'X') {
      event.preventDefault();
      state[focus] = state[focus] === CROSS ? BLANK : CROSS;
      persist();
      paint();
      return;
    } else {
      return;
    }
    event.preventDefault();
    focus = next;
    showCursor(true);
  });

  const bar = controls([
    {
      label: 'Check',
      action: 'check',
      onClick: () => {
        if (isSolved()) {
          status.set('Solved. One closed loop, every number satisfied.', 'done');
          return;
        }
        const target = new Set(puzzle.solution.edges);
        let wrong = 0;
        for (let e = 0; e < edgeCount; e++) if (state[e] === LINE && !target.has(e)) wrong++;
        status.set(
          wrong
            ? `${wrong} drawn segment(s) aren't part of the loop.`
            : 'Everything drawn so far is part of the loop. Keep going.',
          wrong ? 'warn' : 'ok',
        );
      },
    },
    {
      label: 'Reveal',
      kind: 'danger',
      action: 'reveal',
      onClick: () => {
        revealed = !revealed;
        if (revealed) {
          stash = state.slice();
          state.fill(BLANK);
          for (const e of puzzle.solution.edges) state[e] = LINE;
        } else {
          for (let e = 0; e < edgeCount; e++) state[e] = stash?.[e] ?? BLANK;
          stash = null;
        }
        paint();
      },
    },
    {
      label: 'Clear',
      action: 'clear',
      onClick: () => {
        if (!window.confirm('Clear your work on this loop puzzle?')) return;
        state.fill(BLANK);
        revealed = false;
        clearState(puzzle);
        paint();
      },
    },
  ]);

  root.append(
    board,
    bar,
    status.node,
    el('p', {
      class: 'pz-hint',
      text: 'Tap near an edge to cycle line, cross, blank. Right-click or X marks a cross.',
    }),
  );

  paint();
}
