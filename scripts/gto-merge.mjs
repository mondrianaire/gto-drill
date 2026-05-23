#!/usr/bin/env node
// gto-merge.mjs — solver-agnostic merge step. Reads solver-output/
// solver-data.json (regardless of whether GTO+ or TexasSolver produced it)
// and writes a `solver_data` field onto each matching scenario in
// data/scenarios.json. The §8.1 GTO Summary Card reads this field directly.
//
// What gets added per scenario:
//   solver_data: {
//     source: "TexasSolver" | "GTO+",     (best-effort detection)
//     hero_hand: "AcQc",                   (the scenario's dealt hand)
//     solver_actions: [...],               (raw action labels from solver)
//     hero_strategy: [{solver_action, freq, ev}],
//     options: {                           (mapped to scenario.available_actions)
//       "<scenario action>": { freq, ev, ev_cost }
//     },
//     best_solver_action: "...",
//     best_scenario_action: "..." | null,  (matched if mapping found one)
//     solved_at: "YYYY-MM-DD"
//   }
//
// Existing fields are preserved verbatim. The script writes a single
// data/scenarios.json.backup before touching the file, so a bad merge is
// always recoverable with `mv data/scenarios.json.backup data/scenarios.json`.
//
// Usage:
//   node scripts/gto-merge.mjs                 # merge everything in solver-data.json
//   node scripts/gto-merge.mjs --dry-run       # show what would change, write nothing
//   node scripts/gto-merge.mjs <scenario_id>   # one scenario

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIOS_PATH = join(REPO_ROOT, "data/scenarios.json");
const SOLVER_DATA_PATH = join(REPO_ROOT, "solver-output/solver-data.json");
const BACKUP_PATH = join(REPO_ROOT, "data/scenarios.json.backup");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const filter = args.find((a) => !a.startsWith("--")) || null;

if (!existsSync(SOLVER_DATA_PATH)) {
  console.error("❌ No solver-data.json at " + SOLVER_DATA_PATH);
  console.error("   Run texas-extract.mjs (TexasSolver lane) or gto-extract.mjs (GTO+ lane).");
  process.exit(1);
}

const SCENARIOS = JSON.parse(readFileSync(SCENARIOS_PATH, "utf8"));
const SOLVER_DATA = JSON.parse(readFileSync(SOLVER_DATA_PATH, "utf8"));

// ===== Source detection =====
// GTO+'s extractor produces actions like "Bet 9.25" / "Check" — title-cased
// with bb-units in the bet size. TexasSolver's emit "BET 92" / "CHECK" —
// uppercase, with chip-units (bb × 10). Pretty easy tell.
function detectSource(solverData) {
  const sample = Object.values(solverData).find((s) => Array.isArray(s.actions));
  if (!sample) return "unknown";
  const action = (sample.actions[0] || "").toString();
  if (/^[A-Z]+(\s|$)/.test(action)) return "TexasSolver";
  if (/^[A-Z][a-z]/.test(action)) return "GTO+";
  return "unknown";
}
const SOURCE = detectSource(SOLVER_DATA);

// ===== Action mapping =====
// Solver labels and scenario action labels both encode "what you do" plus
// a sizing. Normalise both into a comparable shape:
//   { type: "fold"|"check"|"call"|"bet"|"raise", chips?: <integer in same units> }
// A scenario action like "Bet 2bb (~35%)" → { type: "bet", chips: 20 } (bb×10).
// A solver action like "BET 20"           → { type: "bet", chips: 20 } (TS).
// A GTO+ action  like "Bet 9.25"          → { type: "bet", chips: 925 } (bb×100).
// Different unit conventions are normalised separately, so equality is by
// (type, chips-converted-to-same-base) after detection.

function parseAction(label, sourceHint) {
  const s = (label || "").toString().trim();
  if (!s) return { raw: s, type: null };
  const low = s.toLowerCase();
  if (/^fold/.test(low)) return { raw: s, type: "fold" };
  if (/^(check|x\b)/.test(low)) return { raw: s, type: "check" };
  // Find first numeric (bet/raise/call size). Bare integers in TexasSolver
  // ("BET 20") are bb*10; in GTO+ ("Bet 9.25") are floats in bb; in scenario
  // labels ("Bet 2bb", "Raise to 9bb") are floats in bb.
  const numMatch = s.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) {
    if (/raise|call|bet/.test(low)) return { raw: s, type: low.includes("raise") ? "raise" : low.includes("call") ? "call" : "bet" };
    return { raw: s, type: null };
  }
  const num = parseFloat(numMatch[1]);
  let bb = num;
  // TexasSolver source: bare integer is bb*10 (chip units we wrote in the
  // config). Scenario labels usually carry an explicit "bb" unit.
  if (sourceHint === "TexasSolver" && !/bb/i.test(s) && Number.isInteger(num)) {
    bb = num / 10;
  }
  let type = "bet";
  if (/raise/.test(low)) type = "raise";
  else if (/call/.test(low)) type = "call";
  else if (/bet/.test(low)) type = "bet";
  return { raw: s, type, bb };
}

// Compute a fuzzy match score between two parsed actions. 0 = identical,
// higher = worse. Returns Infinity for "no chance."
function matchScore(a, b) {
  if (!a.type || !b.type) return Infinity;
  if (a.type === b.type) {
    if (a.bb == null || b.bb == null) return 0.5;     // same type, unknown size — soft match
    return Math.abs(a.bb - b.bb);                      // same type, score by size delta in bb
  }
  // Cross-type matches: scenario "Call" can match solver "RAISE"-flavored
  // actions if the sizes line up (e.g., facing a min-raise).
  if ((a.type === "bet" && b.type === "raise") ||
      (a.type === "raise" && b.type === "bet") ||
      (a.type === "call" && (b.type === "bet" || b.type === "raise")) ||
      ((a.type === "bet" || a.type === "raise") && b.type === "call")) {
    if (a.bb == null || b.bb == null) return 5;
    return Math.abs(a.bb - b.bb) + 2;                  // size-aware but penalised
  }
  return Infinity;
}

function mapSolverToScenario(scenarioActions, solverActions, sourceHint) {
  const parsedScen = scenarioActions.map((a) => parseAction(a, "scenario"));
  const parsedSolv = solverActions.map((a) => parseAction(a, sourceHint));
  const mapping = {};       // scenarioActionLabel → solverActionLabel
  for (let i = 0; i < parsedScen.length; i++) {
    let best = { idx: -1, score: Infinity };
    for (let j = 0; j < parsedSolv.length; j++) {
      const sc = matchScore(parsedScen[i], parsedSolv[j]);
      if (sc < best.score) best = { idx: j, score: sc };
    }
    if (best.idx >= 0 && best.score < 3) {
      mapping[scenarioActions[i]] = solverActions[best.idx];
    }
  }
  return mapping;
}

// ===== Per-scenario merge =====
function mergeOne(scen, solverEntry) {
  if (!solverEntry || solverEntry.error || !solverEntry.actions) {
    return { skipped: true, reason: solverEntry?.error || "no solver data" };
  }
  const actions = solverEntry.actions;
  const heroStrat = solverEntry.hero_hand_strategy;
  const dealt = (scen.replay?.hero_cards || []).join("");

  // Hero strategy array. If hero_hand_strategy is absent (extractor couldn't
  // find hero's hand in either player block), fall back to overall_freq with
  // nulls for EV.
  const heroStrategy = [];
  let maxEv = -Infinity;
  for (const a of actions) {
    let freq = 0, ev = null;
    if (heroStrat && heroStrat[a]) {
      freq = (heroStrat[a].FREQ || 0) / 100;
      ev = heroStrat[a].EV;
    } else if (solverEntry.overall_freq && solverEntry.overall_freq[a] != null) {
      freq = solverEntry.overall_freq[a];
    }
    if (ev != null && ev > maxEv) maxEv = ev;
    heroStrategy.push({ solver_action: a, freq, ev });
  }

  // Map solver actions back to scenario.available_actions.
  const mapping = mapSolverToScenario(
    scen.available_actions || [],
    actions,
    SOURCE,
  );

  const options = {};
  for (const scenAction of (scen.available_actions || [])) {
    const solverLabel = mapping[scenAction];
    if (!solverLabel) {
      options[scenAction] = { freq: null, ev: null, ev_cost: null, unmatched: true };
      continue;
    }
    const idx = actions.indexOf(solverLabel);
    const row = heroStrategy[idx];
    const ev_cost = (row.ev != null && maxEv > -Infinity) ? Number((maxEv - row.ev).toFixed(3)) : null;
    options[scenAction] = {
      freq: Number((row.freq || 0).toFixed(3)),
      ev: row.ev != null ? Number(row.ev.toFixed(3)) : null,
      ev_cost,
    };
  }

  let bestSolver = null;
  let bestEv = -Infinity;
  for (const r of heroStrategy) {
    if (r.ev != null && r.ev > bestEv) { bestEv = r.ev; bestSolver = r.solver_action; }
  }
  let bestScen = null;
  for (const [scenAction, solverLabel] of Object.entries(mapping)) {
    if (solverLabel === bestSolver) { bestScen = scenAction; break; }
  }

  return {
    merged: {
      source: SOURCE,
      hero_hand: dealt || null,
      solver_actions: actions,
      hero_strategy: heroStrategy.map((r) => ({
        solver_action: r.solver_action,
        freq: Number((r.freq || 0).toFixed(3)),
        ev: r.ev != null ? Number(r.ev.toFixed(3)) : null,
      })),
      options,
      best_solver_action: bestSolver,
      best_scenario_action: bestScen,
      solved_at: new Date().toISOString().slice(0, 10),
    },
  };
}

// ===== Main =====
const targets = filter
  ? SCENARIOS.filter((s) => s.scenario_id === filter)
  : SCENARIOS;

console.log(`Merging solver data (source detected: ${SOURCE}) into ${targets.length} scenario(s)\n`);

let merged = 0, skipped = 0, unmatched = 0;
const unmatchedReports = [];

for (const scen of targets) {
  const solverEntry = SOLVER_DATA[scen.scenario_id];
  const r = mergeOne(scen, solverEntry);
  if (r.skipped) {
    skipped++;
    console.log(`  ⏭  ${scen.scenario_id.padEnd(50)} ${r.reason}`);
    continue;
  }
  scen.solver_data = r.merged;
  merged++;
  const optionStrs = Object.entries(r.merged.options).map(([k, v]) =>
    `${k}=${v.freq != null ? (v.freq * 100).toFixed(0) + "%" : "?"}`,
  ).join(", ");
  const optionUnmatched = Object.values(r.merged.options).filter((o) => o.unmatched).length;
  if (optionUnmatched) {
    unmatched += optionUnmatched;
    unmatchedReports.push({ id: scen.scenario_id, count: optionUnmatched });
  }
  console.log(`  ✅ ${scen.scenario_id.padEnd(50)} ${optionStrs}${optionUnmatched ? " ⚠" + optionUnmatched + "_unmatched" : ""}`);
}

if (!DRY_RUN && merged > 0) {
  copyFileSync(SCENARIOS_PATH, BACKUP_PATH);
  writeFileSync(SCENARIOS_PATH, JSON.stringify(SCENARIOS, null, 2) + "\n");
  console.log("");
  console.log(`✅ Wrote ${merged} solver_data block(s) to ${SCENARIOS_PATH}`);
  console.log(`   Backup at ${BACKUP_PATH}`);
} else if (DRY_RUN) {
  console.log("");
  console.log(`(dry run — no files written; ${merged} scenarios would merge)`);
}

console.log("");
console.log("─".repeat(70));
console.log(`  ✅ merged:     ${merged}/${targets.length}`);
console.log(`  ⏭  skipped:    ${skipped} (no solver data)`);
if (unmatched) {
  console.log(`  ⚠  unmatched options across scenarios: ${unmatched}`);
  for (const u of unmatchedReports.slice(0, 10)) console.log(`        ${u.id}: ${u.count} unmatched`);
  if (unmatchedReports.length > 10) console.log(`        ...+${unmatchedReports.length - 10} more`);
}

process.exit(0);
