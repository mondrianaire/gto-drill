// equity-calculator.js — the standalone Monte Carlo calculator.
//
// Pure equity tool, no scenario context: pick a hero hand, pick a board
// (0..5 cards), pick a villain range, run the simulation. Reached from
// the sign-in screen as the third main-menu button.

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

function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

const CALC_RANKS = "AKQJT98765432";
const CALC_SUITS = "shdc";

/**
 * Mount the standalone calculator.
 * @param {HTMLElement} container
 * @param {() => void} onExit
 */
export function mountEquityCalculator(container, onExit) {
  clear(container);

  // State
  let hero = []; // 0..2 codes
  let board = []; // 0..5 codes
  let currentCombos = [];

  // -------- header --------
  const exitBtn = h("button", { type: "button", class: "link-btn calc-exit" }, "← Exit");
  exitBtn.addEventListener("click", () => { if (onExit) onExit(); });
  const header = h("div", { class: "calc-header" },
    h("h2", null, "Equity calculator"),
    h("p", { class: "muted calc-blurb" },
      "Pick a hero hand, pick the board (0–5 cards, leave empty for preflop), pick a villain range, run."),
    exitBtn);

  // -------- hero + board slots --------
  const heroSlotsRow = h("div", { class: "calc-slots calc-hero-slots" });
  const boardSlotsRow = h("div", { class: "calc-slots calc-board-slots" });
  const statusEl = h("div", { class: "calc-status muted" }, "Click cards to fill hero (then board).");

  // -------- 52-card grid --------
  const grid = h("div", { class: "hero-pick-grid calc-grid" });
  const cellsByCode = {};

  function renderHeroSlots() {
    clear(heroSlotsRow);
    heroSlotsRow.appendChild(h("span", { class: "calc-slot-label" }, "Hero"));
    for (let i = 0; i < 2; i++) {
      const code = hero[i];
      const slot = code
        ? h("button", { type: "button", class: "hero-pick-slot is-filled", title: "Remove " + code, "aria-label": "Remove " + code }, cardEl(code))
        : h("button", { type: "button", class: "hero-pick-slot is-empty", "aria-label": "Empty hero slot " + (i + 1) }, h("span", null, "?"));
      if (code) slot.addEventListener("click", () => removeFromHero(code));
      heroSlotsRow.appendChild(slot);
    }
  }

  function renderBoardSlots() {
    clear(boardSlotsRow);
    boardSlotsRow.appendChild(h("span", { class: "calc-slot-label" }, "Board"));
    for (let i = 0; i < 5; i++) {
      const code = board[i];
      const slot = code
        ? h("button", { type: "button", class: "hero-pick-slot is-filled", title: "Remove " + code, "aria-label": "Remove " + code }, cardEl(code))
        : h("button", { type: "button", class: "hero-pick-slot is-empty", "aria-label": "Empty board slot " + (i + 1) }, h("span", null, "?"));
      if (code) slot.addEventListener("click", () => removeFromBoard(code));
      boardSlotsRow.appendChild(slot);
    }
  }

  function renderGrid() {
    for (const code of Object.keys(cellsByCode)) {
      const cell = cellsByCode[code];
      const inHero = hero.includes(code);
      const inBoard = board.includes(code);
      cell.classList.toggle("is-selected", inHero);
      cell.classList.toggle("is-board", inBoard);
    }
  }

  function renderStatus() {
    if (hero.length < 2) {
      statusEl.textContent = "Pick " + (2 - hero.length) + " more hero card" + (hero.length === 1 ? "" : "s") + " (then board).";
    } else if (board.length === 0) {
      statusEl.textContent = "Hero set. Now pick 0–5 board cards (leave empty for preflop).";
    } else if (board.length < 5) {
      statusEl.textContent = "Board has " + board.length + " card" + (board.length === 1 ? "" : "s") + ". Click more to add, or click to clear.";
    } else {
      statusEl.textContent = "Board is complete (5 cards). Click any slot to clear.";
    }
  }

  function removeFromHero(code) {
    const idx = hero.indexOf(code);
    if (idx >= 0) hero.splice(idx, 1);
    refresh();
  }

  function removeFromBoard(code) {
    const idx = board.indexOf(code);
    if (idx >= 0) board.splice(idx, 1);
    refresh();
  }

  function pickCard(code) {
    if (hero.includes(code)) { removeFromHero(code); return; }
    if (board.includes(code)) { removeFromBoard(code); return; }
    if (hero.length < 2) hero.push(code);
    else if (board.length < 5) board.push(code);
    else return; // everything full — ignore
    refresh();
  }

  function refresh() {
    renderHeroSlots();
    renderBoardSlots();
    renderGrid();
    renderStatus();
    recomputeLive();
  }

  // Build the 52-card grid (rows = suits, cols = ranks).
  for (const suit of CALC_SUITS) {
    for (const rank of CALC_RANKS) {
      const code = rank + suit;
      const cell = h("button", { type: "button", class: "hero-pick-cell" }, cardEl(code, "sm"));
      cell.addEventListener("click", () => pickCard(code));
      cellsByCode[code] = cell;
      grid.appendChild(cell);
    }
  }

  // -------- villain range picker --------
  // Picker owns its own header (stats + Customize). Standalone calculator
  // opens with no pre-loaded range — the picker shows the empty-hint card.
  const villainHost = h("div", { class: "calc-villain-host" });
  const picker = mountRangePicker(villainHost, {
    initial: [],
    onChange: () => recomputeLive(),
  });

  function recomputeLive() {
    const sel = picker.getSelection();
    currentCombos = sel.combos;
    if (hero.length !== 2) {
      runBtn.disabled = true;
      resetAcc();
      return;
    }
    const live = sel.combos.filter((c) =>
      !c.includes(hero[0]) && !c.includes(hero[1]) &&
      !board.includes(c[0]) && !board.includes(c[1]));
    runBtn.disabled = live.length === 0;
    resetAcc();
  }

  // -------- run + result --------
  let acc = { wins: 0, ties: 0, losses: 0 };

  const trialsSel = h("select", { class: "eq-trials-sel", title: "Trials per click" },
    h("option", { value: "5000" }, "+5,000"),
    h("option", { value: "25000" }, "+25,000"),
    h("option", { value: "100000" }, "+100,000"));

  const result = h("div", { class: "eq-result muted" }, "Run a simulation to see hero equity.");
  const runBtn = h("button", { type: "button", class: "primary eq-run" }, "Run simulation");
  runBtn.disabled = true;

  function resetAcc() {
    acc = { wins: 0, ties: 0, losses: 0 };
    runBtn.textContent = "Run simulation";
    clear(result);
    result.className = "eq-result muted";
    result.textContent = "Run a simulation to see hero equity.";
  }

  function renderAccResult() {
    const total = acc.wins + acc.ties + acc.losses;
    if (total === 0) { resetAcc(); return; }
    const equity = (acc.wins + acc.ties / 2) / total;
    const pct = (equity * 100).toFixed(1);
    const opp = (100 - parseFloat(pct)).toFixed(1);
    clear(result);
    result.className = "eq-result";
    result.appendChild(h("div", { class: "eq-bar" },
      h("div", { class: "eq-bar-hero", style: "width:" + pct + "%" }),
      h("div", { class: "eq-bar-vill", style: "width:" + opp + "%" })));
    const resetLink = h("button", { type: "button", class: "link-btn eq-reset" }, "reset");
    resetLink.addEventListener("click", resetAcc);
    result.appendChild(h("div", { class: "eq-numbers" },
      h("span", { class: "eq-hero-pct" }, "Hero " + pct + "%"),
      h("span", { class: "eq-vill-pct" }, "Villain " + opp + "%"),
      h("span", { class: "muted" },
        " · " + total.toLocaleString() + " trials · " +
        acc.wins + "W / " + acc.ties + "T / " + acc.losses + "L · "),
      resetLink));
  }

  runBtn.addEventListener("click", () => {
    if (hero.length !== 2 || !currentCombos.length) return;
    const trials = parseInt(trialsSel.value, 10) || 5000;
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    setTimeout(() => {
      const r = runEquity({ heroHand: hero, board, villainRange: currentCombos, trials });
      if (r.equity == null) {
        acc = { wins: 0, ties: 0, losses: 0 };
        result.className = "eq-result eq-result-empty muted";
        clear(result);
        result.textContent = "No valid villain combos given the dead cards. Pick a wider range.";
        runBtn.disabled = false;
        runBtn.textContent = "Run simulation";
        return;
      }
      acc.wins += r.wins;
      acc.ties += r.ties;
      acc.losses += r.losses;
      renderAccResult();
      runBtn.disabled = false;
      runBtn.textContent = (acc.wins + acc.ties + acc.losses) > 0 ? "Run more trials" : "Run simulation";
    }, 0);
  });

  // -------- assemble --------
  const root = h("section", { class: "calc-view" },
    header,
    h("div", { class: "calc-section" },
      heroSlotsRow,
      boardSlotsRow,
      grid,
      statusEl
    ),
    villainHost,
    h("div", { class: "eq-run-row" }, trialsSel, runBtn),
    result
  );
  container.appendChild(root);

  // Initial paint
  refresh();

  return {
    unmount: () => clear(container),
  };
}
