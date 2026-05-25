# Solver pipeline — owner runbook

End-to-end workflow to populate `solver_data` on the 31 postflop scenarios
in `data/scenarios.json`. The §8.1 GTO Summary Card consumes this data.

Two solver lanes converge at the same merge step:

- **TexasSolver lane** — open-source, pure CLI, no GUI, runs unattended.
  Recommended for batch processing.
- **GTO+ lane** — paid GUI, socket interface for extraction, requires the app
  running. Useful if you already have a GTO+ license and prefer its solver.

## Architecture at a glance

```
data/scenarios.json + data/preflop-ranges.json + src/range-canonicalize.js
   │
   ├── TexasSolver lane ─────────────────────────────────────────────┐
   │   (1) node scripts/texas-batch-generate.mjs                     │
   │       → solver-input/texas/<scenario_id>.txt                    │
   │   (2) node scripts/texas-batch-solve.mjs                        │
   │       → solver-output/texas/<scenario_id>.json                  │
   │   (3) node scripts/texas-extract.mjs                            │
   │       → solver-output/solver-data-texas.json                    │
   │                                                                 │
   ├── GTO+ lane ───────────────────────────────────────────────────┐│
   │   (1) node scripts/gto-batch-generate.mjs <template>           ││
   │       → solver-output/<scenario_id>.gto2 (unsolved stubs)      ││
   │   (2) (optional) node scripts/gto-verify-loads.mjs             ││
   │       → solver-output/load-verify-report.json                  ││
   │   (3) GTO+ → PROCESS FILES (hours, unattended)                 ││
   │       → solver-output/<scenario_id>.gto2 (solved)              ││
   │   (4) node scripts/gto-extract.mjs                             ││
   │       → solver-output/solver-data-gto-plus.json                ││
   │                                                                 ││
   ▼                                                                 ▼
   solver-output/solver-data-texas.json  +  solver-data-gto-plus.json
   │
   │  (M) node scripts/gto-merge.mjs    ◄─── unions both lane files
   ↓                                          per scenario; GTO+
data/scenarios.json (now §8.1-ready, with solver_data per scenario)
```

## Which lane to use

| | TexasSolver | GTO+ |
|---|---|---|
| Cost | Free | Paid license |
| Batch mode | Pure CLI, runs unattended | GUI button + walks away |
| Crash recovery | Process exits, script continues | Manual GTO+ relaunch + rerun |
| Per-file diagnostics | Exit code + stdout per file | Socket-driven verify script |
| Platform | Windows + Mac + Linux | Windows only |
| Result format | JSON dump per scenario | `.gto2` populated MAIN TREE |
| EV per action in dump | ❌ (freq only) | ✅ (freq + EV) |
| **Recommended for** | **Baseline coverage of all 31 scenarios** | Layered on top of TexasSolver for the §8.1 card's "≈X BB cost" annotation |

Both lanes feed the same downstream `gto-merge.mjs`, which unions their per-scenario data — **GTO+ wins on overlap** because it carries EV that TexasSolver doesn't. Lane-separated output files mean running one after the other no longer clobbers the first's data; TexasSolver freq + GTO+ EV coexist per scenario.

The typical setup: run TexasSolver across all 31 scenarios for cheap baseline coverage, then layer GTO+ on whichever subset of scenarios is worth the hours-long solve time for the EV annotation.

---

## TexasSolver lane

### One-time setup

Download TexasSolver from https://github.com/bupticybee/TexasSolver/releases.
Extract `console_solver.exe` somewhere stable. The batch-solve script
auto-detects common install paths; for non-standard locations, set:

```powershell
$env:TEXAS_SOLVER_PATH = "C:\Path\To\console_solver.exe"
# or pass --solver-path <path> to texas-batch-solve.mjs on each run
```

No license required, no GUI, no per-file template setup.

### The three steps (lane M0–M3)

```bash
# 1. Generate 31 .txt configs from data/scenarios.json
node scripts/texas-batch-generate.mjs

# 2. Solve every config (sequential by default; --concurrency N for parallel)
node scripts/texas-batch-solve.mjs

# 3. Parse the JSON dumps into solver-data-texas.json
node scripts/texas-extract.mjs
```

Each `.txt` config is fully solve-ready: hero range auto-filled from
`deriveRanges()` + the canonicalizer, villain range from authored
`villain_ranges[]` or chart-derived fallback. The 5 edge-case scenarios
that can't resolve a hero range get a `PASTE_HERO_RANGE_HERE` marker and
the `texas-batch-generate` output flags them as `⚠ hero range unresolved`.

Then jump to **The merge step** below.

---

## GTO+ lane

### One-time setup

**Enable GTO+'s socket interface.** (Required by extract step — the socket auth gate.)

```powershell
# In PowerShell as Administrator (Program Files write requires admin):
Set-Content -Path "C:\Program Files\GTO\tmp\customconnect.txt" -Value "override" -NoNewline -Encoding ASCII
```

Then restart GTO+. On the next launch, `tmp/connect_log.txt` will show
`Custom connect in ON`.

**Save per-street max-budget templates.** Step 1 (binary generation) substitutes
per-scenario ranges into a template `.gto2`, but two template constraints
must be satisfied:

1. **Combo budget** — the template's saved hero+villain ranges must be at
   least as wide (combo count) as the widest scenario we'll inject. Else GTO+
   OOM-crashes during solve.
2. **Street match** — the template's saved board length must match the
   scenario's board length. A 5-card-river board substituted into a 3-card-
   flop template OOMs GTO+ at file open (the bet-tree was shaped for a flop
   decision with turn+river chance subtrees, and the file says we're on the
   river — GTO+ doesn't reconcile). So we need separate templates per
   street: flop / turn / river.

In GTO+, save **three** templates by repeating these steps for each street:

1. Open Run Solver
2. Set hero range to **the widest possible** (~700+ combos):
   `22+,A2s+,A2o+,K2s+,K2o+,Q2s+,Q2o+,J2s+,J2o+,T2s+,T2o+,92s+,92o+,82s+,82o+,72s+,72o+,62s+,62o+,52s+,52o+,42s+,42o+,32s,32o`
3. Set villain range to **all hands** (1326 combos): same wide range as hero
4. Set board:
   - For the flop template: 3 cards (e.g. `Td 9d 6h`)
   - For the turn template: 4 cards (e.g. `Td 9d 6h 2s`)
   - For the river template: 5 cards (e.g. `Td 9d 6h 2s 3c`)
5. Set pot/stack: any values (overwritten per scenario)
6. **IMPORTANT**: configure your preferred bet sizing tree — every generated
   `.gto2` carries this tree.
7. **Save** with the matching suffix:
   - `template-max-flop.gto2`
   - `template-max-turn.gto2`
   - `template-max-river.gto2`
   (all in the same directory)
8. Don't solve — we want an unsolved template (MAIN TREE empty) so the
   substituted files get solved cleanly.

`gto-batch-generate.mjs` auto-detects the per-street siblings next to the
template path you pass on the command line, and routes each scenario to the
matching template by board length. If a sibling is missing for a street that
has scenarios, you'll see a clear `⚠OOM-risk` tag in the per-scenario output
and an explicit "fallback is a {flop|turn|river}, scenarios for {turn|river}
will likely OOM" warning at startup.

Backward compatibility: if you pass a single template path with no per-street
siblings, the script falls back to using that one template for everything
(same as before). Useful for spot-tests of a single flop scenario, but won't
work for full coverage.

Validate the templates before generation:

```bash
node scripts/gto-template-check.mjs path/to/template-max.gto2
```

This now reports three things:
1. **Combo budget** — hero/vill combo counts vs widest scenario demand
2. **Byte-pointer cap** — list of scenarios whose substituted range strings
   would overflow byte 18 (hero) or byte 23 (vill); see "Known caveats" below
3. **Per-street coverage** — whether dedicated `-flop` / `-turn` / `-river`
   sibling templates exist, and which streets they cover

A green verdict requires all three. The script exits 1 if any check fails.

## The four steps

### 1. Generate per-scenario setup files

```bash
node scripts/gto-batch-generate.mjs path/to/template-max.gto2
```

Writes 45 files to `solver-output/<scenario_id>.gto2`. Each substitutes
template ranges with chart-derived hero range + authored villain range (or
preflop-derived fallback), updates board/pot/stack, recomputes section length +
bytesum + the @12 forward pointer.

### 2. (Optional) Verify every generated file opens in GTO+

Before kicking off a multi-hour PROCESS FILES run, sanity-check that every
`.gto2` actually loads — a file that crashes GTO+ at load also blocks the
batch, but the batch UI gives no per-file diagnostic.

```bash
node scripts/gto-verify-loads.mjs
```

GTO+ must be running with socket auth enabled (see One-time setup). The
script:
- Connects to TCP `localhost:55143`
- For each `.gto2` in `solver-output/`: sends `~Load file: <abs path>~` and
  waits for the `~successfully loaded~` reply (or socket death)
- On a crash, reconnects automatically and continues with the next file —
  so one bad scenario doesn't poison the run
- Writes `solver-output/load-verify-report.json` and a per-file table:
  - ✅ `loaded cleanly` — GTO+ confirmed the load
  - ❌ `rejected` — GTO+ replied but didn't accept the file
  - ⚠ `timed out` — no reply in 20 s (load may still be in flight)
  - 💥 `crashed GTO+` — socket dropped mid-load; the file kills GTO+

If GTO+ doesn't auto-respawn after a crash (it sometimes does, sometimes
doesn't), the reconnect waits up to 30 s before giving up — at which point
the script aborts cleanly and you can relaunch GTO+ to cover the rest.

Common failure-mode mappings:
- Crash on a **5-card-river** scenario → the file was generated against a
  flop template; save a per-street river template (see One-time setup).
- Crash on a flop scenario that previously loaded → check whether
  `template-max-15k.gto2` (or whichever fallback template was used) is
  still present and matches the scenarios' combo demands.

### 3. GTO+ PROCESS FILES batch solve

1. Open GTO+
2. Folder icon → select `solver-output/`
3. Click `PROCESS FILES`
4. Walk away — depending on tree depth and solver accuracy this can be hours
5. Each file's MAIN TREE section grows from ~25 bytes (empty stub) to ~20-80 KB
   (solved strategy data)

### 4. Extract solver data via socket

GTO+ must be running and you must have set up `customconnect.txt` already.

```bash
node scripts/gto-extract.mjs
```

The script:
- Connects to TCP `localhost:55143`
- For each `.gto2` in `solver-output/`: loads it, requests node data, parses the
  per-combo response into `{ COMBOS, EQUITY, FREQ_by_action, EV_by_action }`
- Combo-weights to per-action **overall** frequencies (`'Bet 9.25': 0.78`)
- Picks out hero's dealt-hand specific strategy
- Writes `solver-output/solver-data-gto-plus.json`

---

## The merge step (lanes converge)

The merger reads both lane files and unions them per scenario:

```bash
node scripts/gto-merge.mjs              # merge everything
node scripts/gto-merge.mjs --dry-run    # preview without writing
node scripts/gto-merge.mjs <scenario>   # one scenario by id
```

What it reads (in this precedence order, per scenario):
1. `solver-output/solver-data-gto-plus.json`  — highest, has EV
2. `solver-output/solver-data-texas.json`     — baseline freq, no EV
3. `solver-output/solver-data.json`           — legacy single-lane fallback

Each scenario is fed by the highest-precedence lane that has data for it.
Scenarios only in TexasSolver still get merged; scenarios only in GTO+ get
merged with EV. Lane-tagged source flows through to `solver_data.source`
on each scenario.

What the merger does per scenario:
- Maps solver action labels (`BET 20`, `Bet 9.25`, `Check`) onto scenario
  `available_actions` (`Bet 2bb (~35%)`, `Check back`) using a fuzzy
  bet-size matcher
- Computes per-option `freq` (hero's hand's frequency for that line) and
  `ev_cost` (max EV across options minus this option's EV — null on
  TexasSolver-fed scenarios where EV is unavailable)
- Picks `best_solver_action` by highest EV when available, falling back to
  highest frequency for TexasSolver-fed scenarios (so the field is always
  populated, never null)
- Writes a `solver_data` field onto each matched scenario in
  `data/scenarios.json`, preserving every existing field verbatim
- Saves a backup at `data/scenarios.json.backup` before touching the file
- Reports per-scenario summary with a `[GTO+]` / `[Tex ]` lane tag, plus
  a final breakdown by lane

Shape of the data file (lane-independent):

```json
{
  "flush-draw-semibluff-c-bet-016": {
    "board": ["8c", "5c", "2h"],
    "actions": ["Bet 9.25", "Check"],
    "next_to_act": "oop",
    "overall_freq": { "Bet 9.25": 0.78, "Check": 0.22 },
    "oop_per_hand": { "KcKh": { "COMBOS": 1.0, "EQUITY": 67.2, ... }, ... },
    "ip_per_hand": { ... },
    "hero_hand_strategy": { "hand": "AcQc", "COMBOS": 1.0, "EQUITY": 52.4, "Bet 9.25": { "FREQ": 78.5, "EV": 1.4 }, ... }
  },
  ...
}
```

Shape of the merged `solver_data` written onto each scenario:

```json
{
  "scenario_id": "flush-draw-semibluff-c-bet-016",
  ...
  "solver_data": {
    "source": "TexasSolver",
    "hero_hand": "AcQc",
    "solver_actions": ["BET 20", "CHECK"],
    "hero_strategy": [
      { "solver_action": "BET 20", "freq": 0.78, "ev": 6.4 },
      { "solver_action": "CHECK",  "freq": 0.22, "ev": 5.2 }
    ],
    "options": {
      "Check back":     { "freq": 0.22, "ev": 5.2, "ev_cost": 1.2 },
      "Bet 2bb (~35%)": { "freq": 0.78, "ev": 6.4, "ev_cost": 0.0 }
    },
    "best_solver_action": "BET 20",
    "best_scenario_action": "Bet 2bb (~35%)",
    "solved_at": "2026-05-23"
  }
}
```

The §8.1 GTO Summary Card consumes `solver_data.options[<action>].freq` and
`.ev_cost` directly.

## Per-scenario diagnostics during generation

`gto-batch-generate.mjs` prints a line per scenario showing the substitutions:

```
✅ flush-draw-semibluff-c-bet-016    board=8c5c2h pot=5.5bb stack=97.5bb hero=139 chars vill=183 chars delta=+118
```

If a scenario can't be generated (missing range, no flop), the line shows the
reason and that scenario is skipped — the corresponding `.gto2` is not written,
so PROCESS FILES will simply skip it.

## What's automated vs manual

| Step | Tool | Manual work |
|---|---|---|
| Auth setup | (one-time) | ~30s, admin shell |
| Template creation | GTO+ GUI | ~2 min, one time |
| `gto-batch-generate.mjs` | Node | runs in ~1s |
| GTO+ PROCESS FILES | GTO+ GUI | 1 click, unattended hours |
| `gto-extract.mjs` | Node | runs in ~1 min |
| Merge to scenarios.json | (script TBD) | ~1s |

Total active human time once template is built: **~3 clicks per batch run.**

## Related scripts

### TexasSolver lane
- `scripts/texas-batch-generate.mjs` — writes 31 `.txt` configs to
  `solver-input/texas/`, hero range auto-filled from chart-derived
  + canonicalized data.
- `scripts/texas-batch-solve.mjs` — invokes `console_solver.exe` on every
  `.txt`. Auto-detects solver path; accepts `--solver-path`, `--concurrency`,
  `--timeout`.
- `scripts/texas-extract.mjs` — parses TexasSolver JSON dumps into
  `solver-output/solver-data-texas.json` (lane-specific path so GTO+
  data isn't clobbered if both lanes run).

### GTO+ lane
- `scripts/gto-batch-generate.mjs` — generates `.gto2` setup files by
  substituting per-scenario data into a max-budget template.
- `scripts/gto-template-check.mjs` — combo budget + per-street coverage
  validator for a template.
- `scripts/gto-pastepack.mjs` — alternative to binary substitution: generates
  human-readable paste sheets so each scenario can be set up manually in
  GTO+'s UI. The robust fallback when binary substitution hits a wall.
- `scripts/gto-verify-loads.mjs` — socket-driven load test (between steps 1
  and 3); per-file ✅/❌ table plus a JSON report. Crash-resilient: reconnects
  to GTO+ after each crash so one bad scenario doesn't poison the run.
- `scripts/gto-extract.mjs` — socket-driven extractor (step 4 of the GTO+
  lane). Writes `solver-output/solver-data-gto-plus.json` (lane-specific
  path so TexasSolver data isn't clobbered if both lanes run).

### Both lanes converge here
- `scripts/gto-merge.mjs` — solver-agnostic. Reads both lane files
  (`solver-data-gto-plus.json` + `solver-data-texas.json`) and unions
  them per scenario, GTO+ winning on overlap. Writes the merged
  `solver_data` field onto matched scenarios in `data/scenarios.json`,
  with a backup at `data/scenarios.json.backup`.
- `src/preflop-ranges.js` — shared `deriveRanges(scen)` used by both
  generators.
- `data/preflop-ranges.json` — 3-source consensus chart library.

## Known caveats

- Templates that lack a `template_max.gto2` style wide-range setup will OOM the
  solver on wide scenarios. The template-check script catches this preemptively.
- The binary substitution recomputes the `@12` forward pointer for shifts and
  the byte 18 / byte 23 sibling pointers in region B. Both byte 18 and byte 23
  are **single-byte** fields (verified — no adjacent high-byte field), so the
  scenario's substituted range string length is capped:
    - hero string ≤ 238 chars (else byte 18 overflows)
    - villain string ≤ 251 chars (else byte 23 overflows)
  `gto-template-check.mjs` reports any scenario that violates the cap as part
  of its standard pre-flight output. The script's exit-1 verdict now covers
  both the combo-budget check and the string-length cap.
- `gto-batch-generate.mjs` now re-parses every generated file before writing
  and asserts that the first two range-shaped strings in the new HEADER equal
  the intended hero/villain. A scenario that fails this verify step is
  reported as `❌ verify: ...` and skipped — the bad file never lands on disk.
  This catches both locator slot-picking errors and byte-pointer arithmetic
  errors before they reach PROCESS FILES.
- **River-vs-flop tree mismatch.** A scenario whose board length doesn't
  match the template's saved board length OOMs GTO+ at file open (confirmed
  empirically: scenarios 007 and 045, both 5-card rivers loaded into a
  3-card-flop template, both crashed; flop scenarios into the same template
  loaded fine). Mitigation: save per-street templates (`-flop.gto2`,
  `-turn.gto2`, `-river.gto2`) and `gto-batch-generate.mjs` routes per
  scenario. Until the per-street files exist, the script tags
  street-mismatched scenarios with `⚠OOM-risk` in its per-line output so
  they're easy to spot.
- For scenarios where `deriveRanges` falls back to the dealt-hand class (5/45
  edge cases: limped pots, ICM, BB-vs-SB), the solver gets a single-combo
  "range" and the equilibrium is degenerate. These need authored
  `hero_range` overrides or a chart for the missing archetype.
