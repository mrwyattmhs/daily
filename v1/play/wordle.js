/**
 * Interactive word guess.
 *
 * Guesses are not checked against a dictionary — any five letters are accepted,
 * which is what was asked for and also removes a 90KB word list from the page.
 *
 * Unlike the other four puzzles this one can be *lost*, so it has an end state
 * they don't: after the last guess the board is finished whether or not it was
 * solved. That is why there is no Check button and why Clear asks twice.
 */

import { el, controls, statusLine, loadState, saveState, clearState } from './state.js';
import { scoreGuess, keyboardState } from '../generators/wordle.js';

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const MARK_EMOJI = { correct: '\u{1F7E9}', present: '\u{1F7E8}', absent: '\u{2B1C}' };

export function mountWordle(puzzle, root) {
  const answer = puzzle.solution.answer.toUpperCase();
  const length = puzzle.length ?? 5;
  const maxGuesses = puzzle.maxGuesses ?? 6;

  const saved = loadState(puzzle);
  /** @type {string[]} committed guesses */
  const guesses = Array.isArray(saved?.guesses)
    ? saved.guesses.filter((g) => typeof g === 'string' && g.length === length).slice(0, maxGuesses)
    : [];
  let current = '';
  let revealed = false;

  const won = () => guesses.includes(answer);
  const finished = () => won() || guesses.length >= maxGuesses || revealed;

  const status = statusLine();

  const board = el('div', {
    class: 'pz-wordle',
    'aria-label': `Word guess, ${length} letters, ${maxGuesses} tries`,
  });

  const tiles = [];
  for (let r = 0; r < maxGuesses; r++) {
    const row = el('div', { class: 'pz-wordle-row' });
    const rowTiles = [];
    for (let c = 0; c < length; c++) {
      const tile = el('span', { class: 'pz-tile' });
      rowTiles.push(tile);
      row.append(tile);
    }
    tiles.push(rowTiles);
    board.append(row);
  }

  /* ---------- keyboard ---------- */

  const keyNodes = new Map();
  const keyboard = el('div', { class: 'pz-kb', 'aria-label': 'Letter keys' });

  ROWS.forEach((letters, i) => {
    const row = el('div', { class: 'pz-kb-row' });
    if (i === 2) {
      row.append(
        el('button', {
          type: 'button',
          class: 'pz-kb-key pz-kb-wide',
          text: 'Enter',
          onClick: () => submit(),
        }),
      );
    }
    for (const letter of letters) {
      const key = el('button', {
        type: 'button',
        class: 'pz-kb-key',
        text: letter,
        'aria-label': letter,
        onClick: () => type(letter),
      });
      keyNodes.set(letter, key);
      row.append(key);
    }
    if (i === 2) {
      row.append(
        el('button', {
          type: 'button',
          class: 'pz-kb-key pz-kb-wide',
          text: '\u232B',
          'aria-label': 'Backspace',
          onClick: () => back(),
        }),
      );
    }
    keyboard.append(row);
  });

  /* ---------- rendering ---------- */

  function paint({ animateRow = -1 } = {}) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    for (let r = 0; r < maxGuesses; r++) {
      const guess = guesses[r];
      for (let c = 0; c < length; c++) {
        const tile = tiles[r][c];
        if (guess) {
          const marks = scoreGuess(guess, answer);
          tile.textContent = guess[c];
          tile.className = `pz-tile pz-tile-${marks[c]}`;
          // Stagger only the row just submitted, so restoring a saved game
          // doesn't replay every previous guess.
          tile.style.transitionDelay = r === animateRow && !reduce ? `${c * 90}ms` : '';
        } else if (r === guesses.length && !finished()) {
          tile.textContent = current[c] ?? '';
          tile.className = `pz-tile${current[c] ? ' pz-tile-filled' : ''}`;
          tile.style.transitionDelay = '';
        } else {
          tile.textContent = '';
          tile.className = 'pz-tile';
          tile.style.transitionDelay = '';
        }
      }
    }

    const states = keyboardState(guesses, answer);
    for (const [letter, node] of keyNodes) {
      const state = states.get(letter);
      node.className = `pz-kb-key${state ? ` pz-kb-${state}` : ''}`;
    }

    copyBtn.hidden = !finished() || revealed;

    if (revealed) status.set(`Given up. The word was ${answer}.`, 'warn');
    else if (won()) {
      status.set(
        guesses.length === 1
          ? `Solved on the first guess. ${answer}.`
          : `Solved in ${guesses.length} of ${maxGuesses}.`,
        'done',
      );
    } else if (guesses.length >= maxGuesses) status.set(`Out of guesses. It was ${answer}.`, 'warn');
    else {
      const left = maxGuesses - guesses.length;
      status.set(`${left} ${left === 1 ? 'guess' : 'guesses'} left.`);
    }
  }

  function shake() {
    const row = tiles[guesses.length];
    if (!row) return;
    const node = row[0].parentElement;
    node.classList.remove('pz-shake');
    // Reading offsetWidth forces a reflow so the animation can restart.
    void node.offsetWidth;
    node.classList.add('pz-shake');
  }

  /* ---------- input ---------- */

  function type(letter) {
    if (finished() || current.length >= length) return;
    current += letter;
    paint();
  }

  function back() {
    if (finished() || current.length === 0) return;
    current = current.slice(0, -1);
    paint();
  }

  function submit() {
    if (finished()) return;
    if (current.length < length) {
      shake();
      paint();
      status.set(`Needs ${length} letters.`, 'warn');
      return;
    }
    guesses.push(current);
    current = '';
    saveState(puzzle, { guesses });
    paint({ animateRow: guesses.length - 1 });
  }

  /**
   * Physical keyboard, bound to the document so there's nothing to click first.
   *
   * Several puzzles share the page, so keys are split by type rather than by
   * focus. Letters are claimed unconditionally — no other puzzle uses them, and
   * requiring focus meant that clicking the sudoku, scrolling down here and
   * typing did nothing at all, with no hint as to why. Enter and Backspace are
   * shared with other boards, so those defer to whatever has focus. Digits are
   * never claimed; they belong to the sudoku.
   */
  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (finished()) return;

    const target = event.target;
    if (target?.matches?.('input, textarea, select')) return;
    const sheet = target?.closest?.('[data-sheet]');
    const elsewhere = Boolean(sheet) && sheet.dataset.sheet !== 'wordle';

    const key = event.key;
    if (/^[a-zA-Z]$/.test(key)) {
      event.preventDefault();
      type(key.toUpperCase());
    } else if (key === 'Enter' && !elsewhere) {
      event.preventDefault();
      submit();
    } else if (key === 'Backspace' && !elsewhere) {
      event.preventDefault();
      back();
    }
  }
  document.addEventListener('keydown', onKeyDown);

  /* ---------- controls ---------- */

  const copyBtn = el('button', {
    type: 'button',
    class: 'pz-btn',
    text: 'Copy result',
    hidden: true,
    onClick: async () => {
      const grid = guesses
        .map((g) => scoreGuess(g, answer).map((m) => MARK_EMOJI[m]).join(''))
        .join('\n');
      const header = `Word guess ${puzzle.date ?? ''} ${won() ? guesses.length : 'X'}/${maxGuesses}`;
      const text = `${header}\n\n${grid}`;
      try {
        await navigator.clipboard.writeText(text);
        status.set('Result copied.', 'ok');
      } catch {
        // Clipboard access needs a secure context and can be blocked outright.
        window.prompt('Copy your result:', text.replace(/\n/g, ' | '));
      }
    },
  });

  const bar = controls([
    {
      label: 'Give up',
      kind: 'danger',
      action: 'reveal',
      onClick: () => {
        if (finished()) return;
        if (!window.confirm('Show the answer? This ends today\u2019s puzzle.')) return;
        revealed = true;
        current = '';
        saveState(puzzle, { guesses, revealed: true });
        paint();
      },
    },
    {
      label: 'Clear',
      action: 'clear',
      onClick: () => {
        if (guesses.length && !window.confirm('This is a once-a-day puzzle. Clear your guesses?')) {
          return;
        }
        guesses.length = 0;
        current = '';
        revealed = false;
        clearState(puzzle);
        paint();
      },
    },
  ]);
  bar.append(copyBtn);

  if (saved?.revealed) revealed = true;

  root.append(
    board,
    keyboard,
    bar,
    status.node,
    el('p', {
      class: 'pz-hint',
      // Describes the actual tiles: this page prints in one accent ink, so the
      // states are solid and pale rather than green and yellow.
      text: 'Type or tap. A solid tile is the right letter in the right place; a pale tile is the right letter somewhere else.',
    }),
  );

  paint();
}
