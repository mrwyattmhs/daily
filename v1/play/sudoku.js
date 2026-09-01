/**
 * Interactive sudoku.
 *
 * Built from HTML rather than SVG: real focus management, keyboard navigation
 * and screen-reader semantics matter more here than drawing control, and an
 * SVG grid gives none of them for free.
 */

import { el, controls, statusLine, loadState, saveState, clearState, debounce } from './state.js';

const N = 9;

const PEERS = (() => {
  const peers = [];
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / N);
    const c = i % N;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    const set = new Set();
    for (let k = 0; k < N; k++) {
      set.add(r * N + k);
      set.add(k * N + c);
    }
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) set.add((br + dr) * N + bc + dc);
    }
    set.delete(i);
    peers.push([...set]);
  }
  return peers;
})();

export function mountSudoku(puzzle, root, opts = {}) {
  // Called once when the board is genuinely solved. Reveal never triggers it.
  let reported = false;
  const reportSolved = () => {
    if (reported || revealed) return;
    reported = true;
    opts.onSolved?.(puzzle.type);
  };

  const given = puzzle.puzzle;
  const saved = loadState(puzzle);

  const values = saved?.values?.length === 81 ? saved.values.slice() : new Array(81).fill(0);
  // Pencil marks as a 9-bit mask per cell, so the whole board is one small array.
  const marks = saved?.marks?.length === 81 ? saved.marks.slice() : new Array(81).fill(0);
  let pencil = false;
  let cursor = given.findIndex((v) => v === 0);
  if (cursor < 0) cursor = 0;
  let revealed = false;

  // Persisting is debounced, which means the save fires *after* whatever
  // mutated the board. Revealing overwrites `values` in place, so without this
  // guard the debounced save would write the solution into the student's
  // saved progress and their work would be gone on reload.
  const persist = debounce(() => {
    if (revealed) return;
    saveState(puzzle, { values, marks });
  }, 200);

  // User work set aside while the solution is on screen.
  let stash = null;

  const status = statusLine();
  const cells = [];

  const grid = el('div', {
    class: 'pz-sudoku',
    role: 'grid',
    'aria-label': 'Sudoku grid, 9 by 9',
  });

  for (let r = 0; r < N; r++) {
    const row = el('div', { class: 'pz-sudoku-row', role: 'row' });
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const isGiven = given[i] !== 0;
      const cell = el('div', {
        class: `pz-cell${isGiven ? ' pz-cell-given' : ''}`,
        role: 'gridcell',
        tabindex: '-1',
        'data-index': i,
        'aria-readonly': isGiven ? 'true' : 'false',
      });
      cells.push(cell);
      row.append(cell);
    }
    grid.append(row);
  }

  /* ---------- rules ---------- */

  const valueAt = (i) => (given[i] !== 0 ? given[i] : values[i]);

  /** Cells that duplicate a value within a row, column or box. */
  function conflicts() {
    const bad = new Set();
    for (let i = 0; i < 81; i++) {
      const v = valueAt(i);
      if (v === 0) continue;
      for (const p of PEERS[i]) {
        if (valueAt(p) === v) {
          bad.add(i);
          bad.add(p);
        }
      }
    }
    return bad;
  }

  function isComplete() {
    for (let i = 0; i < 81; i++) if (valueAt(i) === 0) return false;
    return conflicts().size === 0;
  }

  /* ---------- rendering ---------- */

  function paint() {
    const bad = conflicts();
    const focusValue = valueAt(cursor);

    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const v = valueAt(i);
      cell.textContent = '';
      cell.classList.toggle('pz-cell-conflict', bad.has(i));
      cell.classList.toggle('pz-cell-cursor', i === cursor);
      cell.classList.toggle('pz-cell-peer', i !== cursor && PEERS[cursor].includes(i));
      cell.classList.toggle(
        'pz-cell-match',
        focusValue !== 0 && v === focusValue && i !== cursor,
      );
      cell.setAttribute('tabindex', i === cursor ? '0' : '-1');

      if (v !== 0) {
        cell.append(el('span', { class: 'pz-value', text: String(v) }));
        cell.setAttribute('aria-label', `${label(i)}: ${v}${given[i] ? ', given' : ''}`);
      } else if (marks[i]) {
        const box = el('span', { class: 'pz-marks' });
        for (let d = 1; d <= 9; d++) {
          box.append(
            el('span', {
              class: 'pz-mark',
              text: marks[i] & (1 << (d - 1)) ? String(d) : '',
            }),
          );
        }
        cell.append(box);
        const list = [];
        for (let d = 1; d <= 9; d++) if (marks[i] & (1 << (d - 1))) list.push(d);
        cell.setAttribute('aria-label', `${label(i)}: empty, notes ${list.join(' ')}`);
      } else {
        cell.setAttribute('aria-label', `${label(i)}: empty`);
      }
    }

    const filled = values.filter((v, i) => given[i] === 0 && v !== 0).length;
    const blanks = given.filter((v) => v === 0).length;

    if (!revealed && isComplete()) reportSolved();

    if (revealed) status.set('Solution shown.', 'warn');
    else if (isComplete()) status.set('Solved. Every row, column and box checks out.', 'done');
    else if (bad.size) status.set(`${bad.size} cells conflict.`, 'warn');
    else status.set(`${filled} of ${blanks} filled.`);
  }

  function label(i) {
    return `Row ${Math.floor(i / N) + 1} column ${(i % N) + 1}`;
  }

  /* ---------- input ---------- */

  function focusCell(i) {
    cursor = Math.max(0, Math.min(80, i));
    paint();
    cells[cursor].focus({ preventScroll: true });
  }

  function enter(digit) {
    if (given[cursor] !== 0 || revealed) return;
    if (pencil) {
      // Noting a digit in a cell that already holds a value would be an
      // invisible no-op, so clear the value and keep the note.
      if (values[cursor] !== 0) values[cursor] = 0;
      marks[cursor] ^= 1 << (digit - 1);
    } else {
      // Entering a value clears its notes, and toggles off if already set.
      values[cursor] = values[cursor] === digit ? 0 : digit;
      if (values[cursor] !== 0) marks[cursor] = 0;
    }
    persist();
    paint();
  }

  function erase() {
    if (given[cursor] !== 0 || revealed) return;
    if (values[cursor] !== 0) values[cursor] = 0;
    else marks[cursor] = 0;
    persist();
    paint();
  }

  grid.addEventListener('pointerdown', (event) => {
    const cell = event.target.closest('.pz-cell');
    if (!cell) return;
    event.preventDefault();
    focusCell(Number(cell.dataset.index));
  });

  grid.addEventListener('keydown', (event) => {
    const key = event.key;
    // Arrows only. WASD aliases used to be here, but with a word puzzle on the
    // same page people type letters constantly, and having S jump the cursor
    // (or P silently flip notes mode) is a trap rather than a shortcut.
    const moves = { ArrowUp: -N, ArrowDown: N, ArrowLeft: -1, ArrowRight: 1 };
    if (key in moves) {
      event.preventDefault();
      let next = cursor + moves[key];
      // Don't wrap across row edges when moving horizontally.
      if (key === 'ArrowLeft' && cursor % N === 0) next = cursor;
      if (key === 'ArrowRight' && cursor % N === N - 1) next = cursor;
      if (next < 0 || next > 80) next = cursor;
      focusCell(next);
      return;
    }
    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      enter(Number(key));
      return;
    }
    if (key === 'Backspace' || key === 'Delete' || key === '0') {
      event.preventDefault();
      erase();
    }
    // No letter shortcuts here on purpose. Letters belong to the word puzzle,
    // which listens on the document; a P shortcut for notes would silently
    // flip modes whenever someone typed a word with a P in it.
  });

  /* ---------- keypad, pencil toggle, controls ---------- */

  const keypad = el('div', { class: 'pz-keypad', 'aria-label': 'Number pad' });
  for (let d = 1; d <= 9; d++) {
    keypad.append(
      el('button', {
        type: 'button',
        class: 'pz-key',
        text: String(d),
        'aria-label': `Enter ${d}`,
        onClick: () => {
          enter(d);
          cells[cursor].focus({ preventScroll: true });
        },
      }),
    );
  }
  keypad.append(
    el('button', {
      type: 'button',
      class: 'pz-key pz-key-erase',
      text: 'Erase',
      onClick: () => {
        erase();
        cells[cursor].focus({ preventScroll: true });
      },
    }),
  );

  const pencilBtn = el('button', {
    type: 'button',
    class: 'pz-btn pz-btn-toggle',
    text: 'Notes: off',
    'aria-pressed': 'false',
    onClick: () => setPencil(!pencil),
  });

  function setPencil(on, refocus = true) {
    pencil = on;
    pencilBtn.textContent = `Notes: ${on ? 'on' : 'off'}`;
    pencilBtn.setAttribute('aria-pressed', String(on));
    pencilBtn.classList.toggle('pz-btn-on', on);
    grid.classList.toggle('pz-pencil', on);
    // Clicking the toggle moves focus to the button, which silently kills
    // keyboard entry mid-solve. Hand focus back to the cell being worked on.
    if (refocus) cells[cursor]?.focus({ preventScroll: true });
  }

  const bar = controls([
    {
      label: 'Check',
      action: 'check',
      onClick: () => {
        const bad = conflicts();
        if (isComplete()) status.set('Solved. Every row, column and box checks out.', 'done');
        else if (bad.size) status.set(`${bad.size} cells conflict — they're outlined.`, 'warn');
        else {
          const wrong = values.filter((v, i) => v !== 0 && v !== puzzle.solution[i]).length;
          status.set(
            wrong
              ? `No conflicts yet, but ${wrong} entries don't match the solution.`
              : 'No conflicts, and everything so far is correct. Keep going.',
            wrong ? 'warn' : 'ok',
          );
        }
      },
    },
    {
      label: 'Reveal',
      kind: 'danger',
      action: 'reveal',
      onClick: () => {
        revealed = !revealed;
        if (revealed) {
          stash = values.slice();
          for (let i = 0; i < 81; i++) if (given[i] === 0) values[i] = puzzle.solution[i];
        } else {
          for (let i = 0; i < 81; i++) values[i] = stash?.[i] ?? 0;
          stash = null;
        }
        paint();
      },
    },
    {
      label: 'Clear',
      action: 'clear',
      onClick: () => {
        if (!window.confirm('Clear your work on this sudoku?')) return;
        values.fill(0);
        marks.fill(0);
        revealed = false;
        clearState(puzzle);
        paint();
      },
    },
  ]);
  bar.prepend(pencilBtn);

  root.append(
    grid,
    keypad,
    bar,
    status.node,
    el('p', {
      class: 'pz-hint',
      text: 'Arrow keys to move, 1–9 to enter. Use the Notes button for pencil marks.',
    }),
  );

  setPencil(false, false);
  paint();
}
