#!/usr/bin/env node
// postflop-ev-derive.mjs — populate solver_data.ev_cost on 31 postflop scenarios.
//
// Path B winner from the 2026-05-30 workflow audit (see
// docs/GTO-PLUS-KNOWLEDGE-BASE.md). Chart-derive postflop EV from GTO Wizard
// instead of running GTO+ paste-and-build for 2 hours + multi-hour solve.
//
// HOW TO USE
// ----------
// 1. Open GTO Wizard (free tier: 1 postflop/day × 31 days, or Premium $99/mo).
// 2. For each scenario in POSTFLOP_EV below where `pending: true`:
//    a. Open GTO Wizard's solution viewer for the matching spot (use the
//       `notes` field for sourcing hints — same board, same hero hand,
//       same action history).
//    b. Read the per-action EV-loss numbers for the dealt hero hand (or
//       range average for hidden-cards scenarios — only 2 of them).
//    c. Fill in `freq` (0.0-1.0, equilibrium mix) and `ev_cost` (BB lost
//       vs GTO action) for each option.
//    d. Set `pending: false`.
// 3. Run `node scripts/postflop-ev-derive.mjs`. Script will:
//    - Skip any entry still marked `pending: true` (logs how many)
//    - Validate that option labels exactly match scen.available_actions
//    - Validate that scen.gto_action has ev_cost === 0
//    - Write solver_data into data/scenarios.json for completed entries
//    - Exit non-zero ONLY on validation errors (incomplete is fine, just logged)
// 4. Repeat as you have time. Each run is idempotent — fully-filled entries
//    produce byte-identical output.
//
// Convention identical to scripts/preflop-ev-derive.mjs (PR #168):
//   - ev_cost(GTO action) = 0 always
//   - ev_cost(other) > 0 = BB lost by picking that option vs GTO
//   - freq sums to 1.0 across an entry's options
//   - Values rounded to 1 decimal (no false precision)
//
// Source field will be "postflop-derived-2026-XX-XX" so a future
// TexasSolver-fork-with-EV (or direct GTO+ run) can identify and overwrite.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_PATH = path.join(__dirname, "..", "data", "scenarios.json");

// Set this to the date you finish filling in the LAST scenario. Used as
// solver_data.solved_at. Update before final run.
const SOLVED_AT = "2026-05-30";
const SOURCE_TAG = `postflop-derived-${SOLVED_AT}`;

// Per-scenario EV data. STUB for now — fill in from GTO Wizard.
//
// Each entry shape:
//   "scenario_id": {
//     pending: true|false,        // true = skip, false = process
//     notes: "...",               // source/methodology paragraph
//     options: {
//       "<action label exactly as in scenarios.json available_actions>": {
//         freq: 0.0,              // equilibrium mix frequency (sums to 1.0)
//         ev_cost: 0.0,           // BB cost vs GTO action (GTO action = 0)
//       },
//       ...
//     },
//   }
//
// Scenarios are grouped by decision street (flop → turn → river) for easier
// batch lookup in GTO Wizard. Each scenario's spot summary is in the comment
// above its entry — hero seat, stack, hero hand, board, available actions,
// GTO action — so you can match it against GTO Wizard's tree without
// flipping to scenarios.json.

const POSTFLOP_EV = {

  // =================================================================
  // FLOP DECISIONS (14)
  // =================================================================

  // BTN 100bb (hidden) | Kh7d2s | Check back/Bet 7bb (~30%)/Bet 17bb (~75%) | GTO: Check back
  "btn-vs-bb-3bet-pot-c-bet-decision-001": {
    pending: true,
    notes: "Range-disadvantage check-back. 3-bet pot, BTN c-bets too often historically. Hidden hero — use range-average ev_cost.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 7bb (~30% pot)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 17bb (~75% pot)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb 9d9s | 8h8d3c | Fold/Call/Raise to 16bb | GTO: Call
  "ip-flop-overbet-on-paired-board-006": {
    pending: true,
    notes: "Call don't raise vs polar c-bet on paired board with mid pocket pair.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Raise to 16bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BB 100bb Th8h | 7c6c5d | Check/Donk lead 2bb (~35%)/Donk lead 4bb (~70%) | GTO: Donk lead 2bb (~35%)
  "donk-bet-decision-low-board-046": {
    pending: true,
    notes: "BB donk lead on low connected board — BB has range advantage vs CO open.",
    options: {
      "Check": { freq: 0.0, ev_cost: 0.0 },
      "Donk lead 2bb (~35%)": { freq: 0.0, ev_cost: 0.0 },
      "Donk lead 4bb (~70%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb AcQc | 8c5c2h | Check back/Bet 2bb (~35%)/Bet 4bb (~75%) | GTO: Bet 2bb (~35%)
  "flush-draw-semibluff-c-bet-016": {
    pending: true,
    notes: "Semi-bluff c-bet sizing with nut flush draw + overcards.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 2bb (~35%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 4bb (~75%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb 6c6d | 6h9c2s | Fold/Call/Re-raise to 22bb | GTO: Re-raise to 22bb
  "double-up-spot-set-vs-overpair-018": {
    pending: true,
    notes: "Set on dry board: bet for value. Re-raise extracts max from overpairs.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Re-raise to 22bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb AcQd | Kd7s4h | Check back/Bet 7bb (~16%)/Bet 22bb (~50%) | GTO: Bet 7bb (~16% pot)
  "four-bet-pot-range-cbet-021": {
    pending: true,
    notes: "Tiny range c-bet in 4-bet pots — protect range, prevent floats.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 7bb (~16% pot)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 22bb (~50% pot)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BB 100bb JhTh | 9h8h4c | Fold/Call/Check-raise to 9bb | GTO: Check-raise to 9bb
  "bb-monster-draw-check-raise-023": {
    pending: true,
    notes: "Check-raise the big combo draw (OESD + flush draw) for fold equity + equity.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Check-raise to 9bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb QsJs | QhJd9d | Fold/Call/3-bet to 38bb | GTO: Call
  "top-two-vs-check-raise-wet-board-029": {
    pending: true,
    notes: "Call top two vs c/r on wet board. 3-bet over-commits vs nutted ranges.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "3-bet to 38bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // CO 100bb KsKh | 9c6c3c | Check/Bet 2bb (~30%)/Bet 5bb (~75%) | GTO: Check
  "overpair-on-monotone-flop-030": {
    pending: true,
    notes: "Check overpairs on monotone boards — non-club KK has poor equity vs continue range.",
    options: {
      "Check": { freq: 0.0, ev_cost: 0.0 },
      "Bet 2bb (~30%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 5bb (~75%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // HJ 100bb AhKd | Ac8c5h | Fold/Call/3-bet to 24bb | GTO: Call
  "tptk-vs-flop-min-raise-033": {
    pending: true,
    notes: "Call TPTK vs small flop raise. 3-bet folds out worse + isolates better.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "3-bet to 24bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // UTG 100bb QhQd | Jh6c3d | Check/Bet 3bb (~33%)/Bet 6bb (~66%) | GTO: Bet 3bb (~33%)
  "multiway-cbet-sizing-overpair-034": {
    pending: true,
    notes: "Size down c-bets multiway — fewer hands continue, smaller is enough.",
    options: {
      "Check": { freq: 0.0, ev_cost: 0.0 },
      "Bet 3bb (~33%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 6bb (~66%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BB 100bb AcTc | 8c7c5d | Fold/Call/Check-raise to 20bb | GTO: Check-raise to 20bb
  "nut-flush-draw-check-raise-3bet-pot-035": {
    pending: true,
    notes: "Check-raise big draws in 3-bet pots — pressure cap'd c-bet range.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Check-raise to 20bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // CO 100bb AdKc | 6s5s4d | Fold/Call/Raise to 10bb | GTO: Fold
  "fold-ace-high-vs-donk-lead-039": {
    pending: true,
    notes: "Respect the donk lead on low connected boards — preflop raiser is crushed.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Raise to 10bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb KcTc | AsKd7c | Check back/Bet 1.5bb (~27%)/Bet 4bb (~75%) | GTO: Bet 1.5bb (~27%)
  "range-cbet-small-dry-ace-board-042": {
    pending: true,
    notes: "Tiny range bet on dry ace-high — extract from BB's continues without overcommitting.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 1.5bb (~27%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 4bb (~75%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // =================================================================
  // TURN DECISIONS (7)
  // =================================================================

  // BTN 100bb (hidden) | 9c6c2hTc | Check back/Bet 7bb (50%)/Bet 14bb (100%)/Bet 21bb (overbet) | GTO: Check back
  "small-blind-vs-button-srp-turn-overbet-003": {
    pending: true,
    notes: "Range-flipping turn card. Hidden hero — range-average ev_cost.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 7bb (50% pot)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 14bb (100% pot)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 21bb (overbet)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BB 100bb KdJd | Kc5h4s7c | Fold/Call/Check-raise to 28bb | GTO: Call
  "out-of-position-double-barrel-equity-realization-009": {
    pending: true,
    notes: "OOP turn defense top pair. Check-raise turns hand face-up and folds out bluffs.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Check-raise to 28bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BB 100bb 8c7c | Kc8d3s5h | Check/Probe bet 3bb (~50%)/Probe bet 6bb (~100%) | GTO: Probe bet 3bb (~50%)
  "turn-probe-bet-vs-checked-flop-024": {
    pending: true,
    notes: "Probe the capped range on the turn after CO checks back flop.",
    options: {
      "Check": { freq: 0.0, ev_cost: 0.0 },
      "Probe bet 3bb (~50%)": { freq: 0.0, ev_cost: 0.0 },
      "Probe bet 6bb (~100%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // CO 100bb AcJc | Ts6s2c7d | Check/Delayed c-bet 3bb (~50%)/Delayed c-bet 6bb (~100%) | GTO: Delayed c-bet 3bb (~50%)
  "delayed-cbet-after-flop-check-025": {
    pending: true,
    notes: "Delayed c-bet vs capped flop-check — opponent's range can't have JJ+/sets.",
    options: {
      "Check": { freq: 0.0, ev_cost: 0.0 },
      "Delayed c-bet 3bb (~50%)": { freq: 0.0, ev_cost: 0.0 },
      "Delayed c-bet 6bb (~100%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb Ac5c | Kd8h3s9h | Check back/Bet 5bb (~55%)/Bet 9bb (~100%) | GTO: Check back
  "turn-barrel-give-up-031": {
    pending: true,
    notes: "Give up the turn with no equity — A5c on dry board lost equity entirely.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 5bb (~55%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 9bb (~100%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // CO 100bb 5h5s | 9h5d2hKh | Check/Bet 5bb (~40%)/Bet 13bb (~100%) | GTO: Check
  "middle-set-on-flush-turn-038": {
    pending: true,
    notes: "Pot-control sets on bad turns — flush completed, value bet folds out worse.",
    options: {
      "Check": { freq: 0.0, ev_cost: 0.0 },
      "Bet 5bb (~40%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 13bb (~100%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // CO 100bb AdJc | Js8d3cQh | Check back/Bet 6bb (~50%)/Bet 12bb (~100%) | GTO: Check back
  "turn-check-back-pot-control-043": {
    pending: true,
    notes: "Pot-control top pair on scare turns — Q on Js8d3c puts AJ in marginal spot.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 6bb (~50%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 12bb (~100%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // =================================================================
  // RIVER DECISIONS (10)
  // =================================================================

  // SB 100bb KcQd | Qh7s4d8s3h | Check back/Bet 3bb (~30%)/Bet 7bb (~70%)/Bet 12bb (overbet) | GTO: Bet 3bb (~30%)
  "blind-vs-blind-river-thin-value-005": {
    pending: true,
    notes: "River thin value sizing — TPGK in BvB picks off worse Qx and bluffs.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 3bb (~30%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 7bb (~70%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 12bb (overbet)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb TdJd | Tc9c5d2h6s | Fold/Call | GTO: Fold
  "facing-river-overbet-with-bluff-catcher-007": {
    pending: true,
    notes: "MDF and blockers vs polar river overbet — TPGK is below MDF threshold.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb AhKc | 9h8h2cJh4d | Fold/Call/Raise to 25bb | GTO: Call
  "bluff-catcher-with-blocker-012": {
    pending: true,
    notes: "Nut-blocker bluff catch — Ah blocks nut flush, picks off bluffs.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Raise to 25bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb 7d7c | Js8c3d4h2s | Check back/Bet 5bb (~25%)/Bet 14bb (~75%) | GTO: Check back
  "calling-station-river-thin-call-015": {
    pending: true,
    notes: "Check back showdown value — small pair on dry board, betting only folds worse.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 5bb (~25%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 14bb (~75%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // CO 100bb QcQd | 7h4s2d5s6c | Fold/Call/Shove all-in | GTO: Fold
  "river-overpair-vs-check-raise-017": {
    pending: true,
    notes: "Fold to c/r on 4-card straight — overpair is dominated by check-raise range.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Shove all-in": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb 5c4c | Jh7c3cTd2s | Check back/Bet 4bb (~45%)/Bet 8bb (~90%) | GTO: Bet 4bb (~45%)
  "river-bluff-with-no-showdown-019": {
    pending: true,
    notes: "River bluff into capped range — busted draw with no showdown.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 4bb (~45%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 8bb (~90%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // CO 100bb KsTs | Qs9s4d6c2h | Check back/Bet 11bb (~45%)/Bet 24bb (~100%) | GTO: Bet 24bb (~100%)
  "river-bluff-busted-draw-blocker-022": {
    pending: true,
    notes: "Polarized river bluff sizing — busted flush with K blocker, polar overbet works.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 11bb (~45%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 24bb (~100%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BB 100bb Tc9c | 7h6h2c5d8s | Check/Bet 6bb (~50%)/Bet 12bb (~100%)/Overbet 20bb (~165%) | GTO: Overbet 20bb (~165%)
  "overbet-the-nuts-vs-capped-range-032": {
    pending: true,
    notes: "Overbet the nuts vs capped range — straight on 4-card straight river.",
    options: {
      "Check": { freq: 0.0, ev_cost: 0.0 },
      "Bet 6bb (~50%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 12bb (~100%)": { freq: 0.0, ev_cost: 0.0 },
      "Overbet 20bb (~165%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BTN 100bb Ah5h | Kh9h4c7s2d | Check back/Bet 4bb (~45%)/Bet 8bb (~90%) | GTO: Check back
  "river-blocker-no-bluff-check-040": {
    pending: true,
    notes: "Don't bluff with the wrong blockers — Ah blocks villain's missed nut flush.",
    options: {
      "Check back": { freq: 0.0, ev_cost: 0.0 },
      "Bet 4bb (~45%)": { freq: 0.0, ev_cost: 0.0 },
      "Bet 8bb (~90%)": { freq: 0.0, ev_cost: 0.0 },
    },
  },

  // BB 100bb 9c8c | Td7s4c5h6d | Fold/Call/Raise to 32bb | GTO: Raise to 32bb
  "raise-river-with-the-nuts-045": {
    pending: true,
    notes: "Raise the river with the nuts — 9-high straight on 4-card straight river.",
    options: {
      "Fold": { freq: 0.0, ev_cost: 0.0 },
      "Call": { freq: 0.0, ev_cost: 0.0 },
      "Raise to 32bb": { freq: 0.0, ev_cost: 0.0 },
    },
  },

};

// --- main ---

const raw = fs.readFileSync(SCENARIOS_PATH, "utf8");
const all = JSON.parse(raw);
const arr = Array.isArray(all) ? all : all.scenarios;

let updated = 0;
let pending = 0;
let skipped = 0;
const pendingIds = [];
const problems = [];

for (const scen of arr) {
  const data = POSTFLOP_EV[scen.scenario_id];
  if (!data) {
    skipped += 1;
    continue;
  }

  if (data.pending) {
    pending += 1;
    pendingIds.push(scen.scenario_id);
    continue;
  }

  // Verify the option keys match available_actions exactly. If they don't,
  // bail loud — the spec changed and the EV map needs an update.
  const wanted = new Set(scen.available_actions || []);
  const provided = new Set(Object.keys(data.options));
  for (const a of wanted) {
    if (!provided.has(a)) {
      problems.push(`${scen.scenario_id}: missing EV for action "${a}"`);
    }
  }
  for (const a of provided) {
    if (!wanted.has(a)) {
      problems.push(`${scen.scenario_id}: EV provided for unknown action "${a}"`);
    }
  }

  // Verify GTO action has ev_cost === 0 (sanity check)
  if (scen.gto_action && data.options[scen.gto_action]) {
    const gtoEvCost = data.options[scen.gto_action].ev_cost;
    if (gtoEvCost !== 0) {
      problems.push(`${scen.scenario_id}: GTO action "${scen.gto_action}" has non-zero ev_cost ${gtoEvCost} (must be 0)`);
    }
  }

  // Verify freq sums to approximately 1.0
  const freqSum = Object.values(data.options).reduce((s, o) => s + (o.freq || 0), 0);
  if (Math.abs(freqSum - 1.0) > 0.05) {
    problems.push(`${scen.scenario_id}: freq sum is ${freqSum.toFixed(3)} (expected ~1.0)`);
  }

  // Build the options map in the same shape as TexasSolver merge output
  const optionsOut = {};
  for (const a of scen.available_actions || []) {
    const o = data.options[a];
    if (!o) continue;
    optionsOut[a] = { freq: o.freq, ev: null, ev_cost: o.ev_cost };
  }

  scen.solver_data = {
    source: SOURCE_TAG,
    notes: data.notes,
    hero_hand: scen.replay?.hero_cards?.join("") || null,
    options: optionsOut,
    best_scenario_action: scen.gto_action,
    solved_at: SOLVED_AT,
  };
  updated += 1;
}

// Report problems first — these are blockers
if (problems.length) {
  console.error("Validation problems (no changes written):");
  for (const p of problems) console.error("  -", p);
  process.exit(1);
}

// Only write the file if at least one entry was updated
const postflopTotal = arr.filter(x => (x.replay?.board?.flop || []).length === 3).length;

if (updated > 0) {
  fs.writeFileSync(SCENARIOS_PATH, JSON.stringify(all, null, 2) + "\n");
  console.log(`OK: updated ${updated}/${postflopTotal} postflop scenarios (source=${SOURCE_TAG})`);
} else {
  console.log(`No changes written — 0/${postflopTotal} postflop scenarios have data filled in.`);
}

if (pending > 0) {
  console.log(`\n${pending} scenarios still pending (fill in POSTFLOP_EV and set pending: false):`);
  for (const id of pendingIds) console.log("  -", id);
}

if (updated === postflopTotal) {
  console.log(`\n🎉 All ${postflopTotal} postflop scenarios complete. M5 ev_cost chip now lights up across all 45 scenarios.`);
}
