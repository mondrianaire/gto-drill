# Solver pipeline — owner runbook

End-to-end workflow to populate `solver_freq` and `ev_cost` for all 45 scenarios
in `data/scenarios.json` using GTO+ as the solver engine. The §8.1 GTO Summary
Card card consumes this data.

## Architecture at a glance

```
data/scenarios.json + data/preflop-ranges.json
   │
   │  (1) generate per-scenario .gto2 setup files
   ↓
solver-output/<scenario_id>.gto2  (45 unsolved setups)
   │
   │  (2) GTO+ PROCESS FILES — batch solve overnight
   ↓
solver-output/<scenario_id>.gto2  (45 SOLVED files with MAIN TREE populated)
   │
   │  (3) extract solver data via GTO+ socket interface
   ↓
solver-output/solver-data.json
   │
   │  (4) merge into scenarios.json — adds solver_freq + ev_cost per option
   ↓
data/scenarios.json (now §8.1-ready)
```

## One-time setup

**Enable GTO+'s socket interface.** (Required by step 3 — the socket auth gate.)

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
- Writes `solver-output/solver-data.json`

### 5. Merge into scenarios.json

*(Not built yet — small follow-up script. The data file format is:*

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

*The merge script will add `solver_freq` and `ev_cost` fields to each scenario
in `scenarios.json`, sourced from `hero_hand_strategy`.)*

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

- `scripts/gto-pastepack.mjs` — alternative to step 1: generates human-readable
  paste sheets so you can set up each scenario manually in GTO+ instead of
  using the binary template path. Useful if the template approach hits a wall.
- `scripts/gto-template-check.mjs` — combo budget validator for a template.
- `scripts/gto-verify-loads.mjs` — step 2 (optional) socket-driven load test;
  per-file ✅/❌ table plus a JSON report at
  `solver-output/load-verify-report.json`. Crash-resilient: reconnects to GTO+
  after each crash so one bad scenario doesn't poison the run.
- `scripts/gto-extract.mjs` — step 4 socket-driven extractor.
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
