#!/usr/bin/env node
// texas-batch-generate.mjs — generate one TexasSolver .txt config per scenario.
//
// Iterates data/scenarios.json, calls buildSolverConfig() (from src/replay.js)
// for every postflop scenario, and writes the resulting console-config text
// to solver-input/texas/<scenario_id>.txt. Hero range is auto-filled by
// buildSolverConfig from deriveRanges() + the canonicalizer; villain range
// comes from authored scen.villain_ranges[] or falls back to derived.
//
// Companion scripts:
//   - texas-batch-solve.mjs   — runs console_solver.exe on each .txt
//   - texas-extract.mjs       — parses TexasSolver JSON dumps
//   - gto-merge.mjs           — merges solver-data.json into scenarios.json
//
// Usage:
//   node scripts/texas-batch-generate.mjs              # all postflop scenarios
//   node scripts/texas-batch-generate.mjs <scenario_id>  # one scenario

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSolverConfig } from "../src/replay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));
const OUT_DIR = join(REPO_ROOT, "solver-input/texas");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const filter = process.argv[2];
const targets = filter
  ? SCENARIOS.filter((s) => s.scenario_id === filter)
  : SCENARIOS;
if (filter && !targets.length) {
  console.error("Scenario not found: " + filter);
  process.exit(1);
}

console.log(`Generating ${targets.length} TexasSolver config(s) → ${OUT_DIR}/\n`);

let written = 0, skipped = 0;
const failures = [];

for (const scen of targets) {
  const id = scen.scenario_id;
  const cfg = buildSolverConfig(scen);

  if (!cfg) {
    skipped++;
    console.log(`  ⏭  ${id.padEnd(50)} preflop / no-board — nothing to solve`);
    continue;
  }

  // Quality check on the generated config — flag placeholders the user
  // would need to fill in by hand before the solver will accept it.
  const issues = [];
  if (cfg.includes("PASTE_HERO_RANGE_HERE")) {
    issues.push("hero range unresolved (deriveRanges fallback edge case)");
  }
  if (cfg.includes("PASTE_VILLAIN_RANGE_HERE")) {
    issues.push("villain range unresolved (no authored or derived range)");
  }

  const outPath = join(OUT_DIR, id + ".txt");
  try {
    writeFileSync(outPath, cfg);
    written++;
    if (issues.length) {
      console.log(`  ⚠  ${id.padEnd(50)} written, BUT: ${issues.join("; ")}`);
    } else {
      // Extract the leading set_pot / set_effective_stack / set_board lines
      // for a tight per-line summary.
      const head = cfg.split("\n").slice(0, 3).join(" | ");
      console.log(`  ✅ ${id.padEnd(50)} ${head}`);
    }
  } catch (err) {
    failures.push({ id, error: err.message });
    console.log(`  ❌ ${id.padEnd(50)} write failed: ${err.message}`);
  }
}

console.log("");
console.log(`✅ Wrote ${written} .txt config(s)`);
if (skipped) console.log(`⏭  Skipped ${skipped} preflop / no-board scenario(s)`);
if (failures.length) {
  console.log(`❌ ${failures.length} write failure(s):`);
  for (const f of failures) console.log(`     ${f.id}: ${f.error}`);
}
console.log("");
console.log("Next: node scripts/texas-batch-solve.mjs");
