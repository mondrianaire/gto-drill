// tooltip.js — hover/tap tooltip for dictionary terms.
//
// One singleton tooltip element managed at the document level. Triggers
// attach via `wireTermTrigger(el, entry, onOpenInDictionary)`:
//
//   - Desktop: mouseenter shows the tooltip after a short delay, mouseleave
//     hides it; moving onto the tooltip itself keeps it open.
//   - Mobile (touch): a single tap shows the tooltip, tap anywhere else
//     dismisses. Re-tapping the same term toggles.
//
// Positioning: prefers below the trigger; flips above if it would overflow
// the viewport; horizontally clamped to viewport edges with 6px padding.

import { getEntry } from "./dictionary.js";

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

// ---------------------------------------------------------------------
// Singleton tooltip element
// ---------------------------------------------------------------------

let tipEl = null;             // the tooltip DOM
let currentTrigger = null;    // the term <span> the tooltip is currently anchored to
let openTimer = null;
let openCallback = null;      // (termId) => void  — called when "Open in dictionary →" is clicked

function ensureTipEl() {
  if (tipEl) return tipEl;
  tipEl = h("div", { class: "term-tip", role: "tooltip" });
  tipEl.style.display = "none";
  document.body.appendChild(tipEl);
  // Keep tooltip open while hovering it (desktop)
  tipEl.addEventListener("mouseenter", () => clearTimeout(closeTimer));
  tipEl.addEventListener("mouseleave", scheduleClose);
  return tipEl;
}

let closeTimer = null;
function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(closeTip, 180);
}

function closeTip() {
  if (!tipEl) return;
  tipEl.style.display = "none";
  if (currentTrigger) {
    currentTrigger.classList.remove("term-tip-active");
    currentTrigger = null;
  }
}

function openTip(trigger, entry) {
  clearTimeout(closeTimer);
  ensureTipEl();
  if (currentTrigger === trigger && tipEl.style.display !== "none") {
    return; // already open on this trigger
  }
  if (currentTrigger) currentTrigger.classList.remove("term-tip-active");
  currentTrigger = trigger;
  trigger.classList.add("term-tip-active");

  // Render tooltip content
  while (tipEl.firstChild) tipEl.removeChild(tipEl.firstChild);
  tipEl.appendChild(h("div", { class: "term-tip-head" }, entry.term));
  tipEl.appendChild(h("p", { class: "term-tip-body" }, entry.short_def || ""));
  const link = h("button", { type: "button", class: "term-tip-link" }, "Open in dictionary →");
  link.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeTip();
    if (openCallback) openCallback(entry.id);
  });
  tipEl.appendChild(link);

  tipEl.style.display = "block";
  position(trigger);
}

function position(trigger) {
  // Place below the trigger by default; flip above if needed; clamp horizontally.
  const tr = trigger.getBoundingClientRect();
  const tipRect = tipEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 6;
  // Vertical: prefer below
  let top = tr.bottom + 8;
  if (top + tipRect.height > vh - pad) {
    // not enough room below — try above
    const altTop = tr.top - tipRect.height - 8;
    if (altTop >= pad) top = altTop;
    else top = Math.max(pad, vh - tipRect.height - pad);
  }
  // Horizontal: center on trigger, clamp to viewport
  let left = tr.left + tr.width / 2 - tipRect.width / 2;
  if (left < pad) left = pad;
  else if (left + tipRect.width > vw - pad) left = vw - tipRect.width - pad;

  tipEl.style.top = (top + window.scrollY) + "px";
  tipEl.style.left = (left + window.scrollX) + "px";
}

// ---------------------------------------------------------------------
// Global dismiss handlers (mobile tap-outside, escape key)
// ---------------------------------------------------------------------

let globalListenersInstalled = false;
function installGlobalListeners() {
  if (globalListenersInstalled) return;
  globalListenersInstalled = true;
  document.addEventListener("click", (ev) => {
    if (!currentTrigger) return;
    // If the click is on the trigger or inside the tooltip, leave alone.
    if (tipEl && tipEl.contains(ev.target)) return;
    if (currentTrigger.contains(ev.target)) return;
    closeTip();
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeTip();
  });
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Set the callback fired when a user clicks "Open in dictionary →" inside
 * a tooltip. The caller (usually the router) navigates to the dictionary
 * view scrolled to that entry.
 */
export function setOpenCallback(fn) {
  openCallback = fn;
  installGlobalListeners();
}

/**
 * Attach hover/tap tooltip behavior to a term-trigger element.
 */
export function wireTermTrigger(el, entry) {
  installGlobalListeners();

  // Desktop hover (mouseenter / mouseleave)
  el.addEventListener("mouseenter", () => {
    clearTimeout(openTimer);
    openTimer = setTimeout(() => openTip(el, entry), 280);
  });
  el.addEventListener("mouseleave", () => {
    clearTimeout(openTimer);
    scheduleClose();
  });

  // Click / tap — also serves keyboard activation
  el.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (currentTrigger === el && tipEl && tipEl.style.display !== "none") {
      closeTip();
    } else {
      openTip(el, entry);
    }
  });

  // Keyboard accessibility — Enter/Space
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      openTip(el, entry);
    } else if (ev.key === "Escape") {
      closeTip();
    }
  });
}
