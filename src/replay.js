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
  const applied = (replay.actions || []).slice(0, step);
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
  // Street currently in view = street of the last applied action.
  const viewStreet = applied.length ? applied[applied.length - 1].street : "preflop";
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
 */
export function mountReplay(container, replay) {
  const actions = replay.actions || [];
  const decisionStep = actions.length;
  let step = decisionStep; // start showing the full pre-decision state
  let playTimer = null;

  const table = h("div", { class: "replay-table" });
  const log = h("ol", { class: "replay-log" });
  const stepLabel = h("span", { class: "replay-steplabel" });
  const prevBtn = h("button", { type: "button", class: "replay-ctl" }, "◀");
  const playBtn = h("button", { type: "button", class: "replay-ctl" }, "▶");
  const nextBtn = h("button", { type: "button", class: "replay-ctl" }, "▶▌");
  nextBtn.textContent = "▶";
  prevBtn.setAttribute("aria-label", "Previous action");
  nextBtn.setAttribute("aria-label", "Next action");

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
    const bet = st.street > 0
      ? h("div", { class: "rseat-bet" }, bbChip(round1(st.street)))
      : null;
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
      bet,
      dealerBtn
    );
  }

  function renderLog() {
    while (log.firstChild) log.removeChild(log.firstChild);
    actions.forEach((a, i) => {
      const li = h("li", {
        class: "replay-logitem" + (i < step ? " is-done" : "") + (i === step - 1 ? " is-current" : ""),
        onClick: () => setStep(i + 1),
      }, describeAction(replay, i));
      log.appendChild(li);
    });
    const dec = h("li", {
      class: "replay-logitem replay-logdecision" + (step === decisionStep ? " is-current" : ""),
      onClick: () => setStep(decisionStep),
    }, replay.hero_seat + " to act — your decision");
    log.appendChild(dec);
  }

  function render() {
    const state = deriveState(replay, step);
    renderTable(state);
    renderLog();
    if (step === decisionStep) {
      stepLabel.textContent = "Decision point";
    } else if (step === 0) {
      stepLabel.textContent = "Start of hand";
    } else {
      const a = actions[step - 1];
      stepLabel.textContent = capitalize(a.street) + " — " + describeAction(replay, step - 1);
    }
    prevBtn.disabled = step === 0;
    nextBtn.disabled = step === decisionStep;
    playBtn.textContent = playTimer ? "❚❚" : "▶";
  }

  function setStep(s) {
    step = Math.max(0, Math.min(decisionStep, s));
    if (playTimer && step === decisionStep) stopPlay();
    render();
  }

  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    render();
  }

  function togglePlay() {
    if (playTimer) { stopPlay(); return; }
    if (step === decisionStep) step = 0;
    render();
    playTimer = setInterval(() => {
      if (step >= decisionStep) { stopPlay(); return; }
      step += 1;
      render();
    }, 1100);
    render();
  }

  prevBtn.addEventListener("click", () => { stopPlay(); setStep(step - 1); });
  nextBtn.addEventListener("click", () => { stopPlay(); setStep(step + 1); });
  playBtn.addEventListener("click", togglePlay);

  const gameInfoPrefix = (replay.format === "tournament" ? "Tournament" : "Cash") + " · ";

  const root = h(
    "div",
    { class: "replay" },
    h("div", { class: "replay-gameinfo" }, gameInfoPrefix, bbChip(replay.stack_depth_bb), " deep"),
    table,
    h("div", { class: "replay-controls" }, prevBtn, playBtn, nextBtn, stepLabel),
    h("details", { class: "replay-history" },
      h("summary", null, "Action history"),
      log
    )
  );
  container.appendChild(root);
  render();
  return {
    unmount: () => {
      stopPlay();
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
