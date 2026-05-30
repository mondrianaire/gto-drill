#!/usr/bin/env node
// gto-socket-solve.mjs — INTENDED scaffold for driving an end-to-end GTO+
// solve over the socket interface. Currently BLOCKED — the GTO+ v185 socket
// protocol does not expose configuration / build / solve commands. See the
// "Status" block below and docs/SOLVER-PIPELINE.md for the full report.
//
// What this script would do if the protocol allowed it:
//   1. connect()                             — open TCP + ~init~ handshake
//   2. configure(scenario)                   — Set OOP / IP / board / pot / stack
//   3. buildTree()                           — generate the bet-tree internal indices
//   4. solve(targetDevPct)                   — run CFR until dEV < target
//   5. saveFile(absPath)                     — persist solved .gto2 to disk
//   6. disconnect()
//
// What we empirically confirmed (May 2026, ~200 probes against GTO+ v185):
//   - The only commands GTO+ recognizes are the 9 from the bkushigian/gto- wrapper:
//       init, Load file: <p>, Request node data, Request action data,
//       Request pot/stacks, Request current line, Take action: <n>,
//       Still processing instruction?, plus the "Hand is at start of tree."
//       reply form.
//   - Every other guessed verb ("Set range", "Build tree", "Run solver",
//       "Save file", "Solve", "Iterate", lowercase / snake_case / camelCase
//       variants, "Take" / "Send" / "Apply" / "Change" / "Update" prefixes,
//       GUI-mirroring names) returns "~Instruction unknown.~".
//   - The GTO.exe binary is packed with Winlicense (.winlice / .boot sections),
//       so static string extraction yields nothing — strings are decrypted in
//       memory at runtime.
//
// STATUS: BLOCKED.
//
// The socket interface is READ-ONLY. There is no public mutation API for
// configuration, tree-building, or solving. To unblock this approach we would
// need either:
//   (a) The GTO+ vendor to expose configuration commands in a future release,
//   (b) A leaked / unofficial command list (none found in public sources), or
//   (c) Runtime memory probing of GTO.exe to recover the dispatcher string
//       table — out of scope and brittle against vendor updates.
//
// FALLBACK OPTIONS (the actual paths forward):
//
//   A. Manual GUI workflow (slow, what the user is doing today)
//      Operator configures each scenario in the GUI, clicks Build, Solve,
//      Save. Already works; bottleneck is human time.
//
//   B. Computer-use / AutoHotkey GUI automation
//      Script the GUI clicks. Brittle to window layout, but doesn't depend
//      on undocumented protocols. Could realistically drive 45 scenarios
//      unattended overnight given GTO+ window stability.
//
//   C. Pastepack workflow (already shipped — scripts/gto-pastepack.mjs)
//      Operator opens each scenario in GTO+ once, copies range/board/pot/stack
//      from the rendered .gtopaste.txt files. Probably the fastest hybrid.
//
//   D. Switch to a solver with a real scripting API (PioSolver, TexasSolver,
//      Wasabi) and use GTO+ only for the human-facing artifacts. The
//      texas-solve / texas-extract scripts in this repo already do this for
//      the FREQ lane.
//
// Recommendation: combine C (pastepack for setup speed) with B (AHK macro for
// "Build → Solve → Save" once configured) to cut per-scenario operator time
// from ~4 minutes to ~30 seconds. This script is left in place as
// documentation of why the socket path is closed and what was tried.

import net from "node:net";

const PORT = 55143;
const HOST = "localhost";

console.error(`
gto-socket-solve.mjs is currently a BLOCKED scaffold.

The GTO+ v185 socket protocol does not expose the commands needed for
end-to-end scenario solving (Set range / Build tree / Run solver / Save).
~200 empirical probes against the running socket all returned "Instruction
unknown." See the comment block at the top of this file for the full
findings, and docs/SOLVER-PIPELINE.md for the recommended fallback workflow.

Exiting without action.
`);
process.exit(2);
