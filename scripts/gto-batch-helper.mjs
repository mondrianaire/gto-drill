#!/usr/bin/env node
// gto-batch-helper.mjs — walk the user through the manual GTO+ Build/Save loop
//
// Once the library.txt has 31 scenario entries, the user needs to:
//   1. Open GTO+ → Quickload (folder icon, left panel)
//   2. For each scenario:
//      a. Click the scenario-<scenario_id> entry
//      b. Click LOAD SELECTED TREE
//      c. Close the Quickload dialog
//      d. Click Build Tree (left panel, big blue button)
//      e. File → Save As → solver-output/<scenario_id>.gto2
//      f. (Optional) Click Run Solver to start solving immediately,
//         OR leave unsolved and rely on PROCESS FILES later
//
// This script reduces friction:
//   - Walks scenarios one at a time
//   - Writes the correct filename to the clipboard for paste-in
//   - Prints a clear per-scenario checklist
//   - Tracks progress (% complete, ETA)
//
// Goal: cut the user's cognitive load to ~2 clicks per scenario instead of
// remembering scenario_ids and typing filenames.

import { readFileSync } from "fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));
const OUT_DIR = "C:\\Users\\mondr\\Documents\\Claude\\Projects\\gto-poker-async-duel-AB\\.claude\\worktrees\\gifted-greider-5f4629\\solver-output";

// Filter for postflop scenarios — these are the ones that have library entries
function isPostflop(s) {
  const r = s.replay;
  if (!r || !r.board) return false;
  const b = [].concat(r.board.flop || []).concat(r.board.turn || []).concat(r.board.river || []);
  return b.length >= 3;
}

// Skip preflop + scenarios missing ranges
const postflop = SCENARIOS.filter(isPostflop);

// Set the system clipboard (Windows)
function setClipboard(text) {
  try {
    // Use PowerShell — most reliable on Windows
    const escaped = text.replace(/'/g, "''");
    execSync(`powershell -Command "Set-Clipboard -Value '${escaped}'"`, { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function prompt(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  console.log("");
  console.log("==================================================================");
  console.log("  GTO+ BATCH HELPER — Build/Save loop walker");
  console.log("==================================================================");
  console.log("");
  console.log("  Total scenarios to process: " + postflop.length);
  console.log("  Target directory:           " + OUT_DIR);
  console.log("");
  console.log("  Pre-flight:");
  console.log("    1. GTO+ open ✓");
  console.log("    2. library.txt is in C:\\Program Files\\GTO\\config\\ (copied via UAC) ✓");
  console.log("    3. Quickload dialog open ✓");
  console.log("");
  await prompt("  Press Enter when ready to start the loop > ");
  console.log("");

  const startTime = Date.now();
  for (let i = 0; i < postflop.length; i++) {
    const s = postflop[i];
    const entryName = "scenario-" + s.scenario_id;
    const filename = s.scenario_id + ".gto2";

    // Compute ETA
    const elapsed = (Date.now() - startTime) / 1000;
    const avgPerScenario = i > 0 ? elapsed / i : 0;
    const remaining = avgPerScenario * (postflop.length - i);
    const etaStr = i > 0 ? "   ETA " + Math.ceil(remaining / 60) + " min" : "";

    // Write filename to clipboard for the Save As dialog
    const clipOk = setClipboard(filename);

    console.log("");
    console.log("──────────────────────────────────────────────────────────────────");
    console.log("  [" + (i + 1) + "/" + postflop.length + "]  " + s.scenario_id + etaStr);
    console.log("──────────────────────────────────────────────────────────────────");
    console.log("");
    console.log("  Clipboard: " + filename + "  " + (clipOk ? "✓" : "(paste manually)"));
    console.log("");
    console.log("  Click in GTO+:");
    console.log("    1. Quickload → find entry → '" + entryName + "'");
    console.log("    2. LOAD SELECTED TREE");
    console.log("    3. Close Quickload dialog");
    console.log("    4. Build Tree button (left panel)");
    console.log("    5. File → Save As");
    console.log("    6. Navigate to " + OUT_DIR);
    console.log("    7. Paste filename (Ctrl+V) → already on clipboard");
    console.log("    8. Save");
    console.log("    9. (skip Solve — PROCESS FILES handles that later)");
    console.log("");
    const ans = await prompt("  Done with this scenario? [Enter to continue / s to skip / q to quit] > ");
    if (ans.trim().toLowerCase() === "q") {
      console.log("");
      console.log("Stopped at scenario " + (i + 1) + "/" + postflop.length);
      console.log("Re-run to resume from where you left off (manual; no state persisted yet).");
      break;
    }
    if (ans.trim().toLowerCase() === "s") {
      console.log("  Skipped.");
    }
  }

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log("");
  console.log("==================================================================");
  console.log("  DONE — " + postflop.length + " scenarios in " + totalMin + " min");
  console.log("==================================================================");
  console.log("");
  console.log("  Next: open GTO+'s PROCESS FILES dialog");
  console.log("    Target: " + OUT_DIR);
  console.log("    Toggle OFF 'Move processed files to subdirectory'");
  console.log("    Click PROCESS FILES → unattended batch solve (hours)");
  console.log("");
  console.log("  When all .gto2 files have solved data (>20 KB each):");
  console.log("    node scripts/gto-extract.mjs");
  console.log("    node scripts/gto-merge.mjs");
  console.log("    M5 card EV chip lights up ✓");
  console.log("");
  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
