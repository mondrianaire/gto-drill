#!/usr/bin/env node
// gto-pastepack.mjs — generate per-scenario GTO+ setup sheets.
//
// Reads data/scenarios.json, calls deriveRanges() for each, writes one .txt per
// scenario into solver-input/<scenario_id>.gtopaste.txt. Each sheet contains all
// the values needed to set up the scenario in GTO+'s "Run solver" dialog:
// hero range, villain range, board, pot, effective stack, dealt hand for reference.
//
// Hero range: always chart-derived (76% of scenarios) with dealt-hand fallback.
// Villain range: prefers scenarios.json's authored villain_ranges[0] (which carries
// postflop narrowing for postflop spots), else falls back to chart-derived preflop
// range.
//
// Usage:
//   node scripts/gto-pastepack.mjs              # all 45 scenarios
//   node scripts/gto-pastepack.mjs scenario_id  # one scenario

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRanges } from "../src/preflop-ranges.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));
const OUT_DIR = join(REPO_ROOT, "solver-input");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// Decision-point reducer — mirrors the one in src/replay.js but trimmed.
function decisionState(replay) {
  const seats = {};
  for (const s of replay.seats) seats[s.pos] = { stack: s.stack_bb, street: 0 };
  let pot = replay.starting_pot_bb || 0;
  let cur = "preflop";
  for (const a of replay.actions || []) {
    if (a.street !== cur) {
      for (const p of Object.values(seats)) { pot += p.street; p.street = 0; }
      cur = a.street;
    }
    const seat = seats[a.actor]; if (!seat) continue;
    if (a.type === "bet" || a.type === "raise" || a.type === "call") {
      const add = (a.amount_bb || 0) - seat.street;
      seat.street += add; seat.stack -= add;
    } else if (a.type === "post") {
      seat.street += a.amount_bb || 0; seat.stack -= a.amount_bb || 0;
    }
  }
  const livePot = pot + Object.values(seats).reduce((s, p) => s + p.street, 0);
  const heroStack = (seats[replay.hero_seat] && seats[replay.hero_seat].stack) || 100;
  let villStack = heroStack;
  for (const [pos, s] of Object.entries(seats)) {
    if (pos !== replay.hero_seat && s.stack > 0) villStack = Math.min(villStack, s.stack);
  }
  return { potBb: livePot, effStackBb: Math.min(heroStack, villStack) };
}

const ORDER = ["SB", "BB", "UTG", "UTG1", "UTG2", "MP", "LJ", "HJ", "CO", "BTN"];
function rank(p) { const i = ORDER.indexOf(p); return i < 0 ? 99 : i; }
function heroIsIP(scen) {
  const r = scen.replay;
  if (!r) return true;
  const villains = (r.seats || []).map(s => s.pos).filter(p => p !== r.hero_seat);
  if (!villains.length) return true;
  return rank(r.hero_seat) > Math.min(...villains.map(rank));
}

function buildPastePack(scen) {
  const replay = scen.replay;
  if (!replay) return null;

  const derived = deriveRanges(scen);
  const heroRange = derived.hero_range;
  // Prefer authored villain range when present (postflop narrowing); else use derived.
  const authoredVill = (scen.villain_ranges && scen.villain_ranges[0]) || null;
  const villRange = authoredVill && authoredVill.classes && authoredVill.classes.length
    ? { ...authoredVill, source: "scenarios.json authored" }
    : derived.villain_range;

  const board = []
    .concat(replay.board?.flop || [])
    .concat(replay.board?.turn || [])
    .concat(replay.board?.river || []);

  const ds = decisionState(replay);
  const ip = heroIsIP(scen);
  const dealt = (replay.hero_cards || []).join("");

  const lastAction = replay.actions && replay.actions.length
    ? replay.actions[replay.actions.length - 1] : null;
  const actionText = lastAction
    ? `${lastAction.actor} ${lastAction.type}${lastAction.amount_bb ? " " + lastAction.amount_bb + "bb" : ""}`
    : "(no action yet — preflop spot)";

  const lines = [];
  lines.push(`=== GTO+ SETUP — ${scen.scenario_id} ===`);
  lines.push("");
  lines.push("## Paste into GTO+ \"Run solver\" dialog:");
  lines.push("");
  lines.push("### Board");
  lines.push(`    ${board.length ? board.join(" ") : "(no board — preflop spot)"}`);
  lines.push("");
  lines.push("### Pot (big blinds)");
  lines.push(`    ${ds.potBb}`);
  lines.push("");
  lines.push("### Effective stack (big blinds)");
  lines.push(`    ${ds.effStackBb}`);
  lines.push("");
  lines.push(`### ${ip ? "IP (in-position)" : "OOP (out-of-position)"} range — HERO`);
  if (heroRange) {
    lines.push(`    ${heroRange.classes.join(",")}`);
    lines.push("");
    lines.push(`    [source: ${heroRange.source}${heroRange.label ? " — " + heroRange.label : ""}]`);
  } else {
    lines.push(`    PASTE_HERO_RANGE_HERE  ← no chart available + no dealt hand`);
  }
  lines.push("");
  lines.push(`### ${ip ? "OOP (out-of-position)" : "IP (in-position)"} range — VILLAIN`);
  if (villRange) {
    lines.push(`    ${villRange.classes.join(",")}`);
    lines.push("");
    lines.push(`    [source: ${villRange.source}${villRange.label ? " — " + villRange.label : ""}]`);
  } else {
    lines.push(`    PASTE_VILLAIN_RANGE_HERE  ← no chart or authored range`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Reference (do not paste — for your context)");
  lines.push("");
  lines.push(`  Scenario:        ${scen.scenario_id}`);
  lines.push(`  Hero seat:       ${replay.hero_seat} (${ip ? "IP" : "OOP"})`);
  lines.push(`  Hero dealt:      ${dealt || "(hidden)"}`);
  lines.push(`  Last action:     ${actionText}`);
  if (derived.derivation) {
    const d = derived.derivation;
    lines.push(`  Hero archetype:  ${d.hero_archetype || "(unknown)"} → chart-key ${d.hero_chart_key || "n/a"}`);
    lines.push(`  Vill archetype:  ${d.villain_archetype || "(unknown)"} → chart-key ${d.villain_chart_key || "n/a"}`);
  }
  if (derived.warnings && derived.warnings.length) {
    lines.push("");
    lines.push("  ⚠ Warnings:");
    for (const w of derived.warnings) lines.push(`    - ${w}`);
  }
  lines.push("");
  lines.push("## After setup");
  lines.push(`  1. Save as: ${scen.scenario_id}.gto2`);
  lines.push("  2. Drop in solver-output/ for the extractor to pick up.");

  return { content: lines.join("\n"), heroSource: heroRange?.source, villSource: villRange?.source };
}

const filter = process.argv[2];
const targets = filter ? SCENARIOS.filter(s => s.scenario_id === filter) : SCENARIOS;
if (filter && !targets.length) {
  console.error(`Scenario not found: ${filter}`);
  process.exit(1);
}

let written = 0;
const heroSourceTally = {}, villSourceTally = {};
for (const scen of targets) {
  const pack = buildPastePack(scen);
  if (!pack) continue;
  const outPath = join(OUT_DIR, `${scen.scenario_id}.gtopaste.txt`);
  writeFileSync(outPath, pack.content);
  written++;
  heroSourceTally[pack.heroSource || "(none)"] = (heroSourceTally[pack.heroSource || "(none)"] || 0) + 1;
  villSourceTally[pack.villSource || "(none)"] = (villSourceTally[pack.villSource || "(none)"] || 0) + 1;
}

console.log(`✅ Wrote ${written} paste-pack(s) to solver-input/`);
console.log("");
console.log("Hero range source distribution:");
for (const [s, n] of Object.entries(heroSourceTally)) console.log(`  ${n} ${s}`);
console.log("");
console.log("Villain range source distribution:");
for (const [s, n] of Object.entries(villSourceTally)) console.log(`  ${n} ${s}`);
