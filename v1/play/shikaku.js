/**
 * Interactive rectangle puzzle (shikaku).
 *
 * Drag across cells to draw a rectangle; tap an existing one to remove it. A
 * tap on an empty cell makes a 1x1, which is needed for area-1 clues and is
 * undone by tapping the same cell again.
 *
 * While dragging, the preview is colour-coded against the two rules — exactly
 * one number inside, and area equal to that number — so the feedback arrives
 * before you commit rather than after.
 */

import { svg, el, controls, statusLine, loadState, saveState, clearState, debounce } from './state.js';

const CELL = 40;
const PAD = 16;

export function mountShikaku(puzzle, root) {
  const { rows, cols, clues } = puzzle;
  const clueAt = new Map(clues.map((cl) => [cl.r * cols + cl.c, cl.value]));

  const saved = loadState(puzzle);
  /** @type {{r0:number,c0:number,h:number,w:number}[]} */
  let rects = Array.isArray(saved?.rects) ? saved.rects.slice() : [];
  let revealed = false;

  // See sudoku.js: don't let a debounced save write the revealed solution
  // over the student's own work.
  const persist = debounce(() => {
    if (revealed) return;
    saveState(puzzle, { rects });
  }, 200);
  let stash = null;
  const status = statusLine();

  const width = cols * CELL + PAD * 2;
  const height = rows * CELL + PAD * 2;
  const board = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'pz-svg pz-rects',
    role: 'application',
    'aria-label': `Rectangle puzzle, ${rows} by ${cols}`,
    tabindex: '0',
  });

  const layerFills = svg('g', {});
  const layerGrid = svg('g', {});
  const layerRects = svg('g', {});
  const layerPreview = svg('g', {});
  const layerClues = svg('g', {});

  for (let c = 1; c < cols; c++) {
    layerGrid.append(
      svg('line', {
        x1: PAD + c * CELL, y1: PAD, x2: PAD + c * CELL, y2: PAD + rows * CELL,
        class: 'pz-grid-line',
      }),
    );
  }
  for (let r = 1; r < rows; r++) {
    layerGrid.append(
      svg('line', {
        x1: PAD, y1: PAD + r * CELL, x2: PAD + cols * CELL, y2: PAD + r * CELL,
        class: 'pz-grid-line',
      }),
    );
  }
  layerGrid.append(
    svg('rect', {
      x: PAD, y: PAD, width: cols * CELL, height: rows * CELL, class: 'pz-frame',
    }),
  );

  for (const cl of clues) {
    const cx = PAD + cl.c * CELL + CELL / 2;
    const cy = PAD + cl.r * CELL + CELL / 2;
    layerClues.append(svg('circle', { cx, cy, r: CELL * 0.36, class: 'pz-clue-disc' }));
    layerClues.append(
      svg('text', {
        x: cx, y: cy, class: 'pz-clue',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        text: String(cl.value),
      }),
    );
  }

  board.append(layerFills, layerGrid, layerRects, layerPreview, layerClues);

  /* ---------- rules ---------- */

  const cellsOf = (rect) => {
    const out = [];
    for (let r = rect.r0; r < rect.r0 + rect.h; r++) {
      for (let c = rect.c0; c < rect.c0 + rect.w; c++) out.push(r * cols + c);
    }
    return out;
  };

  /** How a rectangle stands against the rules, independent of its neighbours. */
  function judge(rect) {
    const inside = cellsOf(rect).filter((i) => clueAt.has(i));
    if (inside.length === 0) return { ok: false, why: 'no number inside' };
    if (inside.length > 1) return { ok: false, why: 'more than one number' };
    const value = clueAt.get(inside[0]);
    const area = rect.h * rect.w;
    if (area !== value) return { ok: false, why: `area ${area}, number ${value}` };
    return { ok: true, value };
  }

  const coverage = () => {
    const cover = new Int16Array(rows * cols).fill(-1);
    rects.forEach((rect, k) => {
      for (const i of cellsOf(rect)) cover[i] = k;
    });
    return cover;
  };

  const overlaps = (rect, ignore = -1) =>
    rects.some((other, k) => {
      if (k === ignore) return false;
      return (
        rect.c0 < other.c0 + other.w &&
        other.c0 < rect.c0 + rect.w &&
        rect.r0 < other.r0 + other.h &&
        other.r0 < rect.r0 + rect.h
      );
    });

  function isSolved() {
    if (rects.length !== clues.length) return false;
    if (!rects.every((r) => judge(r).ok)) return false;
    return !coverage().includes(-1);
  }

  /* ---------- rendering ---------- */

  function paint() {
    layerFills.replaceChildren();
    layerRects.replaceChildren();

    rects.forEach((rect) => {
      const verdict = judge(rect);
      const cls = verdict.ok ? 'pz-rect-ok' : 'pz-rect-bad';
      layerFills.append(
        svg('rect', {
          x: PAD + rect.c0 * CELL, y: PAD + rect.r0 * CELL,
          width: rect.w * CELL, height: rect.h * CELL,
          class: `pz-rect-fill ${cls}`,
        }),
      );
      layerRects.append(
        svg('rect', {
          x: PAD + rect.c0 * CELL, y: PAD + rect.r0 * CELL,
          width: rect.w * CELL, height: rect.h * CELL,
          class: `pz-rect-edge ${cls}`,
        }),
      );
    });

    const uncovered = coverage().reduce((n, v) => n + (v === -1 ? 1 : 0), 0);
    const bad = rects.filter((r) => !judge(r).ok).length;

    if (revealed) status.set('Solution shown.', 'warn');
    else if (isSolved()) status.set('Solved. Every rectangle matches its number.', 'done');
    else if (bad) status.set(`${rects.length} drawn, ${bad} don't match their number.`, 'warn');
    else status.set(`${rects.length} of ${clues.length} drawn, ${uncovered} cells left.`);
  }

  /* ---------- drag to draw ---------- */

  const cellFromEvent = (event) => {
    const rect = board.getBoundingClientRect();
    // Map client coordinates through the viewBox, since the SVG is scaled by CSS.
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const x = (event.clientX - rect.left) * scaleX - PAD;
    const y = (event.clientY - rect.top) * scaleY - PAD;
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    return { r, c };
  };

  let anchor = null;
  let moved = false;
  let previewNode = null;

  const spanOf = (a, b) => ({
    r0: Math.min(a.r, b.r),
    c0: Math.min(a.c, b.c),
    h: Math.abs(a.r - b.r) + 1,
    w: Math.abs(a.c - b.c) + 1,
  });

  function drawPreview(rect) {
    layerPreview.replaceChildren();
    if (!rect) {
      previewNode = null;
      return;
    }
    const verdict = judge(rect);
    const clash = overlaps(rect);
    const cls = clash ? 'pz-preview-clash' : verdict.ok ? 'pz-preview-ok' : 'pz-preview-bad';
    previewNode = svg('rect', {
      x: PAD + rect.c0 * CELL, y: PAD + rect.r0 * CELL,
      width: rect.w * CELL, height: rect.h * CELL,
      class: `pz-preview ${cls}`,
    });
    layerPreview.append(previewNode);
    layerPreview.append(
      svg('text', {
        x: PAD + rect.c0 * CELL + (rect.w * CELL) / 2,
        y: PAD + rect.r0 * CELL + (rect.h * CELL) / 2,
        class: 'pz-preview-label',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        text: String(rect.h * rect.w),
      }),
    );
    status.set(
      clash
        ? 'That would overlap a rectangle you already drew.'
        : verdict.ok
          ? `${rect.h}x${rect.w} = ${rect.h * rect.w}. Matches.`
          : `${rect.h}x${rect.w} = ${rect.h * rect.w} — ${verdict.why}.`,
      clash || !verdict.ok ? 'warn' : 'ok',
    );
  }

  board.addEventListener('pointerdown', (event) => {
    if (revealed) return;
    if (event.button !== undefined && event.button !== 0) return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    event.preventDefault();
    board.setPointerCapture?.(event.pointerId);
    anchor = cell;
    moved = false;
    drawPreview(spanOf(cell, cell));
  });

  board.addEventListener('pointermove', (event) => {
    if (!anchor) return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    if (cell.r !== anchor.r || cell.c !== anchor.c) moved = true;
    drawPreview(spanOf(anchor, cell));
  });

  function endDrag(event) {
    if (!anchor) return;
    const cell = cellFromEvent(event) ?? anchor;
    const rect = spanOf(anchor, cell);
    anchor = null;
    drawPreview(null);

    const cover = coverage();
    const hitIndex = cover[rect.r0 * cols + rect.c0];

    // A tap (no drag) on an existing rectangle removes it. This is also how a
    // 1x1 gets undone, which keeps tap-to-create from being a trap.
    if (!moved && hitIndex !== -1) {
      rects.splice(hitIndex, 1);
      persist();
      paint();
      return;
    }
    if (overlaps(rect)) {
      // paint() rewrites the status line, so the warning has to come after it.
      paint();
      status.set('That would overlap a rectangle you already drew.', 'warn');
      return;
    }
    rects.push(rect);
    persist();
    paint();
  }

  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', () => {
    anchor = null;
    drawPreview(null);
    paint();
  });

  const bar = controls([
    {
      label: 'Check',
      action: 'check',
      onClick: () => {
        if (isSolved()) {
          status.set('Solved. Every rectangle matches its number.', 'done');
          return;
        }
        const bad = rects.filter((r) => !judge(r).ok);
        const uncovered = coverage().reduce((n, v) => n + (v === -1 ? 1 : 0), 0);
        if (bad.length) status.set(`${bad.length} rectangle(s) break the rules — shown in red.`, 'warn');
        else status.set(`All good so far. ${uncovered} cells still uncovered.`, 'ok');
      },
    },
    {
      label: 'Reveal',
      kind: 'danger',
      action: 'reveal',
      onClick: () => {
        revealed = !revealed;
        if (revealed) {
          stash = rects;
          rects = puzzle.solution.map(({ r0, c0, h, w }) => ({ r0, c0, h, w }));
        } else {
          rects = stash ?? [];
          stash = null;
        }
        paint();
      },
    },
    {
      label: 'Clear',
      action: 'clear',
      onClick: () => {
        if (!window.confirm('Clear your work on this rectangle puzzle?')) return;
        rects = [];
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
      text: 'Drag across cells to draw a rectangle. Tap one to remove it.',
    }),
  );

  paint();
}
