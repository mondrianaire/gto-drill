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

**Save a max-budget template.** Step 1 (binary generation) substitutes per-scenario
ranges into a template `.gto2`, but the template's bet-tree allocation must be
sized for the WIDEST combo count any scenario will inject — else GTO+ OOM-crashes
during solve.

In GTO+:
1. Open Run Solver
2. Set hero range to **the widest possible** (~700+ combos):
   `22+,A2s+,A2o+,K2s+,K2o+,Q2s+,Q2o+,J2s+,J2o+,T2s+,T2o+,92s+,92o+,82s+,82o+,72s+,72o+,62s+,62o+,52s+,52o+,42s+,42o+,32s,32o`
   (essentially "play anything")
3. Set villain range to **all hands** (1326 combos):
   Same wide range as hero
4. Set board: any flop (e.g. `Td9d6h` — board gets overwritten per scenario)
5. Set pot/stack: any values (overwritten per scenario)
6. **IMPORTANT**: configure your preferred bet sizing tree — every generated
   `.gto2` carries this tree.
7. **Save** as `template-max.gto2` somewhere (e.g. next to `test32.gto2`).
8. Don't solve — we want an unsolved template (MAIN TREE empty) so the
   substituted files get solved cleanly.

Validate the template before generation:

```bash
node scripts/gto-template-check.mjs path/to/template-max.gto2
```

Should print `✅ Template covers all 45 scenarios — safe for batch generation.`

## The four steps

### 1. Generate per-scenario setup files

```bash
node scripts/gto-batch-generate.mjs path/to/template-max.gto2
```

Writes 45 files to `solver-output/<scenario_id>.gto2`. Each substitutes
template ranges with chart-derived hero range + authored villain range (or
preflop-derived fallback), updates board/pot/stack, recomputes section length +
bytesum + the @12 forward pointer.

### 2. GTO+ PROCESS FILES batch solve

1. Open GTO+
2. Folder icon → select `solver-output/`
3. Click `PROCESS FILES`
4. Walk away — depending on tree depth and solver accuracy this can be hours
5. Each file's MAIN TREE section grows from ~25 bytes (empty stub) to ~20-80 KB
   (solved strategy data)

### 3. Extract solver data via socket

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

### 4. Merge into scenarios.json

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
- `scripts/gto-extract.mjs` — step 3 socket-driven extractor.
- `src/preflop-ranges.js` — shared `deriveRanges(scen)` used by both
  generators.
- `data/preflop-ranges.json` — 3-source consensus chart library.

## Known caveats

- Templates that lack a `template_max.gto2` style wide-range setup will OOM the
  solver on wide scenarios. The template-check script catches this preemptively.
- The binary substitution recomputes the `@12` forward pointer for shifts but
  assumes the template's region B (bet-tree abstraction) is independent of range
  size. This held in our minimal tests; if a real generation crashes GTO+ on
  load (not solve), we'd need to investigate region B further.
- For scenarios where `deriveRanges` falls back to the dealt-hand class (5/45
  edge cases: limped pots, ICM, BB-vs-SB), the solver gets a single-combo
  "range" and the equilibrium is degenerate. These need authored
  `hero_range` overrides or a chart for the missing archetype.
