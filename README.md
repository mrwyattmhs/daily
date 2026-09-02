# daily

Deterministic math puzzle generators, plus a page that rebuilds itself every
morning.

Five puzzle types: **sudoku**, **rectangles** (shikaku), **loop**
(slitherlink), a **word search** drawn from math vocabulary, and a daily
**word guess**. The first four are checked to have exactly one solution before
they are published.

All five are playable in the browser, on desktop and touch, with progress saved
locally. The page also ships a static version of every puzzle, so it still
prints and still works with JavaScript off.

The page is a **date-agnostic shell**. It reads the reader's date on load and
fetches from a 30-day buffer of pre-generated puzzle files, so the day rolls
over at midnight Eastern whether or not the nightly job ran. The workflow has no
deadline — it only tops the buffer up.

- Today's page: `https://mrwyattmhs.github.io/daily/`
- A specific day: `https://mrwyattmhs.github.io/daily/?date=2026-09-08` (past days only appear in the picker)
- Today's data: `https://mrwyattmhs.github.io/daily/puzzles/YYYY-MM-DD.json`
- Library: `https://mrwyattmhs.github.io/daily/v1/index.js`

## Setup, once

1. Push the **contents** of this folder to the **root** of `mrwyattmhs/daily`.
   Not the folder itself — if the repo ends up containing a subfolder, Pages
   won't find `index.html` and Actions won't find `.github/workflows/`, so
   nothing runs and the homepage falls back to whatever README is at the root.
   Remember that `.nojekyll` and `.github/` are dotfiles and are skipped by
   `mv *` and by some drag-and-drop uploads.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/`.
   Do **not** use "Choose a theme" — it writes a `_config.yml` and Jekyll then
   renders `README.md` as the homepage instead of serving `index.html`. If a
   `_config.yml` already exists, delete it. The `.nojekyll` file in this repo
   turns Jekyll off; make sure it actually got committed, since some tools skip
   dotfiles.
3. **Settings → Secrets and variables → Actions → New repository secret**,
   named `ANTHROPIC_API_KEY`. Optional: without it the page still builds, using
   built-in copy instead of generated copy.
4. Run the workflow once by hand: **Actions → Publish daily puzzles → Run
   workflow**. Scheduled workflows on a fresh repo sometimes don't fire until
   there has been one manual run.

### If the homepage shows the README instead of puzzles

Jekyll is running. Check that `.nojekyll` exists at the repo root and that
`_config.yml` does not, then confirm `index.html` is present at the root — it is
written by the workflow, so it won't exist until a build has run successfully.

## Local use

```bash
npm test                              # validate all four generators
npm run daily                         # today's puzzles + page
npm run ahead                         # generate the next 15 days
node scripts/generate-daily.js 2026-09-14
node scripts/build-site.js 2026-09-14
```

`index.html` is written to the repo root and a dated copy to `archive/`.

## Pulling puzzles into another site

Every site under `mrwyattmhs.github.io` is the same origin, so no CDN, no build
step, and no CORS setup is needed. Two ways in.

**Import the library and generate in the browser:**

```js
import { generate, rngForDate } from '/daily/v1/index.js';

const puzzle = generate('sudoku', rngForDate('2026-09-14'), { difficulty: 'hard' });
```

**Or fetch the pre-built JSON**, which is the better option for anything
loop-related — uniqueness checking is the slow part and it has already been
done:

```js
const res  = await fetch('/daily/puzzles/2026-09-14.json');
const { puzzles } = await res.json();
```

Note the leading slash. A relative path like `../daily/` will not
resolve correctly from another repo's Pages site.

### Interactive views

`v1/play/` mounts a playable puzzle into any element. It needs `v1/play/play.css`
on the page for styling.

```js
import { mount } from '/daily/v1/play/index.js';
mount(puzzle, document.querySelector('#board'));
```

If the page embeds the day's JSON in a `<script type="application/json"
id="puzzle-data">` and marks slots with `data-play-slot="sudoku"`, one call does
everything:

```js
import { hydrate } from '/daily/v1/play/index.js';
hydrate();
```

Controls per puzzle:

| Puzzle | How to play |
| --- | --- |
| Sudoku | Click or arrow-key to a cell, type 1–9, `P` toggles notes. On-screen keypad for touch. Conflicts outline in red. |
| Rectangles | Drag across cells to draw a rectangle; tap one to remove it. The preview is colour-coded before you commit. |
| Loop | Tap near an edge to cycle line, cross, blank. Right-click or `X` goes straight to a cross. |
| Word search | Drag from the first letter to the last. The selection snaps to the nearest of the eight directions. |
| Word guess | Type or tap five letters, Enter to submit, six tries. Any five letters are accepted — there is no dictionary check. |

The first four have **Check**, **Reveal** and **Clear**. The word guess has
**Give up**, **Clear** and **Copy result** instead: it is the only puzzle that
can be *lost*, so there is nothing to check mid-solve. Progress is written to
localStorage keyed by date and puzzle, and is discarded automatically if the
puzzle for that date changes.

### Day picker

The nav bar carries a dropdown of the **last 7 days**. Future days are
deliberately not listed. They are still fetchable by URL — anyone reading the
source can find them — which is an accepted trade for the punctuality the buffer
buys. Today's solutions are in the page source too, so the bar has always been
"casual peeking", not security.

### Solve tally and celebration

`v1/play/progress.js` keeps a record of solved puzzles in localStorage, and
`hydrate()` renders a badge into any `[data-trophy-slot]` element showing the
running total, one dot per puzzle in the day's set, and how many full days have
been cleared.

Only genuine solves count. **Reveal and Give up never record a solve**, and the
word guess only reports on a win — so running out of guesses means the day
cannot reach full completion. Recording is idempotent, because completion checks
run on every keystroke.

Clearing every puzzle on a page fires `celebrate()` from
`v1/play/celebrate.js`: fourteen shells that climb from the bottom of the
screen, burst, and throw sparks with trails, over about seven seconds, in the
page's accent colours plus a brief stamp. It fires **once per date** — a `celebrated` flag stops a
returning visitor getting fireworks on every load — and is keyed to the page's
date, so an archived day celebrates that day.

Two constraints in that file are deliberate and shouldn't be relaxed casually:
`prefers-reduced-motion` gets a still stamp and no animation at all, and there
are no full-screen flashes or fast pulsing, which can provoke photosensitive
seizures. Particles fade individually and the backdrop never flashes. The canvas
is `pointer-events: none` and removes itself, so it can never trap the page.

The tally is per-browser and editable from the console. It's a tally for fun,
not a grade.

### Keyboard sharing

Five puzzles share one page, so physical keys are split by type rather than by
focus:

| Keys | Go to |
| --- | --- |
| Letters | the word guess, always — nothing else uses them |
| Digits `1`–`9`, `0` | the sudoku, always |
| Arrows | whichever board has focus |
| Enter, Backspace | whichever board has focus; the word guess if none does |

Claiming letters unconditionally is deliberate. Requiring focus meant that
clicking the sudoku, scrolling to the word guess and typing did nothing at all,
with no indication why. For the same reason the sudoku has no letter shortcuts:
a `P`-for-notes binding silently flipped modes whenever someone typed a word
containing a P.

### Static renderers

Optional SVG renderers live in a separate module, so you can ignore them
entirely and draw the data yourself:

```js
import { renderPuzzle } from '/daily/v1/render/svg.js';
element.innerHTML = renderPuzzle(puzzle, { showSolution: false });
```

Renderers read `--puzzle-ink`, `--puzzle-rule`, `--puzzle-accent`,
`--puzzle-tint`, `--puzzle-tint-2`, and `--puzzle-paper` from CSS, so the host
page controls the palette.

### Versioning

`v1/` is frozen now that other sites can depend on it. Breaking changes go in a
new `v2/` folder, and each site moves over when it's ready. That way one push
can't break every site at once.

## Data shapes

Generators return data only — no DOM, no styling. Each type's solution looks
different, so rendering stays per-type.

```js
{ type: 'sudoku',      puzzle: [81 ints, 0 = blank],  solution: [81 ints] }
{ type: 'shikaku',     clues: [{r, c, value}],        solution: [{r0, c0, h, w, value}] }
{ type: 'slitherlink', clues: [rows*cols, -1 = none], solution: { edges: [...], interior: [...] } }
{ type: 'wordsearch',  grid: [rows*cols chars],       solution: { placements: [...] } }
{ type: 'wordle',      length: 5, maxGuesses: 6,      solution: { answer: 'SLOPE' } }
```

The word guess ships its answer to the browser, because guesses are scored
offline. Anyone who opens the page source can read it. That is the same trade
the other four make (their solutions are in the payload too), but here it
actually spoils the puzzle — worth knowing before you treat it as a contest.

All four also carry `date`, `seed`, `difficulty`, and (except sudoku) `rows`
and `cols`. For slitherlink, `interior` is usually easier to render than
`edges`: it's a row-major 0/1 mask of the cells inside the loop.

## Determinism

A date is the seed. `rngForDate('2026-09-14')` always produces the same
puzzles, on every machine and every reload, so the page can be regenerated or
cached freely and every visitor sees the same puzzle. Generators never call
`Math.random`.

## Schedule

`.github/workflows/daily.yml` runs at 08:09 and 14:23 UTC, plus on any push to
`v1/**` or `scripts/**`.

**Neither slot is a deadline.** The page resolves its own date from the
committed buffer, so a run that is hours late, or skipped, or skipped for a
fortnight, doesn't affect what students see in the morning. Two slots are cheap
redundancy for topping the buffer up, nothing more.

Generation skips days whose files already exist, so a repeat run takes a second
or two and commits nothing. There is no skip guard and **no `date` input**: that
input caused a long-running bug, because re-running an old workflow run replays
its original inputs, so a re-run kept rebuilding a weeks-old day and putting it
back on the site. With the page choosing its own date, the input had nothing
useful to do, so it's gone and the bug is structurally impossible.

To regenerate existing files after changing a generator, dispatch manually with
**force** ticked.

### Buffer

30 days ahead, 7 days behind, about 16KB per day — roughly half a megabyte
total. Days older than the 7-day window are pruned automatically.

The buffer is a sliding window, not a batch: each run generates 30 days starting
from the day it runs, so it refills from the front continuously. It only drains
if the job stops running for 30 consecutive days. If it ever does empty, the
page shows the most recent day it has, with a notice, rather than an error.

Rendered HTML is no longer archived per day. That folder was 113KB a day and the
bulk of repo growth; the buffer is the only stored state now.

## Token cost

Near zero. The generators are ordinary algorithms — backtracking, exact cover,
constraint propagation — and no model is involved in producing a puzzle. Don't
be tempted to change that: language models are unreliable at producing valid
sudoku and hopeless at slitherlink, where validity depends on a global
single-loop property.

The API is used once per day for the page's written copy only: a greeting, one
strategy tip, and a math note. **Puzzle data is deliberately never sent to the
model** — it would cost tokens on every build, and a model reformatting a grid
could only ever make it worse. If the call fails or the key is missing, the
build falls back to static copy rather than failing.

## Word lists

`v1/data/words5.json` is the answer pool for the word guess: 808 common
five-letter words, about 2.2 years of daily puzzles. The build validates every
entry and fails loudly rather than shipping a broken one.

Answers are drawn by walking a fixed shuffle of the pool, so the whole list is
used before anything repeats. The shuffle seed is a constant on purpose —
seeding it from the date gives a fresh permutation every day, which is really
random sampling, and answers started repeating within ten days. Changing
`ORDER_SEED` in `v1/generators/wordle.js` reshuffles all future answers.

Because the pool is split by difficulty and difficulty follows the school week,
a repeat becomes possible after roughly the size of the smallest bucket
(currently 166 days). Add words to lengthen that.

## Vocabulary

`v1/data/vocab.json` holds ten units of math terms. The daily build rotates
through them by date. Edit it freely — terms are normalized to A–Z, so spaces
and hyphens are fine, and anything over 13 letters is skipped to keep the grid
printable.

To pin a unit to what you're actually teaching:

```js
buildDailySet('2026-09-14', { vocab, unit: 'quadratics' });
```

## Layers

The three layers are separate on purpose, and each is usable without the ones
above it.

| Folder | Role | Depends on |
| --- | --- | --- |
| `v1/generators/` | Produce puzzle data. No DOM, no styling. | nothing |
| `v1/render/` | Static SVG, used for print and as a mount fallback. | generator output |
| `v1/play/` | Interactive boards, tally, celebration. | generator output |

Note that the page itself is now built in the browser by `v1/play/page.js`, so
JavaScript is required to see any puzzles. Printing still works normally, since
browsers run JavaScript; a reader with scripting disabled gets a short notice.

The word guess is the one puzzle with no static form — its board is empty until
someone plays and printing the answer would defeat it — so it shows a short
notice instead of an SVG and is excluded from print entirely.

Adding interactivity required no change to any generator, which is what the
data-only contract was for.

## Tests

`npm test` validates every generator by re-deriving each answer independently of
the code that produced it: sudoku uniqueness via a plain depth-first counter,
shikaku tiling and clue-to-rectangle correspondence, slitherlink loops rebuilt
from the interior mask and walked to confirm there's exactly one, every word
search placement located in the grid, and word-guess scoring cross-checked
against a second implementation written from the rule.

`tests/wordle-scoring.js` is the focused check on guess scoring, which is the
one piece of logic here that is easy to get subtly wrong. Twelve hand-worked
repeated-letter cases plus 200,000 random pairs cross-checked against an
independent reference. The naive rule — green on a match, else yellow if the
letter appears anywhere — is wrong whenever a letter repeats: `SPEED` guessed
against `ERASE` must score `Y.YY.`, and `EERIE` against `SPEED` must leave the
third E blank.

`tests/slitherlink-exhaustive.js` is the strong check on the loop solver: it
enumerates all 2^(rows·cols) states and compares against the solver's
uniqueness claim. It takes about a minute per 5×5 puzzle, so it isn't part of
`npm test`. Run it after changing the solver.

## Printing

The page has a real print stylesheet: one puzzle per sheet, navigation, controls
and tips suppressed, and answers hidden even if revealed on screen. Printing
deliberately falls back to the blank static puzzle rather than the interactive
board, so a half-finished screen doesn't end up on the handout.

## Naming

"Shikaku" and "Slitherlink" are Nikoli's names for these puzzle types and Nikoli
asserts trademarks on some of them, so the page calls them **Rectangles** and
**Loop**. The generator module names are kept for clarity in the code.
