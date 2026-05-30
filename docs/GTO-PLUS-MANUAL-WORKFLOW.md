# GTO+ batch-solve manual workflow

The minimum-interaction path to get EV data for all 31 postflop scenarios into the M5 GTO Summary Card. Use this when socket-driven full automation isn't available (the GTO+ socket protocol is empirically read-only, confirmed by ~200-probe sweep).

## End-to-end at a glance

| Step | What | Where | Time |
|---|---|---|---|
| 1 | Generate 31 library entries | terminal | 5 sec |
| 2 | Copy library.txt to GTO+ config (UAC) | File Explorer | 30 sec |
| 3 | Open GTO+ → Quickload dialog | GTO+ | 10 sec |
| 4 | For each scenario: LOAD → Build → Save | GTO+ guided by helper script | **~10 sec × 31 = ~5 min** |
| 5 | Close library dialog; PROCESS FILES on solver-output/ | GTO+ | unattended hours |
| 6 | When done: extract + merge | terminal | 1 min |

Total active human time: **~6 min**. Solve time: **unattended hours**.

## Step-by-step

### 1. Generate the library

```bash
node scripts/gto-library-emit.mjs --source=/c/Users/mondr/Downloads/library.txt.backup-1779759231891
```

Writes 31 scenario entries to `C:\Users\mondr\Downloads\library.txt`. Validate the file structure first (no GTO+ interaction required):

```bash
node scripts/gto-library-repair.mjs  # if there are any preamble warnings
```

### 2. Install the library (UAC required)

In File Explorer:

1. Navigate to `C:\Users\mondr\Downloads\`
2. Right-click `library.txt` → Copy
3. Navigate to `C:\Program Files\GTO\config\`
4. Paste → UAC prompt → **Yes** → **Replace** existing

### 3. Pre-flight check in GTO+

1. Open GTO+
2. Click **Quickload** (folder icon, bottom-left of the left panel)
3. Scroll the entry list — you should see **31 new `scenario-*` entries** alongside the originals
4. (Optional but recommended) Click ONE entry → **LOAD SELECTED TREE** → confirm the board/ranges/pot in the main UI match the scenario data. If not, the emitter has a bug — STOP and report before doing the full batch.

### 4. Run the batch-helper

In a terminal:

```bash
node scripts/gto-batch-helper.mjs
```

This walks each scenario one at a time, **pre-fills the clipboard with the right filename** for each Save dialog, and prints a per-scenario checklist. Press Enter after each scenario to advance.

**Per scenario (~10 sec):**

1. In Quickload, click the next `scenario-*` entry (helper tells you which one)
2. Click **LOAD SELECTED TREE**
3. Close the Quickload dialog
4. Click **Build Tree** in the left panel
5. Wait for build to finish (1-2 sec for most scenarios)
6. **File → Save As** → navigate to `solver-output/` (GTO+ remembers the folder after the first save)
7. **Ctrl+V** to paste the pre-filled filename
8. Click **Save**
9. (DO NOT click Run Solver — PROCESS FILES does the batch solve in step 5)
10. Press Enter in the terminal to advance to the next scenario

### 5. Batch solve via PROCESS FILES

When all 31 `.gto2` files are saved:

1. In GTO+: **File** menu → **PROCESS FILES** (or similar — the same dialog you've seen before)
2. **Target directory:** `C:\Users\mondr\Documents\Claude\Projects\gto-poker-async-duel-AB\.claude\worktrees\gifted-greider-5f4629\solver-output\`
3. **Toggle OFF** "Move processed files to subdirectory 'processed'" — let it overwrite in place so we can spot-check progress
4. **Toggle ON** "Use same dEV for all files" → `0.5%` (or `1%` for faster, less precise solves)
5. Click **PROCESS FILES**
6. Walk away. Each scenario takes 30 sec to 10 min depending on bet tree depth + accuracy. Full batch: 1-8 hours.

Spot-check progress from PowerShell:
```powershell
(Get-ChildItem solver-output\*.gto2 | Measure-Object Length -Sum).Sum / 1MB
```
That number should climb from ~0.8 MB (unsolved-tree-built) to 50+ MB (solved).

### 6. Extract + merge

When PROCESS FILES finishes:

```bash
node scripts/gto-extract.mjs   # → solver-output/solver-data-gto-plus.json
node scripts/gto-merge.mjs     # unions GTO+ EV onto TexasSolver baseline → data/scenarios.json
```

The M5 GTO Summary Card's `≈X BB cost` annotation now lights up on misses for every solved scenario.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Quickload entries don't appear after copy | UAC prompt skipped → file not actually replaced | Re-copy with UAC = Yes |
| Entry appears but LOAD shows wrong data | Emitter bug in lp-string patching | Report — re-run emitter with `--source=<known-clean-backup>` |
| GTO+ "Failed to load quickload" error | Library has structural corruption (missing preamble, wrong bytesum) | Run `gto-library-repair.mjs` on Downloads file before copying |
| PROCESS FILES says "31 processed" but no file size growth | Files have no tree built (saved at wrong workflow step), or files were stripped | Verify each saved file is >5 KB (has built tree); re-run step 4 if not |
| PROCESS FILES skips files silently | Files have identical state to a previous solve | Verify each file has scenario-distinct data via `node scripts/gto-mt-analyze.mjs <file.gto2>` |

## Why this workflow

Three alternative paths were investigated tonight; each hit a wall:

1. **Binary `.gto2` substitution** — MAIN TREE Block A is range-dependent and uses internal combo indices. Substituting Block B without rebuilding Block A crashes GTO+. A bet-tree compiler would be 5-20 hours of work duplicating GTO+'s internals.

2. **Socket-driven full automation** — GTO+'s socket protocol is empirically read-only (~200-probe sweep). No `Set ranges` / `Build tree` / `Solve` / `Save` commands exist. Even on registered installs.

3. **GUI automation via Windows-MCP** — possible but brittle (~3-4 hr to develop, fragile against window state changes).

The library-emitter workflow is **the minimum-friction path that empirically works**.
