# GTO+ Knowledge Base

**Master consolidated document for everything we know about GTO+ file formats,
socket protocol, and integration paths.** Self-contained — future sessions can
rebuild context by reading this alone, without digging through agent transcripts
or the parked RE branch.

Last updated: 2026-05-30, after ~14 hours of empirical RE across 5 research
agents + multiple hands-on bisection sessions. The detailed evidence lives on
branch `claude/gto-mt-research` (tagged `gto-plus-re-checkpoint-2026-05-26`),
PR #166 (draft, parked).

---

## End-state goal

Populate `solver_data.options[a].ev_cost` on the 31 postflop scenarios in
`data/scenarios.json` so the M5 GTO Summary Card displays `≈X BB cost` on
misses. This is the only piece blocking full §8.1 spec compliance — the freq
bar already works on TexasSolver baseline data.

The blocker is getting GTO+ to actually solve each scenario. Once solved,
the existing `scripts/gto-extract.mjs` + `scripts/gto-merge.mjs` pipeline
pulls EV out and writes it onto `data/scenarios.json`.

---

## TL;DR — current ship state

**M5 card works today** with TexasSolver freq for all 31 postflop scenarios.
The `≈X BB cost` annotation just doesn't render on misses (no EV data).

**To light up the EV chip**, the owner runs the in-app GTO+ walkthrough
(Database view → `📋 Open GTO+ setup walkthrough` button — shipped in
v2026-05-30.153 / PR #167). Steps through 31 scenarios with copy-ready
ranges/board/pot/stack. ~2 hours of paste+click work + multi-hour unattended
PROCESS FILES batch solve.

No fully-automated path exists. We hit walls on every programmatic angle.
The walls are documented below so future attempts don't re-traverse them.

---

## Approaches tried, ranked by leverage / risk

### 1. `.gto2` binary HEADER substitution — partially works

**What:** Take a saved `.gto2` (template), patch HEADER lp-strings (ranges,
board, pot, stack) per scenario, write as new file, let GTO+ PROCESS FILES
solve the batch.

**Status:** HEADER substitution works perfectly (Agent 1's golden-diff:
byte-identical to GTO+'s own save). The substituted file LOADS in GTO+ via
the socket. **But PROCESS FILES silently no-ops** because the file's MAIN
TREE section still references the template's ranges via combo indices
(see #2 below).

**Useful for:** scenarios where you want to load HEADER state into GTO+
manually then click Build Tree (which regenerates MAIN TREE from HEADER).
NOT useful for unattended batch solving.

**Code:** `scripts/gto-batch-generate.mjs` (the substituter — works for
HEADER, plus per-street template routing and byte-cap validation).

### 2. `.gto2` MAIN TREE substitution — DEAD

**What:** Beyond HEADER, also patch MAIN TREE (the compiled bet-tree
bytecode) so the substituted file is fully self-consistent and PROCESS
FILES can solve it unattended.

**Why dead:** MAIN TREE has a 3-block structure (16-byte sub-header + Block A
compiled bytecode + Block B config/strategy). **Block A is range-dependent**
— it contains internal combo indices that reference the range strings in
Block B / HEADER. Substituting ranges without rebuilding Block A leaves
dangling references and GTO+ crashes at load. Verified empirically by
Agent 5.

To unblock: write a bet-tree compiler that mirrors GTO+'s internal "Build
Tree" logic. Estimated 5-20 hours of work, duplicates proprietary internals,
brittle vs vendor updates. **Not recommended.**

**Format we DID crack:**
- 16-byte sub-header at MAIN TREE start: `<u32=3 version><u32=16 sub-header-size><u32 Block-A-length><u32 Block-B-length>`
- Block A: variable-length bet-tree bytecode wrapped with fixed framing
  (13-byte header, 19-byte ladder × 2, 13-byte tail)
- Block B: lp-strings for ranges/board + bet sizes as text + binary floats

**Code:** `scripts/gto-mt-analyze.mjs`, `scripts/gto-mt-diff.mjs`,
`scripts/gto-mt-blockA-decode.mjs`, `scripts/gto-mt-substitute-probe.mjs`
(proof of dead-end — file loads structurally but crashes at GTO+ load).

### 3. GTO+ socket protocol mutators — DEFINITIVELY DEAD

**What:** Use GTO+'s socket interface (localhost:55143) to programmatically
set ranges/board/pot/stack, trigger Build Tree, Solve, Save per scenario.

**Why dead:** **The protocol is empirically read-only.** Across ~270 probes
across two agent sessions (pre- and post-license), every mutation-style
command returns `Instruction unknown.`

**The complete command vocabulary:**
- `~init~` → handshake. Reply comes in TWO framed chunks back-to-back:
  `~C::<id>~` then `~You are connected to GTO+~`. Must read both —
  agent 4's gotcha.
- `~Load file: <abs_path>~` → load a `.gto2`. Reply `~File successfully loaded.~`
  or rejection.
- `~Take action: N~` → navigate to action N at current node. Reply
  `~Next decision has been set.~` on success, `~Action does not exist~` on
  negative index. **⚠ `Take action: N` where `N >= action_count` HANGS
  GTO+ permanently** (bkushigian issue #2, reproduces in v185 REGISTERED).
  Always parse action count via `Request action data` first.
- `~Request node data~` → returns per-combo strategy text (COMBOS, EQUITY,
  FREQ_by_action, EV_by_action).
- `~Request action data~` → returns `~[N actions: A,B,C]~`.

**Why we're confident it's the whole vocabulary:**
- bkushigian/gto- (the only public Python wrapper) implements exactly these
  commands. Author would have shipped Set/Build/Solve if they existed.
- GTO+ binary is Winlicense-packed (`.winlice` and `.boot` sections). Strings
  not extractable statically.
- `config/languages/english.txt` `[COMMUNICATION]` section has only 3
  strings. Localization file is a dead end.
- No CLI args. `GTO.exe --help` does nothing useful.
- No hidden filesystem trigger. `tmp/progress.txt` is write-only status.
- Vendor explicitly markets the socket as "unofficial" — built for
  hand-replay tools, not scripting.

**Code:** `scripts/gto-extract.mjs` (uses the read-only API), `scripts/gto-verify-loads.mjs`,
`scripts/gto-socket-probe.mjs` / `gto-socket-probe-v2.mjs` (probe drivers),
`scripts/gto-socket-navigate.mjs` (safe `Take action` wrapper with hang
prevention).

**Hang recovery:** see `docs/GTO-PLUS-HANG-RECOVERY.md` on the archive branch.
Kill via Task Manager, relaunch GTO+, restore socket auth via existing
`tmp/customconnect.txt`.

### 4. `library.txt` Quickload injection — DEAD (architectural wall)

**What:** GTO+ has a Quickload library at `C:\Program Files\GTO\config\library.txt`
that stores per-scenario `[TREE]` entries (ranges + board + pot + stack +
bet tree config). User clicks "LOAD SELECTED TREE" on an entry → GTO+
populates the entire UI from that entry's data. 31 library entries = 31
clicks to load = skip all manual setup.

**Why dead:** We can write entries that match GTO+'s own byte-level output
**exactly** (Agent 1's golden-diff: byte-identical to GTO+'s save when GTO+
patches the same field). But **GTO+ silently HIDES entries it didn't write
itself.** There's an in-memory registry populated only when GTO+'s Store/
Duplicate action runs through the GUI code path. Externally-added entries
don't enter that registry.

**Everything we tried (all proved insufficient):**
- Append entries at end of file → invisible
- Insert entries at front of file → invisible
- Patch HEADER count field (@+16) → file rejected entirely
- Patch entry position-index byte (anchor: `01 00 00 00 <idx:u32> b9` —
  varies per entry type, found via byte-diff vs GTO+'s own duplicates) →
  invisible
- Replace existing slot's content in-place → file failed to parse
- Skip @+18 update per Agent 1 → bytes match GTO+'s output but still invisible
- Verbatim no-op rebuild of test-bb-monster (no actual changes) → works
- Same-length patches (board "AdAcAh" → "9h8h4c") → works
- Length-changing patches (pot "10" → "7.50") → works at byte level but
  entries still don't show

**The format we DID fully crack:**
```
File:
  16-byte preamble + [HEADER] ... [/HEADER]
  16-byte preamble + [TREE] ... [/TREE]  (×N entries)
  optional: 16-byte preamble + [CATEGORY] ... [/CATEGORY]

Preamble: <u32 LE section_length_incl_tags> <4 zero> <u32 LE inner_bytesum> <4 zero>
  where inner_bytesum = sum(bytes between [TAG] and [/TAG]) & 0xFFFFFFFF

HEADER inner content (24 bytes, fixed):
  @+0  u32 = 3   (version)
  @+4  u32 = 16  (sub-header size)
  @+8  u32 = ?   (related to count; ANY change → rejection)
  @+12 u32 = 4   (unknown — usually 4)
  @+16 8 bytes  (constant: 01 0a 03 00 b9 00 05 00)

TREE inner content per entry:
  - 22-byte sub-header (includes @+18 = bet-tree config snapshot, NOT
    a length pointer — DO NOT update per Agent 1's golden-diff proof)
  - Variable mix of lp-strings (02 <u32 LE len> <bytes>) for:
    name + range1 + range2 + board + bet sizing values + pot + stack
  - Binary tail with floats for bet-tree configuration
  - Position-index u32 LE at variable offset, anchored by `01 00 00 00`
    before and `b9` after. Updated by GTO+ when entries reorder. Setting
    it correctly is NECESSARY but NOT SUFFICIENT for visibility.

LP-string format: 02 <u32 LE length> <UTF-8 bytes>
```

**What we don't have:** access to GTO+'s in-memory registry. The registry
seems to be a hash table or sorted index built at startup/Save. Without
either patching it directly (process memory injection) or finding a config
file that mirrors it (we exhausted the candidates), this path is closed.

**Code:** `scripts/gto-library-emit.mjs` (most complete emitter — emits all
31 scenarios byte-identical to GTO+'s output, just invisible),
`scripts/gto-library-repair.mjs` (preamble fixer),
`scripts/_tmp-lib-bisect.mjs` (single-field patch harness),
`scripts/_tmp-count-bump.mjs`, `scripts/_tmp-fix-index.mjs`,
`scripts/_tmp-insert-front.mjs`, `scripts/_tmp-replace-slot.mjs` (failed
hypothesis tests, kept as evidence — all on the archive branch).

### 5. `newdefs3.txt` named-range library — WORKS, partial help

**What:** GTO+ has a separate `C:\Program Files\GTO\config\newdefs3.txt`
config file for named preflop ranges (`[CAT_ITEM]` entries like "Premium" →
"AA-QQ,AKs,AKo"). Different format from `library.txt`. Used by the preflop
editor's predef dropdown.

**Status:** Emitter shipped (Agent 3). Generates 62 entries (31 hero + 31
vill) at `C:\Users\mondr\Downloads\newdefs3.txt`. Format fully RE'd. After
copy to Program Files + GTO+ restart, the entries appear in the preflop
editor as `gto-NN-hero` / `gto-NN-vill` quick-pick presets.

**Why partial:** Only solves the range-loading step. User still needs to
manually set board, pot, stack, build tree, solve, save per scenario. Less
useful than the in-app Database walkthrough (which handles all of those in
one focused modal).

**Code (on archive branch):** `scripts/gto-newdefs3-decode.mjs`,
`scripts/gto-newdefs3-emit.mjs`.

### 6. DATABASE MODE + MERGE — UNTESTED LEAD

**What:** GTO+ has an officially-documented batch processing workflow at
gtoplus.com/processingdatabase/. Code `MERGE` (typed in solver editor)
combines multiple `.gto2` savefiles into a single database file.
`PROCESS DATABASE` then solves all trees in the database unattended.
`Export` writes solved trees back to individual files.

**Why interesting:** Officially supported, no RE needed. Could reduce the
manual workflow's per-scenario click count from ~5 (Load → Build → Save
As → name → Save) to ~2 (Load → Add-to-DB) × 31 + 1 PROCESS DATABASE.

**Why untested:** Agent 3 couldn't test (user was mid-game with GTO+ tied
up). Vendor docs hint at "same-tree-shape" expectation, and our 31
scenarios have deliberately different bet trees. Could be a blocker or
might not.

**5-min test to settle it:**
1. Save 2 single-tree `.gto2` files (manual build + save, no solve yet)
2. Open GTO+ → Solver Editor → type code `MERGE` somewhere (find the text
   field — probably tree-editor's "instructions" area; see `english.txt`
   line 618-619 for context)
3. Point at the 2-file directory
4. Observe: does GTO+ produce a single database `.gto2`? Does PROCESS
   DATABASE then solve both?
5. If yes → scale to 31 scenarios. Big workflow win.

### 7. Windows-MCP GUI automation — VIABLE BUT BIG INVESTMENT

**What:** Drive GTO+'s GUI directly via Windows-MCP (screenshot + click +
type). For each scenario, click into each GTO+ field, type values, click
Build Tree, Save As, etc.

**Status:** ~3-4 hours of dev work + ongoing brittleness against window
state changes. The current Database walkthrough modal (PR #167) gets us
most of the productivity gain without the brittleness — the user does the
clicking, the modal does the bookkeeping.

**Worth revisiting if:** scenario library grows to 100+ and manual paste
becomes too costly.

---

## Working pipeline (today)

The end-to-end manual flow that ships GTO+ EV data:

```
1. Owner Database → 📋 Open GTO+ setup walkthrough  (PR #167)
2. In GTO+, paste-and-click through 31 scenarios via the modal:
   - Open Run solver → paste Range 1 → paste Range 2 → paste board
     → paste pot → paste stack → Build tree → Save As <name>.gto2
   - Click "Next →" in the modal, repeat 30 more times
3. GTO+ PROCESS FILES on solver-output/  (unattended hours)
4. node scripts/gto-extract.mjs   → solver-output/solver-data-gto-plus.json
5. node scripts/gto-merge.mjs     → data/scenarios.json (with EV)
6. M5 EV chip lights up on misses
```

Active human time: ~2 hours of clicking. Solver time: multi-hour unattended.

---

## Recipes — to do X, do Y

### Resume work on GTO+ EV pipeline

If the walkthrough flow is broken or you want to validate it:

```bash
git checkout main                                     # whatever has PR #167
cd .claude/worktrees/<active-worktree>
node scripts/dev-server.mjs                           # serve locally
# Open http://localhost:8000/, sign in as owner
# Database view → 📋 GTO+ button on any postflop row
```

### Resume DATABASE MODE investigation (highest leverage untested)

```bash
git checkout main
# 1. In GTO+: manually save 2 distinct scenario .gto2 files (use the
#    walkthrough modal for setup; click Save As but not Solve)
# 2. Try the documented MERGE workflow per #6 above
# 3. If it works for different-shaped trees, write a script that batches it
```

### Resume `library.txt` registry investigation (low leverage, high cost)

Likely requires runtime memory introspection (Frida/Cheat Engine attached
to GTO.exe) to find the in-memory entry registry. Out of scope for normal
development. If pursued:

```bash
git checkout claude/gto-mt-research
# Or: git checkout gto-plus-re-checkpoint-2026-05-26
# Read docs/RE-FINDINGS-AGENT1.md + docs/GTO-PLUS-INTEGRATION-DOSSIER.md
# Try Frida hooks on GTO.exe at Quickload-dialog-open time
```

### Resume `.gto2` MAIN TREE compiler (longest path, full automation reward)

```bash
git checkout claude/gto-mt-research
# Read docs/RE-FINDINGS-AGENT*.md
# Use scripts/gto-mt-analyze.mjs to dump MAIN TREE structures
# Use scripts/gto-mt-blockA-decode.mjs as the decoder starting point
# Need 5-20 hours of careful bytecode RE
```

### Run a controlled experiment on a .gto2 internal

`scripts/gto-mt-substitute-probe.mjs` is the framework. It:
1. Loads a known-good `.gto2`
2. Substitutes one byte/field
3. Reloads via socket to confirm whether GTO+ accepts it
4. Reports the verdict

Extend that pattern for any new byte-level hypothesis test.

### Add a new scenario to the GTO+ batch

1. Add scenario to `data/scenarios.json` with full `replay` data
2. Ensure `derived_ranges()` resolves for it (check the preflop chart
   library)
3. The Database walkthrough modal automatically picks it up — no code
   change needed
4. Run the workflow as normal

### Debug the socket extract (`gto-extract.mjs`) failing

Common failure modes:
- **`GTO+ refused connection: ~C::N~`** — handshake parse bug. Fixed in
  PR #164. Symptom: only the first framed chunk read. Two-chunk fix is
  in `gto-extract.mjs` lines 74-93.
- **Hang on a specific file** — GTO+ might be solving (long) or stuck.
  Wait, or kill+relaunch per hang recovery.
- **Socket auth refused** — `tmp/customconnect.txt` missing. See
  `docs/SOLVER-PIPELINE.md` for one-time setup steps.

---

## File format reference

### `.gto2` binary file

7 sections in order, each with a 16-byte preamble:
```
[HEADER]       <- ranges, board, pot, stack, bet sizes (lp-strings + floats)
[MAIN TREE]    <- bet-tree bytecode (Block A) + config/strategy (Block B)
[LEGEND]       <- 39 bytes, constant
[EDITOR]       <- 39 bytes, constant
[FLOP FILTERS] <- 53 bytes, constant
[DATABASE HEADER] <- 58 bytes, constant
[TRAINER]      <- 49 bytes, constant
```

Preamble: `<u32 LE total_section_length><u32 zero><u32 LE inner_bytesum><u32 zero>`

HEADER substitution works (PR #161, PR #163-165 for various fixes).
MAIN TREE substitution does not (Block A is range-dependent).

### `library.txt`

See section #4 above for complete format documentation.

### `newdefs3.txt`

See section #5 above. Format documented in
`scripts/gto-newdefs3-decode.mjs` on the archive branch.

### `default_tree_settings.txt` (951 bytes)

MFC-style binary with UTF-16LE strings. Encodes default bet sizes for the
tree builder: action ratio bytes, default bet sizes (text "7.5" / "120"),
pct-of-pot defaults (text "40" / "75" / "120"), profile name ("deep
stacks"), pot/stack defaults. Loaded ONCE on tree creation. Swapping
mid-session requires GTO+ restart.

### `tmp/progress.txt`

Write-only solver progress (iteration count + per-action exploitability
delta). Read by GTO+'s UI for the progress bar. Not useful for triggering
behavior.

### `tmp/customconnect.txt`

Single text: `override`. Enables the socket interface. Must be present
before GTO+ launches (it's read on startup).

### `config/languages/english.txt` (42 KB)

The localization file. Every menu item, button, error message in
plaintext. Treated as the Rosetta Stone for understanding GTO+ behavior
without spelunking the encrypted exe. Use it to find features:

```bash
grep -i "merge\|database\|process" "C:/Program Files/GTO/config/languages/english.txt"
```

---

## Auto-backup locations

GTO+ silently auto-backs-up `library.txt` and `newdefs3.txt` to
`C:\Program Files\GTO\config\backups\`. Useful when an experiment corrupts
the live file:

```
backups/
├── library/
│   ├── auto_hour_<H>.txt   (every hour)
│   ├── auto_day_<D>.txt    (every day)
│   ├── manual1.txt         (user's last Save action — most-recent good state)
│   └── tmp.txt             (most recent write)
├── newdefs3_hour<H>.txt
└── newdefs3_day<D>.txt
```

For recovery: copy any backup to `library.txt` (or `newdefs3.txt`) and
restart GTO+.

---

## Active branches + tags

| Ref | Purpose |
|---|---|
| `main` | shipping branch. Has all 5 PRs from 2026-05-25 + the Database walkthrough modal (PR #167). |
| `claude/gto-mt-research` | parked RE archive. Has Agent 1/3/4/5 findings docs, dead-end emitters, bisection scripts. |
| tag `gto-plus-re-checkpoint-2026-05-26` | snapshot of the RE archive at parking time. |
| PR #166 | draft PR exposing the RE archive in the PR list. Marked PARKED. |
| PR #167 | Database console GTO+ walkthrough modal (this doc + the modal). |

---

## What NOT to do

- Don't waste time re-probing the socket for mutators. Confirmed dead by
  270+ probes across two sessions. Same answer pre- and post-license.
- Don't try patching `library.txt` HEADER count or position-index bytes
  to make new entries visible. Both proven not to be the gate.
- Don't try writing your own bet-tree compiler for MAIN TREE substitution
  unless the scenario library grows past ~100 (the manual workflow handles
  31 in ~2 hours).
- Don't trust GTO+'s "X files processed" messages. They count attempts,
  not successes. Always verify by file size growth (`.gto2` grows from
  ~1-5 KB to ~50-500 KB after a real solve) or via `Get-ChildItem
  solver-output\*.gto2 | Measure-Object Length -Sum`.
- Don't kill GTO+ via `Stop-Process` from a non-admin shell — Access
  denied. Use Task Manager directly.

---

## Loose ends (low priority)

- `newdefs3.txt` predef ranges file is shipped but never tested live
  (Agent 3 couldn't validate during the session). Strictly additive
  safety net — copy `C:\Users\mondr\Downloads\newdefs3.txt` to Program
  Files when you want it.
- The Database walkthrough modal could optionally add scenario-progress
  tracking (per-scenario checkmarks persisted in localStorage so re-
  opening the modal jumps to the next unfinished scenario).
- DATABASE MODE / MERGE workflow is untested. ~5 min to validate, could
  cut manual workflow time roughly in half if it works for different-
  shaped trees.

---

## Cross-references

- **Solver pipeline runbook:** `docs/SOLVER-PIPELINE.md` (this branch)
- **Hang recovery:** `docs/GTO-PLUS-HANG-RECOVERY.md` (archive branch)
- **Per-agent findings:** `docs/RE-FINDINGS-AGENT{1,3,4}.md` (archive branch)
- **Original dossier:** `docs/GTO-PLUS-INTEGRATION-DOSSIER.md` (archive branch — superseded by this doc)
- **CLAUDE.md:** project-level conventions and constraints
