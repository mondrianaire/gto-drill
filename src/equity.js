// equity.js — Texas Hold'em equity engine (hand evaluator + Monte Carlo).
//
// Self-contained, pure logic, no DOM. Powers the "Test it — equity vs a
// range" button on the reveal screen.
//
// Cards are 2-char codes like "Ah", "Td", "2c". Ranks 2..A, suits c/d/h/s.
// Internally a card becomes { r: 2..14, s: 0..3 }.

const RANK_MAP = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const RANK_CHARS = "23456789TJQKA";
const SUIT_CHARS = "cdhs";

/** @typedef {{r:number,s:number}} Card */

/** Parse "Ah" → {r:14,s:2}. */
export function parseCard(code) {
  const r = RANK_MAP[code[0]];
  const s = SUIT_CHARS.indexOf(code[1]);
  if (r == null || s < 0) throw new Error("Bad card code: " + code);
  return { r, s };
}

/** A full 52-card deck of codes. */
export function makeDeck() {
  const out = [];
  for (const r of RANK_CHARS) for (const s of SUIT_CHARS) out.push(r + s);
  return out;
}

// -----------------------------------------------------------------------
// Hand evaluator — given 5..7 cards, return a comparable integer score.
// Bigger score = better hand. Categories (most significant digit first):
//   8e10 straight flush · 7e10 quads · 6e10 full house · 5e10 flush
//   4e10 straight · 3e10 trips · 2e10 two pair · 1e10 pair · <1e10 high
// -----------------------------------------------------------------------

function straightHigh(distinctSortedDesc) {
  // distinctSortedDesc: e.g. [14,13,11,9,7,5,3]. Returns the top rank of the
  // best 5-in-a-row, or 0 if no straight. Treats ace as low for the wheel.
  const set = new Set(distinctSortedDesc);
  for (let top = 14; top >= 6; top--) {
    if (set.has(top) && set.has(top - 1) && set.has(top - 2) && set.has(top - 3) && set.has(top - 4)) {
      return top;
    }
  }
  if (set.has(14) && set.has(5) && set.has(4) && set.has(3) && set.has(2)) return 5; // wheel
  return 0;
}

/**
 * Score a hand of 5..7 cards (objects with r/s). Higher score wins.
 * @param {Card[]} cards
 * @returns {number}
 */
export function evaluate(cards) {
  const rankCounts = new Array(15).fill(0);
  const suitCounts = [0, 0, 0, 0];
  const suitRanks = [[], [], [], []]; // per-suit list of ranks present
  for (const c of cards) {
    rankCounts[c.r]++;
    suitCounts[c.s]++;
    suitRanks[c.s].push(c.r);
  }

  // 1) Straight flush
  let bestSF = 0;
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s] >= 5) {
      const distinct = Array.from(new Set(suitRanks[s])).sort((a, b) => b - a);
      const sh = straightHigh(distinct);
      if (sh > bestSF) bestSF = sh;
    }
  }
  if (bestSF > 0) return 8e10 + bestSF;

  // 2) Four of a kind
  let quadRank = 0;
  for (let r = 14; r >= 2; r--) if (rankCounts[r] === 4) { quadRank = r; break; }
  if (quadRank) {
    let kicker = 0;
    for (let r = 14; r >= 2; r--) if (r !== quadRank && rankCounts[r] > 0) { kicker = r; break; }
    return 7e10 + quadRank * 100 + kicker;
  }

  // Identify the best trip and best pair (different ranks).
  let tripRank = 0;
  for (let r = 14; r >= 2; r--) if (rankCounts[r] >= 3) { tripRank = r; break; }
  let pairRankForFH = 0;
  for (let r = 14; r >= 2; r--) {
    if (r === tripRank) continue;
    if (rankCounts[r] >= 2) { pairRankForFH = r; break; }
  }

  // 3) Full house
  if (tripRank && pairRankForFH) {
    return 6e10 + tripRank * 100 + pairRankForFH;
  }

  // 4) Flush
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s] >= 5) {
      const r5 = suitRanks[s].slice().sort((a, b) => b - a).slice(0, 5);
      return 5e10 + r5[0] * 1e8 + r5[1] * 1e6 + r5[2] * 1e4 + r5[3] * 1e2 + r5[4];
    }
  }

  // 5) Straight
  const distinctRanksDesc = [];
  for (let r = 14; r >= 2; r--) if (rankCounts[r] > 0) distinctRanksDesc.push(r);
  const sh = straightHigh(distinctRanksDesc);
  if (sh > 0) return 4e10 + sh;

  // 6) Three of a kind
  if (tripRank) {
    const kickers = [];
    for (let r = 14; r >= 2 && kickers.length < 2; r--) {
      if (r !== tripRank && rankCounts[r] > 0) kickers.push(r);
    }
    return 3e10 + tripRank * 1e4 + (kickers[0] || 0) * 1e2 + (kickers[1] || 0);
  }

  // 7) Two pair / one pair
  const pairs = [];
  for (let r = 14; r >= 2; r--) if (rankCounts[r] === 2) pairs.push(r);
  if (pairs.length >= 2) {
    let kicker = 0;
    for (let r = 14; r >= 2; r--) {
      if (r !== pairs[0] && r !== pairs[1] && rankCounts[r] > 0) { kicker = r; break; }
    }
    return 2e10 + pairs[0] * 1e4 + pairs[1] * 1e2 + kicker;
  }
  if (pairs.length === 1) {
    const p = pairs[0];
    const ks = [];
    for (let r = 14; r >= 2 && ks.length < 3; r--) {
      if (r !== p && rankCounts[r] > 0) ks.push(r);
    }
    return 1e10 + p * 1e6 + (ks[0] || 0) * 1e4 + (ks[1] || 0) * 1e2 + (ks[2] || 0);
  }

  // 8) High card
  const hk = [];
  for (let r = 14; r >= 2 && hk.length < 5; r--) if (rankCounts[r] > 0) hk.push(r);
  return hk[0] * 1e8 + (hk[1] || 0) * 1e6 + (hk[2] || 0) * 1e4 + (hk[3] || 0) * 1e2 + (hk[4] || 0);
}

// -----------------------------------------------------------------------
// Monte Carlo equity simulation
// -----------------------------------------------------------------------

/**
 * Run a Monte Carlo equity simulation.
 *
 * @param {Object} opts
 * @param {string[]} opts.heroHand     2 card codes (e.g. ["Ah","Ks"])
 * @param {string[]} opts.board        0..5 card codes
 * @param {string[][]} opts.villainRange  Array of [card,card] pairs covering the villain's range.
 * @param {number} [opts.trials=5000]
 * @returns {{wins:number, ties:number, losses:number, equity:number|null, trials:number}}
 */
export function runEquity({ heroHand, board, villainRange, trials = 5000 }) {
  if (!Array.isArray(heroHand) || heroHand.length !== 2) {
    throw new Error("heroHand must be 2 cards");
  }
  const heroCards = heroHand.map(parseCard);
  const boardCards = (board || []).map(parseCard);
  const dead = new Set([...heroHand, ...(board || [])]);
  const fullDeck = makeDeck();

  // Only villain combos that don't collide with hero / current board.
  const valid = (villainRange || []).filter((combo) =>
    combo.length === 2 && !dead.has(combo[0]) && !dead.has(combo[1]) && combo[0] !== combo[1]);
  if (valid.length === 0) {
    return { wins: 0, ties: 0, losses: 0, equity: null, trials: 0 };
  }

  let wins = 0, ties = 0, losses = 0;
  const need = 5 - boardCards.length;
  for (let t = 0; t < trials; t++) {
    const vc = valid[(Math.random() * valid.length) | 0];
    const villainCards = [parseCard(vc[0]), parseCard(vc[1])];
    // Build remaining deck (hero + board + this villain combo are dead).
    const used = new Set([...dead, vc[0], vc[1]]);
    const remaining = [];
    for (const c of fullDeck) if (!used.has(c)) remaining.push(c);
    // Draw `need` board cards via partial Fisher-Yates.
    const drawn = [];
    for (let i = 0; i < need; i++) {
      const j = i + ((Math.random() * (remaining.length - i)) | 0);
      const tmp = remaining[i]; remaining[i] = remaining[j]; remaining[j] = tmp;
      drawn.push(parseCard(remaining[i]));
    }
    const finalBoard = boardCards.concat(drawn);
    const heroScore = evaluate(heroCards.concat(finalBoard));
    const villScore = evaluate(villainCards.concat(finalBoard));
    if (heroScore > villScore) wins++;
    else if (heroScore < villScore) losses++;
    else ties++;
  }
  const denom = wins + ties + losses;
  const equity = denom ? (wins + ties / 2) / denom : null;
  return { wins, ties, losses, equity, trials: denom };
}

// -----------------------------------------------------------------------
// Range expansion helpers
// -----------------------------------------------------------------------

/**
 * Expand a 169-grid hand class like "AKs", "AKo", "AA" into all card combos.
 * Also accepts a fully-specified 4-char combo (e.g. "AcKc") and returns it
 * as the single combo it names — useful when GTO prose calls out specific
 * suited holdings on a textured board ("the AhKh hearts flush").
 *
 * - Pairs (e.g. "AA") → 6 combos
 * - Suited (e.g. "AKs") → 4 combos
 * - Offsuit (e.g. "AKo") → 12 combos
 * - Specific combo (e.g. "AcKc") → 1 combo
 *
 * @param {string} cls
 * @returns {string[][]}
 */
export function expandHandClass(cls) {
  // 4-char specific combo: "AcKc", "Th9h", etc.
  if (cls && cls.length === 4) {
    const a = cls.slice(0, 2), b = cls.slice(2, 4);
    if (
      a[0] in RANK_MAP && b[0] in RANK_MAP &&
      SUIT_CHARS.indexOf(a[1]) >= 0 && SUIT_CHARS.indexOf(b[1]) >= 0 &&
      a !== b
    ) {
      return [[a, b]];
    }
    return [];
  }
  if (cls == null || cls.length < 2 || cls.length > 3) return [];
  const r1 = cls[0], r2 = cls[1];
  if (!(r1 in RANK_MAP) || !(r2 in RANK_MAP)) return [];
  const out = [];
  if (r1 === r2) {
    // pair
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      out.push([r1 + SUIT_CHARS[i], r2 + SUIT_CHARS[j]]);
    }
    return out;
  }
  const sfx = cls[2];
  if (sfx === "s") {
    for (let i = 0; i < 4; i++) out.push([r1 + SUIT_CHARS[i], r2 + SUIT_CHARS[i]]);
    return out;
  }
  if (sfx === "o") {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (i !== j) out.push([r1 + SUIT_CHARS[i], r2 + SUIT_CHARS[j]]);
    }
    return out;
  }
  return [];
}

/** Expand a list of hand-class tokens (["AA","KK","AKs"...]) into combos. */
export function expandRange(classes) {
  const seen = new Set();
  const out = [];
  for (const c of classes) {
    for (const combo of expandHandClass(c)) {
      // Canonicalise pair so [Ah,Ks] and [Ks,Ah] don't both appear.
      const key = combo.slice().sort().join("");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(combo);
    }
  }
  return out;
}
