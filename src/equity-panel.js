// equity-panel.js — the "Test it" panel mounted into the reveal screen.
//
// Wires the range picker to the Monte Carlo engine and shows hero equity.
// For scenarios where `replay.hero_cards` is null (range-perspective spots),
// a small 4×13 hand picker lets the user pick a sample hero hand first.

import { runEquity } from "./equity.js";
import { mountRangePicker } from "./range-picker.js";
import { cardEl } from "./replay.js";

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

/** Cards from the replay's current board (flop + turn + river, in order). */
function boardCards(replay) {
  const b = (replay && replay.board) || {};
  return [].concat(b.flop || [], b.turn || [], b.river || []);
}

// -----------------------------------------------------------------------
// mountHeroPicker — a compact 4-suit × 13-rank card grid with two slot
// indicators. Click a card → fills the next empty slot (FIFO replacement
// when both slots are taken). Click a slot → clears it. Board cards are
// disabled. Emits the current 2-card hand on every change.
// -----------------------------------------------------------------------

const HP_RANKS = "AKQJT98765432";
const HP_SUITS = "shdc"; // top → bottom

function mountHeroPicker(host, opts) {
  const board = (opts.board || []).slice();
  let hero = (opts.initial || []).slice();
  const pickOrder = hero.slice(); // tracks order so we know who to evict first

  const titleEl = h("div", { class: "hero-pick-title muted" }, "Pick your hero hand");
  const slotsRow = h("div", { class: "hero-pick-slots" });
  const grid = h("div", { class: "hero-pick-grid" });
  const cellsByCode = {};
  const noteEl = h("div", { class: "hero-pick-note muted" }, "Click two cards below to set your hand.");

  function emit() {
    if (opts.onChange) opts.onChange(hero.slice());
  }

  function syncSlots() {
    while (slotsRow.firstChild) slotsRow.removeChild(slotsRow.firstChild);
    for (let i = 0; i < 2; i++) {
      const code = hero[i];
      let slot;
      if (code) {
        slot = h("button",
          { type: "button", class: "hero-pick-slot is-filled", title: "Remove " + code, "aria-label": "Remove " + code },
          cardEl(code));
        slot.addEventListener("click", () => removeAt(i));
      } else {
        slot = h("button",
          { type: "button", class: "hero-pick-slot is-empty", "aria-label": "Empty slot " + (i + 1) },
          h("span", null, "?"));
      }
      slotsRow.appendChild(slot);
    }
    noteEl.textContent = hero.length === 2
      ? "Click a card to swap, click a slot above to clear it."
      : "Click two cards below to set your hand.";
  }

  function syncGrid() {
    for (const code of Object.keys(cellsByCode)) {
      const cell = cellsByCode[code];
      const onBoard = board.includes(code);
      const isHero = hero.includes(code);
      cell.classList.toggle("is-dead", onBoard);
      cell.classList.toggle("is-selected", isHero);
      cell.disabled = onBoard;
      cell.title = onBoard ? "On the board" : (isHero ? "Selected — click again to remove" : code);
    }
  }

  function pickCard(code) {
    if (board.includes(code)) return;
    if (hero.includes(code)) {
      // Toggle off
      const idx = hero.indexOf(code);
      hero.splice(idx, 1);
      const po = pickOrder.indexOf(code);
      if (po >= 0) pickOrder.splice(po, 1);
    } else if (hero.length < 2) {
      hero.push(code);
      pickOrder.push(code);
    } else {
      // FIFO replace the older selection.
      const old = pickOrder.shift();
      const oi = hero.indexOf(old);
      if (oi >= 0) hero.splice(oi, 1);
      hero.push(code);
      pickOrder.push(code);
    }
    syncSlots();
    syncGrid();
    emit();
  }

  function removeAt(i) {
    const code = hero[i];
    if (!code) return;
    hero.splice(i, 1);
    const po = pickOrder.indexOf(code);
    if (po >= 0) pickOrder.splice(po, 1);
    syncSlots();
    syncGrid();
    emit();
  }

  // Build the 4×13 card grid (rows = suits, cols = ranks).
  for (const suit of HP_SUITS) {
    for (const rank of HP_RANKS) {
      const code = rank + suit;
      const cell = h("button",
        { type: "button", class: "hero-pick-cell" },
        cardEl(code, "sm"));
      cell.addEventListener("click", () => pickCard(code));
      cellsByCode[code] = cell;
      grid.appendChild(cell);
    }
  }

  const root = h("div", { class: "hero-pick" }, titleEl, slotsRow, grid, noteEl);
  host.appendChild(root);
  syncSlots();
  syncGrid();

  return {
    getHero: () => hero.slice(),
  };
}

// -----------------------------------------------------------------------
// mountEquityPanel — the public entry point.
// -----------------------------------------------------------------------

/**
 * Mount the equity panel into `container` for a given scenario.
 * @param {HTMLElement} container
 * @param {Object} scen   Scenario object (uses scen.replay for hero/board).
 * @param {Object} [opts]
 * @param {string[]} [opts.initialRange]  Hand-class labels to pre-select.
 * @param {string} [opts.initialRangeLabel]  Friendly name for the pre-loaded range.
 * @returns {{ unmount: () => void, root: HTMLElement, setRange: (classes:string[], label?:string) => void }}
 */
export function mountEquityPanel(container, scen, opts = {}) {
  const replay = scen && scen.replay;
  const pinnedHero = (replay && replay.hero_cards && replay.hero_cards.length === 2) ? replay.hero_cards : null;
  const board = boardCards(replay);

  // `hero` is mutable: starts as the pinned hand (if any) or empty, then
  // the interactive picker updates it.
  let hero = pinnedHero ? pinnedHero.slice() : [];

  // ----- hero section (read-only display OR interactive picker) ------------
  let heroSection;
  if (pinnedHero) {
    heroSection = h("div", { class: "eq-cards eq-hero-row" },
      h("span", { class: "eq-cards-label" }, "Hero"),
      ...hero.map((c) => cardEl(c)));
  } else {
    const pickHost = h("div", { class: "eq-hero-picker-host" });
    mountHeroPicker(pickHost, {
      initial: [],
      board,
      onChange: (newHero) => {
        hero = newHero;
        recomputeLive();
      },
    });
    heroSection = pickHost;
  }

  const boardRow = h("div", { class: "eq-cards" },
    h("span", { class: "eq-cards-label" }, "Board"),
    ...(board.length ? board.map((c) => cardEl(c, "sm")) : [h("span", { class: "muted" }, "preflop")]));

  // ----- range picker -------------------------------------------------------
  const pickerHost = h("div", { class: "eq-picker-host" });
  const countLabel = h("span", { class: "eq-count" }, "0 combos · pick a range below");
  const rangeLabel = h("span", { class: "eq-range-label" }, opts.initialRangeLabel || "");
  let currentCombos = [];

  function recomputeLive() {
    if (!picker) return;
    const sel = picker.getSelection();
    currentCombos = sel.combos;
    if (hero.length !== 2) {
      countLabel.textContent = sel.classes.length
        ? sel.classes.length + " hand class" + (sel.classes.length === 1 ? "" : "es") + " · pick a hero hand to enable Run"
        : "0 combos · pick a range and a hero hand";
      runBtn.disabled = true;
      return;
    }
    const live = sel.combos.filter((c) =>
      !c.includes(hero[0]) && !c.includes(hero[1]) &&
      !board.includes(c[0]) && !board.includes(c[1]));
    countLabel.textContent =
      sel.classes.length + " hand class" + (sel.classes.length === 1 ? "" : "es") +
      " · " + live.length + " combos vs this spot";
    runBtn.disabled = live.length === 0;
  }

  const picker = mountRangePicker(pickerHost, {
    initial: opts.initialRange || [],
    onChange: () => recomputeLive(),
  });

  // ----- run + result -------------------------------------------------------
  const result = h("div", { class: "eq-result muted" }, "Run a simulation to see hero equity.");
  const runBtn = h("button", { type: "button", class: "primary eq-run" }, "Run simulation");
  runBtn.disabled = true;
  runBtn.addEventListener("click", () => {
    if (!currentCombos.length || hero.length !== 2) return;
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    setTimeout(() => {
      const t0 = performance.now();
      const r = runEquity({ heroHand: hero, board, villainRange: currentCombos, trials: 5000 });
      const ms = Math.round(performance.now() - t0);
      if (r.equity == null) {
        result.className = "eq-result eq-result-empty muted";
        result.textContent = "No valid villain combos given the dead cards. Pick a wider range.";
      } else {
        const pct = (r.equity * 100).toFixed(1);
        const opp = (100 - parseFloat(pct)).toFixed(1);
        result.className = "eq-result";
        while (result.firstChild) result.removeChild(result.firstChild);
        result.appendChild(h("div", { class: "eq-bar" },
          h("div", { class: "eq-bar-hero", style: "width:" + pct + "%" }),
          h("div", { class: "eq-bar-vill", style: "width:" + opp + "%" })
        ));
        result.appendChild(h("div", { class: "eq-numbers" },
          h("span", { class: "eq-hero-pct" }, "Hero " + pct + "%"),
          h("span", { class: "eq-vill-pct" }, "Villain " + opp + "%"),
          h("span", { class: "muted" },
            " · " + r.trials + " trials · " + r.wins + "W / " + r.ties + "T / " + r.losses + "L · " + ms + "ms")
        ));
      }
      runBtn.disabled = false;
      runBtn.textContent = "Run simulation";
    }, 0);
  });

  const root = h(
    "div",
    { class: "eq-panel" },
    pinnedHero
      ? h("div", { class: "eq-header" }, heroSection, boardRow)
      : h("div", { class: "eq-header eq-header-pickable" }, heroSection, boardRow),
    h("div", { class: "eq-picker-section" },
      h("div", { class: "eq-picker-title" },
        h("span", null, "Villain range"),
        rangeLabel,
        countLabel),
      pickerHost
    ),
    h("div", { class: "eq-run-row" }, runBtn),
    result
  );
  container.appendChild(root);

  // Reflect any initial state.
  recomputeLive();

  function setRange(classes, label) {
    picker.setSelection(classes || []);
    rangeLabel.textContent = label || "";
  }

  return {
    unmount: () => { if (root.parentNode) root.parentNode.removeChild(root); },
    root,
    setRange,
  };
}
