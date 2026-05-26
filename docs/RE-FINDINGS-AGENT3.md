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

