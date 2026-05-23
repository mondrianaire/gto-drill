// range-canonicalize.js — collapse a verbose hand-class range string into the
// shortest equivalent canonical form, matching GTO+'s on-save normalization.
//
// Why this exists: GTO+ stores the hero/villain range as a single
// length-prefixed string inside HEADER. A region-B sibling pointer encodes
// (hero_string_len + 17) into a single byte at HEADER content offset 18 (and
// vill_len + 4 at offset 23). The pointer is uint8, so the string length is
// capped at 238 chars (hero) / 251 chars (vill). The tpl-C controlled-corpus
// experiment confirmed there is no adjacent multi-byte length field — the cap
// is real, but GTO+'s OWN canonical range vocabulary never produces strings
// over 224 chars (full 100% range), so the cap accommodates anything GTO+
// would natively save. Verbose authored ranges in data/scenarios.json (some
// 246-417 chars long) violate the cap purely because they use a non-canonical
// long form. This module converts them.
//
// What it does:
//   - Parse any range string (comma-separated tokens, supporting +/- ranges,
//     specific combos like AcKc, and explicit lists) into a set of "atoms"
//   - Atom = one of: { kind:'pair', rank } | { kind:'suited', high, low } |
//                    { kind:'offsuit', high, low } | { kind:'specific', card1, card2 }
//   - Emit the shortest GTO+ -style canonical representation:
//       * Contiguous pairs collapse to XX-YY (e.g. 22,33,44 → 44-22, or AA-22 for all)
//       * Contiguous suited/offsuit with same high rank collapse to XKs-X2s style
//       * Specific-suit combos (AcKc, KhQh, …) pass through individually —
//         GTO+ has no shorter shorthand for "specific suit lock"
//
// Invariant: countCombos(canonical) === countCombos(input). Any drift means
// the canonicalizer corrupted the range and we must fix it before shipping.

const RANKS = "23456789TJQKA"; // index 0=2, index 12=A
const rankIdx = (c) => RANKS.indexOf(c);
const isRank = (c) => rankIdx(c) >= 0;
const isSuit = (c) => "shdc".indexOf(c) >= 0;

// === Parsing ===

// Expand a single token into one or more atoms. Recognized forms:
//   AA          → pair atom
//   AKs / AKo   → suited/offsuit atom
//   AcKc        → specific atom (cards include suit chars)
//   XX+         → pair from XX up to AA  (e.g. 99+ → 99..AA)
//   XYs+ / XYo+ → all kickers from Y up to (X-1) sharing high rank X
//   XX-YY       → contiguous pair range (e.g. AA-22 → all pairs)
//   XYs-XZs     → contiguous suited range sharing high X
//   XYo-XZo     → contiguous offsuit range sharing high X
function expandToken(t) {
  t = t.trim();
  if (!t) return [];
  // Range: XX-YY or XYs-WVs
  const rangeMatch = t.match(/^(.+?)-(.+)$/);
  if (rangeMatch) {
    const [, lo, hi] = rangeMatch;
    return expandRangeToken(lo, hi);
  }
  // Plus: XX+ or XYs+
  if (t.endsWith("+")) {
    return expandPlusToken(t.slice(0, -1));
  }
  return expandAtomicToken(t);
}

function expandAtomicToken(t) {
  // Pair (two of the same rank): AA, KK, ..., 22
  if (t.length === 2 && t[0] === t[1] && isRank(t[0])) {
    return [{ kind: "pair", rank: t[0] }];
  }
  // Suited: XYs
  if (t.length === 3 && t[2] === "s" && isRank(t[0]) && isRank(t[1])) {
    const [a, b] = orderRanks(t[0], t[1]);
    return [{ kind: "suited", high: a, low: b }];
  }
  // Offsuit: XYo
  if (t.length === 3 && t[2] === "o" && isRank(t[0]) && isRank(t[1])) {
    const [a, b] = orderRanks(t[0], t[1]);
    return [{ kind: "offsuit", high: a, low: b }];
  }
  // Specific combo: XsYc — 4 chars, both have rank+suit
  if (t.length === 4 && isRank(t[0]) && isSuit(t[1]) && isRank(t[2]) && isSuit(t[3])) {
    return [{ kind: "specific", card1: t.slice(0, 2), card2: t.slice(2, 4) }];
  }
  // Unparseable — leave as opaque so caller can decide to drop or keep
  return [{ kind: "opaque", raw: t }];
}

function orderRanks(a, b) {
  // Return [higher, lower]
  return rankIdx(a) >= rankIdx(b) ? [a, b] : [b, a];
}

function expandPlusToken(stem) {
  // XX+ → pairs from XX up to AA
  if (stem.length === 2 && stem[0] === stem[1] && isRank(stem[0])) {
    const start = rankIdx(stem[0]);
    const out = [];
    for (let i = start; i <= 12; i++) out.push({ kind: "pair", rank: RANKS[i] });
    return out;
  }
  // XYs+ / XYo+ → kickers from Y up to (X-1), with high rank X fixed
  if (stem.length === 3 && (stem[2] === "s" || stem[2] === "o") && isRank(stem[0]) && isRank(stem[1])) {
    const [high, low] = orderRanks(stem[0], stem[1]);
    const kind = stem[2] === "s" ? "suited" : "offsuit";
    const startK = rankIdx(low);
    const endK = rankIdx(high) - 1;
    const out = [];
    for (let i = startK; i <= endK; i++) out.push({ kind, high, low: RANKS[i] });
    return out;
  }
  return [{ kind: "opaque", raw: stem + "+" }];
}

function expandRangeToken(lo, hi) {
  // Pair range: XX-YY (assume lo is high, hi is low — GTO+ writes AA-22 high-to-low)
  const pairA = lo.length === 2 && lo[0] === lo[1] && isRank(lo[0]);
  const pairB = hi.length === 2 && hi[0] === hi[1] && isRank(hi[0]);
  if (pairA && pairB) {
    const a = rankIdx(lo[0]);
    const b = rankIdx(hi[0]);
    const [start, end] = [Math.min(a, b), Math.max(a, b)];
    const out = [];
    for (let i = start; i <= end; i++) out.push({ kind: "pair", rank: RANKS[i] });
    return out;
  }
  // Suited range: XYs-XZs (same high rank, kicker varies)
  // Offsuit range: XYo-XZo
  const aMatch = lo.match(/^([2-9TJQKA])([2-9TJQKA])([so])$/);
  const bMatch = hi.match(/^([2-9TJQKA])([2-9TJQKA])([so])$/);
  if (aMatch && bMatch && aMatch[1] === bMatch[1] && aMatch[3] === bMatch[3]) {
    const highRank = aMatch[1];
    const kind = aMatch[3] === "s" ? "suited" : "offsuit";
    const aK = rankIdx(aMatch[2]);
    const bK = rankIdx(bMatch[2]);
    const [start, end] = [Math.min(aK, bK), Math.max(aK, bK)];
    const out = [];
    for (let i = start; i <= end; i++) {
      const [h, l] = orderRanks(highRank, RANKS[i]);
      // Only include if the kicker is strictly below the high (no XXs/XXo)
      if (h !== l) out.push({ kind, high: h, low: l });
    }
    return out;
  }
  // Suited/offsuit connector range with varying high+low (e.g. JTs-54s): high
  // and low ranks both shift together by the same gap. GTO+ doesn't typically
  // emit this form; supported here for parsing tolerance.
  if (aMatch && bMatch && aMatch[3] === bMatch[3]) {
    const kind = aMatch[3] === "s" ? "suited" : "offsuit";
    const aH = rankIdx(aMatch[1]), aL = rankIdx(aMatch[2]);
    const bH = rankIdx(bMatch[1]), bL = rankIdx(bMatch[2]);
    if (aH - aL === bH - bL) {
      const gap = aH - aL;
      const [startH, endH] = [Math.min(aH, bH), Math.max(aH, bH)];
      const out = [];
      for (let h = startH; h <= endH; h++) {
        const l = h - gap;
        if (l >= 0) out.push({ kind, high: RANKS[h], low: RANKS[l] });
      }
      return out;
    }
  }
  return [{ kind: "opaque", raw: lo + "-" + hi }];
}

// Expand any range string into a unique set of atoms keyed by their canonical
// form so duplicates are de-duped automatically.
export function expandRange(rangeStr) {
  const tokens = rangeStr.split(",").map((t) => t.trim()).filter(Boolean);
  const atoms = new Map(); // key → atom
  for (const t of tokens) {
    for (const a of expandToken(t)) {
      const key = atomKey(a);
      if (!atoms.has(key)) atoms.set(key, a);
    }
  }
  return [...atoms.values()];
}

function atomKey(a) {
  if (a.kind === "pair") return `p:${a.rank}`;
  if (a.kind === "suited") return `s:${a.high}${a.low}`;
  if (a.kind === "offsuit") return `o:${a.high}${a.low}`;
  if (a.kind === "specific") return `c:${a.card1}${a.card2}`;
  return `x:${a.raw}`;
}

// === Combo counting (for verification) ===

export function combosForAtom(a) {
  if (a.kind === "pair") return 6;
  if (a.kind === "suited") return 4;
  if (a.kind === "offsuit") return 12;
  if (a.kind === "specific") return 1;
  return 0;
}

export function countCombos(rangeStr) {
  return expandRange(rangeStr).reduce((n, a) => n + combosForAtom(a), 0);
}

// === Emission ===

// Given a set of rank indices (within RANKS), return an array of canonical
// "groups" — each group is a maximal contiguous run. Returned high→low.
function contiguousGroups(rankIndices) {
  const sorted = [...new Set(rankIndices)].sort((a, b) => b - a); // descending
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] - 1) j++;
    groups.push([sorted[i], sorted[j]]); // [hiIdx, loIdx]
    i = j + 1;
  }
  return groups;
}

export function canonicalize(rangeStr) {
  const atoms = expandRange(rangeStr);
  const pairs = []; // rank indices
  const suited = {}; // high rank char → Set of low rank indices
  const offsuit = {};
  const specifics = [];
  const opaques = [];
  for (const a of atoms) {
    if (a.kind === "pair") pairs.push(rankIdx(a.rank));
    else if (a.kind === "suited") {
      if (!suited[a.high]) suited[a.high] = new Set();
      suited[a.high].add(rankIdx(a.low));
    } else if (a.kind === "offsuit") {
      if (!offsuit[a.high]) offsuit[a.high] = new Set();
      offsuit[a.high].add(rankIdx(a.low));
    } else if (a.kind === "specific") {
      specifics.push(a);
    } else {
      opaques.push(a);
    }
  }

  const parts = [];

  // Pairs (high → low)
  for (const [hi, lo] of contiguousGroups(pairs)) {
    if (hi === lo) parts.push(RANKS[hi] + RANKS[hi]);
    else parts.push(RANKS[hi] + RANKS[hi] + "-" + RANKS[lo] + RANKS[lo]);
  }

  // Suited: iterate high ranks A down to 3 (suited needs kicker < high so 2 has no suited form)
  for (let h = 12; h >= 1; h--) {
    const high = RANKS[h];
    if (!suited[high]) continue;
    for (const [hi, lo] of contiguousGroups([...suited[high]])) {
      if (hi === lo) parts.push(high + RANKS[hi] + "s");
      else parts.push(high + RANKS[hi] + "s-" + high + RANKS[lo] + "s");
    }
  }

  // Offsuit
  for (let h = 12; h >= 1; h--) {
    const high = RANKS[h];
    if (!offsuit[high]) continue;
    for (const [hi, lo] of contiguousGroups([...offsuit[high]])) {
      if (hi === lo) parts.push(high + RANKS[hi] + "o");
      else parts.push(high + RANKS[hi] + "o-" + high + RANKS[lo] + "o");
    }
  }

  // Specific combos pass through (no GTO+ shorthand for partial-suit locks)
  for (const s of specifics) parts.push(s.card1 + s.card2);

  // Opaques pass through as-is (so we don't silently drop unrecognized input)
  for (const o of opaques) parts.push(o.raw);

  const result = parts.join(",");

  // Self-check: combo count must be preserved exactly
  const inCombos = countCombos(rangeStr);
  const outCombos = countCombos(result);
  if (inCombos !== outCombos) {
    throw new Error(
      `canonicalize: combo count drift (in=${inCombos}, out=${outCombos}) — ` +
      `input="${rangeStr.slice(0, 60)}…" output="${result.slice(0, 60)}…"`,
    );
  }

  return result;
}
