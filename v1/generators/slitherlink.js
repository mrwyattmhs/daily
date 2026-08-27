/**
 * Slitherlink — a loop puzzle.
 *
 * Draw a single closed loop along the grid lines. A number says how many of
 * that cell's four sides the loop uses.
 *
 * Generation runs backwards from the usual approach: grow a region of cells,
 * take its boundary as the loop, and read the clues straight off it. Every
 * clue is then correct by construction, so unlike a forward search we never
 * discard a candidate for being invalid — only for being non-unique.
 *
 * A cell region's boundary is a single closed non-self-intersecting loop
 * exactly when the region is edge-connected, has no holes, and has no diagonal
 * pinch points (two cells meeting only at a corner, which would put four loop
 * edges at one vertex). All three are checked below.
 */

/** Geometry for a rows×cols grid: edge ids, and the maps between them. */
function geometry(rows, cols) {
  const hCount = (rows + 1) * cols;
  const vCount = rows * (cols + 1);
  const edgeCount = hCount + vCount;

  const H = (r, c) => r * cols + c;
  const V = (r, c) => hCount + r * (cols + 1) + c;
  const vertexId = (r, c) => r * (cols + 1) + c;
  const vertexCount = (rows + 1) * (cols + 1);

  // Four edges of each cell, in order: top, bottom, left, right.
  const cellEdges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cellEdges.push([H(r, c), H(r + 1, c), V(r, c), V(r, c + 1)]);
    }
  }

  const edgeVertices = new Array(edgeCount);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) edgeVertices[H(r, c)] = [vertexId(r, c), vertexId(r, c + 1)];
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) edgeVertices[V(r, c)] = [vertexId(r, c), vertexId(r + 1, c)];
  }

  const vertexEdges = Array.from({ length: vertexCount }, () => []);
  for (let e = 0; e < edgeCount; e++) {
    for (const v of edgeVertices[e]) vertexEdges[v].push(e);
  }

  // Which cells each edge borders, for turning a region into a loop.
  const edgeCells = new Array(edgeCount);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      edgeCells[H(r, c)] = [r > 0 ? (r - 1) * cols + c : -1, r < rows ? r * cols + c : -1];
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      edgeCells[V(r, c)] = [c > 0 ? r * cols + (c - 1) : -1, c < cols ? r * cols + c : -1];
    }
  }

  return { rows, cols, hCount, edgeCount, vertexCount, H, V, cellEdges, edgeVertices, vertexEdges, edgeCells };
}

/* ---------- region growth ---------- */

/** Would adding `cell` create a diagonal pinch anywhere? */
function createsPinch(region, rows, cols, cell) {
  const cr = Math.floor(cell / cols);
  const cc = cell % cols;
  const inR = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && region[r * cols + c] === 1;
  // Check each 2×2 block containing this cell.
  for (let r = cr - 1; r <= cr; r++) {
    for (let c = cc - 1; c <= cc; c++) {
      if (r < 0 || c < 0 || r + 1 >= rows + 1 || c + 1 >= cols + 1) continue;
      const a = inR(r, c);
      const b = inR(r, c + 1);
      const d = inR(r + 1, c);
      const e = inR(r + 1, c + 1);
      // Exactly the two diagonals in, the other two out.
      if (a && e && !b && !d) return true;
      if (b && d && !a && !e) return true;
    }
  }
  return false;
}

function connected(mask, rows, cols, want) {
  const total = mask.reduce((n, v) => n + (v === want ? 1 : 0), 0);
  if (total === 0) return true;
  const start = mask.findIndex((v) => v === want);
  const seen = new Uint8Array(rows * cols);
  const stack = [start];
  seen[start] = 1;
  let count = 1;
  while (stack.length) {
    const i = stack.pop();
    const r = Math.floor(i / cols);
    const c = i % cols;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const j = nr * cols + nc;
      if (seen[j] || mask[j] !== want) continue;
      seen[j] = 1;
      count++;
      stack.push(j);
    }
  }
  return count === total;
}

/** No holes: the complement, plus the outside, must be one connected piece. */
function complementConnected(region, rows, cols) {
  const R = rows + 2;
  const C = cols + 2;
  const pad = new Uint8Array(R * C); // 1 = blocked (in region)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[r * cols + c]) pad[(r + 1) * C + (c + 1)] = 1;
    }
  }
  let free = 0;
  for (let i = 0; i < R * C; i++) if (!pad[i]) free++;
  const seen = new Uint8Array(R * C);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length) {
    const i = stack.pop();
    const r = Math.floor(i / C);
    const c = i % C;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      const j = nr * C + nc;
      if (seen[j] || pad[j]) continue;
      seen[j] = 1;
      count++;
      stack.push(j);
    }
  }
  return count === free;
}

/** Grow a region of roughly `target` cells that yields a single clean loop. */
function growRegion(rng, rows, cols, target) {
  const region = new Uint8Array(rows * cols);
  const start = rng.int(rows * cols);
  region[start] = 1;
  let size = 1;

  const frontier = new Set();
  const addFrontier = (cell) => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const j = nr * cols + nc;
      if (!region[j]) frontier.add(j);
    }
  };
  addFrontier(start);

  let stalls = 0;
  while (size < target && frontier.size && stalls < rows * cols * 4) {
    const options = [...frontier];
    const cell = options[rng.int(options.length)];
    frontier.delete(cell);
    if (region[cell]) continue;
    if (createsPinch(region, rows, cols, cell)) {
      stalls++;
      continue;
    }
    region[cell] = 1;
    // Adding a cell can seal off a hole; undo if so.
    if (!complementConnected(region, rows, cols)) {
      region[cell] = 0;
      stalls++;
      continue;
    }
    size++;
    addFrontier(cell);
  }

  if (size < Math.floor(target * 0.6)) return null;
  if (!connected(region, rows, cols, 1)) return null;
  if (!complementConnected(region, rows, cols)) return null;
  return region;
}

/** Loop edges = edges with a region cell on exactly one side. */
function regionToLoop(region, geo) {
  const on = new Uint8Array(geo.edgeCount);
  for (let e = 0; e < geo.edgeCount; e++) {
    const [a, b] = geo.edgeCells[e];
    const ina = a >= 0 && region[a] === 1;
    const inb = b >= 0 && region[b] === 1;
    if (ina !== inb) on[e] = 1;
  }
  return on;
}

/** Confirm the edge set really is one closed loop, by walking it. */
function isSingleLoop(on, geo) {
  const edges = [];
  for (let e = 0; e < geo.edgeCount; e++) if (on[e]) edges.push(e);
  if (edges.length < 4) return false;
  for (let v = 0; v < geo.vertexCount; v++) {
    let deg = 0;
    for (const e of geo.vertexEdges[v]) if (on[e]) deg++;
    if (deg !== 0 && deg !== 2) return false;
  }
  // Walk from one edge; a single loop visits every on-edge.
  const used = new Set();
  let current = edges[0];
  let vertex = geo.edgeVertices[current][0];
  const startVertex = vertex;
  for (;;) {
    used.add(current);
    const [a, b] = geo.edgeVertices[current];
    vertex = vertex === a ? b : a;
    if (vertex === startVertex) break;
    const next = geo.vertexEdges[vertex].find((e) => on[e] && !used.has(e));
    if (next === undefined) return false;
    current = next;
  }
  return used.size === edges.length;
}

/* ---------- solver ---------- */

const UNKNOWN = -1;
const OFF = 0;
const ON = 1;

/**
 * Count solutions up to `cap`. Returns {count, guesses}.
 *
 * Propagation handles the local constraints (vertex degree 0 or 2, and clue
 * satisfaction). The global "exactly one loop" requirement is what makes this
 * puzzle NP-complete — local rules happily produce several disjoint loops — so
 * it's enforced by the closed-cycle prune plus a final check.
 */
function countSolutions(clues, geo, cap = 2) {
  const { edgeCount, vertexCount, vertexEdges, cellEdges } = geo;
  let guesses = 0;

  const clued = [];
  for (let i = 0; i < clues.length; i++) if (clues[i] >= 0) clued.push(i);

  /** Propagate to a fixpoint. Returns false on contradiction. */
  function propagate(state) {
    let changed = true;
    while (changed) {
      changed = false;

      for (let v = 0; v < vertexCount; v++) {
        const inc = vertexEdges[v];
        let on = 0;
        let unknown = 0;
        for (const e of inc) {
          if (state[e] === ON) on++;
          else if (state[e] === UNKNOWN) unknown++;
        }
        if (on > 2) return false;
        if (on === 2 && unknown) {
          for (const e of inc) if (state[e] === UNKNOWN) state[e] = OFF;
          changed = true;
        } else if (on === 1) {
          if (unknown === 0) return false;
          if (unknown === 1) {
            for (const e of inc) if (state[e] === UNKNOWN) state[e] = ON;
            changed = true;
          }
        } else if (on === 0 && unknown === 1) {
          for (const e of inc) if (state[e] === UNKNOWN) state[e] = OFF;
          changed = true;
        }
      }

      for (const cell of clued) {
        const want = clues[cell];
        const inc = cellEdges[cell];
        let on = 0;
        let unknown = 0;
        for (const e of inc) {
          if (state[e] === ON) on++;
          else if (state[e] === UNKNOWN) unknown++;
        }
        if (on > want) return false;
        if (on + unknown < want) return false;
        if (on === want && unknown) {
          for (const e of inc) if (state[e] === UNKNOWN) state[e] = OFF;
          changed = true;
        } else if (on + unknown === want && unknown) {
          for (const e of inc) if (state[e] === UNKNOWN) state[e] = ON;
          changed = true;
        }
      }
    }
    return true;
  }

  /**
   * If the on-edges already contain a closed cycle with no loose ends, nothing
   * else can be on — otherwise there'd be a second loop. Force the rest off.
   */
  function closedCyclePrune(state) {
    // A vertex is "settled" when it has degree 2 and no unknown edges left.
    const onEdges = [];
    for (let e = 0; e < edgeCount; e++) if (state[e] === ON) onEdges.push(e);
    if (onEdges.length === 0) return true;

    const seen = new Set();
    const stack = [onEdges[0]];
    seen.add(onEdges[0]);
    let closed = true;
    while (stack.length) {
      const e = stack.pop();
      for (const v of geo.edgeVertices[e]) {
        let on = 0;
        let unknown = 0;
        for (const f of vertexEdges[v]) {
          if (state[f] === ON) on++;
          else if (state[f] === UNKNOWN) unknown++;
        }
        if (on !== 2 || unknown > 0) {
          closed = false;
          continue;
        }
        for (const f of vertexEdges[v]) {
          if (state[f] === ON && !seen.has(f)) {
            seen.add(f);
            stack.push(f);
          }
        }
      }
    }
    if (!closed) return true; // component still has loose ends; nothing to force

    // Component is a finished cycle. Any other on-edge means two loops.
    if (seen.size !== onEdges.length) return false;
    for (let e = 0; e < edgeCount; e++) if (state[e] === UNKNOWN) state[e] = OFF;
    return true;
  }

  function complete(state) {
    for (const cell of clued) {
      let on = 0;
      for (const e of cellEdges[cell]) if (state[e] === ON) on++;
      if (on !== clues[cell]) return false;
    }
    return isSingleLoop(Uint8Array.from(state, (s) => (s === ON ? 1 : 0)), geo);
  }

  /** Branch edge: prefer one that continues a half-built path. */
  function pickEdge(state) {
    let fallback = -1;
    for (let v = 0; v < vertexCount; v++) {
      let on = 0;
      let cand = -1;
      for (const e of vertexEdges[v]) {
        if (state[e] === ON) on++;
        else if (state[e] === UNKNOWN && cand === -1) cand = e;
      }
      if (on === 1 && cand !== -1) return cand;
      if (cand !== -1 && fallback === -1) fallback = cand;
    }
    return fallback;
  }

  let count = 0;
  let firstSolution = null;

  function recurse(state) {
    if (count >= cap) return;
    if (!propagate(state)) return;
    if (!closedCyclePrune(state)) return;
    if (!propagate(state)) return;

    const e = pickEdge(state);
    if (e === -1) {
      if (complete(state)) {
        count++;
        if (!firstSolution) firstSolution = state.slice();
      }
      return;
    }

    guesses++;
    for (const value of [ON, OFF]) {
      const next = state.slice();
      next[e] = value;
      recurse(next);
      if (count >= cap) return;
    }
  }

  const initial = new Int8Array(edgeCount).fill(UNKNOWN);
  recurse(initial);
  return { count, guesses, solution: firstSolution };
}

/* ---------- generation ---------- */

const PRESETS = {
  easy: { rows: 6, cols: 6, fill: 0.42 },
  medium: { rows: 7, cols: 7, fill: 0.44 },
  hard: { rows: 9, cols: 9, fill: 0.46 },
};

/**
 * @param {Rng} rng
 * @param {object} [opts]
 * @param {'easy'|'medium'|'hard'} [opts.difficulty='medium']
 * @param {number} [opts.rows]
 * @param {number} [opts.cols]
 * @param {boolean} [opts.symmetric=true] Remove clues in 180°-rotational pairs.
 * @param {number} [opts.maxAttempts=60]
 */
export function generate(rng, opts = {}) {
  const level = opts.difficulty ?? 'medium';
  const preset = PRESETS[level] ?? PRESETS.medium;
  const rows = opts.rows ?? preset.rows;
  const cols = opts.cols ?? preset.cols;
  const symmetric = opts.symmetric ?? true;
  const maxAttempts = opts.maxAttempts ?? 60;

  const geo = geometry(rows, cols);
  const cellCount = rows * cols;
  const target = Math.round(cellCount * preset.fill);

  for (let k = 0; k < maxAttempts; k++) {
    const r = rng.fork(`sl-${k}`);
    const region = growRegion(r, rows, cols, target);
    if (!region) continue;

    const loop = regionToLoop(region, geo);
    if (!isSingleLoop(loop, geo)) continue;

    // Full clue set: every cell gets its true edge count.
    const full = new Array(cellCount).fill(0);
    for (let cell = 0; cell < cellCount; cell++) {
      let n = 0;
      for (const e of geo.cellEdges[cell]) if (loop[e]) n++;
      full[cell] = n;
    }

    // Near-always unique when fully clued, but verify rather than assume.
    if (countSolutions(full, geo, 2).count !== 1) continue;

    // Dig out clues, keeping a removal only while the solution stays unique.
    // 0s and 3s carry far more information than 1s and 2s, so try removing the
    // weak clues first — what survives is what drives difficulty.
    const clues = full.slice();
    const order = r.shuffle(Array.from({ length: cellCount }, (_, i) => i)).sort((a, b) => {
      const w = (v) => (v === 1 || v === 2 ? 0 : 1);
      return w(full[a]) - w(full[b]);
    });

    for (const i of order) {
      const pair = symmetric ? [...new Set([i, cellCount - 1 - i])] : [i];
      if (pair.every((j) => clues[j] < 0)) continue;
      const saved = pair.map((j) => clues[j]);
      pair.forEach((j) => (clues[j] = -1));
      if (countSolutions(clues, geo, 2).count !== 1) {
        pair.forEach((j, n) => (clues[j] = saved[n]));
      }
    }

    const { guesses, solution } = countSolutions(clues, geo, 1);
    const shown = clues.filter((v) => v >= 0).length;

    const edges = [];
    for (let e = 0; e < geo.edgeCount; e++) if (solution[e] === ON) edges.push(e);

    return {
      type: 'slitherlink',
      difficulty: level,
      rows,
      cols,
      // Row-major, -1 = no clue, else 0..3.
      clues,
      solution: {
        // Edge ids that are part of the loop.
        edges,
        // Equivalent, and much easier to render as a filled shape: which cells
        // are inside the loop, row-major.
        interior: Array.from(region),
      },
      stats: {
        clueCount: shown,
        clueDensity: +(shown / cellCount).toFixed(2),
        searchNodes: guesses,
        loopLength: edges.length,
      },
    };
  }

  throw new Error(`slitherlink: no unique puzzle found in ${maxAttempts} attempts`);
}

/** Edge id -> drawable segment in cell-units. Exported for renderers. */
export function edgeSegments(rows, cols, edges) {
  const geo = geometry(rows, cols);
  return edges.map((e) => {
    if (e < geo.hCount) {
      const r = Math.floor(e / cols);
      const c = e % cols;
      return { x1: c, y1: r, x2: c + 1, y2: r };
    }
    const idx = e - geo.hCount;
    const r = Math.floor(idx / (cols + 1));
    const c = idx % (cols + 1);
    return { x1: c, y1: r, x2: c, y2: r + 1 };
  });
}

export const meta = {
  type: 'slitherlink',
  name: 'Loop',
  blurb:
    'Draw one closed loop along the grid lines. Each number tells you how many of that cell’s four sides the loop uses.',
  difficulties: ['easy', 'medium', 'hard'],
};
