#!/usr/bin/env node
// texas-extract.mjs — parse TexasSolver JSON dumps into our solver-data.json
// schema. Reads every <scenario_id>.json in solver-output/texas/ and emits
// solver-output/solver-data.json keyed by scenario_id, matching the shape
// gto-extract.mjs already produces — so gto-merge.mjs runs against either
// solver's output unchanged.
//
// Target schema per scenario:
//   {
//     board: ["Kh", "7d", "2s"],
//     actions: ["BET 12.5", "CHECK"],
//     next_to_act: "oop" | "ip",
//     overall_freq: { "BET 12.5": 0.78, "CHECK": 0.22 },     // combo-weighted
//     oop_per_hand: { "AsAc": { COMBOS, EQUITY?, "BET 12.5": {FREQ, EV}, ... } },
//     ip_per_hand:  { ... },
//     hero_hand_strategy: { hand, side, COMBOS, EQUITY?, <action>: {FREQ, EV} }
//   }
//
// TexasSolver's dump format isn't fully standardised across releases; this
// script tries the common shapes and falls back to a "raw passthrough" so
// the file is at least preserved if the parser doesn't recognise something.
// The merge step (gto-merge.mjs) only consumes hero_hand_strategy + overall_freq,
// so we can refine the parser later without re-solving.
//
// Usage:
//   node scripts/texas-extract.mjs

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DUMP_DIR = join(REPO_ROOT, "solver-output/texas");
const OUT_FILE = join(REPO_ROOT, "solver-output/solver-data.json");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));

if (!existsSync(DUMP_DIR)) {
  console.error("❌ No TexasSolver dumps directory at " + DUMP_DIR);
  console.error("   Run texas-batch-solve.mjs first.");
  process.exit(1);
}

const files = readdirSync(DUMP_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("solve-report"));
if (!files.length) {
  console.error(`❌ No .json dumps in ${DUMP_DIR}.`);
  process.exit(1);
}

console.log(`Extracting ${files.length} dump(s) from ${DUMP_DIR}/`);

// ----- Parser helpers -----

// Find the first decision node in a dump tree. TexasSolver typically wraps
// the strategy under a node with `player` / `actions` / `strategy` keys, but
// the exact path varies by release. We walk depth-first, returning the first
// node that has BOTH an `actions` array AND a strategy/weights mapping.
function findRootDecisionNode(obj) {
  if (!obj || typeof obj !== "object") return null;
  const hasActions = Array.isArray(obj.actions) && obj.actions.length;
  const hasStrategy = obj.strategy || obj.strategies || obj.actions_strategy;
  if (hasActions && hasStrategy) return obj;
  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (child && typeof child === "object") {
      const hit = findRootDecisionNode(child);
      if (hit) return hit;
    }
  }
  return null;
}

// Coerce TexasSolver's per-hand strategy into a normalised
// { hand: { COMBOS, [action]: { FREQ, EV } } } map. Handles two common
// shapes:
//   strategy = { "AsAh": [0.78, 0.22], ... }
//   strategy = { "AsAh": { actions: [0.78, 0.22], evs: [12.5, 5.0] }, ... }
// COMBOS / weights pulled from sibling `weights` / `combos` / `range` maps.
function normalisePerHand(node) {
  const actions = node.actions || [];
  const strat = node.strategy || node.strategies || node.actions_strategy || {};
  const evs = node.ev || node.evs || node.action_evs || {};
  const weights = node.weights || node.combos || node.range_weights || {};
  const hands = {};
  for (const hand of Object.keys(strat)) {
    const s = strat[hand];
    const e = evs[hand] || null;
    let freqs = null, evList = null;
    if (Array.isArray(s)) { freqs = s; evList = Array.isArray(e) ? e : null; }
    else if (s && typeof s === "object") {
      freqs = s.actions || s.freqs || s.strategy || null;
      evList = s.evs || s.ev || null;
    }
    if (!freqs) continue;
    const entry = { COMBOS: weights[hand] || 1.0 };
    for (let i = 0; i < actions.length; i++) {
      entry[actions[i]] = {
        FREQ: freqs[i] != null ? freqs[i] * 100 : null,
        EV: evList && evList[i] != null ? evList[i] : null,
      };
    }
    hands[hand] = entry;
  }
  return hands;
}

// Combo-weighted overall frequency per action.
function aggregateOverall(hands, actions) {
  const total = Object.values(hands).reduce((s, h) => s + (h.COMBOS || 0), 0);
  if (!total) return {};
  const out = {};
  for (const act of actions) {
    let w = 0;
    for (const h of Object.values(hands)) {
      const f = h[act] && h[act].FREQ != null ? h[act].FREQ / 100 : 0;
      w += (h.COMBOS || 0) * f;
    }
    out[act] = Math.round((w / total) * 1000) / 1000;   // sum ≈ 1.000
  }
  return out;
}

function pickHeroHandStrategy(perHandByPlayer, scen) {
  const dealt = (scen.replay?.hero_cards || []).join("");
  if (!dealt) return null;
  for (const [side, hands] of Object.entries(perHandByPlayer)) {
    if (hands[dealt]) return { hand: dealt, side, ...hands[dealt] };
  }
  return null;
}

// ----- Main loop -----

const out = {};
let parsed = 0, raw = 0, errored = 0;

for (const f of files) {
  const id = basename(f, ".json");
  const fullPath = join(DUMP_DIR, f);
  process.stdout.write(`  ${id.padEnd(50)} `);
  let dump;
  try {
    dump = JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (e) {
    errored++;
    console.log(`❌ parse error: ${e.message}`);
    out[id] = { error: "json-parse: " + e.message };
    continue;
  }

  const scen = SCENARIOS.find((s) => s.scenario_id === id);
  const node = findRootDecisionNode(dump);
  if (!node) {
    // Couldn't find a decision node — preserve the raw dump key paths so we
    // can refine the parser later, but mark as un-extracted.
    raw++;
    out[id] = {
      error: "no-decision-node",
      dump_top_keys: Object.keys(dump).slice(0, 10),
    };
    console.log(`⚠  raw — no decision node found at top of dump`);
    continue;
  }

  const actions = node.actions || [];
  const nextPlayer = (node.player || node.next_player || node.next_to_act || "")
    .toString().toLowerCase().includes("ip") ? "ip" : "oop";
  // TexasSolver dumps typically have only the next-to-act side's strategy
  // populated at the root node. The "other" side stays absent.
  const actorHands = normalisePerHand(node);
  const perHand = { [nextPlayer + "_per_hand"]: actorHands };
  perHand[(nextPlayer === "ip" ? "oop" : "ip") + "_per_hand"] = {};
  const heroHand = scen
    ? pickHeroHandStrategy({ oop: perHand.oop_per_hand, ip: perHand.ip_per_hand }, scen)
    : null;

  out[id] = {
    board: node.board || (scen && [].concat(
      scen.replay?.board?.flop || [],
      scen.replay?.board?.turn || [],
      scen.replay?.board?.river || []
    )) || [],
    actions,
    next_to_act: nextPlayer,
    overall_freq: aggregateOverall(actorHands, actions),
    oop_per_hand: perHand.oop_per_hand,
    ip_per_hand: perHand.ip_per_hand,
    hero_hand_strategy: heroHand,
  };
  parsed++;
  const freqStr = Object.entries(out[id].overall_freq)
    .map(([a, f]) => `${a}=${(f * 100).toFixed(1)}%`).join(", ");
  console.log(`✅ ${actions.length} actions: ${freqStr || "(no freq aggregation)"}`);
}

writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

console.log("");
console.log("─".repeat(70));
console.log(`  ✅ parsed:      ${parsed}/${files.length}`);
if (raw)     console.log(`  ⚠  raw passthrough: ${raw}`);
if (errored) console.log(`  ❌ errored:     ${errored}`);
console.log(`\n  Wrote ${OUT_FILE}`);
console.log("");
console.log("Next: node scripts/gto-merge.mjs");
process.exit(errored ? 1 : 0);
