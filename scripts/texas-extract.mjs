#!/usr/bin/env node
// texas-extract.mjs — parse TexasSolver JSON dumps into our solver-data
// schema. Reads every <scenario_id>.json in solver-output/texas/ and emits
// solver-output/solver-data-texas.json keyed by scenario_id, matching the
// shape gto-extract.mjs already produces — so gto-merge.mjs reads both lane
// files and unions them per-scenario (GTO+ wins on overlap because it has
// EV and TexasSolver doesn't).
//
// Until v.148 both lanes wrote to a single solver-output/solver-data.json,
// which meant running one lane after the other clobbered the first's data.
// Lane-separated paths let TexasSolver freq + GTO+ EV coexist per
// scenario, which is the practical end-state for the project (TexasSolver
// covers all 31 scenarios cheaply; GTO+ adds EV for the ones the user
// chooses to invest the solve time on).
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
const OUT_FILE = join(REPO_ROOT, "solver-output/solver-data-texas.json");
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
// { hand: { COMBOS, [action]: { FREQ, EV } } } map.
//
// TexasSolver v0.2.0 dump shape (verified empirically on a real solve):
//   node = {
//     actions: ["CHECK", "BET 28.000000"],
//     childrens: { ... },               // typo in upstream — "childrens" not "children"
//     node_type: "action_node",
//     player: 0,                         // 0 = OOP, 1 = IP
//     strategy: {
//       actions: ["CHECK", "BET 28.000000"],
//       strategy: { "2d2c": [0.78, 0.22], "AcKc": [...], ... }   // hand → freq[] per action
//     }
//   }
// NO EV data is included in the dump — only frequencies, so `EV` is null in
// every per-hand entry from this solver.
function normalisePerHand(node) {
  const actions = node.actions || [];
  const stratWrap = node.strategy || node.strategies || node.actions_strategy || null;
  if (!stratWrap) return {};
  // TexasSolver's nested form: stratWrap.strategy holds the hand→freq map.
  // The legacy flat form (some forks): stratWrap IS the hand→freq map. We
  // detect the nested form by checking whether stratWrap.strategy is an
  // object (and not an array — sibling `actions` is an array of strings).
  const strat = (stratWrap.strategy && typeof stratWrap.strategy === "object"
                  && !Array.isArray(stratWrap.strategy))
    ? stratWrap.strategy
    : stratWrap;
  const evs = node.ev || node.evs || node.action_evs || {};
  const weights = node.weights || node.combos || node.range_weights || {};
  const hands = {};
  for (const hand of Object.keys(strat)) {
    if (hand === "actions") continue;     // defensive: skip the sibling sentinel
    const s = strat[hand];
    const e = evs[hand] || null;
    let freqs = null, evList = null;
    if (Array.isArray(s)) { freqs = s; evList = Array.isArray(e) ? e : null; }
    else if (s && typeof s === "object") {
      freqs = s.actions || s.freqs || s.strategy || null;
      evList = s.evs || s.ev || null;
    }
    if (!freqs) continue;
    // Reject array-of-strings (= the sibling actions array, not freqs) —
    // would have produced NaN entries before the nested-form drill above
    // was added.
    if (typeof freqs[0] === "string") continue;
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

// Walk the whole solver tree depth-first, returning EVERY decision node
// keyed by its action-path from the root (e.g. "" for root, "BET 28" for
// root → BET 28, "CHECK.BET 28" for root → CHECK → BET 28). For
// facing-bet scenarios the hero-response node lives at depth ≥1; the
// merge step picks the right depth by matching scenario action shape.
function collectDecisionNodes(dump) {
  const out = [];
  function walk(node, path) {
    if (!node || typeof node !== "object") return;
    const hasActions = Array.isArray(node.actions) && node.actions.length;
    const hasStrategy = node.strategy || node.strategies || node.actions_strategy;
    if (hasActions && hasStrategy) out.push({ path, node });
    if (node.childrens) {
      for (const [edge, child] of Object.entries(node.childrens)) {
        walk(child, path ? path + "." + edge : edge);
      }
    }
  }
  walk(dump, "");
  return out;
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
  // TexasSolver: numeric `player` (0=OOP, 1=IP). Other solvers / older
  // dump formats may use a string ("oop"/"ip") in next_player / next_to_act.
  let nextPlayer = "oop";
  if (typeof node.player === "number") {
    nextPlayer = node.player === 1 ? "ip" : "oop";
  } else if (node.next_player || node.next_to_act) {
    nextPlayer = (node.next_player || node.next_to_act).toString()
      .toLowerCase().includes("ip") ? "ip" : "oop";
  }
  // TexasSolver dumps typically have only the next-to-act side's strategy
  // populated at any given node. The "other" side stays absent at that node.
  const actorHands = normalisePerHand(node);
  const perHand = { [nextPlayer + "_per_hand"]: actorHands };
  perHand[(nextPlayer === "ip" ? "oop" : "ip") + "_per_hand"] = {};
  const heroHand = scen
    ? pickHeroHandStrategy({ oop: perHand.oop_per_hand, ip: perHand.ip_per_hand }, scen)
    : null;

  // Collect every dumped decision node into a `nodes` array keyed by
  // action-path. For typical hero-opens-the-betting scenarios the merge
  // only reads the root (path=""); for facing-bet scenarios (hero
  // responds to villain's bet/raise) it walks to the matching depth.
  const allDecisionNodes = collectDecisionNodes(dump);
  const nodes = allDecisionNodes.map((entry) => {
    const n = entry.node;
    let playerSide = "oop";
    if (typeof n.player === "number") {
      playerSide = n.player === 1 ? "ip" : "oop";
    }
    const hands = normalisePerHand(n);
    return {
      path: entry.path,
      player: playerSide,
      actions: n.actions || [],
      overall_freq: aggregateOverall(hands, n.actions || []),
      hands,                                  // for hero_hand_strategy lookup
    };
  });

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
    // Facing-bet support: every decision node in the dumped tree, keyed
    // by its path from root. The merge step picks the right one based
    // on scenario action shape + hero position.
    nodes,
  };
  parsed++;
  const freqStr = Object.entries(out[id].overall_freq)
    .map(([a, f]) => `${a}=${(f * 100).toFixed(1)}%`).join(", ");
  const nodeStr = nodes.length > 1 ? ` (+${nodes.length - 1} child nodes)` : "";
  console.log(`✅ ${actions.length} actions: ${freqStr || "(no freq aggregation)"}${nodeStr}`);
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
