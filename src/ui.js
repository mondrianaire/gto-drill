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
import { mountReplay, cardEl, liveVillains } from "./replay.js";
import { mountEquityPanel } from "./equity-panel.js";
import { buildTermRegex, lookupTerm } from "./dictionary.js";
import { wireTermTrigger } from "./tooltip.js";

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
//   1 = card run (1+ space-separated codes with explicit suits)
//   2 = position chip (UTG|HJ|CO|BTN|SB|BB)
//   3 = Hero/Villain word
//   4 = "Nbb" / "N.Nbb" → stylized bb chip
//   5 = "K?" → unknown-suit card (suit not yet determined)
//   6 = "Kx" → doesn't-matter-suit card (analyst says suit irrelevant)
//   7 = "K72" / "K72r" / "K72 rainbow" → multi-card rainbow board (3-5 ranks)
//   8 = "KK" / "AA" / "AK" / "JT" → 2-rank hand-class shorthand (pair or non-pair)
// Order matters for regex alternation: longer/more-specific patterns first.
// Group 7 (3-5 ranks) is listed before group 8 (2 ranks) so multi-card
// boards aren't truncated to a 2-rank hand class.
const RICH_RE = /((?:[2-9TJQKA][cdhs])(?:\s+[2-9TJQKA][cdhs])*)\b|\b(UTG|HJ|CO|BTN|SB|BB)\b|\b([Hh]ero|[Vv]illain)\b|\b(\d+(?:\.\d+)?)bb\b|\b([2-9TJQKA])\?|\b([2-9TJQKA])x\b|\b([2-9TJQKA]{3,5})(?:r\b|\s+rainbow\b)?|\b([2-9TJQKA]{2})\b/g;

/** Escape regex meta-characters for safe use inside a constructed RegExp. */
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Tokenize a chunk of prose (no anchor handling) into card icons + chips. */
function tokenizeProse(text, scen) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const heroPos = scen && scen.replay ? scen.replay.hero_seat : null;
  const villains = liveVillains(scen && scen.replay);
  const known = knownCards(scen);
  RICH_RE.lastIndex = 0;
  let last = 0;
  let m;
  while ((m = RICH_RE.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[1]) {
      const codes = m[1].split(/\s+/);
      // Multi-card runs are always iconified; a lone code only if it's a
      // card actually in play (avoids "As"/"Ah" English-word false hits).
      if (codes.length >= 2 || known.has(codes[0])) {
        codes.forEach((c) => frag.appendChild(cardEl(c, "inline")));
      } else {
        frag.appendChild(document.createTextNode(m[1]));
      }
    } else if (m[2]) {
      const pos = m[2];
      const role = pos === heroPos ? " is-hero" : villains.includes(pos) ? " is-villain" : "";
      frag.appendChild(h("span", { class: "tok-pos" + role }, pos));
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
      // "K72" / "K72r" / "K72 rainbow" → multi-card rainbow board.
      // Render each rank as a card with a rainbow-stripe suit indicator.
      const ranks = m[7];
      for (let i = 0; i < ranks.length; i++) {
        const r = ranks[i];
        frag.appendChild(h("span", { class: "tok-rainbow", title: r + " — rainbow board (any of 4 suits, all different)" },
          h("span", { class: "tok-rainbow-rank" }, r === "T" ? "10" : r),
          h("span", { class: "tok-rainbow-suit", "aria-hidden": "true" })));
      }
    } else if (m[8]) {
      // 2-rank hand-class shorthand ("KK", "AA", "AK", "JT", etc.) — render
      // as two doesn't-matter cards. Each card is just a big rank — the
      // empty suit slot conveys "any suit". Reads as "any K + any K" or
      // "any A + any K" — which is what the shorthand means.
      const ranks = m[8];
      for (let i = 0; i < ranks.length; i++) {
        const r = ranks[i];
        frag.appendChild(h("span", { class: "tok-anysuit tok-anysuit-doesntmatter", title: r + " — any suit" },
          h("span", { class: "tok-anysuit-rank" }, r === "T" ? "10" : r)));
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
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
 * @param {{ onRangeClick?: (range:any) => void }} [opts]
 * @returns {DocumentFragment}
 */
export function richText(text, scen, opts) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const ranges = (scen && Array.isArray(scen.villain_ranges)) ? scen.villain_ranges : [];
  const onRangeClick = opts && opts.onRangeClick;
  if (!ranges.length || !onRangeClick) {
    frag.appendChild(wrapDictionaryTerms(tokenizeProse(text, scen)));
    return frag;
  }
  // Longest anchor first so "BB's 3-bet range" wins over "3-bet range".
  const sorted = ranges.slice().sort((a, b) => b.anchor.length - a.anchor.length);
  const anchorRe = new RegExp("(" + sorted.map((r) => reEscape(r.anchor)).join("|") + ")", "g");
  let last = 0;
  let m;
  while ((m = anchorRe.exec(text))) {
    if (m.index > last) frag.appendChild(wrapDictionaryTerms(tokenizeProse(text.slice(last, m.index), scen)));
    const matched = m[1];
    const range = sorted.find((r) => r.anchor === matched);
    // Tokenize the chip's own text too so bb chips / any-suit / etc.
    // appear consistently INSIDE range chips, not just around them.
    frag.appendChild(makeRangeChip(tokenizeProse(matched, scen), range, onRangeClick));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(wrapDictionaryTerms(tokenizeProse(text.slice(last), scen)));
  return frag;
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
  const termRe = buildTermRegex();
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
    const headerBar = h("div", { class: "game-header" },
      h("span", null, "Round ", String((phase.currentRoundIndex || 0) + 1), " of ", String(game.rounds.length))
    );
    container.appendChild(headerBar);

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
      const r = mountReplay(replayHost, scen.replay);
      replayCleanup = r && r.unmount ? r.unmount : null;
      spot.appendChild(h("details", { class: "hand-words" },
        h("summary", null, "The spot in words"),
        h("p", null, richText(scen.description, scen))
      ));
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

    let body, fwdBtn;

    if (!sub.revealed) {
      // ===================== DECIDE =====================
      const actionRow = h("div", { class: "actions-row", role: "radiogroup", "aria-label": "Your move" });
      (scen ? scen.available_actions : []).forEach((a) => {
        // Run the action label through richText so bb chips / pot-%s /
        // any token style applies consistently with the prose voice.
        const btn = h("button", { type: "button", class: "action-btn" + (sub.action === a ? " selected" : "") }, richText(a, scen));
        btn.addEventListener("click", () => {
          sub.action = a;
          actionRow.querySelectorAll(".action-btn").forEach((x) => x.classList.toggle("selected", x === btn));
          errorBox.textContent = "";
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

      body = h("div", { class: "decide" },
        h("span", { class: "decide-label" }, "Your move"),
        actionRow,
        h("span", { class: "decide-label decide-label-sub" }, "How sure?  (1 = guess, 5 = certain)"),
        confRow,
        noteToggle
      );

      fwdBtn = h("button", { type: "button", class: "primary hand-fwd" }, "Lock in & see GTO →");
      fwdBtn.addEventListener("click", () => {
        if (!sub.action) { errorBox.textContent = "Pick your move for this hand."; return; }
        if (!sub.confidence) { errorBox.textContent = "Rate how sure you are (1–5)."; return; }
        sub.revealed = true;
        render(lastGame);
      });
    } else {
      // ===================== REVEAL =====================
      const gto = scen ? scen.gto_action : "";
      const correct = sub.action === gto;

      const result = h("div", { class: "hand-result" + (correct ? " is-ok" : " is-miss") },
        h("div", { class: "result-verdict" }, correct ? "✓ You matched the GTO line" : "✗ Off the GTO line"),
        h("div", { class: "result-picks" },
          h("div", null,
            h("span", { class: "muted" }, "You played  "),
            h("strong", { class: correct ? "ok" : "miss" }, richText(sub.action, scen)),
            h("span", { class: "muted" }, "   ·   confidence " + sub.confidence + "/5")),
          h("div", null,
            h("span", { class: "muted" }, "GTO line  "),
            h("strong", { class: "gto-action" }, richText(gto, scen)))
        )
      );
      // "Test it!" — Monte Carlo equity vs a user-picked villain range.
      // (Declared up here so inline range chips in the explanation prose can
      // call into the same panel.)
      const testHost = h("div", { class: "test-host" });
      const eqState = { open: false, handle: null };
      const testBtn = h("button", { type: "button", class: "secondary test-it" }, "🎲  Test it — equity vs a range");
      function closeEquityPanel() {
        if (eqState.handle) eqState.handle.unmount();
        eqState.handle = null;
        eqState.open = false;
        testBtn.textContent = "🎲  Test it — equity vs a range";
      }
      function openEquityWithRange(range) {
        const classes = (range && range.classes) || [];
        const label = (range && range.label) || "";
        if (eqState.open && eqState.handle) {
          eqState.handle.setRange(classes, label);
        } else {
          eqState.handle = mountEquityPanel(testHost, scen, { initialRange: classes, initialRangeLabel: label });
          eqState.open = true;
          testBtn.textContent = "Hide equity panel";
        }
        if (eqState.handle && eqState.handle.root && eqState.handle.root.scrollIntoView) {
          eqState.handle.root.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
      testBtn.addEventListener("click", () => {
        if (eqState.open) { closeEquityPanel(); return; }
        // Auto-load the LAST chip in the scenario's GTO explanation, if any.
        // Scenarios without a named villain range fall through to standalone
        // mode (empty matrix + "Tap Customize…" hint).
        const ranges = (scen && scen.villain_ranges) || [];
        const last = ranges.length ? ranges[ranges.length - 1] : null;
        if (last) {
          openEquityWithRange({
            classes: last.classes,
            label: "Auto-loaded: " + last.label,
          });
        } else {
          openEquityWithRange(null);
        }
      });

      const explain = h("p", { class: "gto-explanation" }, scen
        ? richText(scen.gto_explanation, scen, { onRangeClick: openEquityWithRange })
        : "");

      // Opponent comparison — only when the opponent has already played this hand.
      const oppUid = (game.participantUids || []).find((u) => u !== myUid);
      const oppSubs = oppUid && round.submissionsByUid ? round.submissionsByUid[oppUid] : null;
      const oppSub = Array.isArray(oppSubs) ? oppSubs[handIdx] : null;
      let oppBlock = null;
      if (oppSub && oppSub.action) {
        const oppName = getDisplayName(game, oppUid);
        const agree = oppSub.action === sub.action;
        oppBlock = h("div", { class: "hand-opp" },
          h("div", null,
            h("strong", null, oppName + " played  "),
            h("strong", { class: oppSub.action === gto ? "ok" : "miss" }, oppSub.action),
            h("span", { class: "muted" }, "   ·   confidence " + (oppSub.confidence || "-") + "/5")),
          h("div", { class: "hand-agree muted" }, agree
            ? "You both made the same call."
            : "You and " + oppName + " disagreed here."),
          oppSub.note ? h("p", { class: "player-note" }, "“" + oppSub.note + "”") : null
        );
      }

      body = h("div", { class: "hand-reveal" },
        result,
        explain,
        oppBlock,
        h("div", { class: "test-row" }, testBtn),
        testHost
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
      h("div", { class: "hand-nav" }, backBtn, fwdBtn)
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
          h("p", { class: "scenario-desc" }, d.scenario ? richText(d.scenario.description, d.scenario) : ""),
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
          d.scenario ? h("p", { class: "gto-explanation" }, richText(d.scenario.gto_explanation, d.scenario)) : null
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
