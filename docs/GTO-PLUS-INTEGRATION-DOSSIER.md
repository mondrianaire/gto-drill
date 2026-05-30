# GTO+ Integration Dossier

Single source of truth for what we know about programmatically integrating
with GTO+ after ~13 hours of empirical reverse engineering across 5 research
agents on 2026-05-25 / 2026-05-26.

**Status:** parked. Project shipped manual workflow as the practical answer.
The library.txt programmatic-injection path hit an architectural wall (entry
visibility uses in-memory registry state we cannot reach via file write).
Future sessions can pick up from this dossier without re-RE'ing.

## End-state goal

Populate `solver_data.options[a].ev_cost` on the 31 postflop scenarios in
`data/scenarios.json` so the M5 GTO Summary Card displays `≈X BB cost` on
misses. Requires running GTO+ solves and extracting per-action EV per
scenario.

## What ships today (without GTO+ EV)

The M5 card works on TexasSolver freq for all 31 scenarios. The card displays:
freq bar, lesson row, verdict, concept tag tooltips, scenario-briefing modal
for hidden-cards spots. The `≈X BB cost` chip stays empty on misses but
nothing else is missing.

## Approaches investigated, ranked by leverage

### 1. .gto2 binary substitution — DEAD

**What:** Take a saved .gto2 (template), patch HEADER lp-strings (ranges,
board, pot, stack) per scenario, write as new file, let GTO+ PROCESS FILES
solve the batch.

**Why dead:** MAIN TREE Block A (the compiled bet-tree bytecode) is
range-dependent. It contains internal combo indices referencing the range
strings. Substituting HEADER's range strings without rebuilding Block A
leaves dangling references. GTO+ crashes at load.

To unblock: write a bet-tree compiler that mirrors GTO+'s internal
"Build Tree" logic. Estimated 5-20 hours of work duplicating proprietary
internals, brittle vs vendor updates.

**Artifacts:** `scripts/gto-batch-generate.mjs` (the substituter — works
for HEADER but not MAIN TREE), `scripts/gto-mt-analyze.mjs`,
`scripts/gto-mt-diff.mjs`, `scripts/gto-mt-blockA-decode.mjs`,
`scripts/gto-mt-substitute-probe.mjs` (proof of dead-end).

### 2. GTO+ socket protocol mutators — DEFINITIVELY DEAD

**What:** Use GTO+'s socket interface (localhost:55143) to programmatically
set ranges/board/pot/stack, trigger Build Tree, Solve, Save per scenario.

**Why dead:** Across ~270 probes spanning two agent sessions (pre- and
post-license), every mutation-style command returns `Instruction unknown.`
The protocol is empirically read-only — only navigation/extraction commands
(`Load file`, `Take action`, `Request node data`, `Request action data`)
work.

The vendor markets the socket as "unofficial" — it's a navigation API for
hand-replay tools, not a scripting interface. The GTO.exe binary is
Winlicense-packed; strings aren't extractable statically. The
`config/languages/english.txt` file is the only readable symbol table,
and its `[COMMUNICATION]` section has only 3 strings.

**Artifacts:** `scripts/gto-socket-probe.mjs`, `scripts/gto-socket-probe-v2.mjs`,
`scripts/gto-socket-navigate.mjs` (safe Take-action wrapper with hang
prevention), `scripts/_probe-batch-a.txt`, `_probe-batch-b.txt` (raw probe
captures), `docs/GTO-PLUS-HANG-RECOVERY.md` (Take action N hang reproducer).

### 3. library.txt Quickload injection — DEAD (architectural wall)

**What:** GTO+ has a Quickload library at `C:\Program Files\GTO\config\library.txt`
that stores per-scenario `[TREE]` entries (ranges + board + pot + stack + bet
tree config). User clicks "LOAD SELECTED TREE" on an entry → GTO+ populates
the entire UI from that entry's data. So 31 library entries + 31 clicks
would skip all the manual setup work.

**Why dead:** We can write entries that match GTO+'s own byte-level output
exactly (agent 1's golden-diff proof — byte-identical to GTO+'s save when
GTO+ patches the same field). But GTO+ silently HIDES entries it didn't
write itself. There's an in-memory registry populated only when GTO+'s own
Store action runs; externally-added entries don't enter that registry.

What we tried (all proved insufficient):
- Append entries at end of file → invisible
- Insert entries at front of file → invisible
- Patch HEADER count field (@+16) → file rejected entirely
- Patch entry position-index byte (varies per entry type, found via
  `01 00 00 00 <idx:u32> b9` anchor pattern) → invisible
- Replace existing slot's content (rename + repatch test-bb-monster with
  scenario data) → file failed to parse
- Don't touch @+18 (agent 1's finding) → bytes match GTO+ but still invisible

The mechanism we cannot see / reach is likely a hash table or sorted index
GTO+ builds at startup or per-Save. Verified empirically that when GTO+
itself adds entries (via Store/Duplicate), it writes the SAME bytes we
write, but the registry update only happens through GTO+'s GUI code path.

**Format understanding (complete):**
- File: 16-byte preamble + `[HEADER]`...`[/HEADER]` + N×(16-byte preamble +
  `[TREE]`...`[/TREE]`) + optional `[CATEGORY]`...`[/CATEGORY]`
- Preamble: `<u32 LE section_length_incl_tags><4 zero><u32 LE inner_bytesum><4 zero>`
- HEADER inner: `<u32=3 version><u32=16 sub-header><u32=N count><u32=4 unknown><8-byte constant>`
- TREE inner: 22-byte sub-header (incl. @+18 = bet-tree config snapshot, NOT
  a length field), then variable mix of lp-strings (`02 <u32 LE len> <bytes>`)
  for name + range1 + range2 + board + bet sizing values + pot + stack +
  more, then binary tail with floats for bet-tree configuration
- Position-index byte: u32 LE at variable offset within each entry,
  preceded by `01 00 00 00` and followed by `b9` byte. Updated when GTO+
  reorders entries. Setting it correctly is necessary but not sufficient.

**Artifacts:** `scripts/gto-library-emit.mjs` (mostly-working emitter,
fixes from agent 1), `scripts/gto-library-repair.mjs` (agent 5),
`scripts/_tmp-lib-bisect.mjs` (single-field patch harness),
`scripts/_tmp-count-bump.mjs`, `scripts/_tmp-fix-index.mjs`,
`scripts/_tmp-insert-front.mjs`, `scripts/_tmp-replace-slot.mjs` (failed
hypothesis tests, kept as evidence).

### 4. newdefs3.txt named-range library — WORKS, partial help

**What:** GTO+ has a separate `newdefs3.txt` config file for named preflop
ranges (`[CAT_ITEM]` entries like "Premium" → "AA-QQ,AKs,AKo"). Different
format from library.txt. Used by the preflop editor's predef dropdown.

**Status:** Emitter shipped (agent 3). Generates 62 entries (31 hero + 31
vill) at `C:\Users\mondr\Downloads\newdefs3.txt`. Format fully RE'd. After
copy to Program Files + GTO+ restart, the entries appear in the preflop
editor as `gto-NN-hero` / `gto-NN-vill` quick-pick presets.

**Why partial:** Only solves the range-loading problem. User still needs
to manually set board, pot, stack, build tree, solve, save per scenario.

**Artifacts:** `scripts/gto-newdefs3-decode.mjs`, `scripts/gto-newdefs3-emit.mjs`.

### 5. DATABASE MODE + MERGE — UNTESTED LEAD

**What:** GTO+ has an officially-documented batch processing workflow at
gtoplus.com/processingdatabase/. Code `MERGE` (typed in solver editor)
combines multiple .gto2 savefiles into a single database. `PROCESS DATABASE`
then solves all trees in the database unattended. `Export` writes solved
trees back to individual files.

**Why untested:** Agent 3 couldn't test (user was mid-game with GTO+ tied
up). Vendor docs hint at same-tree-shape expectation, but our 31 scenarios
are deliberately different-shaped — could be a blocker or might not.

**Estimated value:** If it works for different-shaped trees, could cut the
manual workflow's per-scenario clicks from ~5 (Load + Build + SaveAs + path
+ Save) to ~2 (Load + Add-to-DB) × 31 + 1 PROCESS DATABASE. Potentially
significant.

**Test workflow:**
1. User saves 2 single-tree .gto2 files (manual build + save, no solve)
2. User opens GTO+ → Solver Editor → enter code `MERGE`
3. User points at the 2-file directory
4. Observe: does GTO+ produce a single database .gto2? Does PROCESS
   DATABASE then solve both?
5. If yes → scale to 31 scenarios

### 6. Windows-MCP GUI automation — VIABLE BUT BIG INVESTMENT

**What:** Drive GTO+'s GUI directly via Windows-MCP (screenshot + click +
type). Read pastepack scenarios, click into each GTO+ field, type values,
click Build Tree, Save As, etc.

**Why viable:** We know the GUI works manually. Doesn't depend on
undocumented binary formats or read-only socket.

**Why not pursued:** ~3-4 hours of dev work + brittle vs window state
changes. The pastepack manual workflow with the human in the loop is
faster end-to-end for a one-shot 31-scenario batch.

## What we shipped tonight (5 PRs to main)

- PR #161: M5 Scenario-Briefing modal + Header-v2 concept tag tooltips
- PR #162: Dual-lane solver-data (TexasSolver freq + GTO+ EV coexist)
- PR #163: `.gto2` substituter `@12` poison pointer fix
- PR #164: `gto-extract.mjs` socket handshake race fix
- PR #165: `.gto2` substituter MAIN TREE preservation fix

## Branch with all RE work

`claude/gto-mt-research`, pushed to origin. Tagged `gto-plus-re-checkpoint-2026-05-26`.

## How to resume

1. `git checkout claude/gto-mt-research` (or `git checkout gto-plus-re-checkpoint-2026-05-26`)
2. Read this dossier + the `docs/RE-FINDINGS-AGENT*.md` files
3. Pick which dead-end is worth re-attacking. Most leverage-per-hour:
   - **DATABASE MODE test** (if untested when you resume — 5 min user testing)
   - **Bet-tree compiler** for .gto2 MAIN TREE Block A (5-20 hr, unlocks full automation)
   - **library.txt registry RE** — would need access to GTO+'s runtime memory
     to find the registry structure, OR a different file we haven't found
     that mirrors the registry

## Recommended ship path tonight

Pastepack manual workflow:
1. `node scripts/gto-pastepack.mjs` generates per-scenario paste sheets
2. User opens template-max-flop.gto2 in GTO+
3. Per scenario (~3-4 min): paste hero range, paste vill range, type board,
   type pot, type stack, Build Tree, Save As <scenario_id>.gto2
4. After all 31: GTO+ PROCESS FILES on solver-output/ → unattended batch solve
5. `node scripts/gto-extract.mjs && node scripts/gto-merge.mjs`
6. M5 EV chip lit up

~2 hours of human time + multi-hour unattended solve.
