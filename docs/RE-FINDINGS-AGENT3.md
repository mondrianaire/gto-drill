# Agent 3 (REVIVAL) — GTO+ Menu/Format Reconnaissance

**Started**: 2026-05-26 02:30
**Status**: COMPLETE — POC emitter shipped, recommendations below.

## TL;DR — what to do

**The existing `library.txt` Quickload workflow stays the recommended path.** No newly discovered menu fundamentally beats it.

But two NEW concrete wins are now available:

1. **`scripts/gto-newdefs3-emit.mjs`** (NEW THIS AGENT) — writes 62 named ranges
   (31 hero + 31 villain) into `newdefs3.txt`, the preflop range editor's
   predef library. Same MFC CArchive format as `library.txt`, fully RE'd.
   File ready at `C:\Users\mondr\Downloads\newdefs3.txt` after running.
   Acts as a **safety net**: if a Quickload range is ever wrong, the user can
   double-click `gto-NN-hero` / `gto-NN-vill` in the preflop editor to restore.

2. **DATABASE MODE + MERGE (officially documented, not in mission targets)**
   could reduce the 31-step manual solve workflow to ~5 GUI clicks total.
   Workflow: existing manual flow → produce 31 single-tree .gto2 files → in
   GTO+, type code `MERGE` → point at solver-output/ → merges to one database
   → click PROCESS DATABASE → walk away. Then Export database → 31 solved
   .gto2 files. See "Recommended path forward" below.

The 6 menu items the mission asked about are now fully characterized — none
of them is a "magic" replacement for the existing workflow.

## Telos check

> Ship per-scenario solver-verified frequencies for 31 postflop scenarios into
> the M5 GTO Summary Card. The blocker is the per-scenario human time in GTO+
> (~5 min to manually build + save 31 scenarios). Any path that meaningfully
> reduces that wins.

## CHECKPOINT 1 — Config file inventory (15 min in)

GTO+ config dir at `C:\Program Files\GTO\config\` contains many config files we hadn't catalogued:

### TEXT FILES (line-delimited, trivially editable)

#### `prefloprankings.txt` (3489 bytes, 12 lines)
- 12 lines: header + ranking-system name lines + 8 ranked-hand lines (one per ranking system)
- Each ranked-hand line is a comma-separated list of all 169 hands ordered by strength
- Ranking systems: `@No^limit@`, `@Pokerstove@`, `@Sklansky-Malmuth@`, `@Sklansky-Chubukov@`, `@HU^all-in^equity@`, plus 3 unnamed/numeric
- USE CASE: changes how hand strength is displayed in the matrix UI. NOT useful for injecting scenarios.

#### `prefloprankings_short_sbt.txt` and `_tbs.txt` (696 bytes each, 6 lines)
- Short-handed (6-max?) variants of the above. Same format.
- NOT useful for our scenarios.

#### `settings.txt` (350 bytes, 25 lines)
- INI-like with `[ACTION COLORS]`, `[PREFLOP GROUP COLORS]`, `[HEATMAP COLORS]`
- Pure cosmetic. NOT useful.

#### `dynamicconditions.txt` (79KB, 24,484 lines)
- **PURE TEXT, line-delimited** — each ~127-line block defines a "dynamic condition"
- Block structure: line 1 = magic `12345`, then ~125 numeric fields, line ~127 = NAME (e.g., `quads`, `_AA`, `_KK`)
- ~192 conditions in current file (24484 / 127 ≈ 192)
- These look like preset board/hand classifiers used in the solver UI ("show me when board is `quads`", etc.)
- **UNKNOWN WHETHER WRITEABLE** — need to test if GTO+ reads this on startup or only on menu invocation. Field meanings are mostly unknown (mostly 0s).
- Probably NOT useful for our scenarios but extremely tractable format if it turns out to control something useful.

#### `config/languages/english.txt` (42KB, 1416 lines) — THE ROSETTA STONE
- Every menu item, button, error, and label in plaintext (the GTO.exe binary
  is Winlicense-packed and strings inside it are encrypted at rest — confirmed
  by Agent 4's prior work; my own UTF-16 string extraction found only 17 strings)
- Section-delimited: `[MAIN INTERFACE]`, `[PREFLOP EDITOR]`, `[STACK EDITOR]`,
  `[BOARD EDITOR]`, `[TREE EDITOR]`, `[SOLVER EDITOR]`, `[NAVIGATOR TOOL]`,
  `[FILE WINDOW]`, `[ANALYSIS TOOL]`, `[MENU]`, `[MENU2]`, etc.
- This is the file that unlocks understanding of GTO+'s behavior without
  spelunking the encrypted exe

### BINARY FILES (MFC CArchive serialization with TEXT bracket markers)

#### `library.txt` (68,287 bytes — modified tonight 01:23) — THE QUICKLOAD LIBRARY
- Format: 16-byte header (`<u32 hdr-len-low><u32 0><u32 ?><u32 0>`) → `[HEADER]...[/HEADER]` block → `[TREE]...[/TREE]` blocks
- Each TREE block contains: tree name (e.g. "test-bb-monster"), preflop range strings (compressed), board cards (`AdAcAh`), stack sizes (50, 120, 40, 75 etc), action colors, more data
- We already have `scripts/gto-library-emit.mjs` for same-length AND length-changing patches (after Agent 1 fixed the @+18 bug). **Working and shipped.**

#### `newdefs3.txt` (1510 bytes — modified tonight 01:29) — THE NAMED-RANGE LIBRARY — NEW WORK
- MFC CArchive format: `<u32 block-len><u32 0><u32 size><u32 0>[CAT_HEADER1]...[/CAT_HEADER1]` etc
- Categories: `[CAT_HEADER1]`, `[CAT_HEADER2]`, `[CAT_ITEM]`, `[/CAT_ITEM]`
- Each CAT_ITEM has:
  - 4-byte field count + field metadata
  - **ASCII** length-prefixed strings (NOT UTF-16LE!): `02 07 00 00 00 50 72 65 6d 69 75 6d` = type 02, len 7, "Premium"
  - Range string: `02 0d 00 00 00 41 41 2d 51 51 2c 41 4b 73 2c 41 4b 6f` = "AA-QQ,AKs,AKo"
  - Trailing floats (weights — `00 00 f0 3f` = 1.0 as IEEE-754 double LE high half)
- **TEMPLATE version at `config/data/newdefs3_.txt`** (3490 bytes, larger — uses UTF-16LE strings; this is the LEGACY format from a previous GTO+ version, kept around for restore-from-template only)
- **POC emitter shipped** — `scripts/gto-newdefs3-emit.mjs`. Generates 62 entries, all preambles validate.

#### `default_tree_settings.txt` (951 bytes)
- MFC-style binary with UTF-16LE strings ("deep stacks" label visible)
- Encodes default bet sizes for the tree builder: action ratio bytes (1/4/2/4/2/4),
  default first-bet sizes ("7.5", "120"), default subsequent bets ("4.0", "7.5"),
  pct-of-pot defaults ("40", "75", "120"), "deep stacks" preset name, stack
  default "40", pot default "100", rake "0%", actions "3"
- Loaded ONCE on tree creation. Swapping it mid-session is not viable — would
  need GTO+ restart for the change to take effect.

#### `profiles.pfl` (708 bytes)
- User profile (UI prefs). NOT useful.

### TEMPLATES (in `config/data/` — restored on first run if main file missing)
- `library_.txt` (61441 bytes) — default Quickload library with 4 example scenarios
- `short_library_.txt` (52952 bytes) — short version
- `newdefs3_.txt` (3490 bytes) — default named-ranges library (UTF-16LE legacy format)
- `shortdefs3_.txt` (3834 bytes) — short version
- `settings_.txt` (350 bytes)
- `profiles_.pfl` (708 bytes)

### BACKUPS (auto-saved by GTO+)
- `config/backups/library/auto_hour_*.txt` and `auto_day_*.txt` — library backups
- `config/backups/newdefs3_min*.txt`, `_hour*.txt`, `_day*.txt` — named-ranges backups
- **Backup cadence shows GTO+ writes these files frequently** — every minute on
  the minute file, hourly, daily. Implies GTO+ DOES re-read these on demand,
  not just startup (otherwise no point backing up so often). But empirically
  the LIVE files are still locked-read on app start, so we still need to swap
  with GTO+ closed.

## CHECKPOINT 2 — Menu items via english.txt (30 min in)

**english.txt is the Rosetta Stone**. Every menu item, button, error, and import format is listed there in plaintext. Agent 4 identified this lead; I mined it.

### Full picture of the 6 priority menu items

| # | Menu item (english.txt line) | What it does | Useful for our 31 scenarios? |
|---|---|---|---|
| 1 | **Import preflop ranges from newdefs2.txt or newdefs3.txt** (l. 1301) — submenu under PREFLOP EDITOR > Import predefs | Opens a directory picker; reads `newdefs3.txt` from chosen dir; loads named ranges into the preflop editor as draggable predef labels. **ASCII binary format.** | MEDIUM — same data we'd write directly via path #2 below, but with extra friction (need user to pick a dir, and the imported entries replace the live newdefs3.txt anyway) |
| 2 | **Newdefs3.txt direct write** — `C:\Program Files\GTO\config\newdefs3.txt` | Skip the import menu — write directly to the file GTO+ uses, with backup, restart GTO+ once, entries appear in editor automatically | HIGH — fewer clicks. **POC SHIPPED in this agent.** |
| 3 | **Open: Only load a selection of trees from a database (Alt+W)** (l. 1315) | Filter when opening an existing DATABASE-mode .gto2 savefile. Shows tree list, user ticks which to load. **REQUIRES a database .gto2 to already exist** — does NOT create one from scratch | Conditional: useful only if we go via DATABASE workflow (see below) |
| 4 | **Open: Load a selection of files from a directory (Ctrl+W)** (l. 1316) | Opens directory picker; lists all .gto/.gto2 files in dir; user picks one + Load loads only that one tree. (NOT batch-load — "select which TO LOAD" is the framing per line 159: "Select which files to load") | LOW-MEDIUM — saves one File→Open click per scenario but still serial |
| 5 | **Open: Convert to "Basic" storage** (l. 1311) | Saves a smaller variant of the file by stripping "Extensive" solved data. RAM optimization. | NOT RELEVANT — for already-solved files |
| 6 | **Import .json ICM model (Ctrl+J)** (l. 1313) | MTT-only. Sets per-stack-size ICM equity adjustments. | NOT RELEVANT — cash-game scenarios don't use ICM |

### NEWLY DISCOVERED features (not in mission targets but possibly more impactful)

#### DATABASE MODE — official GTO+ feature for batch processing

GTO+ has a **multi-tree-in-one-file mode** documented at gtoplus.com/processingdatabase/. Key controls discovered in english.txt:

- `Activate database mode` (l. 547) — converts current single-tree session into a database
- `Add current tree to database` (l. 564)
- `Add X random flops` (l. 559) — auto-generate flops for variety
- `Import flops from file` (l. 560) — load a .txt list of flops, auto-build trees for each
- **`PROCESS DATABASE`** (l. 573) — one-click solve every tree in DB
- `Export the trees in your database into separate savefiles` (l. 671)
- `Merge contents of multiple savefiles into a single database` (l. 663) — via code `MERGE` (l. 618-619)
- `Regularly store backup to /tmp/last_database.gto2` (l. 708)

The vendor-documented workflow at gtoplus.com/processingdatabase/ confirms:

> When a database requires significant RAM to store in memory, GTO+ allows
> users to export the database into its separate trees, solve the individual
> trees, and merge the trees together again into a database to prevent
> having to store the database in RAM while solving.
>
> Step 1: Run solver → DATABASE tab → Export database
> Step 2: Folder icon → process all files in the directory
> Step 3: Click "Merge files", enter target directory, click "OK"

This IS the export side. The IMPORT side (creating a DB from 31 separate
single-tree .gto2 files) goes through the same "Merge files" button — user
enters code `MERGE`, points at a directory, GTO+ produces a single database
.gto2. THEN they can `PROCESS DATABASE` to solve all trees in it.

**This may be the real game-changer**, but I did not verify hands-on because
user is mid-game (Golf With Your Friends in front of GTO+). Recommended next:
have the user run a 2-tree test merge to confirm the workflow before
recommending it.

### Verified facts from english.txt

- `newdefs3.txt (preflop ranges)` (line 258) — confirms newdefs3.txt **IS** the preflop ranges database
- `Newdefs3.txt (GTO+/FlopzillaPro)` (line 211) — **format compatible with FlopzillaPro** — so any FlopzillaPro range export documentation may apply
- `Newdefs2.txt (CREV/Flopzilla)` (line 212) — alternate import (CardRunnersEV/Flopzilla legacy)
- `Failed to store settings to /config/default_tree_settings.txt` (line 461) — confirms `default_tree_settings.txt` is the tree-builder defaults file
- `Quickload` button creates library.txt entries — **the format we already emit**
- `Convert to "Basic" storage` is a RAM optimization, not a new-data path
- Line 755-770 `FILE WINDOW`: `Process all .gto files in given directory`,
  `Move processed files to subdirectory "processed"`, `Use same dEV for all
  files`, `Use basic storage for all files`, `Give up after X minutes` —
  this is the PROCESS FILES dialog. Already used in the existing workflow.

## CHECKPOINT 3 — POC emitter validation (75 min in)

Built `scripts/gto-newdefs3-decode.mjs` and `scripts/gto-newdefs3-emit.mjs`.

### Decoder output on live newdefs3.txt
```
Sections: 7
  @   20 [CAT_HEADER1] preLen=97 actual=97 OK preSum=213 actual=213 OK
  @  133 [CAT_HEADER2] preLen=97 actual=97 OK preSum=213 actual=213 OK
  @  246 [CAT_ITEM] preLen=77  actual=77  OK preSum=979 actual=979 OK "my ranges"
  @  339 [CAT_ITEM] preLen=107 actual=107 OK preSum=2630 actual=2630 OK "Premium" -> "AA-QQ,AKs,AKo"
  @  462 [CAT_ITEM] preLen=120 actual=120 OK preSum=2863 actual=2863 OK "Small pocket pair" -> "66-22"
  @  598 [CAT_ITEM] preLen=118 actual=118 OK preSum=2685 actual=2685 OK "Mid pocket pair" -> "JJ-77"
  @  732 [CAT_ITEM] preLen=778 actual=778 OK preSum=30234 actual=30234 OK grouped (Premium/Medium/Weak/Small pocket)
```

All section preambles validate. Format characterized end-to-end.

### Emitter output
- Reads live `newdefs3.txt`
- Selects "Premium -> AA-QQ,AKs,AKo" CAT_ITEM as template
- Generates 62 entries (31 hero + 31 vill, one pair per postflop scenario)
- Recomputes preambles for each emitted entry
- Re-parses output file: 69 sections (7 original + 62 new), **all validate**

Output: `C:\Users\mondr\Downloads\newdefs3.txt` (14,564 bytes)

### Limits / unknowns
- 14 scenarios are preflop-only (no flop in replay) and don't get entries —
  this matches the existing `gto-library-emit.mjs` behavior
- Entry NAMES use 11-char format `gto-NN-hero` / `gto-NN-vill` (NN = scenario
  index). Tested: name lp-string length-changing patches work because we
  recompute the preamble bytesum
- The "Premium" template entry has `[CAT_ITEM]` shape with 1 name + 1 value
  — works for simple ranges. We do NOT use the grouped-range entry shape
  (which has N color buckets), because our scenarios are single-range
- The new entries appear UNDER existing categories (`my ranges` etc) since we
  insert as siblings to the last CAT_ITEM. **They will inherit whichever
  category they fall under in the preflop editor's tree view.** May or may
  not need their own `[CAT_HEADER]` — TBD by user testing
- **NOT TESTED IN GTO+** — user is mid-game in another app. The file is
  byte-identically valid per our preamble verifier; should load, but final
  confirmation requires the user to swap the file and open the preflop
  editor

## Recommended path forward

Three actionable options ranked by leverage-per-hour-of-additional-work:

| Path | New work | User time | Total time |
|---|---|---|---|
| A — Ship as-is (existing manual workflow) | 0 hrs | 5min build + unattended solve | per docs/GTO-PLUS-MANUAL-WORKFLOW.md |
| B — Add newdefs3.txt predefs (this agent's POC) | DONE | A + zero additional time (predefs are safety net only) | Same as A but safer |
| C — Test DATABASE MODE + MERGE workflow | 30 min user testing | If it works: ~5 GUI clicks instead of 31x(load+save) | Could halve user time |

### Author's pick: **B is already done — recommend C as next investigation**

Path B (newdefs3.txt) is shipped and ready — strictly additive, zero risk to
existing workflow, ready file at `C:\Users\mondr\Downloads\newdefs3.txt`.
The user can install it any time (close GTO+, copy file via Explorer, accept
UAC, reopen).

Path C (DATABASE MODE) is the genuine prize but needs **30 min of user
testing** I couldn't do mid-game. The next agent (or future session) should:

1. Have user verify GTO+ is OPEN with the library.txt scenarios installed
2. User does ONE scenario manual build + save (no PROCESS FILES yet — just to
   get one .gto2 file with a built-but-unsolved tree)
3. Repeat for ONE more scenario (need 2 files for the test)
4. User: GTO+ -> Solver Editor -> enter code `MERGE` somewhere (text field?)
5. User: point at the 2-file directory
6. Observe: does GTO+ produce a SINGLE database .gto2 file? Does PROCESS
   DATABASE then solve both at once?
7. If yes -> scale to 31 scenarios

The risk in C is that the MERGE/DATABASE workflow may have constraints we
don't know about (board mismatch handling? same-tree-shape requirement?
RAM limits?). english.txt line 660: "If you have made a change to the
tree/ranges/rake/cap, then clicking this button will rebuild the database
with the new tree/ranges/rake/cap" suggests SAMENESS of tree shape is the
default expectation — our 31 scenarios are deliberately DIFFERENT-shaped,
so this could be a blocker. But the docs aren't clear, and a 2-file test
costs the user 5 minutes to settle the question.

## Unknowns + stopping criteria

### What I tried to find but couldn't
- **GTO.exe symbols/strings** — binary is Winlicense-packed. Plain string
  extraction (UTF-16 walker) found only 17 strings, all garbage. ASCII walk
  found 631k strings, mostly garbage (ICM filter returned 7 hits, none
  meaningful). Confirms Agent 4's prior observation: don't bother grepping
  GTO.exe directly, use `english.txt` as the symbol table
- **Whether newdefs3.txt entries created at the top level (no category) appear
  visibly in the preflop editor** — verifying needs UI testing, deferred
- **Whether DATABASE MERGE accepts different-shaped trees** (different bet
  trees per scenario, different boards) — vendor docs imply same-shape, but
  english.txt line 663 says "Merge contents of multiple savefiles into a
  single database" without qualification. Needs hands-on test
- **Whether `dynamicconditions.txt` controls anything user-visible** —
  format clearly text-line-based, ~192 blocks, names like `quads`/`_AA`/`_KK`
  suggest it's solver display conditions, but didn't characterize the
  numeric fields' meanings (mostly 0s; 12345 magic + bytecounts only)

### Why I stopped researching when I did
- The 2-hour hard cap is real and ~80 min in
- Path B (newdefs3.txt emitter) is shipped and validated structurally — the
  main work product is in hand
- Path C (DATABASE MODE) requires user testing I cannot perform unilaterally
- The 6 mission menu items are characterized — none is a 10x improvement
  over the existing manual workflow

### What would change the recommendation if the user could provide it
- 5 minutes of user time to test DATABASE MERGE on 2 scenarios -> unlocks
  path C if it works -> cuts active user time in half
- Confirmation that newdefs3.txt swap loads cleanly (open GTO+, look for
  `gto-01-hero` etc) -> validates POC end-to-end

## Files shipped this session

- `scripts/gto-newdefs3-decode.mjs` (NEW) — parser + format docs in header
- `scripts/gto-newdefs3-emit.mjs` (NEW) — emitter with --dry-run support
- `C:\Users\mondr\Downloads\newdefs3.txt` (generated artifact — 14,564 bytes,
  62 new range entries, all preambles validated)
- `docs/RE-FINDINGS-AGENT3.md` (this file)

All committed incrementally per mission instructions.
