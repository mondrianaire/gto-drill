// concepts.js — the GTO-concept taxonomy.
//
// Every scenario in data/scenarios.json carries a `concept_tags`
// array drawn from these keys. The player profile buckets a player's
// responses by concept to surface per-area strengths and leaks.
//
// Keep this in sync with the tags written into scenarios.json.

export const CONCEPTS = {
  "aggression": "Aggression & sizing",
  "range-reading": "Range reading",
  "board-texture": "Board texture",
  "bluffing": "Bluffing",
  "bluff-catching": "Bluff-catching",
  "value-betting": "Value betting",
  "pot-control": "Pot control",
  "preflop": "Preflop ranges",
  "icm": "Tournament / ICM",
  "equity-realization": "Equity realization",
};

/** Human-readable label for a concept key (falls back to the key). */
export function conceptLabel(key) {
  return CONCEPTS[key] || key;
}

/** Ordered list of concept keys — stable display order for profiles. */
export const CONCEPT_ORDER = Object.keys(CONCEPTS);
