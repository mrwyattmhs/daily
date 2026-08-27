# daily

Deterministic math puzzle generators, plus a page that rebuilds itself every
morning.

Four puzzle types: **sudoku**, **rectangles** (shikaku), **loop**
(slitherlink), and a **word search** drawn from math vocabulary. Every puzzle is
checked to have exactly one solution before it is published.

All four are playable in the browser, on desktop and touch, with progress saved
locally. The page also ships a static version of every puzzle, so it still
prints and still works with JavaScript off.

- Today's page: `https://mrwyattmhs.github.io/daily/`
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

Each has **Check**, **Reveal** and **Clear**. Progress is written to
localStorage keyed by date and puzzle, and is discarded automatically if the
puzzle for that date changes.

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
```

All four also carry `date`, `seed`, `difficulty`, and (except sudoku) `rows`
and `cols`. For slitherlink, `interior` is usually easier to render than
`edges`: it's a row-major 0/1 mask of the cells inside the loop.

## Determinism

A date is the seed. `rngForDate('2026-09-14')` always produces the same
puzzles, on every machine and every reload, so the page can be regenerated or
cached freely and every visitor sees the same puzzle. Generators never call
`Math.random`.

## Schedule

`.github/workflows/daily.yml` runs at 09:07 and 10:07 UTC. GitHub cron is UTC
only and ignores daylight saving, so both slots are chosen to land before 07:00
Eastern all year:

| Slot | Summer (EDT) | Winter (EST) |
| --- | --- | --- |
| 09:07 UTC | 05:07 | 04:07 |
| 10:07 UTC | 06:07 | 05:07 |

Scheduled runs are often late and occasionally very late, so the first slot
leaves nearly two hours of slack. The second is a catch-up that exits
immediately if `archive/<date>.html` already exists.

Each run also generates 15 days ahead. Today's puzzles were almost certainly
written a fortnight ago, so a slow seed can never delay publishing.

Difficulty follows the school week: easier Monday and Tuesday, hardest Friday.
Change the `ramp` array in `v1/index.js` to adjust.

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
| `v1/render/` | Static SVG for print and no-JS. | generator output |
| `v1/play/` | Interactive boards. | generator output |

Adding interactivity required no change to any generator, which is what the
data-only contract was for.

## Tests

`npm test` validates every generator by re-deriving each answer independently of
the code that produced it: sudoku uniqueness via a plain depth-first counter,
shikaku tiling and clue-to-rectangle correspondence, slitherlink loops rebuilt
from the interior mask and walked to confirm there's exactly one, and every word
search placement located in the grid.

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
