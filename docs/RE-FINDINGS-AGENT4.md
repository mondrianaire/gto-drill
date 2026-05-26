# Agent 4 (REVIVAL) — RE Findings

**Mission**: Solve binary structures necessary to generate poker ranges and
scenarios for GTO+. Three angles:
- A: Re-probe socket against REGISTERED GTO+ (prior 200-probe was pre-license)
- B: Find other GTO+ Python wrappers / SDKs / vendor SDK files
- C: Process-level / file-level introspection (debug logs, CLI args, manuals)

**Started**: 2026-05-26 (revival agent)
**Hard cap**: 2 hours
**Predecessor context**: agents 1 & 3 went silent. Agent (earlier session)
ran ~200 socket probes against UNREGISTERED GTO+ — all returned
`Instruction unknown.` See `docs/SOLVER-PIPELINE.md` "Socket protocol
surface" section for that summary.

## Status: STARTING

### Inputs confirmed available

- **GTO+ is running, REGISTERED** (process 71340, title `Untitled - GTO`)
- **Socket auth in place** — `tmp/customconnect.txt` exists (8 bytes)
- **`tmp/connect_log.txt`** present — for verifying connection
- **`config/languages/english.txt`** — 42 KB UI string table. **THIS IS THE
  KEY LEAD** — every menu/button/socket command string should be there in
  plaintext (the GTO.exe binary is Winlicense-packed so strings are
  encrypted at rest, but the localization file is **outside** the packed
  region and is plaintext at rest).
- **`config/data/`** trailing-underscore staging files (library_.txt etc.)
  may be a documented "import these" target
- **`tmp/progress.txt`** (621 bytes) — solver progress file written
  externally

### First steps (in order)

1. Grep `english.txt` for known socket commands (`Load file`,
   `Request node data`, `Take action`) — confirms hypothesis
2. If confirmed, extract every short imperative phrase from `english.txt`
   as a new probe-list candidate
3. Re-probe REGISTERED GTO+ socket with that list
4. In parallel: check `GTO.exe --help`, look for command-line args

(Updated incrementally — see commits.)
