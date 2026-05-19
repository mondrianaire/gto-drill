// equity-panel.js — the "Test it" panel mounted into the reveal screen.
//
// Wires the range picker to the Monte Carlo engine and shows hero equity.

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

/**
 * Mount the equity panel into `container` for a given scenario.
 * @param {HTMLElement} container
 * @param {Object} scen   Scenario object (uses scen.replay for hero/board).
 * @returns {{ unmount: () => void }}
 */
export function mountEquityPanel(container, scen) {
  const replay = scen && scen.replay;
  const hero = (replay && replay.hero_cards) || null;
  const board = boardCards(replay);

  // No hero hand → can't run equity. Show a friendly notice.
  if (!hero || hero.length !== 2) {
    const note = h(
      "div",
      { class: "eq-panel" },
      h("p", { class: "muted" },
        "Hero's specific hand isn't pinned for this spot — the equity tool " +
        "needs both hole cards. (Hand-picker coming soon.)")
    );
    container.appendChild(note);
    return { unmount: () => { if (note.parentNode) note.parentNode.removeChild(note); } };
  }

  // ----- header strip: hero + board -----
  const heroRow = h("div", { class: "eq-cards" },
    h("span", { class: "eq-cards-label" }, "Hero"),
    ...hero.map((c) => cardEl(c)));
  const boardRow = h("div", { class: "eq-cards" },
    h("span", { class: "eq-cards-label" }, "Board"),
    ...(board.length ? board.map((c) => cardEl(c, "sm")) : [h("span", { class: "muted" }, "preflop")]));

  // ----- range picker -----
  const pickerHost = h("div", { class: "eq-picker-host" });
  const countLabel = h("span", { class: "eq-count" }, "0 combos · pick a range below");
  let currentCombos = [];
  mountRangePicker(pickerHost, {
    onChange: (sel) => {
      currentCombos = sel.combos;
      const live = sel.combos.filter((c) => !c.includes(hero[0]) && !c.includes(hero[1]) && !board.includes(c[0]) && !board.includes(c[1]));
      countLabel.textContent =
        sel.classes.length + " hand class" + (sel.classes.length === 1 ? "" : "es") +
        " · " + live.length + " combos vs this spot";
      runBtn.disabled = live.length === 0;
    },
  });

  // ----- run + result -----
  const result = h("div", { class: "eq-result muted" }, "Run a simulation to see hero equity.");
  const runBtn = h("button", { type: "button", class: "primary eq-run" }, "Run simulation");
  runBtn.disabled = true;
  runBtn.addEventListener("click", () => {
    if (!currentCombos.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    // yield to the browser so the button can repaint before we block
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
    h("div", { class: "eq-header" }, heroRow, boardRow),
    h("div", { class: "eq-picker-section" },
      h("div", { class: "eq-picker-title" },
        h("span", null, "Villain range"),
        countLabel),
      pickerHost
    ),
    h("div", { class: "eq-run-row" }, runBtn),
    result
  );
  container.appendChild(root);

  return {
    unmount: () => { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
