// range-picker.js — matrix-first villain range picker.
//
// Two key shapes:
//   - The 13×13 matrix is the canonical visual representation of a range.
//     Poker players think in matrix terms ("top-left = premium", "diagonal
//     = pairs", "above-diagonal = suited"), so it's the display.
//   - Picker controls (Top % slider, Category chips, Playable filter,
//     Clear all) live INSIDE a collapsible "Customize" disclosure. The
//     matrix is the hero on mount; controls only appear when the user
//     explicitly wants to override.
//
// Three open-states the caller can land in (driven by opts):
//   1. Chip click — pre-loaded named range, label shown above the matrix.
//   2. Test-it    — pre-loaded with the last chip in the scenario.
//   3. Standalone — empty matrix + a hint prompting "Tap Customize…".

import { expandHandClass } from "./equity.js";

// -----------------------------------------------------------------------
// Tiny DOM helper (kept local; matches the project's existing pattern).
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

// -----------------------------------------------------------------------
// Hand-class labels + canonical preflop strength ranking
// -----------------------------------------------------------------------

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

function classLabel(r, c) {
  if (r === c) return RANKS[r] + RANKS[c];
  if (c > r) return RANKS[r] + RANKS[c] + "s";
  return RANKS[c] + RANKS[r] + "o";
}

const ALL_LABELS = (() => {
  const out = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(classLabel(r, c));
  return out;
})();

// Rough preflop hand-strength approximation. Real solvers use PokerStove's
// canonical 169-hand ranking; this is close enough for the Top-N% slider's
// UX (the slider's purpose is to surface roughly-the-right shape, not to
// be a precision tool — that's what manual cell-tap is for).
function handStrength(lbl) {
  if (lbl.length === 2) {
    return 200 - RANKS.indexOf(lbl[0]) * 10;
  }
  const r1 = RANKS.indexOf(lbl[0]);
  const r2 = RANKS.indexOf(lbl[1]);
  const high = 13 - r1;
  const low = 13 - r2;
  const gap = r2 - r1;
  const suited = lbl[2] === "s";
  let score = high * 5 + low * 2.5;
  if (suited) score += 8;
  if (gap === 1) score += 5;
  else if (gap === 2) score += 2;
  if (suited && r1 === 0 && r2 >= 8) score += 4; // wheel-suited Ax bonus
  return score;
}

const ORDERED = [...ALL_LABELS].sort((a, b) => handStrength(b) - handStrength(a));

function comboCount(lbl) {
  if (lbl.length === 2) return 6;
  if (lbl[2] === "s") return 4;
  if (lbl[2] === "o") return 12;
  return 1; // specific combo like "AcKc"
}

// -----------------------------------------------------------------------
// Preset definitions
// -----------------------------------------------------------------------

const JUMP_PCTS = [5, 10, 20, 30, 50];

const CATEGORIES = {
  "Pairs":             ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22"],
  "Premium pairs":     ["AA","KK","QQ","JJ"],
  "Big slick":         ["AKs","AKo"],
  "Broadways":         ["AA","KK","QQ","JJ","TT","AKs","AKo","AQs","AQo","AJs","AJo","ATs","ATo","KQs","KQo","KJs","KJo","KTs","KTo","QJs","QJo","QTs","QTo","JTs","JTo"],
  "Suited aces":       ["AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s"],
  "Suited BW":         ["KQs","KJs","KTs","QJs","QTs","JTs"],
  "Suited connectors": ["AKs","KQs","QJs","JTs","T9s","98s","87s","76s","65s","54s","43s","32s"],
  "Suited 1-gap":      ["KJs","QTs","J9s","T8s","97s","86s","75s","64s","53s","42s"],
};

// "Playable" reference set ≈ top 30% of hands. Used by the Playable-only
// filter as a fixed intersection target.
const PLAYABLE_SET = new Set([
  "AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22",
  "AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s",
  "KQs","KJs","KTs","K9s","K8s","K7s",
  "QJs","QTs","Q9s","Q8s",
  "JTs","J9s","J8s",
  "T9s","T8s","T7s",
  "98s","97s",
  "87s","86s",
  "76s","75s",
  "65s","64s",
  "54s","53s",
  "AKo","AQo","AJo","ATo",
  "KQo","KJo","KTo",
  "QJo","QTo",
  "JTo",
]);

// -----------------------------------------------------------------------
// mountRangePicker — the public entry point.
// -----------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @param {string[]} [opts.initial]       Initial selected hand-class labels.
 * @param {string} [opts.initialLabel]    Pre-loaded range name (e.g. "BB's 3-bet range").
 * @param {(sel:{classes:string[], combos:string[][], comboCount:number, label:string|null}) => void} [opts.onChange]
 * @returns {{
 *   getSelection: () => any,
 *   setSelection: (labels:string[], label?:string|null) => void,
 *   clear: () => void,
 *   root: HTMLElement
 * }}
 */
export function mountRangePicker(container, opts = {}) {
  const onChange = opts.onChange || (() => {});

  // ----- state -----
  const raw = new Set(opts.initial || []); // user-intended set
  const sel = new Set();                    // displayed set (after Playable filter)
  let loadedLabel = opts.initialLabel || null;
  let playableOnly = false;
  const cellBy = {};

  // ----- DOM -----
  const statsEl = h("div", { class: "rp-stats" });
  // Clear all lives in the main header — it's a view-level reset, not
  // specific to any one input section, and stays accessible even with
  // the controls collapsed.
  const clearBtn = h("button",
    { type: "button", class: "rp-clear-btn", title: "Clear all selected hands" },
    "⌫ Clear");
  const customizeBtn = h("button",
    { type: "button", class: "rp-customize-btn", "aria-expanded": "false", title: "Show controls to customize the range" },
    h("span", { class: "lbl" }, "Customize"),
    h("span", { class: "chev" }, "▼"));

  const header = h("div", { class: "rp-header" }, statsEl, clearBtn, customizeBtn);

  const emptyHint = h("div", { class: "rp-empty-hint", hidden: true });
  emptyHint.innerHTML = "No villain range yet. Tap <b>Customize</b> to pick a range, or hit a category chip in there to start fast.";

  // Matrix
  const matrix = h("div", { class: "rp-matrix" });
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const lbl = classLabel(r, c);
      const kind = r === c ? "pair" : (c > r ? "suited" : "offsuit");
      const btn = h("button", { type: "button", class: "rp-cell rp-" + kind }, lbl);
      btn.addEventListener("click", () => {
        if (raw.has(lbl)) raw.delete(lbl);
        else raw.add(lbl);
        markCustom();
        clearJumpHighlights();
        refreshCategoryChips();
        render();
        emit();
      });
      cellBy[lbl] = btn;
      matrix.appendChild(btn);
    }
  }
  const matrixWrap = h("div", { class: "rp-matrix-wrap" }, matrix);

  // ----- collapsible controls -----
  const sliderEl = h("input", { type: "range", min: "0", max: "100", value: "0", step: "1", class: "rp-slider" });
  const pctEl = h("span", { class: "rp-slider-label" }, "0%");
  const jumpsEl = h("div", { class: "rp-jumps-row" });
  const catsEl = h("div", { class: "rp-cats" });
  const playableSwitch = h("button",
    { type: "button", class: "rp-switch", "aria-pressed": "false", title: "Restrict to a 'playable' top-30% reference set" },
    h("span", { class: "rp-switch-track" }),
    h("span", { class: "rp-switch-thumb" }));

  const topSection = h("div", { class: "rp-section" },
    h("div", { class: "rp-section-label" },
      h("span", null, "Top %"),
      h("span", { class: "rp-section-hint" }, "drag slider or jump to a preselect")),
    h("div", { class: "rp-slider-row" }, sliderEl, pctEl),
    h("div", { class: "rp-jumps" },
      h("span", { class: "rp-jumps-label" }, "Jump to:"),
      jumpsEl));

  // Category section now contains the chips PLUS a Filter sub-row at the
  // bottom (Playable toggle). Categories are additive — tap a chip to
  // add its hands to the selection, tap again to remove them. Multiple
  // chips can be active simultaneously.
  const catSection = h("div", { class: "rp-section" },
    h("div", { class: "rp-section-label" },
      h("span", null, "Category"),
      h("span", { class: "rp-section-hint" }, "tap to add · tap again to remove")),
    catsEl,
    h("div", { class: "rp-filter-sub-row" },
      h("div", null,
        h("div", { class: "rp-filter-sublabel" }, "Filter"),
        h("div", { class: "rp-filter-name" }, "Playable hands only"),
        h("div", { class: "rp-filter-sub" }, "Intersect with a top-30% reference range")),
      playableSwitch));

  const controlsWrap = h("div", { class: "rp-controls-wrap" }, topSection, catSection);

  // Layout: controls sit in the SAME slot as the empty hint (above the
  // matrix). Empty hint shows when nothing is selected AND controls are
  // closed — i.e., the slot is the call-to-action when blank, then
  // becomes the customization surface when the user taps Customize.
  // Matrix is always below either of those.
  const root = h("div", { class: "range-picker" }, header, emptyHint, controlsWrap, matrixWrap);
  container.appendChild(root);

  // ----- behavior -----
  function applyPlayableFilter() {
    sel.clear();
    for (const lbl of raw) {
      if (!playableOnly || PLAYABLE_SET.has(lbl)) sel.add(lbl);
    }
  }

  function render() {
    // Visual repaint only — does NOT fire onChange. Mutator helpers call
    // emit() after the state change so the initial mount can paint the
    // DOM without bouncing back into the caller's onChange before their
    // own `const picker = mountRangePicker(...)` has finished.
    applyPlayableFilter();
    let combos = 0;
    for (const lbl of ALL_LABELS) {
      const on = sel.has(lbl);
      cellBy[lbl].classList.toggle("is-on", on);
      if (on) combos += comboCount(lbl);
    }
    for (const lbl of sel) {
      if (!cellBy[lbl]) combos += comboCount(lbl);
    }
    // Empty hint shows when there's nothing to display AND the controls
    // are closed (controls live in the same slot — when open, they ARE
    // the call-to-action so the hint would be redundant).
    const controlsOpen = controlsWrap.classList.contains("is-open");
    const isEmpty = sel.size === 0 && !loadedLabel;
    emptyHint.hidden = !isEmpty || controlsOpen;
    if (isEmpty) {
      statsEl.innerHTML = '<span class="muted">No range selected</span>';
    } else {
      const prefix = loadedLabel
        ? '<span class="rp-loaded-label">' + escapeHtml(loadedLabel) + '</span>'
        : '';
      statsEl.innerHTML = prefix +
        "<b>" + sel.size + "</b> hand class" + (sel.size === 1 ? "" : "es") +
        " · <b>" + combos + "</b> combo" + (combos === 1 ? "" : "s") +
        (playableOnly ? ' · <span class="rp-playable-flag">playable filter on</span>' : "");
    }
  }

  function emit() {
    onChange(getSelection());
  }

  function markCustom() {
    // Any user-driven modification drops the "loaded range" label.
    loadedLabel = null;
  }

  function clearJumpHighlights() {
    Array.from(jumpsEl.children).forEach((b) => b.classList.remove("is-on"));
  }

  // A category chip is "active" iff every hand in its set is present in
  // the current raw selection. Derived state, recomputed after every
  // change — lets categories combine cleanly with sliders, manual taps,
  // and each other.
  function isCategoryActive(name) {
    const hands = CATEGORIES[name];
    for (const h of hands) if (!raw.has(h)) return false;
    return hands.length > 0;
  }

  function refreshCategoryChips() {
    Array.from(catsEl.children).forEach((b) => {
      const name = b.textContent;
      b.classList.toggle("is-on", isCategoryActive(name));
    });
  }

  function setTopN(pct, source) {
    const n = Math.round((pct / 100) * 169);
    raw.clear();
    for (let i = 0; i < n; i++) raw.add(ORDERED[i]);
    pctEl.textContent = "Top " + pct + "%";
    if (source !== "slider") sliderEl.value = pct;
    clearJumpHighlights();
    Array.from(jumpsEl.children).forEach((b) =>
      b.classList.toggle("is-on", parseInt(b.dataset.pct, 10) === pct));
    refreshCategoryChips();
    markCustom();
    render();
    emit();
  }

  function toggleCategory(name) {
    const labels = CATEGORIES[name] || [];
    if (isCategoryActive(name)) {
      // Active → remove this category's hands from the selection.
      for (const l of labels) raw.delete(l);
    } else {
      // Inactive → add this category's hands (union with existing).
      for (const l of labels) raw.add(l);
    }
    sliderEl.value = 0;
    pctEl.textContent = raw.size + " hands";
    clearJumpHighlights();
    refreshCategoryChips();
    markCustom();
    render();
    emit();
  }

  function clearAll() {
    raw.clear();
    sliderEl.value = 0;
    pctEl.textContent = "0%";
    clearJumpHighlights();
    refreshCategoryChips();
    markCustom();
    render();
    emit();
  }

  // ---- wire controls ----
  for (const pct of JUMP_PCTS) {
    const btn = h("button", { type: "button", class: "rp-jump" }, pct + "%");
    btn.dataset.pct = pct;
    btn.addEventListener("click", () => setTopN(pct, "preselect"));
    jumpsEl.appendChild(btn);
  }

  for (const name of Object.keys(CATEGORIES)) {
    const btn = h("button", { type: "button", class: "rp-cat" }, name);
    btn.addEventListener("click", () => toggleCategory(name));
    catsEl.appendChild(btn);
  }

  sliderEl.addEventListener("input", (ev) => setTopN(parseInt(ev.target.value, 10) || 0, "slider"));
  clearBtn.addEventListener("click", clearAll);

  playableSwitch.addEventListener("click", () => {
    playableOnly = !playableOnly;
    playableSwitch.classList.toggle("is-on", playableOnly);
    playableSwitch.setAttribute("aria-pressed", playableOnly ? "true" : "false");
    render();
    emit();
  });

  customizeBtn.addEventListener("click", () => {
    const open = !controlsWrap.classList.contains("is-open");
    controlsWrap.classList.toggle("is-open", open);
    customizeBtn.classList.toggle("is-open", open);
    customizeBtn.setAttribute("aria-expanded", open ? "true" : "false");
    customizeBtn.querySelector(".lbl").textContent = open ? "Hide controls" : "Customize";
    // Re-render so the empty-hint visibility recomputes — it lives in
    // the same slot as the controls and must hide when they open.
    render();
  });

  // ---- public API ----
  function getSelection() {
    const classes = [...sel];
    const combos = [];
    for (const c of classes) combos.push(...expandHandClass(c));
    return { classes, combos, comboCount: combos.length, label: loadedLabel };
  }

  function setSelection(labels, label) {
    raw.clear();
    for (const l of labels || []) raw.add(l);
    sliderEl.value = 0;
    pctEl.textContent = (labels && labels.length) ? labels.length + " hands" : "0%";
    clearJumpHighlights();
    refreshCategoryChips();
    loadedLabel = label || null;
    render();
    emit();
  }

  // Initial paint — visual only, no onChange (the caller hasn't finished
  // initializing yet, so any onChange callback would fire too early).
  refreshCategoryChips();
  render();

  return { getSelection, setSelection, clear: clearAll, root };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
