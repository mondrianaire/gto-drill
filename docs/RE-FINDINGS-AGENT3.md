# Agent 3 (REVIVAL) — GTO+ Menu/Format Reconnaissance

**Started**: 2026-05-26
**Mission**: Investigate every GTO+ menu item that takes file/data input. Find a programmatic path that bypasses MAIN TREE substitution.

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

#### `dynamicconditions.txt` (79KB, 24,484 lines) **⭐ NEW DISCOVERY ⭐**
- **PURE TEXT, line-delimited** — each ~127-line block defines a "dynamic condition"
- Block structure: line 1 = magic `12345`, then ~125 numeric fields, line ~127 = NAME (e.g., `quads`, `_AA`, `_KK`)
- ~192 conditions in current file (24484 / 127 ≈ 192)
- These look like preset board/hand classifiers used in the solver UI ("show me when board is `quads`", etc.)
- **UNKNOWN WHETHER WRITEABLE** — need to test if GTO+ reads this on startup or only on menu invocation. Field meanings are mostly unknown (mostly 0s).
- Probably NOT useful for our scenarios but extremely tractable format if it turns out to control something useful.

### BINARY FILES (MFC CArchive serialization with TEXT bracket markers)

#### `library.txt` (68,287 bytes — modified tonight 01:23) **THE QUICKLOAD LIBRARY**
- Format: 16-byte header (`<u32 hdr-len-low><u32 0><u32 ?><u32 0>`) → `[HEADER]...[/HEADER]` block → `[TREE]...[/TREE]` blocks
- Each TREE block contains: tree name (e.g. "test-bb-monster"), preflop range strings (compressed), board cards (`AdAcAh`), stack sizes (50, 120, 40, 75 etc), action colors, more data
- We already have `scripts/gto-library-emit.mjs` for same-length patches. **Length-changing patches need RE.**

#### `newdefs3.txt` (1510 bytes — modified tonight 01:29) **THE NAMED-RANGE LIBRARY**
- MFC CArchive format: `<u32 block-len><u32 0><u32 size><u32 0>[CAT_HEADER1]...[/CAT_HEADER1]` etc
- Categories: `[CAT_HEADER1]`, `[CAT_HEADER2]`, `[CAT_ITEM]`, `[/CAT_ITEM]`
- Each CAT_ITEM has:
  - 4-byte field count + field metadata
  - **ASCII** length-prefixed strings (NOT UTF-16!): `02 07 00 00 00 50 72 65 6d 69 75 6d` = type 02, len 7, "Premium"
  - Range string: `02 0d 00 00 00 41 41 2d 51 51 2c 41 4b 73 2c 41 4b 6f` = "AA-QQ,AKs,AKo"
  - Trailing floats (weights?)
- **TEMPLATE version at `config/data/newdefs3_.txt`** (3490 bytes, **larger** — has more example entries) — uses **UTF-16LE** strings instead of ASCII (`fffe ff` = UTF-16 BOM marker pattern)
- **This is the most promising injection target** — small file, clear bracket-delimited structure, contains exactly what we need (named ranges)

#### `default_tree_settings.txt` (951 bytes)
- MFC CArchive with UTF-16LE strings ("deep stacks" visible)
- Probably the default solve-tree configuration template
- Worth examining further

#### `profiles.pfl` (708 bytes)
- User profile (UI prefs). NOT useful.

### TEMPLATES (in `config/data/` — restored on first run if main file missing)
- `library_.txt` (61441 bytes) — default Quickload library
- `short_library_.txt` (52952 bytes) — short version
- `newdefs3_.txt` (3490 bytes) — default named-ranges library (UTF-16LE encoded!)
- `shortdefs3_.txt` (3834 bytes) — short version
- `settings_.txt` (350 bytes)
- `profiles_.pfl` (708 bytes)

### BACKUPS (auto-saved by GTO+)
- `config/backups/library/auto_hour_*.txt` and `auto_day_*.txt` — library backups
- `config/backups/newdefs3_min*.txt`, `_hour*.txt`, `_day*.txt` — named-ranges backups
- **Backup cadence suggests GTO+ writes these files frequently** — but doesn't tell us if it RE-READS them after startup

## NEXT STEPS

1. RE the `newdefs3.txt` binary format end-to-end so we can write 31 hero+vill range pairs programmatically
2. Test whether GTO+ re-reads `newdefs3.txt` while running (or only on startup)
3. Examine `default_tree_settings.txt` — could be the file to inject solver setups
4. Try the "Import preflop ranges" menu and observe what file it asks for
5. Check if `dynamicconditions.txt` controls anything useful

## CHECKPOINT 2 — Menu items and DATABASE mode (30 min in)

**english.txt is the Rosetta Stone**. Every menu item, button, error, and import format is listed there in plaintext. Agent 4 already identified this but didn't get to mine it for our specific menu items.

### Full picture of the 6 priority menu items

| # | Menu item | What it does (per english.txt strings) | Useful? |
|---|---|---|---|
| 1 | **Import preflop ranges (newdefs2 or newdefs3)** | Opens a directory picker; reads `newdefs3.txt` or `newdefs2.txt` from chosen dir; loads named ranges into the preflop editor as draggable predef labels. ASCII binary format (see Checkpoint 1). | **⭐ HIGH** — write 31×2 named ranges, user drags them in |
| 2 | **Newdefs3.txt direct write** | Same end-state as #1 but skip the file picker — just write to `C:\Program Files\GTO\config\newdefs3.txt` (with backup), restart GTO+ once, ranges appear in editor automatically | **⭐⭐ HIGHEST** — same data, no menu interaction |
| 3 | **Open: Only load a selection of trees from a database (Alt+W)** | Filter when opening a DATABASE savefile (.gto2 in database mode). Shows tree list, user ticks which to load. **Requires a database .gto2 to already exist.** | **⭐⭐⭐ GAME-CHANGER** if we can generate the database file |
| 4 | **Open: Load a selection of files from a directory (Ctrl+W)** | Opens directory picker; lists all .gto2 files; user picks which to load. Loads SELECTED tree first (just one). After load, the SOLVER editor's "Activate database mode" + "Add current tree" + "PROCESS DATABASE" path can batch-solve them | **⭐⭐ HIGH** — batched per-scenario load |
| 5 | **Open: Convert to "Basic" storage** | Saves a smaller variant of the file by stripping "Extensive" solved data. NOT useful for generating new scenarios. | ❌ |
| 6 | **Import JSON ICM model** | MTT-only. Sets per-stack-size ICM equity adjustments. Not relevant for our cash-game scenarios. | ❌ |

### NEWLY DISCOVERED features (not in mission targets but possibly relevant)

#### DATABASE MODE (⭐⭐⭐ POTENTIAL GAME-CHANGER)

GTO+ has a built-in **multi-tree-in-one-file** mode:

- `Activate database mode` — converts current single-tree session into a database
- `Add current tree to database` — current tree becomes one entry in the DB
- `Add X random flops` — auto-generate flops for variety
- `Import flops from file` — load a .txt list of flops, auto-build trees for each
- `Add trees to database / solve all trees in database` — batch-solve
- **`PROCESS DATABASE`** — one-click solve every tree in DB
- `Export the trees in your database into separate savefiles` — split back to individual .gto2 files
- `Merge contents of multiple savefiles into a single database` — merge 31 individual .gto2 into one DB. Enter code `MERGE` to invoke.
- `Regularly store backup to /tmp/last_database.gto2`

**THE ANSWER MAY BE**:
1. Use existing `gto-library-emit.mjs` to write 31 quickload entries
2. User loads each + builds tree + saves (~5 min total, per existing MANUAL workflow doc)
3. User: Solver Editor → enter code `MERGE` → point at the directory with 31 .gto2 → produces ONE database file
4. User: PROCESS DATABASE → solves all 31 trees overnight
5. User: Export database → 31 separate solved .gto2 files (auto-named by tree name)
6. Existing `gto-extract.mjs` runs

This is **5-step instead of 31-step manual solve**. The bottleneck (per-scenario human interaction for build+save) stays at ~5 min, but the SOLVE phase becomes fully unattended.

#### `Process all .gto files in given directory` (FILE WINDOW)

Already documented in manual workflow as PROCESS FILES. Same idea as PROCESS DATABASE but on a flat directory of separate .gto files rather than a database file. **This is what current workflow uses.** Confirmed at line 755 of english.txt.

### Verified facts from english.txt

- `newdefs3.txt (preflop ranges)` (line 258) — confirms newdefs3.txt **IS** the preflop ranges database
- `Newdefs3.txt (GTO+/FlopzillaPro)` (line 211) — **format compatible with FlopzillaPro** — so any FlopzillaPro range export documentation may apply
- `Newdefs2.txt (CREV/Flopzilla)` (line 212) — alternate import (CardRunnersEV/Flopzilla legacy)
- `Failed to store settings to /config/default_tree_settings.txt` (line 461) — confirms `default_tree_settings.txt` is the tree-builder defaults file (read on tree creation; useful for setting our pot/stack defaults)
- `Quickload` button creates library.txt entries — **the format we already emit**
- `Convert to "Basic" storage` is a RAM optimization, not new-data path

### What's NOT useful
- ICM/JSON import — MTT only
- Convert to "Basic" — RAM optimization
- subsets.dat — encrypted/scrambled data (not a config file we can edit)
