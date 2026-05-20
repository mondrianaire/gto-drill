// replay.js — visual poker-hand replayer.
//
// Renders a scenario's structured `replay` object (see the Replay typedef in
// scenarios.js) as a poker table that can be stepped through action-by-action
// up to the quiz decision point. Pure DOM + CSS — no framework, no assets:
// cards are drawn with CSS so nothing extra has to load.

// -----------------------------------------------------------------------
// Tiny DOM helper (kept local, like the other view modules).
// -----------------------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

const STREETS = ["preflop", "flop", "turn", "river"];
const SUITS = {
  c: { glyph: "♣", red: false },
  d: { glyph: "♦", red: true },
  h: { glyph: "♥", red: true },
  s: { glyph: "♠", red: false },
};

// -----------------------------------------------------------------------
// Card rendering
// -----------------------------------------------------------------------

/**
 * A single playing card. `code` like "Kd"/"Tc"; null/undefined = face down.
 * `size` is "sm" (small table card), "inline" (text-flow card) or default.
 */
export function cardEl(code, size) {
  let cls = "pcard";
  if (size === "sm") cls += " pcard-sm";
  else if (size === "inline") cls += " pcard-inline";
  if (!code) return h("div", { class: cls + " pcard-back" });
  const rank = code[0] === "T" ? "10" : code[0];
  const suit = SUITS[code[1]] || { glyph: "?", red: false };
  return h(
    "div",
    { class: cls + (suit.red ? " pcard-red" : "") },
    h("span", { class: "pcard-rank" }, rank),
    h("span", { class: "pcard-suit" }, suit.glyph)
  );
}

function fmtBb(n) {
  return (Number.isInteger(n) ? String(n) : String(n)) + "bb";
}

/**
 * DOM equivalent of fmtBb — returns a bb-chip element matching the
 * .tok-bb visual used throughout the app's prose. Use this for visual
 * displays (pot, stack, bet bubble, table-info bar) so the bb voice is
 * consistent everywhere. The text version fmtBb is still used inside
 * `describeAction()` because action-log lines are plain text.
 */
function bbChip(n) {
  return h("span", { class: "tok-bb" },
    h("span", { class: "tok-bb-num" }, String(n)),
    h("span", { class: "tok-bb-unit" }, "bb"));
}

// -----------------------------------------------------------------------
// Replay reducer — derive table state after `step` actions are applied.
// -----------------------------------------------------------------------

function deriveState(replay, step) {
  const seats = {};
  for (const s of replay.seats) {
    seats[s.pos] = { pos: s.pos, stack: s.stack_bb, street: 0, total: 0, folded: false };
  }
  let pot = replay.starting_pot_bb || 0;
  const allActions = replay.actions || [];
  const applied = allActions.slice(0, step);
  let curStreet = "preflop";
  for (const a of applied) {
    if (a.street !== curStreet) {
      // Street changed — sweep this street's bets into the pot.
      for (const p of Object.values(seats)) { pot += p.street; p.street = 0; }
      curStreet = a.street;
    }
    const seat = seats[a.actor];
    if (!seat) continue;
    if (a.type === "fold") {
      seat.folded = true;
    } else if (a.type === "bet" || a.type === "raise" || a.type === "call") {
      const add = (a.amount_bb || 0) - seat.street;
      seat.street += add;
      seat.total += add;
      seat.stack -= add;
    } else if (a.type === "post") {
      seat.street += a.amount_bb || 0;
      seat.total += a.amount_bb || 0;
      seat.stack -= a.amount_bb || 0;
    }
  }
  // Determine the street to show on the table. Normal case: the street of
  // the last applied action. EXCEPTION: when we're at the decision point
  // AND the next street has been DEALT (i.e. scen.replay.board has cards
  // for it), the dealer would have advanced the board between the last
  // action and the hero's decision. Show the new street's cards and sweep
  // any open street-bets into the pot. Fixes scenarios where the hero is
  // first to act on a new street (e.g., BB facing a flop with no preflop
  // continuation from villain).
  let viewStreet = applied.length ? applied[applied.length - 1].street : "preflop";
  if (step === allActions.length) {
    const board = replay.board || {};
    let dealtStreet = "preflop";
    if (board.river && board.river.length) dealtStreet = "river";
    else if (board.turn && board.turn.length) dealtStreet = "turn";
    else if (board.flop && board.flop.length) dealtStreet = "flop";
    const order = ["preflop", "flop", "turn", "river"];
    if (order.indexOf(dealtStreet) > order.indexOf(viewStreet)) {
      // Sweep the still-open street-bets into the pot, then advance.
      for (const p of Object.values(seats)) { pot += p.street; p.street = 0; }
      viewStreet = dealtStreet;
    }
  }
  const liveBets = Object.values(seats).reduce((s, p) => s + p.street, 0);
  return { seats, pot, displayPot: pot + liveBets, viewStreet };
}

// Position label of whoever acts next at this step (the hero, at the
// decision point).
function nextActor(replay, step) {
  const actions = replay.actions || [];
  if (step < actions.length) return actions[step].actor;
  return replay.hero_seat;
}

/**
 * Positions still live in the hand at the decision point, excluding the
 * hero — i.e. the villain(s) the hero is up against. Used to give the
 * villain a shared visual identity in both the table and the GTO prose.
 */
export function liveVillains(replay) {
  if (!replay) return [];
  const { seats } = deriveState(replay, (replay.actions || []).length);
  return Object.values(seats)
    .filter((s) => !s.folded && s.pos !== replay.hero_seat)
    .map((s) => s.pos);
}

/**
 * Pot size in big blinds at the hero's decision point (after all replay
 * actions have been applied, including any live bets on the current
 * street). Returns null if the replay can't yield a usable number — in
 * which case callers should skip pot-relative computations.
 */
export function potAtDecisionBb(replay) {
  if (!replay) return null;
  const { displayPot } = deriveState(replay, (replay.actions || []).length);
  return displayPot > 0 ? displayPot : null;
}

/**
 * Build a compact mini-display of the hand's INFLECTION points up to the
 * decision — replaces the verbose "spot in words" prose. Groups by
 * street and shows only the actions that meaningfully change state:
 *   - bet / raise / call (chips move)
 *   - check (initiative passes — useful context)
 * Skips: posts (defaults), folds (noise).
 *
 * Each street row shows: street label + board cards dealt this street
 * + the inflection actions. The row for the current decision street
 * ends with a "← Hero's turn" arrow so the reader knows where they are.
 *
 * @param {Object} replay
 * @returns {HTMLElement|null}
 */
export function buildSpotSummary(replay) {
  if (!replay) return null;
  const actions = replay.actions || [];
  const heroSeat = replay.hero_seat;
  const board = replay.board || {};

  // Group inflection actions by street
  const bystreet = { preflop: [], flop: [], turn: [], river: [] };
  for (const a of actions) {
    if (a.type === "post" || a.type === "fold") continue;
    if (bystreet[a.street]) bystreet[a.street].push(a);
  }

  // Decision street: latest street with board data (or preflop if no flop).
  let decisionStreet = "preflop";
  if (board.river && board.river.length) decisionStreet = "river";
  else if (board.turn && board.turn.length) decisionStreet = "turn";
  else if (board.flop && board.flop.length) decisionStreet = "flop";

  const STREETS = ["preflop", "flop", "turn", "river"];
  const streetCards = {
    preflop: [],
    flop: board.flop || [],
    turn: board.turn || [],
    river: board.river || [],
  };

  // Actor naming — match the wrap-up convention: hero → "HERO", the
  // single non-hero actor → "VILLAIN". For the rare multi-villain
  // scenarios (2 of 45) keep positions so the reader can tell which
  // opponent is acting.
  const villainSeats = new Set();
  for (const a of actions) {
    if (a.type === "post" || a.type === "fold") continue;
    if (a.actor !== heroSeat) villainSeats.add(a.actor);
  }
  const singleVillain = villainSeats.size === 1;

  // Build the actor identity as a styled chip matching the same
  // tok-pos.is-hero / tok-pos.is-villain visual idiom the rest of the
  // app uses (wrap-up cards, reveal, etc.). Done directly (instead of
  // routing through richText) to avoid a circular import with ui.js.
  function actorChip(seat) {
    if (seat === heroSeat) return h("span", { class: "tok-pos is-hero" }, "HERO");
    if (singleVillain) return h("span", { class: "tok-pos is-villain" }, "VILLAIN");
    return h("span", { class: "tok-pos is-villain" }, seat); // multi-villain: position
  }

  // bb chip — same DOM shape as the rich-text tokenizer's tok-bb chip
  // so the existing CSS just applies.
  function bbChip(amount) {
    return h("span", { class: "tok-bb" },
      h("span", { class: "tok-bb-num" }, String(amount)),
      h("span", { class: "tok-bb-unit" }, "bb")
    );
  }

  // Builds the action as an array of mixed DOM nodes + text. Caller
  // wraps in a .spot-sum-action span.
  function actionNodes(a) {
    const actor = actorChip(a.actor);
    if (a.type === "check") return [actor, document.createTextNode(" checks")];
    if (a.type === "call") {
      const out = [actor, document.createTextNode(" calls")];
      if (a.amount_bb) {
        out.push(document.createTextNode(" "));
        out.push(bbChip(a.amount_bb));
      }
      return out;
    }
    if (a.type === "bet") {
      return [actor, document.createTextNode(" bets "), bbChip(a.amount_bb || 0)];
    }
    if (a.type === "raise") {
      // Name the preflop escalation (open / 3-bet / 4-bet / 5-bet)
      if (a.street === "preflop") {
        let n = 0;
        for (const p of actions) {
          if (p === a) break;
          if (p.street === "preflop" && p.type === "raise") n++;
        }
        const verb = n === 0 ? "opens to" : n === 1 ? "3-bets to" : n === 2 ? "4-bets to" : "5-bets to";
        return [actor, document.createTextNode(" " + verb + " "), bbChip(a.amount_bb || 0)];
      }
      return [actor, document.createTextNode(" raises to "), bbChip(a.amount_bb || 0)];
    }
    return [actor, document.createTextNode(" " + a.type)];
  }

  function streetLabel(s) {
    return { preflop: "PRE", flop: "FLOP", turn: "TURN", river: "RIVER" }[s] || s.toUpperCase();
  }

  const rows = [];
  for (const street of STREETS) {
    const items = bystreet[street];
    const cards = streetCards[street];
    const isDecision = street === decisionStreet;
    // Skip streets that have no actions AND no cards (e.g., turn/river
    // before they're dealt).
    if (!isDecision && items.length === 0 && cards.length === 0) continue;
    const cardsEl = cards.length
      ? h("div", { class: "spot-sum-cards" }, ...cards.map((c) => cardEl(c, "sm")))
      : null;
    const actionsEl = h("div", { class: "spot-sum-actions" });
    items.forEach((a) => {
      // data-step = the replay `step` value AT WHICH this action's
      // effects are on the table (setStep(N) applies actions[0..N-1]).
      // The replay component drives highlight via spotSummary.setStep().
      const stepValue = actions.indexOf(a) + 1;
      const actionEl = h("div", { class: "spot-sum-action" }, ...actionNodes(a));
      actionEl.setAttribute("data-step", String(stepValue));
      actionsEl.appendChild(actionEl);
    });
    // Hero-turn arrow on the decision street (its own line at the end)
    if (isDecision) {
      actionsEl.appendChild(h("div", { class: "spot-sum-yourturn" }, "← your turn"));
    }
    rows.push(h("div", { class: "spot-sum-row" + (isDecision ? " is-decision" : "") },
      h("span", { class: "spot-sum-street" }, streetLabel(street)),
      cardsEl,
      actionsEl
    ));
  }

  if (rows.length === 0) return null;
  const el = h("div", { class: "spot-summary" }, ...rows);
  // setStep(step) — driven by mountReplay's onStep callback. Highlights
  // the action with the largest data-step ≤ step (the most recent
  // action applied at the current replay position). At minStep (before
  // any voluntary action) nothing is highlighted.
  el.setStep = function (step) {
    const all = el.querySelectorAll(".spot-sum-action");
    let current = null;
    all.forEach((a) => {
      a.classList.remove("is-current");
      const s = parseInt(a.getAttribute("data-step"), 10);
      if (!Number.isNaN(s) && s <= step) current = a;
    });
    if (current) current.classList.add("is-current");
  };
  return el;
}

// -----------------------------------------------------------------------
// Action-log phrasing
// -----------------------------------------------------------------------

function describeAction(replay, index) {
  const a = replay.actions[index];
  if (a.type === "fold") return a.actor + " folds";
  if (a.type === "check") return a.actor + " checks";
  if (a.type === "call") return a.actor + " calls " + fmtBb(a.amount_bb);
  if (a.type === "post") return a.actor + " posts " + fmtBb(a.amount_bb);
  if (a.type === "bet") return a.actor + " bets " + fmtBb(a.amount_bb) + (a.all_in ? " (all in)" : "");
  if (a.type === "raise") {
    // On preflop, name the escalation: open / 3-bet / 4-bet / 5-bet.
    if (a.street === "preflop") {
      let n = 0;
      for (let i = 0; i <= index; i++) {
        const p = replay.actions[i];
        if (p.street === "preflop" && p.type === "raise") n++;
      }
      const verb = n === 1 ? "opens to" : n === 2 ? "3-bets to" : n === 3 ? "4-bets to" : "5-bets to";
      return a.actor + " " + verb + " " + fmtBb(a.amount_bb) + (a.all_in ? " (all in)" : "");
    }
    return a.actor + " raises to " + fmtBb(a.amount_bb) + (a.all_in ? " (all in)" : "");
  }
  return a.actor + " " + a.type;
}

// -----------------------------------------------------------------------
// mountReplay — render the table + stepper into `container`.
// -----------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {Object} replay  A scenario's `replay` object.
 * @param {Object} [opts]
 * @param {(step:number)=>void} [opts.onStep]  Notified on every render
 *   with the current step value. Used by callers to drive an external
 *   highlight (e.g. the spot-summary mini-display).
 */
export function mountReplay(container, replay, opts) {
  const onStep = opts && typeof opts.onStep === "function" ? opts.onStep : null;
  const actions = replay.actions || [];
  const decisionStep = actions.length;
  // SB/BB blind posts come FIRST in the actions array. They're forced
  // bets — not "action history" the user steps through. Treat them as a
  // default minimum-state: the table starts with blinds already posted,
  // and the previous-action button never steps before them.
  let minStep = 0;
  while (minStep < actions.length && actions[minStep].type === "post") minStep += 1;
  // Inflection points: action indices we WANT to dwell on in the replay.
  // Folds and checks are noise — they don't move money or change the
  // visual state meaningfully. Bets / raises / calls are the inflection
  // moments where chips move. We auto-play through THESE on load and
  // skip over the noise; user can still step through one-by-one with
  // prev/next if they want the full history.
  function isInflection(a) {
    return a && (a.type === "bet" || a.type === "raise" || a.type === "call");
  }
  // Step at which each inflection action ENDS (i.e., the state AFTER it).
  // setStep(N) applies actions[0..N-1] inclusive.
  const inflectionSteps = [];
  for (let i = minStep; i < decisionStep; i++) {
    if (isInflection(actions[i])) inflectionSteps.push(i + 1);
  }

  let step = decisionStep; // start showing the full pre-decision state
  let playTimer = null;
  let autoplayTimer = null;
  let userInteracted = false;

  const table = h("div", { class: "replay-table" });
  const stepLabel = h("span", { class: "replay-steplabel" });
  // Fast-rewind to the start of the hand (right after SB/BB posts —
  // posts are baked into `minStep` so this is the cleanest "from the
  // top" state). Sits at the leftmost position.
  const rewindBtn = h("button", { type: "button", class: "replay-ctl" }, "⏮");
  const prevBtn = h("button", { type: "button", class: "replay-ctl" }, "◀");
  const playBtn = h("button", { type: "button", class: "replay-ctl" }, "▶");
  const nextBtn = h("button", { type: "button", class: "replay-ctl" }, "▶");
  rewindBtn.setAttribute("aria-label", "Rewind to start of hand");
  prevBtn.setAttribute("aria-label", "Previous action");
  nextBtn.setAttribute("aria-label", "Next action");
  playBtn.setAttribute("aria-label", "Play / pause replay");

  function streetIdx(s) { return STREETS.indexOf(s); }

  function renderTable(state) {
    while (table.firstChild) table.removeChild(table.firstChild);
    const turn = nextActor(replay, step);

    // Place every seat around the oval. `ring` is the seats in table order;
    // it is rotated so the hero sits in slot 0 (bottom centre) and the rest
    // follow clockwise into slots 1–5.
    const ring = replay.seats.map((s) => s.pos);
    let heroIdx = ring.indexOf(replay.hero_seat);
    if (heroIdx < 0) heroIdx = 0;
    const ordered = ring.slice(heroIdx).concat(ring.slice(0, heroIdx));
    ordered.forEach((pos, slot) => {
      const seatDef = replay.seats.find((s) => s.pos === pos);
      const isHero = pos === replay.hero_seat;
      table.appendChild(seatEl(
        seatDef, state.seats[pos], isHero, turn === pos,
        "rseat rslot-" + slot + (isHero ? " rseat-hero" : "")
      ));
    });

    // Board + pot in the middle.
    const shown = streetIdx(state.viewStreet);
    const boardCards = []
      .concat(shown >= 1 ? replay.board.flop : [])
      .concat(shown >= 2 ? replay.board.turn : [])
      .concat(shown >= 3 ? replay.board.river : []);
    table.appendChild(h(
      "div",
      { class: "replay-center" },
      h("div", { class: "replay-board" }, boardCards.length
        ? boardCards.map((c) => cardEl(c, "sm"))
        : [h("span", { class: "replay-board-empty" }, "preflop")]),
      h("div", { class: "replay-pot" }, "Pot ", bbChip(round1(state.displayPot)))
    ));

    // Bet bubbles — a SEPARATE pass so each bubble sits halfway between
    // its seat and the pot (positioned via .rbet-slot-N CSS), not above
    // or below the seat itself. Reads as "chips pushed forward to the
    // pot" rather than a label attached to the player.
    ordered.forEach((pos, slot) => {
      const st = state.seats[pos];
      if (st.street > 0) {
        table.appendChild(h(
          "div",
          { class: "rbet rbet-slot-" + slot },
          bbChip(round1(st.street))
        ));
      }
    });
  }

  function seatEl(seatDef, st, isHero, isTurn, cls) {
    let cardRow;
    if (st.folded && !isHero) {
      // Folded players' cards are mucked — show that, not face-down cards.
      cardRow = h("div", { class: "rseat-cards rseat-mucked" }, "folded");
    } else {
      const cards = isHero
        ? (replay.hero_cards || [null, null]).map((c) => cardEl(c, "sm"))
        : [cardEl(null, "sm"), cardEl(null, "sm")];
      cardRow = h("div", { class: "rseat-cards" }, cards);
    }
    // Dealer button — small "D" disc attached to whichever seat holds
    // the BTN (regardless of whether that's the hero). Real-table cue
    // that orients the eye to where the action started.
    const isDealer = seatDef.pos === "BTN";
    const dealerBtn = isDealer
      ? h("div", { class: "rseat-dealer", title: "Dealer button" }, "D")
      : null;
    return h(
      "div",
      { class: cls + (isTurn ? " rseat-turn" : "") + (st.folded ? " rseat-folded" : "") +
        (!isHero && !st.folded ? " rseat-villain" : "") },
      cardRow,
      h("div", { class: "rseat-pos" }, seatDef.pos + (isHero ? " (you)" : "")),
      h("div", { class: "rseat-stack" }, bbChip(round1(st.stack))),
      dealerBtn
    );
  }

  function render() {
    const state = deriveState(replay, step);
    renderTable(state);
    if (step === decisionStep) {
      stepLabel.textContent = "Decision point";
    } else if (step === minStep) {
      // Initial state — blinds posted, no voluntary action yet.
      stepLabel.textContent = "Start of hand";
    } else {
      const a = actions[step - 1];
      stepLabel.textContent = capitalize(a.street) + " — " + describeAction(replay, step - 1);
    }
    rewindBtn.disabled = step <= minStep;
    prevBtn.disabled = step <= minStep;
    nextBtn.disabled = step === decisionStep;
    playBtn.textContent = (playTimer || autoplayTimer) ? "❚❚" : "▶";
    if (onStep) {
      try { onStep(step); } catch (_) { /* swallow — highlight is cosmetic */ }
    }
  }

  function setStep(s) {
    step = Math.max(minStep, Math.min(decisionStep, s));
    if (playTimer && step === decisionStep) stopPlay();
    render();
  }

  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (autoplayTimer) { clearTimeout(autoplayTimer); autoplayTimer = null; }
    render();
  }

  // Skip past "noise" actions (fold / check / post) when stepping with
  // prev/next or playing. Returns the next inflection step at or beyond
  // `s` (going forwards) or at or before `s` (going backwards). If no
  // inflection step exists in that direction, returns the appropriate
  // endpoint (minStep or decisionStep).
  function snapForward(s) {
    while (s < decisionStep) {
      const a = actions[s - 1];
      if (s === decisionStep || s === minStep || isInflection(a)) return s;
      s += 1;
    }
    return decisionStep;
  }
  function snapBackward(s) {
    while (s > minStep) {
      const a = actions[s - 1];
      if (s === minStep || isInflection(a)) return s;
      s -= 1;
    }
    return minStep;
  }

  function togglePlay() {
    if (playTimer || autoplayTimer) { stopPlay(); return; }
    // Restart from the post-blinds baseline if we're at the end already.
    if (step === decisionStep) step = minStep;
    render();
    playTimer = setInterval(() => {
      if (step >= decisionStep) { stopPlay(); return; }
      step = snapForward(step + 1);
      render();
    }, 900);
    render();
  }

  // Auto-play the buildup on load — step through INFLECTION actions only
  // (bets / raises / calls), skipping the noise (folds / checks / posts).
  // Each step has a brief dwell so the user sees the bet bubble appear
  // and chips animate forward. Stops if the user interacts.
  function startAutoplayOnLoad() {
    if (inflectionSteps.length === 0) return;  // nothing to animate
    step = minStep;
    render();
    let i = 0;
    function tick() {
      if (userInteracted) return;
      if (i >= inflectionSteps.length) {
        autoplayTimer = setTimeout(() => {
          if (userInteracted) return;
          step = decisionStep;
          autoplayTimer = null;
          render();
        }, 700);
        return;
      }
      step = inflectionSteps[i];
      i += 1;
      render();
      autoplayTimer = setTimeout(tick, 800);
    }
    autoplayTimer = setTimeout(tick, 500);
  }

  // prev/next mark user as interacting AND stop any in-flight playback —
  // they want to land on a specific step, not be carried past it. The
  // play button uses togglePlay directly so it correctly toggles
  // start/stop instead of being forced into "start fresh".
  function step_user(fn) {
    return () => {
      userInteracted = true;
      stopPlay();
      fn();
    };
  }
  rewindBtn.addEventListener("click", step_user(() => setStep(minStep)));
  prevBtn.addEventListener("click", step_user(() => setStep(snapBackward(step - 1))));
  nextBtn.addEventListener("click", step_user(() => setStep(snapForward(step + 1))));
  playBtn.addEventListener("click", () => {
    userInteracted = true;
    togglePlay();
  });

  const gameInfoPrefix = (replay.format === "tournament" ? "Tournament" : "Cash") + " · ";

  const root = h(
    "div",
    { class: "replay" },
    h("div", { class: "replay-gameinfo" }, gameInfoPrefix, bbChip(replay.stack_depth_bb), " deep"),
    table,
    h("div", { class: "replay-controls" }, rewindBtn, prevBtn, playBtn, nextBtn, stepLabel)
  );
  container.appendChild(root);
  // Render baseline first (so the table is on screen instantly), THEN
  // start auto-playing the buildup. The user sees the hand built up
  // action-by-action with each bet/raise/call animating in.
  render();
  startAutoplayOnLoad();
  return {
    unmount: () => {
      stopPlay();
      userInteracted = true;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
