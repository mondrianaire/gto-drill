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
//   7 = "K72" board run (3-5 ranks) — rendered as N default doesn't-matter
//       cards; the OPTIONAL group-8 modifier appends a board-modifier glyph.
//   8 = board modifier suffix: "r" / " rainbow" / "m" / "mono" / " monotone"
//       / "tt" / " two-tone" / " two-toned". Group 7's ranks render as
//       cards, then group 8 (if present) renders the appropriate modifier
//       glyph alongside, so the math composes: (K72) + (rainbow) glyph.
//   9 = "KK" / "AA" / "AK" / "JT" → 2-rank hand-class shorthand
//  10 = optional suited/offsuit suffix on group 9: "s" or "o" — tightly
//       bound (no space) per poker convention ("AKs", not "AK s"). When
//       present, a small suited/offsuit marker pill sits next to the cards.
// Order matters for regex alternation: longer/more-specific patterns first.
// Group 9's negative lookahead prevents "75% pot" / "25-40% frequency" /
// "25/40% mix" from rendering "75" or "25" as a 2-rank hand class:
//   - `\s*%`           → "75%"
//   - `\s*-\d+\s*%`    → "25-40%"
//   - `\s*[/—]\d+\s*%` → "25/40%"
// Percentages share digit vocab with rank shorthand; the trailing %
// (possibly via a range) is the distinguishing cue.
const RICH_RE = /((?:[2-9TJQKA][cdhs])(?:\s*[2-9TJQKA][cdhs])*)\b|\b(UTG|HJ|CO|BTN|SB|BB)\b|\b([Hh]ero|[Vv]illain)\b|\b(\d+(?:\.\d+)?)bb\b|\b([2-9TJQKA])\?|\b([2-9TJQKA])x\b|\b([2-9TJQKA]{3,5})(\s+rainbow\b|\s+monotone\b|\s+two-toned?\b|\s*mono\b|\s*tt\b|r\b|m\b)?|\b([2-9TJQKA]{2})(s|o)?\b(?!\s*(?:[-/–—]\s*\d+)?\s*%)/g;

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
      if (codes.length >= 2 || known.has(codes[0])) {
        codes.forEach((c) => frag.appendChild(cardEl(c, "inline")));
      } else {
        frag.appendChild(document.createTextNode(m[1]));
      }
    } else if (m[2]) {
      const pos = m[2];
      const isHero = pos === heroPos;
      const isVillain = villains.includes(pos);
      const role = isHero ? " is-hero" : isVillain ? " is-villain" : "";
      // In actor-label mode, replace the position name with HERO/VILLAIN
      // for the actors. Folded / non-actor positions keep their position
      // name (they're contextual, not the actors we're discussing).
      let label = pos;
      if (actorLabels) {
        if (isHero) label = "HERO";
        else if (isVillain) label = "VILLAIN";
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
      // 3-5 rank board run — render as N default doesn't-matter cards,
      // then append a board-modifier glyph if a suffix was captured.
      // Composition: (K72)(rainbow) = three default cards + rainbow bar.
      const ranks = m[7];
      for (let i = 0; i < ranks.length; i++) {
        const r = ranks[i];
        frag.appendChild(h("span", { class: "tok-anysuit tok-anysuit-doesntmatter", title: r + " — any suit" },
          h("span", { class: "tok-anysuit-rank" }, r === "T" ? "10" : r)));
      }
      const modRaw = m[8];
      if (modRaw) {
        const mod = modRaw.trim().toLowerCase();
        let kind = null;
        let label = null;
        if (mod === "rainbow" || mod === "r") { kind = "rainbow"; label = "Rainbow — all suits different"; }
        else if (mod === "monotone" || mod === "m" || mod === "mono") { kind = "monotone"; label = "Monotone — all one suit"; }
        else if (mod === "two-tone" || mod === "two-toned" || mod === "tt") { kind = "twotone"; label = "Two-tone — two suits"; }
        if (kind) {
          frag.appendChild(h("span", {
            class: "tok-modifier tok-modifier-" + kind,
            title: label,
            "aria-label": label,
          }));
        }
      }
    } else if (m[9]) {
      // 2-rank hand-class shorthand ("KK", "AA", "AK", "JT", etc.) — render
      // as two doesn't-matter cards each. Reads as "any K + any K" or
      // "any A + any K" — which is what the shorthand means. The OPTIONAL
      // group-10 suffix ("s" suited or "o" offsuit) appends a small
      // marker pill so AKs reads as cards + suited badge, AKo as cards +
      // offsuit badge. (Pairs can't be suited; if someone writes "KKs"
      // we silently drop the suffix — the pair already implies offsuit.)
      const ranks = m[9];
      for (let i = 0; i < ranks.length; i++) {
        const r = ranks[i];
        frag.appendChild(h("span", { class: "tok-anysuit tok-anysuit-doesntmatter", title: r + " — any suit" },
          h("span", { class: "tok-anysuit-rank" }, r === "T" ? "10" : r)));
      }
      const suffix = m[10];
      if (suffix && ranks[0] !== ranks[1]) {
        const isSuited = suffix === "s";
        const label = isSuited ? "Suited — same suit" : "Offsuit — different suits";
        frag.appendChild(h("span", {
          class: "tok-suit-suffix tok-suit-suffix-" + (isSuited ? "s" : "o"),
          title: label,
          "aria-label": label,
        }));
      }
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
  const list = h("div", { class: "villain-range-list" });
  for (const range of ranges) {
    const card = h(
      "div",
      { class: "villain-range-card" + (onRangeClick ? " is-clickable" : ""),
        role: onRangeClick ? "button" : null,
        tabindex: onRangeClick ? "0" : null,
        title: onRangeClick ? "Tap to test equity vs this range" : null },
      h("div", { class: "villain-range-card-header" },
        h("span", { class: "villain-range-card-label" }, range.label || "Range"),
        onRangeClick ? h("span", { class: "villain-range-card-icon", "aria-hidden": "true" }, "🎲") : null
      ),
      range.summary ? h("div", { class: "villain-range-card-summary" }, range.summary) : null
    );
    if (onRangeClick) {
      card.addEventListener("click", (ev) => { ev.preventDefault(); onRangeClick(range); });
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onRangeClick(range); }
      });
    }
    list.appendChild(card);
  }
  return h("div", { class: "villain-range-block" },
    h("div", { class: "villain-range-label" },
      h("span", null, "Villain's range"),
      onRangeClick ? h("span", { class: "spot-context-hint muted" }, " — tap to test equity") : null
    ),
    list
  );
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

      // Villain range justification (now placed just above Test it) +
      // spot framing (strategic WHY, sits between verdict and range).
      const villainRangeBlock = buildVillainRangeBlock({ scen, onRangeClick: openEquityWithRange });
      const spotFraming = buildSpotFramingBlock({ scen, onRangeClick: openEquityWithRange });

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

      body = h("div", { class: "hand-reveal" },
        gtoRead,            // GTO line: small blurb
        result,             // verdict + compact comparison + opponent
        spotFraming,        // THE SPOT — strategic WHY (range/board/SPR)
        villainRangeBlock,  // villain range — leads straight into Test it
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

    container.appendChild(h(
      "section",
      { class: "in-game my-turn" },
      progress,
      h("div", { class: "hand-card" }, spot, body),
      errorBox,
      h("div", { class: "hand-nav" }, backBtn, fwdBtn || null)
    ));
  }

  function renderWaiting(round, game, myUid) {
    const oppUid = (game.participantUids || []).find((u) => u !== myUid);
    const oppName = oppUid ? getDisplayName(game, oppUid) : "your opponent";
    container.appendChild(h(
      "section",
      { class: "in-game waiting" },
      h("h2", null, "Waiting for " + oppName),
      h("p", { class: "muted" }, "You submitted your handful for this round. We'll show the results once " + oppName + " submits theirs."),
      h("p", { class: "muted" }, "You can close this page — the game's saved. It'll pick up right here the next time you open the app.")
    ));
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
