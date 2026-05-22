// ui.js — section-4 (Game Flow and UI)
//
// In-game UI (per-scenario submission + waiting + per-round reveal) plus
// the end-of-game wrap-up screen. All state reads go through section-2's
// adapter via readGame; all submissions go through submitHandful. Scenario
// metadata comes from section-1. Notifications are triggered through
// section-3.

import { readGame, submitHandful, getCurrentUid, createGame, joinGame, setRematchGameId } from "./state.js";
import { getScenarioById } from "./scenarios.js";
import { computePhase } from "./flow.js";
import { perPlayerAccuracy, interPlayerAgreement, rankedDisagreements } from "./stats.js";
import { recordGame, writeActiveGameId } from "./history.js";
import { mountReplay, cardEl, liveVillains, potAtDecisionBb, buildSpotSummary } from "./replay.js";
import { mountEquityPanel } from "./equity-panel.js";
import { buildTermRegex, lookupTerm, getTooltipThreshold } from "./dictionary.js";
import { wireTermTrigger } from "./tooltip.js";
import { buildShareLinkButton, shareUrlForGame } from "./share.js";
import { buildAvatar } from "./onboarding.js";

// -----------------------------------------------------------------------
// Small DOM helpers (duplicated from onboarding.js intentionally to keep
// each module self-contained; both are tiny).
// -----------------------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== false && v != null) {
        el.setAttribute(k, v);
      }
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

// -----------------------------------------------------------------------
// richText — turn GTO prose into DOM with inline card icons, position
// chips, and a shared Hero/Villain colour identity (matching the table).
// -----------------------------------------------------------------------

/** Every card known to be in play for a scenario (hero hand + board). */
function knownCards(scen) {
  const set = new Set();
  const r = scen && scen.replay;
  if (r) {
    (r.hero_cards || []).forEach((c) => c && set.add(c));
    const b = r.board || {};
    [].concat(b.flop || [], b.turn || [], b.river || []).forEach((c) => c && set.add(c));
  }
  return set;
}

// Token patterns:
//   1 = card run (1+ codes with explicit suits — `\s*` between cards so
//       "Ah Kh Qh", "Ah Kh", and "AhKhQh" all tokenize)
//   2 = position chip (UTG|HJ|CO|BTN|SB|BB)
//   3 = Hero/Villain word
//   4 = "Nbb" / "N.Nbb" → stylized bb chip
//   5 = "K?" → unknown-suit card (suit not yet determined)
//   6 = "Kx" → doesn't-matter-suit card (analyst says suit irrelevant)
//   7 = "K72" board run (3-5 ranks) — rendered as N doesn't-matter cards.
//   8 = OPTIONAL board-texture modifier on group 7: "r" / " rainbow" /
//       "m" / "mono" / " monotone" / "tt" / " two-tone" / " two-toned".
//       When present, group 7's cards are wrapped in a modifier-tag
//       frame (.tok-modtag) with the texture marker in the border band.
//   9 = "KK" / "AA" / "AK" / "JT" → 2-rank hand-class shorthand
//  10 = OPTIONAL suited/offsuit suffix on group 9: "s" or "o" — tightly
//       bound (no space) per poker convention ("AKs", not "AK s"). When
//       present, the cards are wrapped in the same .tok-modtag frame
//       with the suited/offsuit marker in the border band.
// Order matters for regex alternation: longer/more-specific patterns first.
// Group 9's negative lookahead prevents "75% pot" / "25-40% frequency" /
// "25/40% mix" from rendering "75" or "25" as a 2-rank hand class:
//   - `\s*%`           → "75%"
//   - `\s*-\d+\s*%`    → "25-40%"
//   - `\s*[/—]\d+\s*%` → "25/40%"
// Percentages share digit vocab with rank shorthand; the trailing %
// (possibly via a range) is the distinguishing cue.
//
// Group 11 (`X-Y-Z` etc.) handles dash-separated rank boards like
// "6-7-8-9-T" or "7-4-2-5-6" — each rank renders as a card. Requires
// 3+ ranks separated by single dashes. Word boundaries on both ends
// exclude pair-range notation ("TT-77" — the second T has no \b since
// it's preceded by a word char), and the {2,4} repetition excludes
// 2-rank hand notation like "9-6 two pair".
const RICH_RE = /((?:[2-9TJQKA][cdhs])(?:\s*[2-9TJQKA][cdhs])*)\b|\b(UTG|HJ|CO|BTN|SB|BB)\b|\b([Hh]ero|[Vv]illain)\b|\b(\d+(?:\.\d+)?)bb\b|\b([2-9TJQKA])\?|\b([2-9TJQKA])x\b|\b([2-9TJQKA]{3,5})(\s+rainbow\b|\s+monotone\b|\s+two-toned?\b|\s*mono\b|\s*tt\b|r\b|m\b)?|\b([2-9TJQKA]{2})(s|o)?\b(?!\s*(?:[-/–—]\s*\d+)?\s*%)|\b([2-9TJQKA](?:-[2-9TJQKA]){2,4})\b/g;

/** Escape regex meta-characters for safe use inside a constructed RegExp. */
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Tokenize a chunk of prose (no anchor handling) into card icons + chips.
 *
 * @param {string} text
 * @param {Object} scen — scenario context (for pot computation, ranges)
 * @param {Object} [opts]
 * @param {boolean} [opts.asAction] — Signals this whole text is an action
 *   LABEL (current decision), not prose. When true, every bb chip in the
 *   result gets its computed pot-% suffix appended regardless of which
 *   verb precedes it ("Bet 7bb", "Donk lead 2bb", "Raise to 5bb", "3-bet
 *   to 11bb" etc. all get tagged). When false (default), only chips
 *   preceded by "Bet"/"bet" get the suffix — keeps past-action prose
 *   ("BB 3-bets to 11bb" inside a description) from receiving a pct
 *   computed against the wrong (current-decision) pot.
 * @param {boolean} [opts.actorLabels] — Render position chips for the
 *   hero seat as "HERO" and live-villain seats as "VILLAIN", instead of
 *   the position name ("BTN" / "BB" / etc.). Used in the wrap-up so the
 *   reader can scan disagreement cards across many scenarios without
 *   having to remember which position they were in each spot. Also
 *   strips "(Hero)" / "(Villain)" parenthetical annotations from the
 *   text, since those would be redundant with the new chip labels.
 */
function tokenizeProse(text, scen, opts) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const heroPos = scen && scen.replay ? scen.replay.hero_seat : null;
  const villains = liveVillains(scen && scen.replay);
  const known = knownCards(scen);
  const actorLabels = !!(opts && opts.actorLabels);
  // When actorLabels is on, strip "(Hero)" / "(Villain)" annotations that
  // would otherwise read redundantly next to the new HERO/VILLAIN chip.
  if (actorLabels) {
    text = text.replace(/\s*\((?:Hero|Villain)\)/g, "");
  }
  RICH_RE.lastIndex = 0;
  let last = 0;
  let m;
  while ((m = RICH_RE.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[1]) {
      // Pull every 2-char card code out of the run. Works for both
      // space-separated ("Ah Kh Qh") and concatenated ("AhKhQh") forms,
      // because the regex permits `\s*` between cards.
      const codes = m[1].match(/[2-9TJQKA][cdhs]/g) || [];
      // Multi-card runs are always iconified; a lone code only if it's a
      // card actually in play (avoids "As"/"Ah" English-word false hits).
      // A run of 2+ cards is wrapped in .cardrun so the line never
      // breaks between the cards — the run reads as one entity.
      if (codes.length >= 2) {
        const run = h("span", { class: "cardrun" });
        codes.forEach((c) => run.appendChild(cardEl(c, "inline")));
        frag.appendChild(run);
      } else if (known.has(codes[0])) {
        frag.appendChild(cardEl(codes[0], "inline"));
      } else {
        frag.appendChild(document.createTextNode(m[1]));
      }
    } else if (m[2]) {
      const pos = m[2];
      const isHero = pos === heroPos;
      const isVillain = villains.includes(pos);
      const role = isHero ? " is-hero" : isVillain ? " is-villain" : "";
      // In actor-label mode, replace the position name with HERO for the
      // hero. A villain becomes "VILLAIN" only when there is exactly ONE
      // opponent live at the decision — with multiple opponents that
      // label is ambiguous, so each keeps its own position name. Folded
      // / non-actor positions always keep their position name.
      let label = pos;
      if (actorLabels) {
        if (isHero) label = "HERO";
        else if (isVillain && villains.length === 1) label = "VILLAIN";
      }
      frag.appendChild(h("span", { class: "tok-pos" + role }, label));
    } else if (m[3]) {
      const role = /^h/i.test(m[3]) ? " is-hero" : " is-villain";
      frag.appendChild(h("span", { class: "tok-word" + role }, m[3]));
    } else if (m[4]) {
      // "Nbb" / "N.Nbb" → stylized big-blind chip
      frag.appendChild(h("span", { class: "tok-bb" },
        h("span", { class: "tok-bb-num" }, m[4]),
        h("span", { class: "tok-bb-unit" }, "bb")));
    } else if (m[5]) {
      // "K?" → unknown-suit card (suit not yet determined)
      const rank = m[5];
      frag.appendChild(h("span", { class: "tok-anysuit tok-anysuit-unknown", title: rank + " — suit unknown" },
        h("span", { class: "tok-anysuit-rank" }, rank === "T" ? "10" : rank),
        h("span", { class: "tok-anysuit-mark" }, "?")));
    } else if (m[6]) {
      // "Kx" / "Ax" → doesn't-matter-suit card. The absence of a suit
      // mark IS the signal: rank fills the card by itself, so the card
      // reads as "any K" with no suit indicator at all.
      const rank = m[6];
      frag.appendChild(h("span", { class: "tok-anysuit tok-anysuit-doesntmatter", title: rank + " — any suit" },
        h("span", { class: "tok-anysuit-rank" }, rank === "T" ? "10" : rank)));
    } else if (m[7]) {
      // 3-5 rank board run — N doesn't-matter cards. If group 8 captured
      // a board-texture modifier, the cards are wrapped in a modifier-tag
      // frame with the texture marker in the border band; with no
      // modifier the cards render plain.
      const ranks = m[7];
      const cards = [];
      for (let i = 0; i < ranks.length; i++) {
        const r = ranks[i];
        cards.push(h("span", { class: "tok-anysuit tok-anysuit-doesntmatter", title: r + " — any suit" },
          h("span", { class: "tok-anysuit-rank" }, r === "T" ? "10" : r)));
      }
      const modRaw = m[8];
      let modTag = null;
      if (modRaw) {
        const mod = modRaw.trim().toLowerCase();
        if (mod === "rainbow" || mod === "r") modTag = { fill: "rainbow", mark: "🌈", label: "Rainbow — all four suits different" };
        else if (mod === "monotone" || mod === "m" || mod === "mono") modTag = { fill: "solid", mark: "m", label: "Monotone — all one suit" };
        else if (mod === "two-tone" || mod === "two-toned" || mod === "tt") modTag = { fill: "stripes", mark: "2", label: "Two-tone — two suits" };
      }
      if (modTag) {
        frag.appendChild(h("span", {
          class: "tok-modtag tok-modtag-" + modTag.fill,
          title: modTag.label,
        },
          ...cards,
          h("span", { class: "tok-modtag-glyph", "aria-hidden": "true" }, modTag.mark)
        ));
      } else {
        // No modifier — render the board cards as one unbreakable run.
        frag.appendChild(h("span", { class: "cardrun" }, ...cards));
      }
    } else if (m[9]) {
      // 2-rank hand-class shorthand ("KK", "AA", "AK", "JT", etc.) —
      // render as two doesn't-matter cards. When an OPTIONAL group-10
      // suffix ("s" suited / "o" offsuit) is present — and it isn't a
      // pair — the two cards PLUS an "s"/"o" marker compartment are
      // wrapped in one bordered group, so "AKs" reads as a single tidy
      // unit. The offsuit "o" is split diagonally red/black to echo
      // "two different suits". (Pairs can't be suited; a stray "KKs"
      // suffix is silently dropped.)
      const ranks = m[9];
      const suffix = m[10];
      const hasSuffix = (suffix === "s" || suffix === "o") && ranks[0] !== ranks[1];
      const isSuited = suffix === "s";
      const cards = [];
      for (let i = 0; i < ranks.length; i++) {
        const r = ranks[i];
        cards.push(h("span", { class: "tok-anysuit tok-anysuit-doesntmatter", title: r + " — any suit" },
          h("span", { class: "tok-anysuit-rank" }, r === "T" ? "10" : r)));
      }
      if (hasSuffix) {
        // The cards are wrapped in a modifier-tag frame; the "s" / "o"
        // marker sits in the frame's extended right band. Suited gets a
        // solid (one-suit) frame; offsuit a red/black (two-suit) one.
        frag.appendChild(h("span", {
          class: "tok-modtag tok-modtag-" + (isSuited ? "solid" : "split"),
          title: isSuited ? "Suited — same suit" : "Offsuit — different suits",
        },
          ...cards,
          h("span", { class: "tok-modtag-glyph", "aria-hidden": "true" }, isSuited ? "s" : "o")
        ));
      } else {
        // No suffix — the two cards still stay together on one line.
        frag.appendChild(h("span", { class: "cardrun" }, ...cards));
      }
    } else if (m[11]) {
      // Dash-separated rank board ("6-7-8-9-T", "7-4-2-5-6"). Same
      // rendering as the concatenated form (group 7): each rank as a
      // doesn't-matter-suit card.
      const ranks = m[11].split("-");
      const run = h("span", { class: "cardrun" });
      for (const r of ranks) {
        run.appendChild(h("span", { class: "tok-anysuit tok-anysuit-doesntmatter", title: r + " — any suit" },
          h("span", { class: "tok-anysuit-rank" }, r === "T" ? "10" : r)));
      }
      frag.appendChild(run);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  attachBetPotPct(frag, scen, opts);
  return frag;
}

/**
 * After tokenizing, walk the fragment and decorate any bb chip that's
 * acting as a BET — i.e. preceded by "Bet " / "bet " in the immediately
 * prior text node. Adds a small "~XX% pot" suffix inside the chip, where
 * XX is computed from the scenario's pot at the decision point.
 *
 * If a literal "(~N% pot)" parenthetical follows the chip in prose, it's
 * stripped to avoid double-printing. The computed value rounds to the
 * nearest 5% so it visually matches the prose convention ("~30%", "~75%").
 *
 * Heuristic for "this is a bet": preceded by `\bBet\s+` (capital or
 * lowercase). Past actions ("3-bet to 11bb", "BB bets") are skipped
 * because their pot context is the pot at THAT point in history, not the
 * pot at the current decision — computing % against the current pot
 * would lie. Action buttons + GTO line are where this lands well.
 */
// A pot-% parenthetical adjacent to a bb chip — in any of these forms:
//   "(~30% pot)"  "(30% pot)"  "(~30%)"  "(30%)"  "(~75.5% pot)"
// The regex only matches a parenthetical that's clearly a percent (digits
// + `%`) so it's safe to apply WITHOUT a verb-prefix check — random
// parentheticals after a bb chip ("(BB's stack)", etc.) won't match.
const POT_PCT_PAREN_RE = /^\s*\(~?\d+(?:\.\d+)?\s*%(?:\s*pot)?\)/;

function attachBetPotPct(frag, scen, opts) {
  const potBb = potAtDecisionBb(scen && scen.replay);
  const asAction = !!(opts && opts.asAction);
  // Snapshot children before mutating so we don't iterate a moving list.
  const nodes = Array.prototype.slice.call(frag.childNodes);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!(node && node.nodeType === 1 && node.classList && node.classList.contains("tok-bb"))) continue;
    const prev = node.previousSibling;
    const next = node.nextSibling;
    const prevText = (prev && prev.nodeType === 3) ? prev.textContent : "";

    // Step 1: STRIP a redundant pot-% parenthetical adjacent to ANY bb
    // chip. The chip itself displays the bb amount; a literal "(~30%)" /
    // "(~30% pot)" / "(50%)" duplicates information. Done unconditionally
    // because the regex only matches digit-% paren patterns — random
    // text adjacent to the chip is unaffected.
    if (next && next.nodeType === 3) {
      const stripped = next.textContent.replace(POT_PCT_PAREN_RE, "");
      if (stripped !== next.textContent) next.textContent = stripped;
    }

    // Step 2: ADD the computed "~XX% pot" suffix INSIDE the chip when the
    // chip is a CURRENT BET. Two signals get a chip tagged:
    //
    //   (a) opts.asAction is true — caller is rendering an action LABEL
    //       (an option-card action, an action button, the opponent's
    //       picked-action chip). The whole text IS the action, so every
    //       bb in it is a bet amount; verb-prefix matching is irrelevant.
    //
    //   (b) chip is preceded by "Bet "/"bet " in prose — narrow rule that
    //       catches inline references like "the GTO line is to Bet 7bb"
    //       without mislabelling past-action narration ("BB 3-bets to
    //       11bb" in a description should NOT get a pct against the
    //       current pot, since the 3-bet happened earlier).
    if (!potBb) continue;
    const isCurrentBet = asAction || /\b[Bb]et\s+$/.test(prevText);
    if (!isCurrentBet) continue;
    const numEl = node.querySelector(".tok-bb-num");
    if (!numEl) continue;
    const num = parseFloat(numEl.textContent);
    if (!isFinite(num) || num <= 0) continue;
    const pct = (num / potBb) * 100;
    const rounded = Math.max(5, Math.round(pct / 5) * 5);
    const pctSpan = document.createElement("span");
    pctSpan.className = "tok-bb-pct";
    pctSpan.textContent = "~" + rounded + "% pot";
    node.appendChild(pctSpan);
  }
}

/** A clickable inline range chip: the anchor text + a 🎲 icon. */
function makeRangeChip(matchedText, range, onClick) {
  const summary = range && range.summary ? range.summary : "";
  const title = summary ? (range.label + " — " + summary) : (range && range.label) || "";
  const chip = h(
    "span",
    { class: "tok-range", title, role: "button", tabindex: "0" },
    matchedText,
    h("span", { class: "tok-range-icon", "aria-hidden": "true" }, "🎲")
  );
  chip.addEventListener("click", (ev) => { ev.preventDefault(); onClick(range); });
  chip.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onClick(range); }
  });
  return chip;
}

/**
 * Render GTO prose with:
 *   - inline card icons, position chips, Hero/Villain identity (always);
 *   - clickable range chips on any anchor in `scen.villain_ranges`
 *     (only when `opts.onRangeClick` is provided).
 *
 * Exported so the solo-practice view can reuse the same rendering.
 *
 * @param {string} text
 * @param {Object} scen
 * @param {{ onRangeClick?: (range:any) => void, asAction?: boolean, actorLabels?: boolean }} [opts]
 *   `asAction` signals that `text` is an action label (current decision)
 *   so every bb chip in it gets a computed pot-% suffix regardless of
 *   which verb precedes it (Bet / Donk lead / Raise to / Re-raise to /
 *   3-bet to / Check-raise to / Probe bet / Overbet / etc.).
 *   `actorLabels` swaps position chips for HERO/VILLAIN in the hero +
 *   live-villain seats (used in wrap-up so the reader doesn't have to
 *   track which position they were in each scenario).
 * @returns {DocumentFragment}
 */
export function richText(text, scen, opts) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const ranges = (scen && Array.isArray(scen.villain_ranges)) ? scen.villain_ranges : [];
  const onRangeClick = opts && opts.onRangeClick;
  const tokOpts = (opts && (opts.asAction || opts.actorLabels))
    ? { asAction: !!opts.asAction, actorLabels: !!opts.actorLabels }
    : undefined;
  if (!ranges.length || !onRangeClick) {
    frag.appendChild(wrapDictionaryTerms(tokenizeProse(text, scen, tokOpts)));
    return frag;
  }
  // Longest anchor first so "BB's 3-bet range" wins over "3-bet range".
  const sorted = ranges.slice().sort((a, b) => b.anchor.length - a.anchor.length);
  const anchorRe = new RegExp("(" + sorted.map((r) => reEscape(r.anchor)).join("|") + ")", "g");
  let last = 0;
  let m;
  while ((m = anchorRe.exec(text))) {
    if (m.index > last) frag.appendChild(wrapDictionaryTerms(tokenizeProse(text.slice(last, m.index), scen, tokOpts)));
    const matched = m[1];
    const range = sorted.find((r) => r.anchor === matched);
    // Tokenize the chip's own text too so bb chips / any-suit / etc.
    // appear consistently INSIDE range chips, not just around them.
    frag.appendChild(makeRangeChip(tokenizeProse(matched, scen, tokOpts), range, onRangeClick));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(wrapDictionaryTerms(tokenizeProse(text.slice(last), scen, tokOpts)));
  return frag;
}

/** Five-dot confidence indicator (filled vs empty), with aria label. */
function confidenceDots(confidence, who) {
  const safe = Math.max(0, Math.min(5, parseInt(confidence, 10) || 0));
  const wrap = h("span", {
    class: "reveal-conf",
    "aria-label": (who || "Confidence") + " " + safe + " of 5",
  });
  for (let i = 1; i <= 5; i++) {
    wrap.appendChild(h("span", {
      class: "reveal-conf-dot" + (i <= safe ? " is-filled" : ""),
      "aria-hidden": "true",
    }));
  }
  return wrap;
}

/**
 * Build the "spot context" block — situational info that frames the
 * decision in GTO terms, visible DURING the decide phase AND the reveal
 * phase (it doesn't change based on what the user picks). Two parts:
 *
 *   - "THE SPOT" — bulleted framing (range advantages, board texture,
 *     SPR, capped vs uncapped). Pulled from scen.framing.
 *   - "VILLAIN'S RANGE" — clickable chips for each entry in
 *     scen.villain_ranges. Clicking a chip pops the Monte Carlo equity
 *     panel pre-loaded with that range (via onRangeClick) so the user
 *     can explore equity BEFORE committing to an action.
 *
 * Lives above the action buttons / reveal verdict, OUTSIDE the
 * "you matched / off the line" outcome block — because this info is
 * about the spot, not the outcome.
 *
 * Returns null if both sections are empty (no framing, no ranges).
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {(range:Object)=>void} [args.onRangeClick] — handler for
 *   clickable villain-range chips. When omitted, ranges aren't clickable
 *   (still render as labelled chips for context).
 */
/**
 * Build the VILLAIN RANGE JUSTIFICATION block — the LEAD of the reveal.
 * For each entry in `scen.villain_ranges`, renders a card with the range
 * LABEL + the SUMMARY (which says WHY the analyst narrowed villain to
 * this range — e.g., "Linear 3-bet range: JJ+, AK, AQs, plus a slice of
 * suited bluffs"). Each card is clickable to pop the Monte Carlo equity
 * panel pre-loaded with that range.
 *
 * Lives at the TOP of the reveal so the asymmetric multiplayer angle
 * (what's villain doing here) is the primary signal, not buried below
 * the verdict. Returns null when no villain ranges are defined.
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {(range:Object)=>void} [args.onRangeClick]
 */
export function buildVillainRangeBlock({ scen, onRangeClick }) {
  if (!scen) return null;
  const ranges = Array.isArray(scen.villain_ranges) ? scen.villain_ranges : [];
  if (ranges.length === 0) return null;

  // Range cards — each one a deduced range. The label is the conclusion
  // ("BB's 3-bet range vs BTN open"); the summary is the supporting
  // evidence ("Linear 3-bet range: JJ+, AK, AQs, plus a slice of
  // suited bluffs"). Both go through richText so K72r becomes
  // card-glyphs + rainbow modifier, positions become chips, bb amounts
  // become bb chips — same voice as everywhere else in the app.
  // Clicking pops the equity panel pre-loaded.
  const list = h("div", { class: "villain-range-list" });
  for (const range of ranges) {
    const card = h(
      "div",
      { class: "villain-range-card" + (onRangeClick ? " is-clickable" : ""),
        role: onRangeClick ? "button" : null,
        tabindex: onRangeClick ? "0" : null,
        title: onRangeClick ? "Tap to test equity vs this range" : null },
      h("div", { class: "villain-range-card-header" },
        h("span", { class: "villain-range-card-label" }, range.label ? richText(range.label, scen, { actorLabels: true }) : "Range"),
        onRangeClick ? h("span", { class: "villain-range-card-icon", "aria-hidden": "true" }, "🎲") : null
      ),
      range.summary ? h("div", { class: "villain-range-card-summary" }, richText(range.summary, scen, { actorLabels: true })) : null
    );
    if (onRangeClick) {
      card.addEventListener("click", (ev) => { ev.preventDefault(); onRangeClick(range); });
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onRangeClick(range); }
      });
    }
    list.appendChild(card);
  }

  // Evidence row — what we have to work with: villain's actions through
  // the hand. For scenarios where villain hasn't acted yet (e.g.,
  // push/fold on the BTN before the blinds respond), this falls back
  // to a predictive context note instead.
  const evidence = buildVillainEvidence(scen);
  const subtitleText = onRangeClick
    ? "GTO read of what villain could hold, given the action above. Tap a range to test equity."
    : "GTO read of what villain could hold, given the action above.";

  return h("div", { class: "villain-range-block" },
    h("div", { class: "villain-range-header" },
      h("div", { class: "villain-range-title" }, "Villain's range"),
      h("div", { class: "villain-range-subtitle muted" }, subtitleText)
    ),
    evidence,
    list
  );
}

/**
 * Build the "Evidence" row for the villain range section — surfaces
 * the actions villain has taken in the hand so the user sees the
 * deductive inputs. For scenarios where villain hasn't acted yet
 * (push/fold spots, opening decisions), falls back to a predictive
 * note explaining that the ranges are based on what villain WILL face.
 */
function buildVillainEvidence(scen) {
  if (!scen || !scen.replay) return null;
  const replay = scen.replay;
  const hero = replay.hero_seat;
  const villainActs = (replay.actions || []).filter(
    (a) => a.actor !== hero && a.type !== "post" && a.type !== "fold"
  );

  if (villainActs.length === 0) {
    // Predictive: villain hasn't acted; range is what they'll face the
    // decision with (e.g., shove range, calling range vs hero's bet).
    return h("div", { class: "villain-evidence villain-evidence-predictive" },
      h("span", { class: "villain-evidence-label" }, "Predicting"),
      h("span", { class: "villain-evidence-text muted" },
        "Villain hasn't acted — these are the ranges they'll be making the decision with."
      )
    );
  }

  // Reactive: render villain's actions as evidence chips. For preflop
  // raise naming (opens / 3-bets / 4-bets), the escalation depends on
  // raises across BOTH players, so count up through the full action
  // sequence (not just villain's).
  const allActions = replay.actions || [];
  const chips = [];
  for (const a of villainActs) {
    // For each villain raise, count how many preflop raises preceded
    // it in the full action sequence (across both players).
    let priorPreflopRaises = 0;
    if (a.street === "preflop" && a.type === "raise") {
      for (const p of allActions) {
        if (p === a) break;
        if (p.street === "preflop" && p.type === "raise") priorPreflopRaises++;
      }
    }
    chips.push(h("span", { class: "villain-evidence-chip" },
      h("span", { class: "villain-evidence-street" }, streetShort(a.street)),
      h("span", { class: "villain-evidence-act" }, evidenceVerb(a, priorPreflopRaises))
    ));
  }
  return h("div", { class: "villain-evidence" },
    h("span", { class: "villain-evidence-label" }, "Evidence"),
    h("div", { class: "villain-evidence-chips" }, ...chips)
  );
}

function streetShort(s) {
  return { preflop: "PRE", flop: "FLOP", turn: "TURN", river: "RIVER" }[s] || s.toUpperCase();
}
function evidenceVerb(a, priorPreflopRaises) {
  if (a.type === "check") return "checks";
  if (a.type === "call") return "calls" + (a.amount_bb ? " " + a.amount_bb + "bb" : "");
  if (a.type === "bet") return "bets " + (a.amount_bb || 0) + "bb";
  if (a.type === "raise") {
    if (a.street === "preflop") {
      const n = priorPreflopRaises;
      const verb = n === 0 ? "opens to" : n === 1 ? "3-bets to" : n === 2 ? "4-bets to" : "5-bets to";
      return verb + " " + (a.amount_bb || 0) + "bb";
    }
    return "raises to " + (a.amount_bb || 0) + "bb";
  }
  return a.type;
}

/**
 * Build the FRAMING block — situational facts about the spot (board
 * texture, SPR, position dynamics, range advantages NOT specific to
 * villain-range-narrowing). Sits BELOW the verdict in the new layout
 * as supporting context. Returns null if framing data is empty.
 *
 * Replaces the earlier `buildSpotContext` which combined framing AND
 * range chips into one block — those concerns are now separated:
 * villain range (the lead, top) vs spot framing (supporting, below).
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {(range:Object)=>void} [args.onRangeClick]
 */
export function buildSpotFramingBlock({ scen, onRangeClick }) {
  if (!scen) return null;
  const framing = Array.isArray(scen.framing) ? scen.framing : [];
  if (framing.length === 0) return null;
  const list = h("ul", { class: "spot-framing-list" });
  const richOpts = onRangeClick ? { onRangeClick } : undefined;
  for (const b of framing) {
    list.appendChild(h("li", { class: "spot-framing-item" },
      h("span", { class: "spot-framing-marker", "aria-hidden": "true" }, "·"),
      h("span", { class: "spot-framing-text" }, richText(b, scen, richOpts))
    ));
  }
  return h("div", { class: "spot-framing" },
    h("div", { class: "spot-context-label" }, "The spot"),
    list
  );
}

/**
 * Backwards-compatible wrapper — keeps the old `buildSpotContext` export
 * working for any callers I haven't migrated. New callers should use
 * `buildVillainRangeBlock` and `buildSpotFramingBlock` directly.
 */
export function buildSpotContext({ scen, onRangeClick }) {
  const villain = buildVillainRangeBlock({ scen, onRangeClick });
  const framing = buildSpotFramingBlock({ scen, onRangeClick });
  if (!villain && !framing) return null;
  return h("div", { class: "spot-context" }, villain, framing);
}

/**
 * Build the hand-intro narrative — short prose framing of the scenario.
 * Reads as the solver's "here's the spot" sentence: positions, action
 * to here, board, pot, who's facing what. Distinct from the GTO line
 * (the answer) and from the verdict (your result) — this is the
 * scenario brief that introduces the analysis below.
 *
 * Data source: scen.description (already populated for every scenario;
 * was previously rendered inline in older reveal layouts before being
 * dropped in the table-only revamp).
 *
 * @param {Object} args
 * @param {Object} args.scen
 */
export function buildHandIntro({ scen }) {
  if (!scen || !scen.description) return null;
  return h("div", { class: "hand-intro" },
    h("div", { class: "hand-intro-label" }, "The hand"),
    h("p", { class: "hand-intro-text" }, richText(scen.description, scen))
  );
}

/**
 * Build the GTO description preamble — paragraph that introduces the
 * strategic landscape of the spot (range dynamics, board impact, who
 * has the equity edge) AND telegraphs the impact of the available
 * options. Sits between the verdict and the per-option pros/cons
 * matrix: sets up the thinking the user will need to evaluate each
 * choice.
 *
 * Data source: scen.gto_explanation (already populated on every
 * scenario; was previously rendered as a paragraph, then dropped,
 * now restored in the right slot — between verdict and matrix).
 *
 * Distinct from:
 *   - buildHandIntro: rehashes positions/board/pot — redundant with
 *     the replay table + spot-summary action log above.
 *   - buildGtoRead: one-liner naming the GTO action.
 *   - buildOptionsAnalysis: per-option For/Against.
 *
 * @param {Object} args
 * @param {Object} args.scen
 */
export function buildGtoExplanation({ scen }) {
  if (!scen || !scen.gto_explanation) return null;
  return h("div", { class: "gto-explanation" },
    h("div", { class: "gto-explanation-label" }, "GTO read"),
    h("p", { class: "gto-explanation-text" }, richText(scen.gto_explanation, scen, { actorLabels: true }))
  );
}

/**
 * Build the "How others played" crowd breakdown — aggregates every
 * recorded response to this scenario into a per-option distribution.
 * For each action: a % bar, the player count, a row of player avatars
 * (hover → name), the average confidence of that group, and markers
 * for the GTO line / the user's own pick. A non-GTO option that a
 * meaningful slice of the crowd picked with high average confidence
 * gets a "⚠ Blind spot" flag — the crowd-scale version of the
 * confidence-gap insight.
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {Array<{uid,displayName,photoURL,action,confidence}>} args.responses
 * @param {string} args.userAction  The current user's pick (for the marker).
 */
export function buildCrowdBreakdown({ scen, responses, userAction }) {
  if (!scen) return null;
  const options = Array.isArray(scen.available_actions) ? scen.available_actions : [];
  const gto = scen.gto_action;
  const list = Array.isArray(responses) ? responses : [];
  const total = list.length;

  const header = h("div", { class: "crowd-header" },
    h("div", { class: "crowd-title" }, "How others played"),
    h("div", { class: "crowd-subtitle muted" },
      total === 0 ? "No one else has played this hand yet"
        : total === 1 ? "1 player so far"
        : total + " players so far")
  );

  if (total === 0) {
    return h("div", { class: "crowd-breakdown" },
      header,
      h("p", { class: "crowd-empty muted" },
        "You're the first to play this hand — come back later to see how the crowd reads it.")
    );
  }

  // Low-sample notice — with only a handful of answers a percentage
  // split (especially "100% · 1 player") reads as crowd wisdom when it
  // is really a sample of one or two. Reframe it honestly until the
  // crowd is real.
  const SMALL_SAMPLE = 5;
  const lowSample = (total > 0 && total < SMALL_SAMPLE)
    ? h("p", { class: "crowd-lown" },
        total === 1
          ? "Just your answer so far — this becomes a real crowd read once other players weigh in."
          : "Early sample — only " + total + " answers so far. The split below firms up as the crowd grows.")
    : null;

  // Group responses by action.
  const byAction = {};
  for (const r of list) {
    const a = r.action || "—";
    (byAction[a] = byAction[a] || []).push(r);
  }

  // One avatar for a response. If the player left a comment, the
  // avatar gets a green note-dot and a hover (desktop) / tap (mobile)
  // popover showing the comment — a mini player-info card.
  function crowdAvatar(r) {
    const name = r.displayName || "Player";
    const av = buildAvatar(name, r.photoURL || null);
    av.classList.add("crowd-avatar");
    const note = r.note && String(r.note).trim();
    if (!note) {
      av.title = name;
      return av;
    }
    const noteAction = r.noteAction && String(r.noteAction).trim();
    const wrap = h("div",
      { class: "crowd-avatar-wrap has-note", role: "button", tabindex: "0",
        "aria-label": name + " left a comment" },
      av,
      h("span", { class: "crowd-note-dot", "aria-hidden": "true" }),
      h("div", { class: "crowd-note-pop" },
        h("div", { class: "crowd-note-pop-name" }, name),
        // The answer this comment was written about — keeps it honest
        // even if the player later changed their answer on a retest.
        noteAction
          ? h("div", { class: "crowd-note-pop-ctx" }, "Answered “" + noteAction + "”")
          : null,
        h("p", { class: "crowd-note-pop-text" }, "“" + note + "”")
      )
    );
    function openExclusive() {
      // Tap-to-toggle (mobile); close any other open popover first.
      const wasOpen = wrap.classList.contains("pop-open");
      const root = wrap.closest(".crowd-breakdown");
      if (root) root.querySelectorAll(".crowd-avatar-wrap.pop-open")
        .forEach((w) => w.classList.remove("pop-open"));
      if (!wasOpen) wrap.classList.add("pop-open");
    }
    wrap.addEventListener("click", (ev) => { ev.stopPropagation(); openExclusive(); });
    wrap.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openExclusive(); }
    });
    return wrap;
  }
  // Per-action stats — count, %, average confidence, blind-spot flag.
  function statsFor(opt) {
    const group = byAction[opt] || [];
    const count = group.length;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const confs = group.map((r) => Number(r.confidence)).filter((c) => c >= 1 && c <= 5);
    const avgConf = confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : null;
    const isGto = opt === gto;
    // Crowd blind spot — a non-GTO option a meaningful slice picked
    // with high average confidence.
    const isBlindSpot = !isGto && pct >= 15 && avgConf != null && avgConf >= 3.5;
    return { group, count, pct, avgConf, isGto, isBlindSpot };
  }

  // Every available action, plus any responded-to action not already in
  // available_actions (defensive — old data shapes).
  const allActions = options.slice();
  for (const a of Object.keys(byAction)) {
    if (!allActions.includes(a)) allActions.push(a);
  }
  // Hierarchy order (spec §8.2 / mockup M6): the two rows that carry the
  // lesson lead — the GTO line, then the player's own pick — followed by
  // every other action by descending share.
  const lead = [];
  if (allActions.includes(gto)) lead.push(gto);
  if (userAction && userAction !== gto && allActions.includes(userAction)) {
    lead.push(userAction);
  }
  const ordered = lead.concat(
    allActions
      .filter((a) => !lead.includes(a))
      .sort((a, b) => (byAction[b] || []).length - (byAction[a] || []).length)
  );

  const rows = h("div", { class: "crowd-rows" });
  for (const opt of ordered) {
    const { group, count, pct, avgConf, isGto, isBlindSpot } = statsFor(opt);
    const isUser = opt === userAction;

    // A row recedes to a thin dimmed line only when it carries nothing
    // the player needs to see — never the GTO line, their own pick, or
    // a crowd blind spot.
    if (!isGto && !isUser && !isBlindSpot) {
      rows.appendChild(h("div", { class: "crowd-row-receded" },
        h("span", { class: "crowd-receded-action" }, richText(opt, scen, { asAction: true })),
        h("span", { class: "crowd-receded-bar" },
          h("span", { class: "crowd-receded-fill", style: "width:" + pct + "%" })),
        h("span", { class: "crowd-receded-pct" }, pct + "%")
      ));
      continue;
    }

    // Full card. The tier drives the framing: green for the GTO line or
    // a correct (merged) pick, red for a miss, amber for a blind spot
    // the player avoided.
    const isMerged = isGto && isUser;
    let tier, marker = null;
    if (isMerged) {
      tier = "crowd-row-merged";
      marker = h("span", { class: "crowd-marker is-gto" }, "✓ Your pick · GTO line");
    } else if (isGto) {
      tier = "crowd-row-gto";
      marker = h("span", { class: "crowd-marker is-gto" }, "✓ GTO line");
    } else if (isUser) {
      tier = "crowd-row-pick";
      marker = h("span", { class: "crowd-marker is-miss" }, "✗ Your pick");
    } else {
      tier = "crowd-row-spot";
    }

    const blindTag = isBlindSpot
      ? h("span", {
          class: "crowd-tag is-blindspot",
          title: "A lot of players picked this confidently — but it's not the GTO line",
        }, "⚠ Blind spot")
      : null;

    // Avatar row, capped with a "+N" overflow chip. Players who left a
    // comment get a green dot + a hover/tap popover with the note.
    const CAP = 10;
    const avatarRow = h("div", { class: "crowd-avatars" });
    group.slice(0, CAP).forEach((r) => avatarRow.appendChild(crowdAvatar(r)));
    if (count > CAP) {
      avatarRow.appendChild(h("span", { class: "crowd-avatar-more" }, "+" + (count - CAP)));
    }

    rows.appendChild(h("div", { class: "crowd-row-card " + tier },
      (marker || blindTag)
        ? h("div", { class: "crowd-row-markers" }, marker, blindTag)
        : null,
      h("div", { class: "crowd-row-head" },
        h("div", { class: "crowd-row-action" }, richText(opt, scen, { asAction: true }))
      ),
      h("div", { class: "crowd-bar" },
        h("div", {
          class: "crowd-bar-fill" + (isGto ? " is-gto" : "")
            + (isUser && !isGto ? " is-miss" : ""),
          style: "width:" + pct + "%",
        }),
        h("span", { class: "crowd-bar-label" },
          pct + "% · " + count + (count === 1 ? " player" : " players"))
      ),
      h("div", { class: "crowd-row-foot" },
        avatarRow,
        avgConf != null
          ? h("span", { class: "crowd-conf muted" }, "avg confidence " + avgConf.toFixed(1))
          : null
      )
    ));
  }

  return h("div", { class: "crowd-breakdown" }, header, lowSample, rows);
}

/**
 * Build the options-analysis matrix — every available action as a card
 * with pros / cons bullets, GTO pick highlighted with a green ✓ ribbon,
 * the user's pick highlighted with a "Your pick" tag (and red ✗ if it
 * differs from GTO). Lets the user compare the trade-offs of every
 * choice they had, not just the one they made.
 *
 * Data source: scen.action_analysis — { [action]: { pros: string[],
 * cons: string[] } } — populated for every scenario.
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {string} args.userAction
 * @param {string} args.gtoAction
 */
export function buildOptionsAnalysis({ scen, userAction, gtoAction }) {
  if (!scen) return null;
  const analysis = scen.action_analysis || {};
  const options = Array.isArray(scen.available_actions) ? scen.available_actions : [];
  if (options.length === 0) return null;

  const cards = h("div", { class: "options-analysis-list" });
  for (const opt of options) {
    const isGto = opt === gtoAction;
    const isUser = opt === userAction;
    const optAnalysis = analysis[opt] || {};
    const pros = Array.isArray(optAnalysis.pros) ? optAnalysis.pros : [];
    const cons = Array.isArray(optAnalysis.cons) ? optAnalysis.cons : [];

    // Tags row on the card: GTO ✓ ribbon and/or "Your pick" tag
    const tagsRow = h("div", { class: "options-analysis-tags" });
    if (isGto) tagsRow.appendChild(h("span", { class: "options-analysis-tag is-gto" }, "✓ GTO"));
    if (isUser) {
      const cls = "options-analysis-tag is-user" + (isGto ? " is-match" : " is-miss");
      tagsRow.appendChild(h("span", { class: cls }, isGto ? "Your pick" : "✗ Your pick"));
    }

    const prosEl = pros.length
      ? h("ul", { class: "options-analysis-pros" },
          ...pros.map((p) => h("li", null, richText(p, scen, { actorLabels: true })))
        )
      : null;
    const consEl = cons.length
      ? h("ul", { class: "options-analysis-cons" },
          ...cons.map((c) => h("li", null, richText(c, scen, { actorLabels: true })))
        )
      : null;

    const classes = "options-analysis-card"
      + (isGto ? " is-gto" : "")
      + (isUser ? " is-user" : "")
      + (isUser && !isGto ? " is-miss" : "");

    cards.appendChild(h("div", { class: classes },
      h("div", { class: "options-analysis-card-header" },
        h("div", { class: "options-analysis-action" }, richText(opt, scen, { asAction: true })),
        tagsRow.children.length > 0 ? tagsRow : null
      ),
      h("div", { class: "options-analysis-body" },
        prosEl ? h("div", { class: "options-analysis-section" },
          h("div", { class: "options-analysis-section-label" }, "For"),
          prosEl
        ) : null,
        consEl ? h("div", { class: "options-analysis-section" },
          h("div", { class: "options-analysis-section-label" }, "Against"),
          consEl
        ) : null
      )
    ));
  }

  return h("div", { class: "options-analysis" },
    h("div", { class: "options-analysis-header" },
      h("div", { class: "options-analysis-title" }, "Your options"),
      h("div", { class: "options-analysis-subtitle muted" }, "How the solver weighs each choice")
    ),
    cards
  );
}

/**
 * Build the "GTO line" blurb — a small one-line block that names the
 * solver's preferred action. Per user: "GTO line is a small blurb about
 * the best option."
 *
 * Just the headline: "GTO line: [action chip]". No body paragraph.
 * The villain-range justification ABOVE this block already covers the
 * "why we read villain on that range", and the spot framing BELOW the
 * verdict covers the situational facts. The blurb itself is just the
 * recommendation, kept tight.
 *
 * Note: `onRangeClick` is accepted for API compatibility but no longer
 * threaded through any prose (the body paragraph is gone).
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {string} args.gtoAction
 */
export function buildGtoRead({ scen, gtoAction }) {
  if (!scen) return null;
  return h("div", { class: "gto-read gto-read-blurb" },
    h("span", { class: "gto-read-label muted" }, "GTO line"),
    h("span", { class: "gto-read-action" }, richText(gtoAction, scen, { asAction: true }))
  );
}

/**
 * Build the lesson-takeaway pill — a one-line crystallization of the
 * pattern this hand teaches ("Range-disadvantage check-back", "MDF and
 * blockers vs polar river overbet", etc.). Sits at the very top of the
 * reveal so the user carries away a single transferable concept before
 * working through the supporting detail.
 *
 * Data source: scen.lesson_tag (string). Every scenario in the dataset
 * has one populated.
 *
 * @param {Object} args
 * @param {Object} args.scen
 */
export function buildLessonTakeaway({ scen }) {
  if (!scen || !scen.lesson_tag) return null;
  return h("div", { class: "lesson-takeaway" },
    h("span", { class: "lesson-takeaway-label" }, "💡 Lesson"),
    h("span", { class: "lesson-takeaway-text" }, scen.lesson_tag)
  );
}

/**
 * Build the scenario INFO pane — a heads-up shown ABOVE the hand summary
 * for any scenario whose setup deviates from the default (100bb cash,
 * Hero's cards shown). Each deviation gets its own row: what is different
 * plus the reason it matters, so the player doesn't autopilot standard
 * assumptions. Returns null for a fully standard scenario (the common
 * case — no pane, no clutter).
 *
 * Detected deviations (all read from scen.replay):
 *   - format === "tournament"   → tournament pressures (ICM, pay jumps)
 *   - stack_depth_bb !== 100    → non-standard effective stacks
 *   - hero_cards missing        → range-vs-range spot, Hero's cards hidden
 *
 * Decide-safe: this pane is visible during the decide phase, so it states
 * only factual setup + neutral reasoning — never the GTO answer.
 *
 * @param {Object} args
 * @param {Object} args.scen
 */
export function buildScenarioInfo({ scen }) {
  const replay = scen && scen.replay;
  if (!replay) return null;

  const items = [];

  if (replay.format === "tournament") {
    items.push({
      head: "Tournament hand",
      reason: "This is a tournament spot, not a cash game. Survival, pay " +
        "jumps, and ICM pressure can pull the correct play away from the " +
        "chip-EV answer you'd make in a cash game.",
    });
  }

  const depth = Number(replay.stack_depth_bb);
  if (depth && depth !== 100) {
    items.push({
      head: "Non-standard stack depth — " + depth + "bb effective",
      reason: "Stacks are " + depth + "bb deep, not the usual 100bb. " +
        "Standard 100bb opening ranges and implied-odds math don't carry " +
        "over directly — read the spot on its own terms.",
    });
  }

  const hasCards = replay.hero_cards && replay.hero_cards[0];
  if (!hasCards) {
    items.push({
      head: "Hero's hole cards are hidden",
      reason: "This spot is played without a specific Hero hand on " +
        "purpose — it's a range-vs-range decision. Judge it from " +
        "position, board texture, and the betting action.",
    });
  }

  if (items.length === 0) return null;

  return h("div", { class: "scenario-info" },
    h("div", { class: "scenario-info-label" },
      h("span", { class: "scenario-info-icon", "aria-hidden": "true" }, "ⓘ"),
      "Heads-up — this scenario is different"
    ),
    ...items.map((it) =>
      h("div", { class: "scenario-info-item" },
        h("div", { class: "scenario-info-head" }, it.head),
        h("div", { class: "scenario-info-reason" }, richText(it.reason, scen))
      )
    )
  );
}

/**
 * Retest comparison — shown on the reveal ONLY when the player has
 * answered this scenario before. Surfaces their previous answer next to
 * a verdict on whether the new answer moved toward the GTO line.
 * Returns null when there's no prior answer (the common first-play case).
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {?{action:string, confidence:(number|null)}} args.prior
 * @param {string} args.currentAction
 * @param {string} args.gtoAction
 */
export function buildRetestCompare({ scen, prior, currentAction, gtoAction }) {
  if (!prior || !prior.action) return null;
  const priorGto = prior.action === gtoAction;
  const currGto = currentAction === gtoAction;
  const same = prior.action === currentAction;
  let verdict, tone;
  if (same) {
    verdict = currGto ? "Same as last time — still on the GTO line" : "Same answer as last time";
    tone = currGto ? "good" : "bad";
  } else if (!priorGto && currGto) {
    verdict = "Improved — now on the GTO line";
    tone = "good";
  } else if (priorGto && !currGto) {
    verdict = "Slipped — you were on the GTO line last time";
    tone = "bad";
  } else {
    verdict = "Still off — a different choice this time";
    tone = "bad";
  }
  // Prior confidence as filled/empty dots (1–5), matching the verdict
  // block's confidence display.
  let dotsEl = null;
  const c = Number(prior.confidence);
  if (c >= 1 && c <= 5) {
    let dots = "";
    for (let i = 1; i <= 5; i++) dots += i <= c ? "●" : "○";
    dotsEl = h("span", { class: "retest-dots", title: "Your confidence last time" }, dots);
  }
  return h("div", { class: "retest-compare retest-" + tone },
    h("span", { class: "retest-tag" }, "Replay"),
    h("span", { class: "retest-prior" },
      "Last time: ",
      h("span", { class: "retest-prior-action" }, richText(prior.action, scen, { asAction: true })),
      dotsEl
    ),
    h("span", { class: "retest-verdict" }, verdict)
  );
}

/**
 * Build the reveal-result block — the educational moment of every hand.
 * Returns a compact comparison: when Hero matched the GTO line, a single
 * centred tile (the action is the answer). When Hero missed, a two-column
 * "you played | GTO line" split. Confidence renders as five dots. Same
 * widget on solo + duel.
 *
 * The per-option pros/cons MATRIX layout was tried (see git history) and
 * judged too verbose. Per-option analysis lives in `scen.action_analysis`
 * but is not rendered here — the legacy `gto_explanation` paragraph carries
 * the analysis instead, rendered by the caller below this block.
 *
 * @param {Object} args
 * @param {Object} args.scen
 * @param {string} args.userAction
 * @param {string} args.gtoAction
 * @param {number} args.confidence
 * @param {Object} [args.opponent]    — { name, photoURL?, action, confidence?, note? }
 */
export function buildRevealResult({ scen, userAction, gtoAction, confidence, opponent }) {
  const correct = userAction === gtoAction;

  // Verdict bar — big red/green at-a-glance signal.
  const verdict = h("div", { class: "reveal-verdict" },
    h("span", { class: "reveal-verdict-icon", "aria-hidden": "true" }, correct ? "✓" : "✗"),
    h("span", { class: "reveal-verdict-text" }, correct ? "You matched the GTO line" : "Off the GTO line")
  );

  // Confidence row — five dots filled/empty.
  const confRow = h("div", { class: "reveal-conf-row" },
    h("span", { class: "reveal-conf-label" }, "Confidence"),
    confidenceDots(confidence, "You")
  );

  // Comparison: single tile when matched, two columns when missed.
  let comparison;
  if (correct) {
    comparison = h("div", { class: "reveal-compare reveal-compare-single" },
      h("div", { class: "reveal-side reveal-side-correct" },
        h("div", { class: "reveal-side-action" }, richText(userAction, scen, { asAction: true })),
        confRow
      )
    );
  } else {
    comparison = h("div", { class: "reveal-compare reveal-compare-split" },
      h("div", { class: "reveal-side reveal-side-you reveal-side-miss" },
        h("div", { class: "reveal-side-label muted" }, "You played"),
        h("div", { class: "reveal-side-action" }, richText(userAction, scen, { asAction: true })),
        confRow
      ),
      h("div", { class: "reveal-side reveal-side-gto" },
        h("div", { class: "reveal-side-label muted" }, "GTO line"),
        h("div", { class: "reveal-side-action" }, richText(gtoAction, scen, { asAction: true }))
      )
    );
  }

  // Opponent panel — only when an opponent has submitted. Lives below the
  // comparison; same chrome as before with avatar + name + their action +
  // confidence dots + their typed note.
  let opponentPanel = null;
  if (opponent && opponent.action) {
    const oppName = opponent.name || "Opponent";
    const oppFirstName = oppName.split(/\s+/)[0];
    const oppCorrect = opponent.action === gtoAction;
    const matchedYou = opponent.action === userAction;
    const avatarEl = buildAvatar(oppName, opponent.photoURL || null);
    avatarEl.classList.add("reveal-opp-avatar");

    const summaryBits = [];
    summaryBits.push(matchedYou ? "Matched your pick" : "Disagreed with you");
    summaryBits.push(oppCorrect ? "on the GTO line" : "off the GTO line");

    opponentPanel = h("div", { class: "reveal-opp-panel" + (oppCorrect ? " is-ok" : " is-miss") },
      h("div", { class: "reveal-opp-panel-header" },
        avatarEl,
        h("div", { class: "reveal-opp-panel-id" },
          h("span", { class: "reveal-opp-panel-name" }, oppFirstName),
          h("span", { class: "reveal-opp-panel-summary muted" }, summaryBits.join(", "))
        )
      ),
      h("div", { class: "reveal-opp-panel-pick" },
        h("span", { class: "reveal-opp-panel-label muted" }, "Picked"),
        h("span", { class: "reveal-opp-panel-action" }, richText(opponent.action, scen, { asAction: true }))
      ),
      opponent.confidence ? h("div", { class: "reveal-opp-panel-conf" },
        h("span", { class: "reveal-opp-panel-label muted" }, "Confidence"),
        confidenceDots(opponent.confidence, oppFirstName)
      ) : null,
      opponent.note ? h("div", { class: "reveal-opp-panel-note-row" },
        h("span", { class: "reveal-opp-panel-label muted" }, oppFirstName + "'s note"),
        h("p", { class: "reveal-opp-panel-note" }, "“" + opponent.note + "”")
      ) : null
    );
  }

  return h("div", { class: "reveal-result" + (correct ? " is-ok" : " is-miss") },
    verdict,
    comparison,
    opponentPanel
  );
}

/**
 * Post-process a tokenized fragment: walk its text-node children, wrap any
 * known dictionary terms in tooltip-enabled spans. DOM-element children
 * (cards, position chips, range chips) are passed through untouched.
 *
 * This runs AFTER tokenizeProse so dictionary terms don't fight cards /
 * positions for the same text — they only get a shot at the plain-text
 * residue.
 */
function wrapDictionaryTerms(fragOrEl) {
  const termRe = buildTermRegex({ minComplexity: getTooltipThreshold() });
  if (!termRe) return fragOrEl;
  const out = document.createDocumentFragment();
  for (const node of Array.from(fragOrEl.childNodes)) {
    if (node.nodeType !== 3 /* TEXT_NODE */) {
      out.appendChild(node);
      continue;
    }
    const text = node.textContent;
    let last = 0;
    let m;
    termRe.lastIndex = 0;
    while ((m = termRe.exec(text))) {
      if (m.index > last) out.appendChild(document.createTextNode(text.slice(last, m.index)));
      const matched = m[1];
      const entry = lookupTerm(matched);
      if (entry) {
        const span = h("span",
          { class: "term-trigger", role: "button", tabindex: "0", "data-term-id": entry.id, "aria-label": entry.term + " — tap for definition" },
          matched);
        wireTermTrigger(span, entry);
        out.appendChild(span);
      } else {
        out.appendChild(document.createTextNode(matched));
      }
      last = m.index + m[0].length;
    }
    // Handles both the no-match case (last=0, appends entire text) and the
    // trailing portion after the last match.
    if (last < text.length) out.appendChild(document.createTextNode(text.slice(last)));
  }
  return out;
}

function getDisplayName(game, uid) {
  const p = (game.participants || []).find((x) => x.uid === uid);
  return (p && p.displayName) || "Unknown";
}

// -----------------------------------------------------------------------
// mountInGameView — main per-round loop
// -----------------------------------------------------------------------

export function mountInGameView(container, gameId) {
  let unsub = null;
  let lastGame = null;
  let draft = null; // current player's in-progress submission set
  let handIdx = 0;  // which hand of the handful is currently on screen
  let submitting = false;
  let replayCleanup = null; // stops the active replay's timer before re-render

  function render(game) {
    if (replayCleanup) { try { replayCleanup(); } catch (_) {} replayCleanup = null; }
    clear(container);
    const myUid = getCurrentUid();
    const phase = computePhase(game, myUid);
    // Share-link button (top right of the duel view). Lets either player
    // hand the opponent a deep-link to this exact game — the missing piece
    // for inviting someone who isn't watching the lobby. URL is read at
    // click time so a stale gameId can't sneak through.
    const { button: shareBtn, fallback: shareFallback } = buildShareLinkButton({
      buildUrl: () => shareUrlForGame(gameId),
      title: "Copy share link for this game",
      className: "game-share",
    });
    const headerBar = h("div", { class: "game-header" },
      h("span", null, "Round ", String((phase.currentRoundIndex || 0) + 1), " of ", String(game.rounds.length)),
      shareBtn
    );
    container.appendChild(headerBar);
    container.appendChild(shareFallback);

    // "No opponent yet" banner — appears as soon as the game has only
    // one participant. Lets the creator know they can play freely now
    // and the opponent will catch up whenever they join. The header's
    // share button is the action; this banner explains why they'd use
    // it. Disappears the moment a second player joins.
    const participantCount = (game.participantUids || []).length;
    if (participantCount < 2 && game.status !== "complete" && game.status !== "cancelled") {
      const inviteBanner = h("div", { class: "invite-banner" },
        h("span", { class: "invite-banner-icon", "aria-hidden": "true" }, "🔗"),
        h("div", { class: "invite-banner-body" },
          h("div", { class: "invite-banner-title" }, "Opponent hasn't joined yet"),
          h("div", { class: "invite-banner-text muted" },
            "Play your batch now — they'll catch up when they open the share link. ",
            "Tap the link icon above to copy the invite."
          )
        )
      );
      container.appendChild(inviteBanner);
    }

    if (phase.gameComplete) {
      mountWrapUpView(container, gameId, { reuseGame: game });
      return;
    }

    const round = phase.currentRound;
    if (!round) {
      container.appendChild(h("p", null, "Loading round..."));
      return;
    }

    if (phase.myTurn) {
      renderMyTurn(round, game, myUid);
    } else if (phase.revealReady) {
      renderReveal(round, game, myUid);
    } else if (phase.waitingForOpponent) {
      renderWaiting(round, game, myUid);
    } else {
      container.appendChild(h("p", null, "Waiting..."));
    }
  }

  // The decision screen — one hand at a time, in two beats: DECIDE (pick an
  // action + confidence, then lock it) and REVEAL (see the GTO answer and,
  // if your opponent has already played this hand, their call). The replay
  // table stays the hero of both beats.
  function renderMyTurn(round, game, myUid) {
    // (Re)initialise the draft when the round changes.
    if (!draft || draft.roundIndex !== round.roundIndex) {
      draft = {
        roundIndex: round.roundIndex,
        submissions: round.scenarioIds.map((id) => ({
          scenario_id: id, action: null, confidence: null, note: "", revealed: false,
        })),
      };
      handIdx = 0;
    }
    const total = round.scenarioIds.length;
    handIdx = Math.max(0, Math.min(total - 1, handIdx));
    const sub = draft.submissions[handIdx];
    const scen = getScenarioById(round.scenarioIds[handIdx]);
    const errorBox = h("div", { class: "error", role: "alert" });

    // --- progress: "Hand X of N" + dots (a dot fills once that hand is locked) ---
    const dots = h("div", { class: "hand-dots" });
    for (let i = 0; i < total; i++) {
      dots.appendChild(h("span", {
        class: "hand-dot" + (i === handIdx ? " is-current" : "") + (draft.submissions[i].revealed ? " is-done" : ""),
      }));
    }
    const progress = h("div", { class: "hand-progress" },
      h("span", { class: "hand-count" }, "Hand " + (handIdx + 1) + " of " + total),
      dots
    );

    // --- the spot (hero) ---
    const spot = h("div", { class: "hand-spot" });
    if (scen && scen.replay) {
      const replayHost = h("div", { class: "replay-host" });
      spot.appendChild(replayHost);
      // Build the spot-summary BEFORE mounting the replay. Two-way sync:
      //   replay → summary: mountReplay's onStep drives summary.setStep
      //   summary → replay: summary's onJumpToStep drives replay.jumpTo
      // The replay handle is captured in a closure ref because the
      // summary references it before mountReplay returns.
      let replayHandle = null;
      const summary = buildSpotSummary(scen.replay, {
        onJumpToStep: (s) => { if (replayHandle) replayHandle.jumpTo(s); },
      });
      replayHandle = mountReplay(replayHost, scen.replay, {
        onStep: summary ? (s) => summary.setStep(s) : null,
      });
      replayCleanup = replayHandle && replayHandle.unmount ? replayHandle.unmount : null;
      if (summary) spot.appendChild(summary);
    } else if (scen) {
      spot.appendChild(h("p", { class: "scenario-desc" }, richText(scen.description, scen)));
      if (scen.board) {
        spot.appendChild(h("div", { class: "board" }, h("strong", null, "Board: "), scen.board));
      }
      if (Array.isArray(scen.action_history) && scen.action_history.length) {
        spot.appendChild(h("div", { class: "action-history" },
          h("strong", null, "Action: "), scen.action_history.join(" → ")));
      }
    }

    const isLast = handIdx === total - 1;
    const backBtn = h("button", { type: "button", class: "secondary hand-back" }, "Back");
    backBtn.disabled = handIdx === 0;
    backBtn.addEventListener("click", () => { handIdx -= 1; render(lastGame); });

    // IMPORTANT: spot-context (framing + villain range chips) is GTO content
    // and MUST NOT appear during decide. Both the framing bullets and the
    // named villain ranges encode the solver's read of the spot — showing
    // them before lock-in would give away the answer. They live ONLY in
    // the post-submission GTO screen below.
    let body, fwdBtn;

    if (!sub.revealed) {
      // ===================== DECIDE =====================
      // Lock-in button is built first so the action/confidence click
      // handlers below can reveal it once both are picked. It lives
      // INSIDE the decide body (below the note), not in the hand-nav
      // row at the bottom — so the call-to-action visually belongs to
      // the form it's submitting. Back stays in hand-nav.
      const lockInBtn = h("button", { type: "button", class: "primary hand-fwd lock-in-btn", hidden: true }, "Lock in & see GTO →");
      function refreshLockBtn() {
        lockInBtn.hidden = !(sub.action && sub.confidence);
      }

      const actionRow = h("div", { class: "actions-row", role: "radiogroup", "aria-label": "Your move" });
      (scen ? scen.available_actions : []).forEach((a) => {
        // Run the action label through richText so bb chips / pot-%s /
        // any token style applies consistently with the prose voice.
        const btn = h("button", { type: "button", class: "action-btn" + (sub.action === a ? " selected" : "") }, richText(a, scen, { asAction: true }));
        btn.addEventListener("click", () => {
          sub.action = a;
          actionRow.querySelectorAll(".action-btn").forEach((x) => x.classList.toggle("selected", x === btn));
          errorBox.textContent = "";
          refreshLockBtn();
        });
        actionRow.appendChild(btn);
      });

      const confRow = h("div", { class: "confidence-row", role: "radiogroup", "aria-label": "How sure are you" });
      for (let c = 1; c <= 5; c++) {
        const btn = h("button", { type: "button", class: "conf-btn" + (sub.confidence === c ? " selected" : "") }, String(c));
        btn.addEventListener("click", () => {
          sub.confidence = c;
          confRow.querySelectorAll(".conf-btn").forEach((x) => x.classList.toggle("selected", x === btn));
          errorBox.textContent = "";
          refreshLockBtn();
        });
        confRow.appendChild(btn);
      }

      const noteInput = h("textarea", {
        class: "note-input", maxlength: "280", rows: "2",
        placeholder: "What's your read here? (optional, max 280 chars)",
      });
      noteInput.value = sub.note || "";
      noteInput.addEventListener("input", () => { sub.note = noteInput.value.slice(0, 280); });
      const noteToggle = h("details", { class: "note-toggle" },
        h("summary", null, sub.note ? "Note added ✓" : "Add a note"),
        noteInput
      );
      if (sub.note) noteToggle.open = true;

      lockInBtn.addEventListener("click", () => {
        if (!sub.action) { errorBox.textContent = "Pick your move for this hand."; return; }
        if (!sub.confidence) { errorBox.textContent = "Rate how sure you are (1–5)."; return; }
        sub.revealed = true;
        render(lastGame);
      });

      body = h("div", { class: "decide" },
        h("span", { class: "decide-label" }, "Your move"),
        actionRow,
        h("span", { class: "decide-label decide-label-sub" }, "How sure?  (1 = guess, 5 = certain)"),
        confRow,
        noteToggle,
        lockInBtn
      );

      // Set initial visibility (handles the case where the user came
      // back to a hand that already has action+confidence on the draft).
      refreshLockBtn();
      // No fwdBtn during decide — the lock-in lives inside the body.
      // Back still appears alone in hand-nav so the user can navigate.
      fwdBtn = null;
    } else {
      // ===================== REVEAL (the GTO screen) =====================
      // EVERYTHING below this line is GTO content — only appears AFTER the
      // user locks in their answer:
      //   - spot context (framing + villain range chips)
      //   - equity host (Monte Carlo panel mounts here)
      //   - verdict + per-option pros/cons matrix + opponent panel
      //   - "Test it" fallback button
      const gto = scen ? scen.gto_action : "";

      // Equity panel state — local to the reveal branch.
      const equityHost = h("div", { class: "equity-host" });
      const eqState = { open: false, handle: null };
      function openEquityWithRange(range) {
        if (!scen) return;
        const classes = (range && range.classes) || [];
        const label = (range && range.label) || "";
        if (eqState.open && eqState.handle) {
          eqState.handle.setRange(classes, label);
        } else {
          eqState.handle = mountEquityPanel(equityHost, scen, { initialRange: classes, initialRangeLabel: label });
          eqState.open = true;
        }
        if (eqState.handle && eqState.handle.root && eqState.handle.root.scrollIntoView) {
          eqState.handle.root.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
      function closeEquityPanel() {
        if (eqState.handle) try { eqState.handle.unmount(); } catch (_) {}
        eqState.handle = null;
        eqState.open = false;
      }

      // Villain range — framed as a deduction ("based on the action so
      // far, here's what villain looks like"). Sits just above the
      // equity panel + Test it so clicking flows into verification.
      const villainRangeBlock = buildVillainRangeBlock({ scen, onRangeClick: openEquityWithRange });

      // GTO description preamble — paragraph that introduces the
      // strategic landscape and telegraphs the impact of each option.
      // Replaces the redundant "The hand" intro (positions/board/pot
      // are already on the table and in the spot-summary action log).
      const gtoExplanation = buildGtoExplanation({ scen });

      // Find the opponent's participant record + their submission for this
      // hand (if they've already played). Pass identity (avatar + name) into
      // the reveal so they're a clear visual actor, not a faceless string.
      const oppUid = (game.participantUids || []).find((u) => u !== myUid);
      const oppParticipant = oppUid && Array.isArray(game.participants)
        ? game.participants.find((p) => p.uid === oppUid)
        : null;
      const oppSubs = oppUid && round.submissionsByUid ? round.submissionsByUid[oppUid] : null;
      const oppSub = Array.isArray(oppSubs) ? oppSubs[handIdx] : null;
      const opponent = oppSub && oppSub.action ? {
        name: getDisplayName(game, oppUid),
        photoURL: oppParticipant ? oppParticipant.photoURL : null,
        action: oppSub.action,
        confidence: oppSub.confidence,
        note: oppSub.note,
      } : null;

      const result = buildRevealResult({
        scen,
        userAction: sub.action,
        gtoAction: gto,
        confidence: sub.confidence,
        opponent,
      });

      // Options analysis matrix — every available action with pros/cons.
      // userAction must be available here, so build after `sub` is in
      // scope (above the body composition).
      const optionsAnalysis = buildOptionsAnalysis({
        scen, userAction: sub.action, gtoAction: gto,
      });

      // GTO Read lead — top of the reveal: GTO line headline + reasoning.
      const gtoRead = buildGtoRead({ scen, gtoAction: gto, onRangeClick: openEquityWithRange });

      // "Test it" — reveal-only fallback. Auto-loads the LAST villain range.
      const testBtn = h("button", { type: "button", class: "secondary test-it" }, "🎲  Test it — equity vs a range");
      testBtn.addEventListener("click", () => {
        if (eqState.open) {
          closeEquityPanel();
          testBtn.textContent = "🎲  Test it — equity vs a range";
          return;
        }
        const ranges = (scen && scen.villain_ranges) || [];
        const last = ranges.length ? ranges[ranges.length - 1] : null;
        if (last) {
          openEquityWithRange({ classes: last.classes, label: "Auto-loaded: " + last.label });
        } else {
          openEquityWithRange(null);
        }
        testBtn.textContent = "Hide equity panel";
      });

      const takeaway = buildLessonTakeaway({ scen });
      body = h("div", { class: "hand-reveal" },
        takeaway,           // LEAD: one-line lesson takeaway
        gtoRead,            // GTO line: small blurb (the answer)
        result,             // verdict + compact comparison + opponent
        gtoExplanation,     // preamble: strategic landscape + option impacts
        optionsAnalysis,    // matrix: every option's pros/cons
        villainRangeBlock,  // deduced villain range — into Test it
        equityHost,         // equity panel mounts here
        h("div", { class: "test-row" }, testBtn)
      );

      fwdBtn = h("button", { type: "button", class: "primary hand-fwd" },
        isLast ? "Submit handful" : "Next hand →");
      fwdBtn.addEventListener("click", async () => {
        if (submitting) return;
        if (!isLast) { handIdx += 1; render(lastGame); return; }
        submitting = true;
        fwdBtn.disabled = true;
        const finalSubs = draft.submissions.map((s) => ({
          scenario_id: s.scenario_id,
          action: s.action,
          confidence: s.confidence,
          note: s.note ? s.note.slice(0, 280) : null,
          submitted_at: new Date().toISOString(),
        }));
        try {
          const res = await submitHandful(gameId, draft.roundIndex, finalSubs);
          if (!res.success) {
            errorBox.textContent = "Submit failed (" + res.status + "). Try again.";
            submitting = false;
            fwdBtn.disabled = false;
            return;
          }
          draft = null;
          submitting = false;
          // The Firestore write triggers a snapshot, which re-renders into
          // the waiting / reveal view.
        } catch (err) {
          console.error(err);
          errorBox.textContent = "Network error. Try again.";
          submitting = false;
          fwdBtn.disabled = false;
        }
      });
    }

    // On reveal (fwdBtn = Next hand → / Submit handful) we anchor the
    // nav row to the top of the viewport as a sticky pane, so the user
    // can advance from any scroll position. During decide (fwdBtn is
    // null because lock-in lives inside the form), the nav row stays
    // at the bottom with just the Back button.
    const isReveal = !!fwdBtn;
    const navRow = h("div", { class: "hand-nav" + (isReveal ? " hand-nav-sticky" : "") }, backBtn, fwdBtn || null);

    container.appendChild(h(
      "section",
      { class: "in-game my-turn" },
      progress,
      isReveal ? navRow : null,
      h("div", { class: "hand-card" }, spot, body),
      errorBox,
      !isReveal ? navRow : null
    ));
  }

  function renderWaiting(round, game, myUid) {
    const oppUid = (game.participantUids || []).find((u) => u !== myUid);
    const oppName = oppUid ? getDisplayName(game, oppUid) : "your opponent";
    const oppFirst = (oppName || "").split(/\s+/)[0] || oppName;

    // Opponent activity interpretation — does the user have any signal
    // for whether the opponent is coming back? Uses lastSubmittedAt[opp]
    // when present, else falls back to the game's lastActivityAt or
    // createdAt. Threshold mirrors the active-games panel: 7+ days =
    // stalled.
    const lastSubMap = game.lastSubmittedAt || {};
    const oppLastIso = (oppUid && lastSubMap[oppUid]) || null;
    let activityText = "";
    let isStalled = false;
    if (oppLastIso) {
      activityText = oppFirst + " last submitted " + friendlyAgoStr(oppLastIso) + ".";
      isStalled = daysAgoFromIso(oppLastIso) >= 7;
    } else {
      // Opponent joined but never submitted. Prefer the joinedAt
      // timestamp from participants[] so the user can see exactly
      // when she arrived ("Mom joined 2 hours ago"); fall back to
      // the game's last-activity timestamp if for some reason the
      // join time isn't recorded.
      const oppParticipant = (game.participants || []).find((p) => p.uid === oppUid);
      const joinedIso = oppParticipant ? oppParticipant.joinedAt : null;
      const referenceIso = joinedIso || game.lastActivityAt || game.createdAt;
      activityText = joinedIso
        ? oppFirst + " joined " + friendlyAgoStr(joinedIso) + " — hasn't submitted any rounds yet."
        : oppFirst + " hasn't submitted any rounds yet (game " + (referenceIso ? friendlyAgoStr(referenceIso) : "recently") + ").";
      if (referenceIso && daysAgoFromIso(referenceIso) >= 7) isStalled = true;
    }

    // Back-to-home button — drops the active-game pointer and reloads
    // the landing page, where the user can resume this game from the
    // active-games panel anytime, or cancel it if it's gone stale.
    const homeBtn = h("button", { type: "button", class: "primary waiting-back" }, "← Back to home");
    homeBtn.addEventListener("click", () => {
      writeActiveGameId(null);
      const base = location.origin + location.pathname;
      location.assign(base);
    });

    const stalledBadge = isStalled
      ? h("div", { class: "waiting-stalled-badge" }, "⚠ Stalled — no opponent activity for 7+ days")
      : null;

    container.appendChild(h(
      "section",
      { class: "in-game waiting" + (isStalled ? " is-stalled" : "") },
      h("h2", null, "Waiting for " + oppName),
      stalledBadge,
      h("p", { class: "waiting-activity" + (isStalled ? " is-stalled" : " muted") }, activityText),
      h("p", { class: "muted" }, "You submitted your handful for this round. We'll show the results once " + oppFirst + " submits theirs."),
      h("p", { class: "muted" }, "You can close this page — the game's saved. It'll pick up right here the next time you open the app."),
      h("div", { class: "waiting-actions" }, homeBtn)
    ));
  }

  // Friendly relative-time formatter ("3 hours ago", "5 days ago"). Kept
  // local to ui.js — the active-games panel has its own copy in
  // onboarding.js; the two could be promoted to a shared util later.
  function friendlyAgoStr(iso) {
    if (!iso) return "recently";
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return "recently";
    const minutes = ms / 60000;
    if (minutes < 60) {
      const m = Math.max(1, Math.round(minutes));
      return m === 1 ? "1 minute ago" : m + " minutes ago";
    }
    const hours = minutes / 60;
    if (hours < 24) {
      const h = Math.round(hours);
      return h === 1 ? "1 hour ago" : h + " hours ago";
    }
    const days = hours / 24;
    if (days < 30) {
      const d = Math.round(days);
      return d === 1 ? "1 day ago" : d + " days ago";
    }
    const months = days / 30;
    if (months < 12) {
      const mo = Math.round(months);
      return mo === 1 ? "1 month ago" : mo + " months ago";
    }
    return "over a year ago";
  }
  function daysAgoFromIso(iso) {
    if (!iso) return 0;
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return 0;
    return ms / 86400000;
  }

  function renderReveal(round, game, myUid) {
    const uids = (game.participantUids || []).slice();
    const [a, b] = uids;
    const aName = getDisplayName(game, a);
    const bName = getDisplayName(game, b);
    const reveals = h("div", { class: "reveal-list" });
    round.scenarioIds.forEach((id, idx) => {
      const scen = getScenarioById(id);
      if (!scen) return;
      const subsA = (round.submissionsByUid && round.submissionsByUid[a]) || [];
      const subsB = (round.submissionsByUid && round.submissionsByUid[b]) || [];
      const subA = Array.isArray(subsA) ? subsA[idx] : null;
      const subB = Array.isArray(subsB) ? subsB[idx] : null;
      const gto = scen.gto_action;
      const aRight = subA && subA.action === gto;
      const bRight = subB && subB.action === gto;
      const card = h("div", { class: "reveal-card" },
        h("h3", null, "Scenario " + (idx + 1) + ": " + scen.lesson_tag),
        h("p", { class: "scenario-desc" }, richText(scen.description, scen)),
        h("div", { class: "player-result" },
          h("strong", null, aName),
          h("span", { class: aRight ? "ok" : "miss" }, subA ? subA.action : "—"),
          h("span", { class: "conf" }, "Conf: ", String(subA ? subA.confidence : "-")),
          subA && subA.note ? h("p", { class: "player-note" }, "“", subA.note, "”") : null
        ),
        h("div", { class: "player-result" },
          h("strong", null, bName),
          h("span", { class: bRight ? "ok" : "miss" }, subB ? subB.action : "—"),
          h("span", { class: "conf" }, "Conf: ", String(subB ? subB.confidence : "-")),
          subB && subB.note ? h("p", { class: "player-note" }, "“", subB.note, "”") : null
        ),
        h("div", { class: "gto-line" },
          h("strong", null, "GTO answer: "),
          h("span", { class: "gto-action" }, gto)
        ),
        h("p", { class: "gto-explanation" }, richText(scen.gto_explanation, scen))
      );
      reveals.appendChild(card);
    });

    container.appendChild(h(
      "section",
      { class: "in-game reveal" },
      h("h2", null, "Round " + (round.roundIndex + 1) + " reveal"),
      h("p", { class: "muted" }, "Both submitted. Here's how you each played the spots, and what the GTO answer was."),
      reveals,
      h("p", { class: "muted" }, "Next round will load automatically once your opponent opens the app.")
    ));
  }

  unsub = readGame(
    gameId,
    (g) => {
      if (!g) return;
      lastGame = g;
      render(g);
    },
    (err) => { console.warn("in-game game read failed:", (err && err.code) || err); }
  );

  return {
    unmount: () => {
      if (unsub) unsub();
      if (replayCleanup) { try { replayCleanup(); } catch (_) {} }
      clear(container);
    },
  };
}

// -----------------------------------------------------------------------
// mountWrapUpView
// -----------------------------------------------------------------------

export function mountWrapUpView(container, gameId, opts) {
  opts = opts || {};
  let unsub = null;

  function render(game) {
    clear(container);
    const uids = (game.participantUids || []).slice();
    if (uids.length < 2) {
      container.appendChild(h("p", null, "Game not yet complete."));
      return;
    }
    const [a, b] = uids;
    const aName = getDisplayName(game, a);
    const bName = getDisplayName(game, b);
    const acc = perPlayerAccuracy(game);
    const agree = interPlayerAgreement(game);
    const disagree = rankedDisagreements(game);

    // Save this finished game to local history (idempotent — keyed by gameId).
    const myUid = getCurrentUid();
    const oppUid = uids.find((u) => u !== myUid) || b;
    recordGame({
      gameId,
      completedAt: new Date().toISOString(),
      myName: getDisplayName(game, myUid),
      opponentName: getDisplayName(game, oppUid),
      rounds: (game.rounds || []).length,
      handfulSize: game.rounds[0] ? game.rounds[0].scenarioIds.length : 0,
      myCorrect: acc[myUid] ? acc[myUid].correct : 0,
      myTotal: acc[myUid] ? acc[myUid].total : 0,
      myPct: acc[myUid] ? acc[myUid].pct : 0,
      oppCorrect: acc[oppUid] ? acc[oppUid].correct : 0,
      oppTotal: acc[oppUid] ? acc[oppUid].total : 0,
      oppPct: acc[oppUid] ? acc[oppUid].pct : 0,
      agreeSame: agree.same,
      agreeTotal: agree.total,
      agreePct: agree.pct,
    });

    const accuracySection = h("section", { class: "wrap-accuracy" },
      h("h3", null, "Individual performance"),
      h("div", { class: "stats-row" },
        h("div", { class: "stat-block" },
          h("div", { class: "stat-name" }, aName),
          h("div", { class: "stat-pct" }, String(acc[a].pct) + "%"),
          h("div", { class: "stat-detail" }, acc[a].correct + " / " + acc[a].total + " matched GTO")
        ),
        h("div", { class: "stat-block" },
          h("div", { class: "stat-name" }, bName),
          h("div", { class: "stat-pct" }, String(acc[b].pct) + "%"),
          h("div", { class: "stat-detail" }, acc[b].correct + " / " + acc[b].total + " matched GTO")
        )
      )
    );

    const agreementSection = h("section", { class: "wrap-agreement" },
      h("h3", null, "How often you agreed"),
      h("div", { class: "stat-block big" },
        h("div", { class: "stat-pct" }, String(agree.pct) + "%"),
        h("div", { class: "stat-detail" }, agree.same + " of " + agree.total + " spots, you both picked the same action")
      )
    );

    const disagreementList = h("ol", { class: "disagreement-list" });
    if (disagree.length === 0) {
      disagreementList.appendChild(h("li", { class: "muted" }, "You agreed on every spot. That's either harmonious or suspicious."));
    } else {
      disagree.forEach((d) => {
        const card = h("li", { class: "disagreement-card" },
          h("div", { class: "dis-header" },
            h("strong", null, "Joint confidence: " + d.joint_confidence_min + " (min of " + d.playerA_confidence + ", " + d.playerB_confidence + ")"),
            h("span", { class: "muted" }, " Round " + (d.roundIndex + 1))
          ),
          h("h4", null, d.scenario ? d.scenario.lesson_tag : d.scenario_id),
          // Render description with HERO/VILLAIN labels — wrap-up users
          // have played multiple positions across many spots and shouldn't
          // need to track which seat they were in each one.
          h("p", { class: "scenario-desc" }, d.scenario ? richText(d.scenario.description, d.scenario, { actorLabels: true }) : ""),
          h("div", { class: "dis-row" },
            h("strong", null, aName + ": "), d.playerA_action, " (conf " + d.playerA_confidence + ")",
            d.playerA_note ? h("p", { class: "player-note" }, "“" + d.playerA_note + "”") : null
          ),
          h("div", { class: "dis-row" },
            h("strong", null, bName + ": "), d.playerB_action, " (conf " + d.playerB_confidence + ")",
            d.playerB_note ? h("p", { class: "player-note" }, "“" + d.playerB_note + "”") : null
          ),
          h("div", { class: "dis-row gto" },
            h("strong", null, "GTO: "), d.scenario ? d.scenario.gto_action : "—"
          ),
          d.scenario ? h("p", { class: "gto-explanation" }, richText(d.scenario.gto_explanation, d.scenario, { actorLabels: true })) : null
        );
        disagreementList.appendChild(card);
      });
    }

    const disagreementSection = h("section", { class: "wrap-disagreements" },
      h("h3", null, "Where you both felt sure and disagreed"),
      h("p", { class: "muted" }, "Spots where you picked different actions, ranked by how confident you both were. These are the conversations worth having."),
      disagreementList
    );

    // Rematch + navigation controls.
    const base = location.origin + location.pathname;
    const errorBox = h("div", { class: "error", role: "alert" });
    let rematchControl;
    if (game.rematchGameId) {
      if (game.rematchBy === myUid) {
        rematchControl = h("button", { type: "button", class: "primary" }, "Go to your rematch");
        rematchControl.addEventListener("click", () => {
          writeActiveGameId(game.rematchGameId);
          location.assign(base);
        });
      } else {
        rematchControl = h("button", { type: "button", class: "primary" }, "Join the rematch");
        rematchControl.addEventListener("click", async () => {
          rematchControl.disabled = true;
          errorBox.textContent = "";
          try {
            const res = await joinGame(game.rematchGameId);
            if (res && res.error) {
              errorBox.textContent = "Could not join the rematch (" + res.error + ").";
              rematchControl.disabled = false;
              return;
            }
            writeActiveGameId(res.gameId);
            location.assign(base);
          } catch (err) {
            console.error(err);
            errorBox.textContent = "Could not join the rematch. Check your connection.";
            rematchControl.disabled = false;
          }
        });
      }
    } else {
      rematchControl = h("button", { type: "button", class: "primary" }, "Rematch — same settings");
      rematchControl.addEventListener("click", async () => {
        rematchControl.disabled = true;
        errorBox.textContent = "";
        try {
          const { gameId: newId } = await createGame({
            rounds: game.config.rounds,
            handful_size: game.config.handful_size,
          });
          try { await setRematchGameId(gameId, newId, myUid); } catch (_) {}
          writeActiveGameId(newId);
          location.assign(base);
        } catch (err) {
          console.error(err);
          errorBox.textContent = "Could not start a rematch. Check your connection and try again.";
          rematchControl.disabled = false;
        }
      });
    }
    const homeBtn = h("button", { type: "button", class: "secondary" }, "Back to home");
    homeBtn.addEventListener("click", () => {
      writeActiveGameId(null);
      location.assign(base);
    });
    const wrapActions = h("section", { class: "wrap-actions" },
      rematchControl,
      homeBtn,
      errorBox
    );

    container.appendChild(h(
      "section",
      { class: "wrap-up" },
      h("h2", null, "Game complete"),
      h("p", { class: "muted" }, "You played " + (game.rounds || []).length + " rounds, " + (game.rounds[0] ? game.rounds[0].scenarioIds.length : 0) + " spots each."),
      accuracySection,
      agreementSection,
      disagreementSection,
      wrapActions
    ));
  }

  if (opts.reuseGame) {
    render(opts.reuseGame);
    return { unmount: () => clear(container) };
  }
  unsub = readGame(
    gameId,
    (g) => { if (g) render(g); },
    (err) => { console.warn("wrap-up game read failed:", (err && err.code) || err); }
  );
  return {
    unmount: () => {
      if (unsub) unsub();
      clear(container);
    },
  };
}
