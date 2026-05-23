// preflop-ranges.js — derive hero + villain preflop ranges at the decision point.
//
// Input: a scenario object (from scenarios.json) whose `replay.actions` carries
// the preflop action chain.
//
// Output: { heroRange, villainRange, derivation } where each range is an array
// of hand-class tokens ('AKs', 'JJ', 'T9o', ...) and derivation explains the
// archetype identification.
//
// Data source: data/preflop-ranges.json — consolidated from greenline, pekarstas,
// and tyloo (3-source consensus where available). See the JSON's _meta block.
//
// Schema convention: charts use MP for the seat between UTG and CO. Our scenarios
// use HJ for the same seat. Mapping handled here.

import preflopRanges from "../data/preflop-ranges.json" with { type: "json" };

// HJ in our scenarios = MP in chart sources.
const SEAT_TO_CHART = { UTG: "UTG", HJ: "MP", MP: "MP", CO: "CO", BTN: "BTN", SB: "SB", BB: "BB" };
function chartSeat(scenSeat) { return SEAT_TO_CHART[scenSeat] || scenSeat; }

/**
 * Walk preflop actions, identify:
 *   - opener (first raiser)
 *   - threeBettor (second raiser)
 *   - fourBettor (third raiser)
 *   - cold-callers (callers BEFORE any 3bet)
 *
 * @param {Array<{street:string, actor:string, type:string, amount_bb?:number}>} actions
 * @returns {{ opener, threeBettor, fourBettor, callers, foldedSeats, liveSeats }}
 */
function summarizePreflop(actions, allSeats) {
  const preflop = actions.filter((a) => a.street === "preflop");
  let opener = null, threeBettor = null, fourBettor = null;
  const callers = [];
  const folded = new Set();
  for (const a of preflop) {
    if (a.type === "fold") folded.add(a.actor);
    else if (a.type === "raise") {
      if (!opener) opener = a.actor;
      else if (!threeBettor) threeBettor = a.actor;
      else if (!fourBettor) fourBettor = a.actor;
    } else if (a.type === "call" && opener) callers.push(a.actor);
  }
  const live = allSeats.filter((s) => !folded.has(s));
  return { opener, threeBettor, fourBettor, callers, foldedSeats: [...folded], liveSeats: live };
}

/**
 * Derive a seat's archetype at the decision point.
 *   RFI          — seat is the first raiser, nobody reraised yet
 *   open_3bet    — seat opened, faces a 3bet (decision = 4bet/call/fold)
 *   open_4bet    — seat opened, 3bet, faces 4bet
 *   cold_3bet    — seat cold-3bet over an open
 *   cold_4bet    — seat cold-4bet (rare)
 *   call_vs_open — seat called an open (no 3bet yet)
 *   call_3bet_pot — seat is in a 3bet pot postflop having called preflop
 *   (other archetypes return null — caller treats as ambiguous)
 */
function archetypeFor(seat, sum) {
  if (sum.opener === seat) {
    if (sum.fourBettor === seat) return "open_4bet";
    if (sum.threeBettor) return "open_faces_3bet";
    return "RFI";
  }
  if (sum.threeBettor === seat) return "cold_3bet";
  if (sum.fourBettor === seat) return "cold_4bet";
  if (sum.callers.includes(seat)) return sum.threeBettor ? "call_3bet_pot" : "call_vs_open";
  return null;
}

/**
 * Build the chart-key for a (seat, archetype) given the preflop context.
 * Returns null if we can't map it (caller should fall back to dealt-hand single combo).
 */
function chartKey(seat, archetype, sum) {
  const s = chartSeat(seat);
  if (archetype === "RFI") return `${s}-RFI`;
  if (archetype === "call_vs_open") return sum.opener ? `${s}-vs-open-${chartSeat(sum.opener)}` : null;
  if (archetype === "cold_3bet")     return sum.opener ? `${s}-vs-open-${chartSeat(sum.opener)}` : null;  // cold-3bet = subset of vs-open with raise action
  if (archetype === "open_faces_3bet")  return sum.threeBettor ? `${s}-vs-3bet-${chartSeat(sum.threeBettor)}` : null;
  if (archetype === "cold_4bet")     return null;          // rare — chart unlikely to cover
  if (archetype === "open_4bet")     return null;
  if (archetype === "call_3bet_pot") return sum.opener && sum.threeBettor ? `${chartSeat(sum.threeBettor)}-vs-3bet-${s}` : null;
  return null;
}

/**
 * Convert a chart entry (hand → { raise:N, call:N, allin:N }) to a flat array of
 * hand-class strings, filtered to whatever continuation actions matter for the
 * archetype:
 *   RFI                       — only 'raise' (open-raise range)
 *   call_vs_open              — only 'call'
 *   cold_3bet                 — only 'raise' or 'allin' (3betting subset of vs-open)
 *   open_faces_3bet           — 'call' or 'raise' (continuing range — fold-to-3bet excluded)
 *   call_3bet_pot             — 'call' (calling the 3bet)
 *   default                   — all non-fold actions
 */
function filterByArchetype(handMap, archetype) {
  const out = [];
  const want = {
    RFI: (a) => a.raise || a.allin,
    call_vs_open: (a) => a.call,
    cold_3bet: (a) => a.raise || a.allin,
    open_faces_3bet: (a) => a.raise || a.call || a.allin,
    call_3bet_pot: (a) => a.call,
  }[archetype] || ((a) => a.raise || a.call || a.allin);
  for (const [hand, actions] of Object.entries(handMap)) {
    if (want(actions)) out.push(hand);
  }
  return out;
}

/**
 * Derive hero + villain preflop ranges at the scenario's decision point.
 *
 * @param {Object} scen
 * @returns {{ hero_range, villain_range, derivation, warnings }}
 *   hero_range / villain_range are { label, classes } objects matching the
 *   scenarios.json villain_ranges schema, so they can be substituted in directly.
 *   `warnings` is an array of strings — non-empty if any range had to fall back.
 */
export function deriveRanges(scen) {
  const warnings = [];
  const replay = scen && scen.replay;
  if (!replay || !replay.hero_seat) {
    return { hero_range: null, villain_range: null, derivation: null, warnings: ["no replay or hero_seat"] };
  }

  const actions = replay.actions || [];
  const allSeats = (replay.seats || []).map((s) => s.pos);
  const hero = replay.hero_seat;
  const sum = summarizePreflop(actions, allSeats);

  // Hero range
  const heroArche = archetypeFor(hero, sum);
  const heroKey = heroArche ? chartKey(hero, heroArche, sum) : null;
  const heroChart = heroKey ? preflopRanges.scenarios[heroKey] : null;
  let heroClasses = null;
  let heroNote = null;
  if (heroChart && heroChart.hands) {
    heroClasses = filterByArchetype(heroChart.hands, heroArche);
    heroNote = `${heroArche} → ${heroKey} (${heroChart.providerCount}-source consensus${heroChart.providers ? ": " + heroChart.providers.join("+") : ""})`;
  } else {
    // Fallback: single-combo "range" from the dealt hand
    const dealt = (replay.hero_cards || []).join("");
    const cls = dealtHandClass(replay.hero_cards);
    if (cls) {
      heroClasses = [cls];
      heroNote = `FALLBACK: dealt-hand class only — no chart for ${hero}/${heroArche}/${heroKey || "?"}`;
      warnings.push(`hero_range fallback (${heroNote}); dealt=${dealt}`);
    } else {
      warnings.push("hero_range: could not derive — no chart and no dealt hand");
    }
  }

  // Villain range — first non-hero live seat. For multi-villain scenarios we
  // only derive the primary opponent's range (the decision is usually heads-up
  // by the river anyway).
  const villainSeat = sum.liveSeats.find((s) => s !== hero) || null;
  let villainClasses = null;
  let villainNote = null;
  if (villainSeat) {
    const villArche = archetypeFor(villainSeat, sum);
    const villKey = villArche ? chartKey(villainSeat, villArche, sum) : null;
    const villChart = villKey ? preflopRanges.scenarios[villKey] : null;
    if (villChart && villChart.hands) {
      villainClasses = filterByArchetype(villChart.hands, villArche);
      villainNote = `${villainSeat} ${villArche} → ${villKey} (${villChart.providerCount}-source consensus)`;
    } else {
      villainNote = `FALLBACK: no chart for ${villainSeat}/${villArche}/${villKey || "?"}`;
      warnings.push(`villain_range fallback (${villainNote})`);
      // For postflop scenarios we may already have an authored villain_range — caller
      // can prefer that over our derivation. Return null so caller knows to fall back.
    }
  }

  return {
    hero_range: heroClasses
      ? { label: heroNote, classes: heroClasses, source: "preflop-derived" }
      : null,
    villain_range: villainClasses
      ? { label: villainNote, classes: villainClasses, source: "preflop-derived" }
      : null,
    derivation: {
      hero_seat: hero,
      hero_archetype: heroArche,
      hero_chart_key: heroKey,
      villain_seat: villainSeat,
      villain_archetype: villainSeat ? archetypeFor(villainSeat, sum) : null,
      villain_chart_key: villainSeat ? chartKey(villainSeat, archetypeFor(villainSeat, sum), sum) : null,
      opener: sum.opener,
      three_bettor: sum.threeBettor,
      callers: sum.callers,
    },
    warnings,
  };
}

// Helper: dealt cards → hand-class (AcKc → AKs, AhKd → AKo, AsAh → AA).
function dealtHandClass(cards) {
  if (!cards || cards.length !== 2) return null;
  const RANKS = "23456789TJQKA";
  const r1 = cards[0][0], s1 = cards[0][1], r2 = cards[1][0], s2 = cards[1][1];
  if (r1 === r2) return r1 + r1;
  const hi = RANKS.indexOf(r1) > RANKS.indexOf(r2) ? r1 : r2;
  const lo = hi === r1 ? r2 : r1;
  return hi + lo + (s1 === s2 ? "s" : "o");
}
