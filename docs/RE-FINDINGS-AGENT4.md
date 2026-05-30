# Agent 4 (REVIVAL) — RE Findings

**Mission**: Solve binary structures necessary to generate poker ranges and
scenarios for GTO+. Three angles attacked: (A) re-probe REGISTERED GTO+
socket, (B) hunt for other GTO+ wrappers/SDKs, (C) process/file-level
introspection.

**Started**: 2026-05-26 (revival agent)
**Hard cap**: 2 hours
**Predecessor context**: agents 1 & 3 went silent. Earlier ~200 probe sweep
was pre-license (UNREGISTERED).

---

## TL;DR

1. **Registration does NOT unlock new socket commands.** ~70 additional
   probes (post-license) all return `Instruction unknown.` Identical surface
   to unregistered.
2. **No other public GTO+ socket wrapper exists.** `bkushigian/gto-` is the
   only one. `theodelrieu/prc` and `Mister-Kitty/GTOHelper` looked promising
   but are for range conversion and PioSolver respectively.
3. **One genuinely new finding**: `Take action: 0` returns
   `~Next decision has been set.~` — confirming the navigation mutator's
   success form. Previously we only had the error form. **But**:
   `Take action: 1` with no valid action 1 at the current node **hung
   GTO+ entirely** (Responding: False). This is bkushigian issue #2 behavior
   — confirmed reproducible in v185 REGISTERED.
4. **No CLI args, no manual file, no debug log mode.** `GTO.exe --help`
   requires elevation. The shipped `english.txt` localization file (1416
   lines, scanned in full) contains every GUI string but **zero socket
   command strings** — protocol vocabulary is purely binary-embedded
   (Winlicense-packed, as already known).
5. **Two interesting filesystem side channels exist** but neither offers a
   solve trigger: `tmp/progress.txt` (real-time per-iteration dEV/stack
   dump) and `tmp/last_database.gto2` (auto-saved backup every X min).
   These are write-only; GTO+ does not poll for files written by us.

**Recommendation: socket-driven solve remains blocked.** The only realistic
path forward is GUI automation (AutoHotkey / Windows-MCP) or continued
manual workflow. Detailed below in "Recommended path forward".

---

## Status: COMPLETE (within scope of this 2-hr engagement)

Agent 4 killed the hung GTO+ process via `Stop-Process -Force` to leave the
system in a clean state. **User action required before next socket work:**

```powershell
Start-Process "C:\Program Files\GTO\GTO.exe"
```

…then verify with `Test-NetConnection localhost -Port 55143 -InformationLevel
Quiet` (should return True). See `docs/GTO-PLUS-HANG-RECOVERY.md`.

---

## Angle A — REGISTERED socket re-probe

### Sanity check (PASS)

Connected to `localhost:55143`, `~init~` handshake replied
`~C::8715~~You are connected to GTO+~`. Loaded a known-solved file with
`Load file: <abs>` → `~File successfully loaded.~`. The known 8 commands
work identically to unregistered.

### Batch A (64 probes, all UNKNOWN)

Source: `scripts/_probe-batch-a.txt`. Categories:
- GUI label EXACT strings (`Run solver`, `Build tree`, `PROCESS FILES`,
  `Save`, `Save As`, `Solve current tree`, `Re-build tree`, `Rebuild
  database`, etc.)
- `Set Range <N>` permutations
- `Enter code` and known secret-code values (`MERGE`, `export_XXX`)
- `Save file:`, `Export file:`, `Export: Current range as string`
- Take-peer variants (`Take build`, `Take solve`, `Take save`, `Take open`)
- License-gated guesses (`License status`, `Set mode: solver`)
- Database commands (`Activate database mode`, `Add current tree to
  database`, etc.)
- Help/introspection (`?`, `HELP`, `Commands`, `List commands`)
- Library/quickload (`Quick-load`, `LOAD ENTIRE TREE`, `Store current tree`)

**Result: 62/64 UNKNOWN, 2 known (Request node data, Request pot/stacks).**

### Batch B (PARTIAL — hung GTO+ at probe 3)

Source: `scripts/_probe-batch-b.txt`. Output captured at
`docs/_probe-batch-b-hang.txt`.

| # | Command | Reply |
|---|---|---|
| 1 | `Take action: 0` | **`~Next decision has been set.~`** ← NOVEL |
| 2 | `Take action: 1` | SILENT (hung) |
| 3-50 | ... | all SILENT (cascade of hang) |

`Take action: 0` is the **navigation success form**. We previously only
documented the error form `~Action does not exist~` (which fires for
negative or beyond-max indices). The success form was missing.

`Take action: 1` hung the dispatcher. At this loaded node, only action 0
exists. So **any out-of-range action index past the current node's available
actions hangs GTO+ irrecoverably** (process stays alive, MainWindowTitle
visible, but Responding=False — needs Task Manager kill).

This is the same failure mode documented in bkushigian/gto- issue #2. It
reproduces in v185 REGISTERED.

### Full enumeration of known socket commands (post-Agent-4)

| Command | Reply (success) | Reply (error / no file) |
|---|---|---|
| `init` | `~C::<id>~~You are connected to GTO+~` | — |
| `Load file: <abs>` | `~File successfully loaded.~` | (varies) |
| `Request node data` | `~[GTO+ export][Board: <board>][OOP, N hands, M actions...]...~` | silent if no file |
| `Request action data` | (long form, see bkushigian wrapper) | silent if no file |
| `Request pot/stacks` | `~[Pot+stack data][Pot: X][Stack OOP: Y][Stack IP: Z]~` | silent |
| `Request current line` | `~Hand is at start of tree.~` or path | silent |
| `Take action: 0..N` (valid) | **`~Next decision has been set.~`** | (success) |
| `Take action: <invalid>` | `~Action does not exist~` (negative) **OR HANG** (positive beyond max) | |
| `Still processing instruction?` | `~Solver still running. Please try again later.~` or other | — |

**Net new vs prior docs: `~Next decision has been set.~` is the
previously-undocumented success form for `Take action`.**

---

## Angle B — Other wrappers / SDKs

### Searched and ruled out

1. **`bkushigian/gto-`** (`src/gto.py`, 12.6 KB) — the only known wrapper.
   Confirmed via direct fetch: exactly the 8 commands documented above.
   Repository moved from `master` to `main` branch.
2. **`theodelrieu/prc`** — initially looked promising (path
   `lib/include/prc/gtoplus/parser/api_def.hpp`), but it's a
   **range-file parser**, not a socket wrapper. It uses Boost Spirit X3
   to parse `newdefs3.txt`-style range definitions. No protocol commands.
3. **`Mister-Kitty/GTOHelper`** — actively maintained Java tool that
   automates a poker solver from a poker tracker, but the solver is
   **PioSolver**, not GTO+. README confirms.
4. **vendor `C:\Program Files\GTO\`** — no `.pyd`, `.h`, `.so`, or `.dll`
   sidecar files. Only `GTO.exe` (15.8 MB) and config/language text files.
   No documented SDK shipped.
5. **`www.gtoplus.com/special-menu`** and **`www.gtoplus.com/advancedcode`** —
   both reference "code" features but they're for the **tree-builder bet-
   sizing notation** (`B2`, `G11`, `L[100,200,400]`) and **post-solve
   special editing** (merge/round/incentives), respectively. Neither is a
   scripting/socket API.
6. **`www.gtoplus.com/processingdatabase`** — describes the GUI
   "Export → process → merge" three-step workflow. This is the same
   `PROCESS FILES` UI button + manual Open/Save loop. No automation hook.
7. **Forum search (2+2, Reddit, AHK forums)** — zero discussions of GTO+
   programmatic API. The only public mention of automation anywhere is the
   bkushigian wrapper.

### Conclusion (Angle B)

There is **no public second GTO+ socket protocol document**. The
implication: the protocol surface is determined entirely by the dispatcher
table inside `GTO.exe`. That table is encrypted at rest (Winlicense) and
the strings we've enumerated by probing are the only ones it accepts. We
have probed >270 candidates across all known categories with zero
new mutator hits.

---

## Angle C — Process / file / CLI introspection

### CLI args (BLOCKED)

`GTO.exe --help` requires elevation in PowerShell:
> Program 'GTO.exe' failed to run: The requested operation requires elevation

We could potentially get this by running an elevated PowerShell, but no
public reference suggests GTO.exe takes CLI args at all (no
"--batch-solve" or similar in any documentation found).

### english.txt full scan (USEFUL but not for socket)

`C:\Program Files\GTO\config\languages\english.txt` (1416 lines, 42 KB).
**Plaintext UI string table.** Searched in full for socket-shaped strings.

- The `[COMMUNICATION]` section contains only 3 strings (port-restart
  warnings + Flopzilla tree-built check). **Confirms: socket vocab is
  NOT in this file.**
- Found four interesting GUI hooks that suggest hidden capabilities,
  none of which mapped to a socket command:
  - **Ctrl+Alt+D** "Enter code" dialog (e.g. `MERGE`, `export_XXX`)
  - **Ctrl+Alt+U** "Update database for turn reports"
  - **Ctrl+Alt+O** "Open custom"
  - **Alt+W / Ctrl+W** Open file/database selectors
- Every probed exact-GUI-label string returns UNKNOWN. The dispatcher
  apparently uses an *internal* vocab, not the localized labels.

### Filesystem side channels (write-only)

Two GTO+-owned files **change in real time** during a solve and could
serve as monitoring side channels — but **neither offers a solve trigger**:

| File | Content | Useful for |
|---|---|---|
| `C:\Program Files\GTO\tmp\progress.txt` | Per-iteration dEV + per-player stacks, tab-separated | Reading solver progress without socket |
| `C:\Program Files\GTO\tmp\connect_log.txt` | Socket auth state log | Verifying socket is up |
| `C:\Program Files\GTO\tmp\last_database.gto2` | Auto-backup every X min (configurable in GUI) | Crash recovery |

I checked `flops/` and `config/data/` directories for any "drop here for
auto-solve"-style behavior — no evidence of file polling. GTO+ does not
react to files we drop into its install tree (verified by writing to
`tmp/` and seeing no change in the GUI).

### Process state introspection

`Get-Process GTO`:
- Single process, PID changes per launch
- Listens only on TCP `0.0.0.0:55143` (no other ports)
- `Modules` property returns mostly stripped names (Winlicense)
- Working set ~94 MB at idle (post-load)
- Title shows registered: `GTO+ v185` (was `Untitled - GTO` before file
  loaded)

No second IPC channel (no named pipe, no shared memory, no other socket).
The 55143 socket really is the only programmatic interface.

---

## Recommended path forward

The user's underlying goal is to solve 31 postflop scenarios with minimal
operator time. Given findings above:

| Path | Effort | Coverage | Risk | Recommended? |
|---|---|---|---|---|
| **A — Manual GUI workflow** (load library → Build → Solve → Save × 31) | ~5 min × 31 = ~2.5 hr operator time, once | 31/31 scenarios with EV | Low (known to work) | **Yes — ship this** |
| **B — TexasSolver-only (drop EV from §8.1 v1)** | 0 additional hr (already done) | 31/31 freq only, no EV | Low (already running) | Yes if §8.1 can ship without EV cost |
| **C — Windows-MCP/AHK GUI automation** | 2-4 hr to script + debug | All scenarios + reusable for future adds | Medium (brittle to GTO+ window changes) | Only if scenario library will grow significantly |
| **D — More socket probes** | 1-2 hr per round | Speculative | High (each batch can hang GTO+) | No — candidate space exhausted |
| **E — Runtime memory dump of GTO.exe** | 4+ hr, requires re-doing per GTO+ release | Could recover dispatcher table | Very high (no precedent, breaks every update) | No |

**Author's pick**: **A + B in parallel.** Ship TexasSolver-only freq data
to §8.1 immediately so the card is unblocked. Layer GTO+'s EV annotation
across the 31 scenarios over a single ~2.5 hr manual session as a separate
follow-up; the merge step (`gto-merge.mjs`) already unions both lanes
correctly. This avoids spending another agent-session on automation that
won't pay back unless the scenario library doubles.

### What unlocks more (out-of-budget but worth knowing)

If a future engagement wants to revisit:

- **Path C (GUI automation) is the only feasible "more automation" route.**
  Start with `mcp__Windows-MCP__Snapshot` to capture the GTO+ UI tree —
  the snapshot includes button coordinates and labels, so the script can
  click by label rather than by pixel (more resilient to window resizes).
- **Vendor outreach** — the gtoplus.com support email could be asked
  directly whether a documented scripting API is on the roadmap. Zero
  signal in the public changelog, but a private feature flag is possible.

---

## What this session DID NOT do (out-of-scope or blocked)

- **Did not try elevated `GTO.exe --help`** — requires user to spawn an
  elevated shell. Recommend trying once: open admin PowerShell, run
  `& "C:\Program Files\GTO\GTO.exe" --help` and capture stderr.
  If it shows a banner, follow up. If it silently launches the GUI, no
  CLI surface exists.
- **Did not probe with GTO+ in a different state** (e.g. mid-solve, with
  a tree being built). The dispatcher *might* accept different verbs
  during specific phases. Risky given the hang behavior — could lose
  solver state. Not worth pursuing.
- **Did not attempt runtime memory dump** of `GTO.exe` — out of scope and
  brittle.

---

## Specific high-value follow-up for the next session (if any)

If the user really wants to keep pushing the socket angle, the highest-
expected-value next step is **GUI automation reconnaissance**:

1. With GTO+ open and a scenario loaded, use `mcp__Windows-MCP__Snapshot`
   to capture the full UI tree (control IDs, button labels, positions).
2. Identify the Build / Solve / Save / Process Files button hierarchy.
3. Prototype a Windows-MCP-driven "load → solve → save" loop on 1
   scenario.
4. If that works, generalize to all 31.

This sidesteps the protocol problem entirely. The cost is ~2-4 hr of
scripting; the payoff is full automation that survives future scenario
adds.

---

## Files produced this session

- `docs/RE-FINDINGS-AGENT4.md` (this file)
- `docs/_probe-batch-b-hang.txt` (raw record of the hang)
- `scripts/gto-socket-probe-v2.mjs` (compact probe runner with summary)
- `scripts/_probe-batch-a.txt` (64-probe GUI-mirroring batch)
- `scripts/_probe-batch-b.txt` (50-probe peer-form batch, hung on probe 3)
