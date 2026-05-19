// range-picker.js — 13×13 hand-grid range picker.
//
// Standard poker layout:
//   - row == col  → pair (diagonal)
//   - col >  row  → suited combos (upper-right triangle)
//   - col <  row  → offsuit combos (lower-left triangle)
//
// Rows/cols are A,K,Q,J,T,9,8,7,6,5,4,3,2 from top-left. Each cell toggles
// a whole hand-class (e.g. "AKs", "QQ", "T9o") in/out of the range. The
// caller gets a callback with the expanded combos every time selection
// changes.

import { expandHandClass } from "./equity.js";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

function labelFor(r, c) {
  if (r === c) return RANKS[r] + RANKS[c];
  if (c > r) return RANKS[r] + RANKS[c] + "s";
  return RANKS[c] + RANKS[r] + "o";
}

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

// All 169 hand-class labels, ordered top-left → bottom-right.
function allLabels() {
  const out = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(labelFor(r, c));
  return out;
}

// A few stock ranges users will reach for.
const PAIRS = ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22"];
const BROADWAYS = [
  "AA","KK","QQ","JJ","TT",
  "AKs","AKo","AQs","AQo","AJs","AJo","ATs","ATo",
  "KQs","KQo","KJs","KJo","KTs","KTo",
  "QJs","QJo","QTs","QTo",
  "JTs","JTo",
];

/**
 * Mount the range picker into `container`.
 *
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {string[]} [opts.initial]   initial selection (hand-class labels)
 * @param {(sel:{classes:string[], combos:string[][], comboCount:number}) => void} [opts.onChange]
 * @returns {{ getSelection: () => any, setSelection: (labels:string[]) => void, root: HTMLElement }}
 */
export function mountRangePicker(container, opts = {}) {
  const selected = new Set(opts.initial || []);
  const onChange = opts.onChange || (() => {});

  const buttons = {};
  const grid = h("div", { class: "rp-grid" });
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const lbl = labelFor(r, c);
      const kind = r === c ? "pair" : c > r ? "suited" : "offsuit";
      const btn = h(
        "button",
        { type: "button", class: "rp-cell rp-" + kind + (selected.has(lbl) ? " is-on" : "") },
        lbl
      );
      btn.addEventListener("click", () => {
        if (selected.has(lbl)) selected.delete(lbl);
        else selected.add(lbl);
        btn.classList.toggle("is-on");
        emit();
      });
      grid.appendChild(btn);
      buttons[lbl] = btn;
    }
  }

  function syncButtons() {
    for (const lbl of Object.keys(buttons)) {
      buttons[lbl].classList.toggle("is-on", selected.has(lbl));
    }
  }

  function setSelection(labels) {
    selected.clear();
    for (const l of labels) if (l in buttons) selected.add(l);
    syncButtons();
    emit();
  }

  function getSelection() {
    const classes = [...selected];
    const combos = [];
    for (const c of classes) combos.push(...expandHandClass(c));
    return { classes, combos, comboCount: combos.length };
  }

  function emit() { onChange(getSelection()); }

  const presetsRow = h(
    "div",
    { class: "rp-presets" },
    h("button", { type: "button", class: "rp-preset", onClick: () => setSelection(allLabels()) }, "Any two"),
    h("button", { type: "button", class: "rp-preset", onClick: () => setSelection(PAIRS) }, "Pairs"),
    h("button", { type: "button", class: "rp-preset", onClick: () => setSelection(BROADWAYS) }, "Broadways"),
    h("button", { type: "button", class: "rp-preset rp-clear", onClick: () => setSelection([]) }, "Clear")
  );

  const root = h("div", { class: "range-picker" }, grid, presetsRow);
  container.appendChild(root);

  return { getSelection, setSelection, root };
}
