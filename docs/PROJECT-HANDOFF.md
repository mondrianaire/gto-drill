# Project Handoff Spec: GTO Drill — Solver Data Pipeline

*Audience: future-you (or a fresh Claude session picking this up cold).
Self-contained — assumes only repo access and the project's general context
(CLAUDE.md).*

---

## Telos

Ship **§8.1 GTO Summary Card** with real solver-verified frequencies + EV costs
for as many of the 45 scenarios as feasible. Solver data comes from GTO+, fed
back via two channels: socket-driven extraction (proven) and binary `.gto2`
substitution (partially proven, partially blocked).

---

## Status snapshot — what's working RIGHT NOW

### ✅ Solid green: socket extraction pipeline

- GTO+ socket interface at `localhost:55143`, auth via
  `C:\Program Files\GTO\tmp\customconnect.txt` containing literal text
  `override` (admin write to Program Files required, one-time).
- Protocol: `~init~` → `~Load file: <abs path>~` → `~Request node data~` →
  parse the `[GTO+ export][Board: …][OOP, …][IP, …]` reply for per-combo
  COMBOS/EQUITY/FREQ/EV.
- Verified against `data\test332.gto2` — pulls real per-combo data with
  `Bet 9.25 / Check` frequencies, dumps to `solver-output\test332-extracted.json`.
- Wrapper basis: bkushigian/gto- on GitHub.

### ✅ Solid green: preflop range library (PR #145)

- `data\preflop-ranges.json` — 52 scenario keys, 3-source consensus from
  greenline + pekarstas + tyloo.
- `src\preflop-ranges.js` exports `deriveRanges(scen)`. 76% of our 45 scenarios
  resolve cleanly to chart-cited ranges.
- HJ in scenarios.json = MP in chart sources (mapping handled inside
  `deriveRanges`).

### ✅ Solid green: paste-pack fallback (PR #145)

- `scripts\gto-pastepack.mjs` — generates `solver-input\<id>.gtopaste.txt` per
  scenario.
- Chart-derived hero range + authored postflop vill (or chart-derived preflop
  vill).
- 45/45 hero ranges populated, 40/45 vill ranges from scenarios.json, 3 from
  chart, 2 missing.
- Manual GTO+ setup workflow: ~30 sec / scenario.

### 🟢 Confirmed working: binary substitution for the narrow happy path

After PRs #146-151, the binary generator works for scenarios meeting BOTH:

- **Board = flop only** (6-char board, matches template — no board byte shift)
- **Hero range ≤ 238 chars + Villain range ≤ 251 chars** (uint8 byte budget)

Currently 14 of 31 postflop scenarios meet both constraints. Files sit in
`solver-output\`, ready for GTO+'s `PROCESS FILES`.

| Pipeline component | Status |
|---|---|
| HEADER section length + bytesum | ✅ |
| `@12` forward pointer (net delta) | ✅ |
| HEADER byte 18 = `hero_len + 17` (hero delta only) | ✅ |
| HEADER byte 23 = `vill_len + 4` (vill delta only) | ✅ |
| Empty MAIN TREE stub (template-derived) | ✅ |
| EBUSY-resilient writes | ✅ |
| Template combo budget validation (`gto-template-check.mjs`) | ✅ |

### ⏸ Blocked / waiting

| Item | What it blocks | Why blocked | Resolution |
|---|---|---|---|
| Board byte decoding | 17 turn/river scenarios | Empirically OOMs with corrupted display | Needs 3 controlled saves varying board length |
| Multi-byte encoding | 4 wide-range scenarios (hero > 238 OR vill > 251) | byte 18 / byte 23 are uint8 | Needs 3 controlled saves with progressively wider ranges |
| Region D derived bytes | Display-only artifacts (likely non-blocking) | tpl-base/tpl-hero-len diff showed byte 577 changed with hero content | Low priority — observed, not blocking load/solve |

User has independent researchers digging in parallel. Resolutions may arrive
from that channel.

---

## File map — where things live

### In the repo (`gto-poker-async-duel-AB\`)

```
data\preflop-ranges.json              ← 3-source preflop chart consensus
data\scenarios.json                   ← 45 scenarios (canonical source of truth)
data\test32.gto2 / test332.gto2       ← user's solved samples (DO NOT DELETE)
data\dictionary.json                  ← unrelated

src\preflop-ranges.js                 ← deriveRanges(scen) — chart lookup
src\replay.js                         ← buildSolverConfig + lots of replay helpers

scripts\gto-batch-generate.mjs        ← binary .gto2 generator
scripts\gto-template-check.mjs        ← validate template combo budget vs demands
scripts\gto-pastepack.mjs             ← paste-pack generator
scripts\gto-extract.mjs               ← socket-driven extractor

solver-input\<id>.gtopaste.txt        ← 45 paste-packs (regenerable)
solver-output\<id>.gto2               ← 14 currently-generated, ready for PROCESS FILES
solver-output\solver-data.json        ← would land here after extract (doesn't exist yet)

docs\SOLVER-PIPELINE.md               ← owner runbook (4-step workflow)
docs\RESEARCH-AGENT.md                ← deep-dive researcher brief
docs\PROJECT-HANDOFF.md               ← this file
docs\CHANGELOG.md                     ← v.142+ entries on solver pipeline
.claude\agents\researcher.md          ← project-local agent definition

template-max-15k.gto2                 ← user's max-budget unbuilt template (root of repo)
```

### Outside the repo (user-level)

```
C:\Users\mondr\Downloads\template-max.gto2          ← user's earlier 545KB template (DON'T USE — solved tree)
C:\Users\mondr\Documents\Claude\Projects\Auto Builder\test.gto2  ← original 1057B unsolved template (reference)
C:\Users\mondr\.claude\skills\deep-dive-researcher\SKILL.md      ← skill (auto-triggered)
C:\Users\mondr\.claude\agents\researcher.md                       ← global agent
C:\Users\mondr\Documents\Claude\Artifacts\RESEARCH-AGENT.md       ← shareable doc copy
C:\Program Files\GTO\tmp\customconnect.txt                        ← MUST contain "override"
C:\Program Files\GTO\tmp\progress.txt                             ← solver iteration log
C:\Program Files\GTO\tmp\connect_log.txt                          ← socket auth log
```

---

## Commands — copy-paste ready

All assume `cd "C:\Users\mondr\Documents\Claude\Projects\gto-poker-async-duel-AB"` first.

### Generate paste-packs (manual setup workflow)

```powershell
node scripts/gto-pastepack.mjs
# → 45 files in solver-input/
```

### Generate binary .gto2 files (automated workflow, current 14-scenario coverage)

```powershell
# First: close any GTO+ instances holding file locks
Get-Process | Where-Object { $_.ProcessName -like "*GTO*" } | Stop-Process -Force

# Validate the template covers the scenarios
node scripts/gto-template-check.mjs ".\template-max-15k.gto2"

# Generate
node scripts/gto-batch-generate.mjs ".\template-max-15k.gto2"
# → .gto2 files in solver-output/ (skips preflop, wide-range, turn/river)
```

### Extract solver data after PROCESS FILES completes

```powershell
# GTO+ must be running with socket auth enabled
node scripts/gto-extract.mjs
# → solver-output/solver-data.json
```

### Smoke test ONE generated file before kicking off batch

```powershell
# Open this in GTO+ (Run Solver → File → Open)
# Expected: clean load, shows board/ranges/pot/stack as substituted
solver-output\ip-flop-overbet-on-paired-board-006.gto2
```

---

## Known failure modes + recoveries

| Symptom | Cause | Recovery |
|---|---|---|
| Generator EBUSY error | GTO+ has file open in solver-output/ | `Stop-Process` all GTO; rerun |
| Generated file freezes GTO+ on load | Turn/river board OR ranges > uint8 budget | Use paste-pack for that scenario; wait on board byte decode |
| File loads but with corrupted ranges + OOM warning | Same as above (different symptom) | Same |
| Socket auth refused (`Connection refused`) | customconnect.txt missing OR GTO+ wasn't restarted after creating it | Verify file contains `override` (no newline); close and reopen GTO+ |
| Socket connects but commands time out | GTO+ in a different state (tree-builder waiting for input, etc) | Close GTO+ and reopen fresh; load a known-good file first |
| `gto-extract.mjs` exits before output | Wrapper-protocol bug: receive() resolves on first `~`-framed chunk (the `C::ID`) before auth response arrives | Fixed in current main; re-pull if needed |
| Solver-output has stale `facing-river-overbet-with-bluff-catcher-007.gto2` | Generated earlier before turn/river block-out; locked by GTO+ | Close GTO+; manually `Remove-Item` |

---

## Decision points pending

| Decision | Options | Author's pick |
|---|---|---|
| Solve the 14 now via PROCESS FILES, or wait for researchers to crack board byte? | A. Run now → 14 scenarios of real data in hand. B. Wait → potentially 28-31 in one batch. | A. Get data flowing for §8.1 chrome; expand when researchers report back. |
| Should §8.1 GTO Summary Card ship with placeholder data while solves run? | A. Ship chrome now, light up cards as solves land. B. Wait for full data. | A. Ship now — visible progress, no blocking. |
| What to do with 17 turn/river + 4 wide-range scenarios? | A. Paste-pack manually (15-20 min). B. Wait on researchers. C. Both. | C. |
| Mockup queue (6 visible UI items independent of solver data) | A. Pause until solver pipeline closes. B. Run mockup autopilot in parallel. | B. None of these mockups depend on solver data — Results-Header-v2, Results-Highlight, Results-Villain-Range, Results-Notes, Results-Social-v2, CompactToggle-v2 polish, Scenario-Briefing. |

---

## Pickup recipe — first 5 minutes of a fresh session

If you (or future-Claude) reads this cold:

1. `git pull origin main` — confirm v.142+ is in
2. `node --check scripts/gto-batch-generate.mjs` — sanity check the scripts work
3. `ls solver-output\*.gto2 | wc -l` — see what's currently staged (should be ~14)
4. `cat docs\SOLVER-PIPELINE.md | head -60` — refresh on the 4-step pipeline
5. Read the latest `### Added` / `### Fixed` entries in `docs\CHANGELOG.md`
   (start at v.142)
6. Check if user has shared any researcher findings — they were going to be
   passed inline

If user is mid-workflow when you arrive, ask:

> "Status check: how far through the [generation / solve / extraction] step
> are we? Anything broken since last I looked?"

Don't redo binary RE work the long way — the byte 18 / byte 23 findings are
settled. If a NEW failure mode appears, controlled-diff against
`tpl-A1/A2/A3` (still in `solver-output\`) is the methodology that worked.

---

## Lessons learned (avoid these patterns)

These cost time in this session — pre-mortem against them next time:

1. **Don't fabricate GTO+ UI instructions.** The app's flow is "range 1 →
   range 2 → Build tree → Save as." Anything more elaborate is invention
   until the user confirms.
2. **Don't update HEADER byte 18 with net delta.** It tracks hero length only.
   Same for byte 23 = vill only. Use per-substitution deltas, never net.
3. **Don't use `test.gto2`'s empty MAIN TREE stub with a different template's
   HEADER.** The bytes were captured from an unbuilt simple-region-B template;
   pairing with an extended-region-B template (any template GTO+ saves after
   "Build tree") causes load freezes. Either keep the source template's
   MAIN TREE, or use an empty stub that matches the source template's region
   B form.
4. **Don't bundle multiple substitutions into one test when debugging.**
   Always isolate to ONE variable, diff against a baseline, find the rogue
   byte. Worked every time we did it; failed every time we didn't.
5. **Don't punt to paste-pack prematurely OR persist too long on binary.**
   ~3 failed test files is the right "switch path" threshold.

---

*End of handoff. Update sections as state changes — particularly the
status snapshot and the decision points table.*
