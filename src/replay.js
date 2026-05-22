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
// Suit colour lookup. The suit SHAPE is drawn as inline SVG by
// suitSvg() — deliberately NOT a Unicode glyph. The Unicode suit
// characters (♠♥♦♣) render inconsistently across browsers: Chrome on
// Windows intermittently substitutes a colour-emoji glyph, which looks
// wrong and ignores the card's red/black colour. SVG is deterministic.
const SUITS = {
  c: { red: false, name: "clubs" },
  d: { red: true, name: "diamonds" },
  h: { red: true, name: "hearts" },
  s: { red: false, name: "spades" },
};

// Rank names for card tooltips — the card face shows the short rank;
// the title spells the card out so an explicit-suit card carries the
// same hover/scout info the abstract tok-anysuit cards already do.
const RANK_NAMES = {
  A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten",
  "9": "Nine", "8": "Eight", "7": "Seven", "6": "Six",
  "5": "Five", "4": "Four", "3": "Three", "2": "Two",
};

// -----------------------------------------------------------------------
// Card rendering
// -----------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";
function svgNode(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

// Build a suit as an inline <svg> (viewBox 0 0 100 100). The shapes use
// `fill: currentColor` (set in CSS) so the card's red/black colour
// applies. Diamond/heart/spade are single paths; the club is three
// discs plus a stem.
function suitSvg(suitCode) {
  const svg = svgNode("svg", {
    viewBox: "0 0 100 100", class: "pcard-suit-svg", "aria-hidden": "true",
  });
  if (suitCode === "d") {
    svg.appendChild(svgNode("path", { d: "M50 6 L88 50 L50 94 L12 50 Z" }));
  } else if (suitCode === "h") {
    svg.appendChild(svgNode("path", {
      d: "M50 87 C50 87 8 59 8 32 C8 18 18 9 30 9 C40 9 47 16 50 24 " +
         "C53 16 60 9 70 9 C82 9 92 18 92 32 C92 59 50 87 50 87 Z",
    }));
  } else if (suitCode === "s") {
    svg.appendChild(svgNode("path", {
      d: "M50 8 C50 8 8 39 8 64 C8 77 16 84 27 84 C35 84 42 79 46 73 " +
         "C45 84 40 91 31 96 L69 96 C60 91 55 84 54 73 C58 79 65 84 73 84 " +
         "C84 84 92 77 92 64 C92 39 50 8 50 8 Z",
    }));
  } else if (suitCode === "c") {
    svg.appendChild(svgNode("circle", { cx: "50", cy: "30", r: "20" }));
    svg.appendChild(svgNode("circle", { cx: "28", cy: "60", r: "20" }));
    svg.appendChild(svgNode("circle", { cx: "72", cy: "60", r: "20" }));
    svg.appendChild(svgNode("path", {
      d: "M44 51 C44 71 39 87 29 96 L71 96 C61 87 56 71 56 51 Z",
    }));
  } else {
    return null;
  }
  return svg;
}

// Build a replay-control icon as an inline <svg> (viewBox 0 0 100 100).
// Same rationale as suitSvg — the Unicode media glyphs (⏮ ◀ ▶ ❚❚)
// render as inconsistent colour emoji in some browsers.
function iconSvg(name) {
  const svg = svgNode("svg", {
    viewBox: "0 0 100 100", class: "replay-ctl-icon", "aria-hidden": "true",
  });
  if (name === "prev") {
    svg.appendChild(svgNode("path", { d: "M60 20 L60 80 L24 50 Z" }));
  } else if (name === "next" || name === "play") {
    svg.appendChild(svgNode("path", { d: "M40 20 L40 80 L76 50 Z" }));
  } else if (name === "pause") {
    svg.appendChild(svgNode("rect", { x: "32", y: "22", width: "13", height: "56", rx: "2" }));
    svg.appendChild(svgNode("rect", { x: "55", y: "22", width: "13", height: "56", rx: "2" }));
  } else if (name === "rewind") {
    svg.appendChild(svgNode("rect", { x: "22", y: "22", width: "12", height: "56", rx: "2" }));
    svg.appendChild(svgNode("path", { d: "M82 22 L82 78 L44 50 Z" }));
  }
  return svg;
}

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
  const suitCode = code[1];
  const suit = SUITS[suitCode] || { red: false };
  const suitNode = suitSvg(suitCode) || document.createTextNode("?");
  // Tooltip — the full card name. An explicit-suit card now carries the
  // same hover info the abstract tok-anysuit cards already do (those
  // show "K — any suit" / "K — suit unknown"); without this, real cards
  // in results-view prose were the one card type with no tooltip.
  const rankName = RANK_NAMES[code[0]] || rank;
  const title = suit.name ? rankName + " of " + suit.name : rankName;
  return h(
    "div",
    { class: cls + (suit.red ? " pcard-red" : ""), title },
    h("span", { class: "pcard-rank" }, rank),
    h("span", { class: "pcard-suit" }, suitNode)
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
  // the last applied action. EXCEPTION: at the decision VIEW — `topStep`,
  // one step PAST the last action — the dealer has advanced the board to
  // the hero's decision street (if its cards are dealt in replay.board).
  // Show that street's cards and sweep open street-bets into the pot.
  // `step > allActions.length` is exactly topStep (setStep clamps there);
  // AT allActions.length (the last action's own frame) the board still
  // shows that action's street, not yet the next card.
  let viewStreet = applied.length ? applied[applied.length - 1].street : "preflop";
  if (step > allActions.length) {
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
 * Compact board-runout strip for the one-screen hand view (spec §6.1 /
 * mockup M3). Shows flop / turn / river dealt ONCE — grouped, with a
 * street tag per group — plus the decision-point pot. This replaces the
 * oval table's felt board in the compact layout: the board is decision
 * data, the animated table is a luxury. Returns null for a preflop spot
 * (no board) — the caller simply omits the strip.
 *
 * @param {Object} replay
 * @returns {HTMLElement|null}
 */
export function buildRunoutStrip(replay) {
  if (!replay || !replay.board) return null;
  const board = replay.board;
  const streets = [
    { tag: "Flop", cards: board.flop || [] },
    { tag: "Turn", cards: board.turn || [] },
    { tag: "River", cards: board.river || [] },
  ].filter((s) => Array.isArray(s.cards) && s.cards.length > 0);
  if (streets.length === 0) return null;

  const pot = potAtDecisionBb(replay);
  const head = h("div", { class: "runout-head" },
    h("span", { class: "runout-label" }, "Runout"),
    pot != null
      ? h("span", { class: "runout-pot" },
          "Pot ", h("b", null, String(Math.round(pot * 10) / 10)), " bb")
      : null
  );
  const streetEls = streets.map((s) =>
    h("div", { class: "runout-street" },
      h("span", { class: "runout-street-tag" }, s.tag),
      h("div", { class: "runout-street-cards" },
        ...s.cards.map((c) => cardEl(c, "sm")))
    )
  );
  return h("div", { class: "runout-strip" },
    head,
    h("div", { class: "runout-streets" }, ...streetEls)
  );
}

/**
 * Compact one-line hero strip for the one-screen hand view (spec §6.1 /
 * mockup M3): the hero's seat, hole cards, and decision-point stack —
 * the compact layout's replacement for the oval table's hero seat.
 * Returns null if the replay names no hero seat.
 *
 * @param {Object} replay
 * @returns {HTMLElement|null}
 */
export function buildHeroStrip(replay) {
  if (!replay || !replay.hero_seat) return null;
  const seat = replay.hero_seat;
  const cards = Array.isArray(replay.hero_cards) && replay.hero_cards.length === 2
    ? replay.hero_cards
    : null;
  // Stack at the decision point — after every replay action is applied.
  let stackBb = null;
  try {
    const { seats } = deriveState(replay, (replay.actions || []).length);
    const heroSeat = seats[seat];
    if (heroSeat && typeof heroSeat.stack === "number") {
      stackBb = Math.round(heroSeat.stack * 10) / 10;
    }
  } catch { /* malformed replay — omit the stack */ }

  return h("div", { class: "hero-strip" },
    h("span", { class: "hero-strip-seat" }, h("b", null, seat), " · You"),
    cards
      ? h("div", { class: "hero-strip-cards" }, ...cards.map((c) => cardEl(c, "sm")))
      : null,
    stackBb != null
      ? h("div", { class: "hero-strip-stack" },
          h("span", { class: "hero-strip-stack-num" }, String(stackBb) + " bb"),
          h("span", { class: "hero-strip-stack-label" }, "Your stack"))
      : null
  );
}

/**
 * Build a TexasSolver console config (the .txt body) for a scenario's
 * decision spot — owner tooling, exported per scenario from the Database
 * console. Fills board, decision-point pot + effective stack, the
 * villain range, and the static bet-tree / solve block. The HERO range
 * is a marked placeholder (PASTE_HERO_RANGE_HERE): scenario data stores
 * only the dealt hand, not a hero range. Returns null for a preflop
 * spot (no board to solve).
 *
 * @param {Object} scen  a scenario object
 * @returns {string|null}
 */
export function buildSolverConfig(scen) {
  const replay = scen && scen.replay;
  if (!replay || !replay.board) return null;
  const board = []
    .concat(replay.board.flop || [])
    .concat(replay.board.turn || [])
    .concat(replay.board.river || []);
  if (board.length < 3) return null;            // no flop → a preflop spot

  // Pot + effective stack at the decision, in TexasSolver chip units —
  // bb × 10, so the app's 0.5bb precision lands on whole numbers.
  const chips = (bb) => Math.round((bb || 0) * 10);
  const pot = potAtDecisionBb(replay) || 0;
  const { seats } = deriveState(replay, (replay.actions || []).length);
  const heroPos = replay.hero_seat;
  const villPos = (liveVillains(replay) || [])[0] || null;
  const heroStack = (seats[heroPos] && typeof seats[heroPos].stack === "number")
    ? seats[heroPos].stack : (replay.stack_depth_bb || 100);
  const villStack = (villPos && seats[villPos] && typeof seats[villPos].stack === "number")
    ? seats[villPos].stack : heroStack;
  const effStack = Math.min(heroStack, villStack);

  // Villain range — every villain_ranges[].classes merged and deduped.
  const villClasses = [];
  for (const vr of (scen.villain_ranges || [])) {
    for (const c of (vr.classes || [])) {
      if (c && !villClasses.includes(c)) villClasses.push(c);
    }
  }
  const villRange = villClasses.length ? villClasses.join(",") : "PASTE_VILLAIN_RANGE_HERE";

  // OOP = whoever acts first postflop (the earlier seat). The hero's
  // range is always the placeholder — it isn't in the scenario data.
  const ORDER = ["SB", "BB", "UTG", "UTG1", "UTG2", "MP", "LJ", "HJ", "CO", "BTN"];
  const rank = (p) => { const i = ORDER.indexOf(p); return i < 0 ? 99 : i; };
  const heroOop = villPos ? rank(heroPos) < rank(villPos) : true;
  const HERO = "PASTE_HERO_RANGE_HERE";

  return [
    "set_pot " + chips(pot),
    "set_effective_stack " + chips(effStack),
    "set_board " + board.join(","),
    "set_range_oop " + (heroOop ? HERO : villRange),
    "set_range_ip " + (heroOop ? villRange : HERO),
    "set_bet_sizes oop,flop,bet,50",
    "set_bet_sizes oop,flop,raise,60",
    "set_bet_sizes oop,flop,allin",
    "set_bet_sizes ip,flop,bet,50",
    "set_bet_sizes ip,flop,raise,60",
    "set_bet_sizes ip,flop,allin",
    "set_bet_sizes oop,turn,bet,50",
    "set_bet_sizes oop,turn,raise,60",
    "set_bet_sizes oop,turn,donk,50",
    "set_bet_sizes oop,turn,allin",
    "set_bet_sizes ip,turn,bet,50",
    "set_bet_sizes ip,turn,raise,60",
    "set_bet_sizes ip,turn,allin",
    "set_bet_sizes oop,river,bet,50",
    "set_bet_sizes oop,river,raise,60,100",
    "set_bet_sizes oop,river,allin",
    "set_bet_sizes ip,river,bet,50",
    "set_bet_sizes ip,river,raise,60,100",
    "set_bet_sizes oop,river,donk,50",
    "set_bet_sizes ip,river,allin",
    "set_allin_threshold 0.67",
    "set_raise_limit 3",
    "build_tree",
    "set_thread_num 8",
    "set_accuracy 0.5",
    "set_max_iteration 200",
    "set_print_interval 10",
    "set_use_isomorphism 1",
    "start_solve",
    "set_dump_rounds 2",
    "dump_result " + scen.scenario_id + ".json",
  ].join("\n") + "\n";
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
 * @param {Object} [opts]
 * @param {(step:number)=>void} [opts.onJumpToStep]  Wired to a click
 *   handler on every action chip and the "← your turn" marker. The
 *   caller forwards this to the replay's `jumpTo` so clicking in the
 *   mini-display drives the table to the same point.
 * @returns {HTMLElement|null}
 */
export function buildSpotSummary(replay, opts) {
  const onJumpToStep = opts && typeof opts.onJumpToStep === "function" ? opts.onJumpToStep : null;
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

  // Actor naming — hero → "HERO"; a lone opponent → "VILLAIN". But when
  // MULTIPLE opponents are live at the decision, OR more than one
  // distinct opponent appears in the action log, "VILLAIN" is ambiguous
  // — fall back to position names so the reader can tell opponents apart.
  const villainSeats = new Set();
  for (const a of actions) {
    if (a.type === "post" || a.type === "fold") continue;
    if (a.actor !== heroSeat) villainSeats.add(a.actor);
  }
  const singleVillain = liveVillains(replay).length <= 1 && villainSeats.size <= 1;

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
      const nodes = actionNodes(a);
      // Pot indicator — for every action that moves chips into the pot
      // (bet / raise / call), show the running pot total AFTER this
      // action, right-aligned on the line. Checks don't change the pot.
      if (a.type === "bet" || a.type === "raise" || a.type === "call") {
        const potBb = deriveState(replay, stepValue).displayPot;
        if (potBb > 0) {
          nodes.push(h("span", { class: "spot-sum-actpot" },
            "pot ",
            h("span", { class: "spot-sum-actpot-val" }, round1(potBb) + "bb")));
        }
      }
      const actionEl = h("div", { class: "spot-sum-action" }, ...nodes);
      actionEl.setAttribute("data-step", String(stepValue));
      actionsEl.appendChild(actionEl);
    });
    // Hero-turn arrow on the decision street (its own line at the end).
    // data-step = actions.length + 1 (the replay's topStep) — the clean
    // decision-time table state, DISTINCT from the last villain action's
    // frame (which keeps its own action chip at data-step actions.length).
    if (isDecision) {
      // "← Action on HERO" — names the actor (the hero chip) rather
      // than the generic "your turn", consistent with the HERO/VILLAIN
      // voice used everywhere else.
      const yourTurnEl = h("div", { class: "spot-sum-yourturn" },
        document.createTextNode("← Action on "),
        actorChip(heroSeat)
      );
      yourTurnEl.setAttribute("data-step", String(actions.length + 1));
      actionsEl.appendChild(yourTurnEl);
    }
    rows.push(h("div", { class: "spot-sum-row" + (isDecision ? " is-decision" : "") },
      h("span", { class: "spot-sum-street" }, streetLabel(street)),
      cardsEl,
      actionsEl
    ));
  }

  if (rows.length === 0) return null;
  const el = h("div", { class: "spot-summary" + (onJumpToStep ? " is-clickable" : "") }, ...rows);

  // Click or keyboard → drive the replay table to that action's state.
  // Delegated off the root; reads data-step from the activated
  // .spot-sum-action / .spot-sum-yourturn. Each such row is given button
  // semantics and a tab stop so keyboard users can drive the replay too,
  // not just mouse / touch.
  if (onJumpToStep) {
    el.querySelectorAll(".spot-sum-action, .spot-sum-yourturn").forEach((row) => {
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("title", "Jump the replay to this point");
    });
    const jumpFrom = (target) => {
      if (!target || !el.contains(target)) return;
      const s = parseInt(target.getAttribute("data-step"), 10);
      if (!Number.isNaN(s)) onJumpToStep(s);
    };
    el.addEventListener("click", (ev) => {
      jumpFrom(ev.target.closest(".spot-sum-action, .spot-sum-yourturn"));
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const target = ev.target.closest(".spot-sum-action, .spot-sum-yourturn");
      if (!target || !el.contains(target)) return;
      ev.preventDefault();
      jumpFrom(target);
    });
  }
  // setStep(step) — driven by mountReplay's onStep callback. Highlights
  // the spot-summary entry matching the replay's current position:
  //   - topStep (step > actions.length) → the "← Action on HERO" marker
  //     (the clean decision-time table state);
  //   - decisionStep and earlier → the action chip with the largest
  //     data-step ≤ step, so the LAST action chip is still selectable
  //     in its own right (it shows that action's badge on the table).
  // At minStep (before any voluntary action) nothing is highlighted.
  el.setStep = function (step) {
    const all = el.querySelectorAll(".spot-sum-action");
    const yourTurn = el.querySelector(".spot-sum-yourturn");
    all.forEach((a) => a.classList.remove("is-current"));
    if (yourTurn) yourTurn.classList.remove("is-current");
    // topStep — the clean decision-time view; the "← Action on HERO"
    // marker is the current entry.
    if (yourTurn && step > actions.length) {
      yourTurn.classList.add("is-current");
      return;
    }
    let current = null;
    all.forEach((a) => {
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
  // decisionStep — the frame where the LAST action is applied; it shows
  //   that action's "raises to 35bb" badge on the acting seat.
  // topStep — one beyond: the same chips/board on the table but with NO
  //   action badge — "the table state at decision time", hero to act.
  // These are two distinct, separately-selectable states.
  const decisionStep = actions.length;
  const topStep = decisionStep + 1;
  // SB/BB blind posts come FIRST in the actions array. They're forced
  // bets — not "action history" the user steps through. Treat them as a
  // default minimum-state: the table starts with blinds already posted,
  // and the previous-action button never steps before them.
  let minStep = 0;
  while (minStep < actions.length && actions[minStep].type === "post") minStep += 1;
  // Inflection points: action indices we WANT to dwell on in the replay.
  // Folds are noise — once mucked, the seat dims and there's nothing
  // strategically useful to show. Bets / raises / calls move chips.
  // Checks change initiative: who acts next, who showed weakness, what
  // line the betting tree just branched into — important context to
  // see animate in, even though no chips move. Now that checks have a
  // visual badge + ring pulse, they're worth dwelling on.
  function isInflection(a) {
    return a && (a.type === "bet" || a.type === "raise" || a.type === "call" || a.type === "check");
  }
  // Step at which each inflection action ENDS (i.e., the state AFTER it).
  // setStep(N) applies actions[0..N-1] inclusive.
  const inflectionSteps = [];
  for (let i = minStep; i < decisionStep; i++) {
    if (isInflection(actions[i])) inflectionSteps.push(i + 1);
  }

  let step = topStep; // start on the clean decision-time table state
  let playTimer = null;
  let autoplayTimer = null;
  let userInteracted = false;

  const table = h("div", { class: "replay-table" });
  const stepLabel = h("span", { class: "replay-steplabel" });
  // Fast-rewind to the start of the hand (right after SB/BB posts —
  // posts are baked into `minStep` so this is the cleanest "from the
  // top" state). Sits at the leftmost position.
  const rewindBtn = h("button", { type: "button", class: "replay-ctl" }, iconSvg("rewind"));
  const prevBtn = h("button", { type: "button", class: "replay-ctl" }, iconSvg("prev"));
  const playBtn = h("button", { type: "button", class: "replay-ctl" }, iconSvg("play"));
  const nextBtn = h("button", { type: "button", class: "replay-ctl" }, iconSvg("next"));
  rewindBtn.setAttribute("aria-label", "Rewind to start of hand");
  prevBtn.setAttribute("aria-label", "Previous action");
  nextBtn.setAttribute("aria-label", "Next action");
  playBtn.setAttribute("aria-label", "Play / pause replay");

  function streetIdx(s) { return STREETS.indexOf(s); }

  function renderTable(state, justActed) {
    while (table.firstChild) table.removeChild(table.firstChild);
    const turn = nextActor(replay, step);

    // Betting ring — the visual ellipse that bet chips are pushed onto
    // (casino betting-line convention). Appended first so it sits
    // behind the seats, bets, and pot.
    table.appendChild(h("div", { class: "replay-ring", "aria-hidden": "true" }));

    // Place every seat around the oval. `ring` is the seats in table order;
    // it is rotated so the hero sits in slot 0 (bottom centre) and the rest
    // follow clockwise into slots 1–5.
    const ring = replay.seats.map((s) => s.pos);
    let heroIdx = ring.indexOf(replay.hero_seat);
    if (heroIdx < 0) heroIdx = 0;
    const ordered = ring.slice(heroIdx).concat(ring.slice(0, heroIdx));
    let btnSeatEl = null;
    let btnSlot = -1;
    ordered.forEach((pos, slot) => {
      const seatDef = replay.seats.find((s) => s.pos === pos);
      const isHero = pos === replay.hero_seat;
      const justActedHere = justActed && justActed.actor === pos ? justActed : null;
      const el = seatEl(
        seatDef, state.seats[pos], isHero, turn === pos,
        "rseat rslot-" + slot + (isHero ? " rseat-hero" : "") +
          (justActedHere ? " rseat-just-acted" : ""),
        justActedHere
      );
      table.appendChild(el);
      if (pos === "BTN") { btnSeatEl = el; btnSlot = slot; }
    });

    // Dealer button — appended INTO the BTN seat so it is unambiguously
    // that seat's button, sitting on the seat corner toward table centre.
    // It stays bright when the BTN folds: folded seats dim their content
    // (cards / labels), not the seat box, and the disc is not content.
    if (btnSeatEl && btnSlot >= 0) {
      btnSeatEl.appendChild(h("div",
        { class: "rdealer rdealer-slot-" + btnSlot, title: "Dealer button" }, "D"));
    }

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

  function seatEl(seatDef, st, isHero, isTurn, cls, justActed) {
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
    // (Dealer button is rendered at table level by renderTable — not
    // a seat child — so it stays bright when the BTN folds.)
    // Just-acted badge: small floating chip naming the action that just
    // landed at this seat. CSS animates it in on each render, so when
    // the replay steps forward the badge "pops" briefly. Critical for
    // checks (no bet bubble) and adds visual confirmation for
    // bets/raises/calls beyond just the chip appearing.
    const actedBadge = justActed ? h(
      "div",
      { class: "rseat-acted-badge rseat-acted-" + justActed.type },
      actionVerb(justActed)
    ) : null;
    return h(
      "div",
      { class: cls + (isTurn ? " rseat-turn" : "") + (st.folded ? " rseat-folded" : "") +
        (!isHero && !st.folded ? " rseat-villain" : "") },
      cardRow,
      h("div", { class: "rseat-pos" }, seatDef.pos + (isHero ? " (you)" : "")),
      h("div", { class: "rseat-stack" }, bbChip(round1(st.stack))),
      actedBadge
    );
  }

  // Short action verb for the just-acted badge. "raises to 2.5bb",
  // "calls 2.5bb", "checks", "bets 3bb", "folds" — chip-style label.
  function actionVerb(a) {
    if (a.type === "check") return "checks";
    if (a.type === "fold") return "folds";
    if (a.type === "call") return "calls" + (a.amount_bb ? " " + round1(a.amount_bb) + "bb" : "");
    if (a.type === "bet") return "bets " + round1(a.amount_bb || 0) + "bb";
    if (a.type === "raise") return "raises to " + round1(a.amount_bb || 0) + "bb";
    return a.type;
  }

  function render() {
    const state = deriveState(replay, step);
    // Identify the action that JUST landed (if any). Posts are baseline
    // state — never flag a post as just-acted. At minStep no action has
    // landed yet; at topStep (the decision view) the badge is suppressed
    // so it reads as the clean table state rather than "after an action".
    const justActed = (step > minStep && step <= decisionStep
      && actions[step - 1] && actions[step - 1].type !== "post")
      ? actions[step - 1]
      : null;
    renderTable(state, justActed);
    if (step >= topStep) {
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
    nextBtn.disabled = step >= topStep;
    while (playBtn.firstChild) playBtn.removeChild(playBtn.firstChild);
    playBtn.appendChild(iconSvg((playTimer || autoplayTimer) ? "pause" : "play"));
    if (onStep) {
      try { onStep(step); } catch (_) { /* swallow — highlight is cosmetic */ }
    }
  }

  function setStep(s) {
    step = Math.max(minStep, Math.min(topStep, s));
    if (playTimer && step >= topStep) stopPlay();
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
  // endpoint (minStep, decisionStep, or topStep).
  function snapForward(s) {
    if (s >= decisionStep) return topStep;
    while (s < decisionStep) {
      const a = actions[s - 1];
      if (s === minStep || isInflection(a)) return s;
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
    if (step >= decisionStep) step = minStep;
    render();
    playTimer = setInterval(() => {
      if (step >= topStep) { stopPlay(); return; }
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
          // Settle on the clean decision-time state (topStep), having
          // just shown the last action's badge on the final tick.
          step = topStep;
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

  // Format + depth (always shown) + optional context tag (only present
  // when depth/format meaningfully changes strategy — tournament hands,
  // short-stack cash, etc.). The context tag lights up so the user
  // catches it at a glance during the decide phase, not just in
  // post-decision framing bullets.
  const isTournament = replay.format === "tournament";
  const gameInfoPrefix = (isTournament ? "Tournament" : "Cash") + " · ";
  const gameInfoChip = h("div", { class: "replay-gameinfo" + (isTournament ? " is-tournament" : "") },
    gameInfoPrefix, bbChip(replay.stack_depth_bb), " deep");
  const contextTag = replay.context_tag
    ? h("div", { class: "replay-context-tag" + (isTournament ? " is-tournament" : " is-shortstack") },
        replay.context_tag)
    : null;

  const root = h(
    "div",
    { class: "replay" },
    h("div", { class: "replay-header" }, gameInfoChip, contextTag),
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
    // Jump the table to a specific step. Used by the spot-summary
    // mini-display click handler so clicking an action drives the
    // replay to that state. Behaves like a manual nav (cancels
    // autoplay, snaps to inflection if necessary).
    jumpTo: (s) => {
      userInteracted = true;
      stopPlay();
      // Snap toward the user's intent: if they clicked a non-inflection
      // step (a check), we still land exactly on that step. If they
      // clicked an inflection step, that's where we land too. Use
      // setStep directly — no snap rounding for explicit clicks.
      setStep(s);
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
