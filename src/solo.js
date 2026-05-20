// solo.js — anonymous, single-player practice mode.
//
// No Firebase, no sign-in, no opponent. Pulls one random scenario at a
// time from the loaded library, runs the same decide -> reveal flow as
// the multiplayer in-game view (so the GTO explanation, range chips,
// and Monte Carlo equity panel all work identically), then shuffles to
// a fresh hand on "Next hand".

import { listScenarios } from "./scenarios.js";
import { mountReplay } from "./replay.js";
import { mountEquityPanel } from "./equity-panel.js";
import { richText, buildRevealResult } from "./ui.js";
import { buildShareLinkButton, shareUrlForScenario } from "./share.js";

// -----------------------------------------------------------------------
// Tiny DOM helper (local; intentionally duplicated to keep this module
// self-contained, matching the project's existing pattern).
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

function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

// -----------------------------------------------------------------------
// mountSoloView — the whole solo practice loop.
//
// @param {HTMLElement} container
// @param {() => void} onExit  Called when the user backs out to sign-in.
// -----------------------------------------------------------------------

export function mountSoloView(container, onExit) {
  const scenarios = listScenarios();
  if (scenarios.length === 0) {
    container.appendChild(h("p", { class: "muted" }, "No scenarios loaded — try refreshing."));
    return { unmount: () => clear(container) };
  }

  // Optional `?scenario=<id>` URL param pins solo to a specific scenario,
  // useful for sharing or for inspecting a particular spot. When pinned,
  // "Next hand" still cycles through the pinned scenario (you re-decide
  // the same spot rather than getting a random one).
  const params = new URLSearchParams(location.search);
  const pinnedId = params.get("scenario");
  const pinned = pinnedId ? scenarios.find((s) => s.scenario_id === pinnedId) : null;

  // Tracking which scenarios we've shown recently, to avoid immediate
  // repeats. Window = half the library or 10, whichever is smaller.
  const recentWindow = Math.min(10, Math.max(1, Math.floor(scenarios.length / 2)));
  const recent = [];
  let currentScen = null;
  // Per-hand state — gets reset on each Next hand.
  let draft = null;
  let replayCleanup = null;
  let handsCompleted = 0;
  let correctSoFar = 0;

  function pickRandomScenario() {
    if (pinned) return pinned;
    let pool = scenarios.filter((s) => !recent.includes(s.scenario_id));
    if (pool.length === 0) pool = scenarios.slice();
    const next = pool[(Math.random() * pool.length) | 0];
    recent.push(next.scenario_id);
    while (recent.length > recentWindow) recent.shift();
    return next;
  }

  function nextHand() {
    currentScen = pickRandomScenario();
    draft = { action: null, confidence: null, note: "", revealed: false };
    render();
  }

  function render() {
    if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
    clear(container);

    const scen = currentScen;
    const errorBox = h("div", { class: "error", role: "alert" });

    // --- header strip --------------------------------------------------------
    // Two-row header: title + action buttons on row 1, stats on row 2. Both
    // action buttons are icon-only (with `title` tooltips); the labels would
    // be redundant given how visually distinct 🔗 / ← are.
    const exitBtn = h("button",
      { type: "button", class: "link-btn solo-exit icon-btn", title: "Exit solo practice", "aria-label": "Exit solo practice" },
      h("span", { "aria-hidden": "true" }, "←"));
    exitBtn.addEventListener("click", () => {
      if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
      if (onExit) onExit();
    });
    const stats = handsCompleted
      ? h("span", { class: "muted solo-stats" },
          "Hands " + handsCompleted + " · GTO accuracy " +
          Math.round((correctSoFar / handsCompleted) * 100) + "%")
      : h("span", { class: "muted solo-stats" }, "Hands 0");
    // Icon-only share link button. buildUrl is evaluated at click time so
    // the URL always points at the scenario currently on screen.
    const { button: shareBtn, fallback: shareFallback } = buildShareLinkButton({
      buildUrl: () => shareUrlForScenario(scen.scenario_id),
      title: "Copy share link for this hand",
      className: "solo-share",
    });
    const header = h("div", { class: "solo-header" },
      h("div", { class: "solo-header-top" },
        h("h2", null, "Solo practice"),
        h("div", { class: "solo-header-actions" }, shareBtn, exitBtn)
      ),
      stats
    );

    // --- the spot ------------------------------------------------------------
    const spot = h("div", { class: "hand-spot" });
    if (scen.replay) {
      const replayHost = h("div", { class: "replay-host" });
      spot.appendChild(replayHost);
      const r = mountReplay(replayHost, scen.replay);
      replayCleanup = r && r.unmount ? r.unmount : null;
      spot.appendChild(h("details", { class: "hand-words" },
        h("summary", null, "The spot in words"),
        h("p", null, richText(scen.description, scen))
      ));
    } else {
      spot.appendChild(h("p", { class: "scenario-desc" }, richText(scen.description, scen)));
    }

    // --- body: decide or reveal ---------------------------------------------
    let body, primaryBtn;
    if (!draft.revealed) {
      const actionRow = h("div", { class: "actions-row", role: "radiogroup", "aria-label": "Your move" });
      (scen.available_actions || []).forEach((a) => {
        // Run action label through richText so bb chips / any-suit / etc.
        // apply consistently with the prose voice.
        const btn = h("button", { type: "button", class: "action-btn" + (draft.action === a ? " selected" : "") }, richText(a, scen, { asAction: true }));
        btn.addEventListener("click", () => {
          draft.action = a;
          actionRow.querySelectorAll(".action-btn").forEach((x) => x.classList.toggle("selected", x === btn));
          errorBox.textContent = "";
        });
        actionRow.appendChild(btn);
      });

      const confRow = h("div", { class: "confidence-row", role: "radiogroup", "aria-label": "How sure are you" });
      for (let c = 1; c <= 5; c++) {
        const btn = h("button", { type: "button", class: "conf-btn" + (draft.confidence === c ? " selected" : "") }, String(c));
        btn.addEventListener("click", () => {
          draft.confidence = c;
          confRow.querySelectorAll(".conf-btn").forEach((x) => x.classList.toggle("selected", x === btn));
          errorBox.textContent = "";
        });
        confRow.appendChild(btn);
      }

      const noteInput = h("textarea", {
        class: "note-input", maxlength: "280", rows: "2",
        placeholder: "What's your read here? (optional)",
      });
      noteInput.value = draft.note || "";
      noteInput.addEventListener("input", () => { draft.note = noteInput.value.slice(0, 280); });
      const noteToggle = h("details", { class: "note-toggle" },
        h("summary", null, draft.note ? "Note added ✓" : "Add a note"),
        noteInput
      );
      if (draft.note) noteToggle.open = true;

      body = h("div", { class: "decide" },
        h("span", { class: "decide-label" }, "Your move"),
        actionRow,
        h("span", { class: "decide-label decide-label-sub" }, "How sure?  (1 = guess, 5 = certain)"),
        confRow,
        noteToggle
      );

      primaryBtn = h("button", { type: "button", class: "primary hand-fwd" }, "Lock in & see GTO →");
      primaryBtn.addEventListener("click", () => {
        if (!draft.action) { errorBox.textContent = "Pick your move."; return; }
        if (!draft.confidence) { errorBox.textContent = "Rate how sure you are (1–5)."; return; }
        draft.revealed = true;
        handsCompleted += 1;
        if (draft.action === scen.gto_action) correctSoFar += 1;
        render();
      });
    } else {
      // ===================== REVEAL =====================
      const gto = scen.gto_action;

      // Equity panel + range chips — same wiring as multiplayer reveal.
      const testHost = h("div", { class: "test-host" });
      const eqState = { open: false, handle: null };
      const testBtn = h("button", { type: "button", class: "secondary test-it" }, "🎲  Test it — equity vs a range");
      function closePanel() {
        if (eqState.handle) eqState.handle.unmount();
        eqState.handle = null;
        eqState.open = false;
        testBtn.textContent = "🎲  Test it — equity vs a range";
      }
      function openWithRange(range) {
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
        if (eqState.open) { closePanel(); return; }
        // Auto-load the LAST chip in the scenario's GTO explanation, if any.
        const ranges = (scen && scen.villain_ranges) || [];
        const last = ranges.length ? ranges[ranges.length - 1] : null;
        if (last) {
          openWithRange({
            classes: last.classes,
            label: "Auto-loaded: " + last.label,
          });
        } else {
          openWithRange(null);
        }
      });

      // Build the reveal AFTER openWithRange is defined so the matrix's
      // pros/cons range chips can call into it.
      const result = buildRevealResult({
        scen,
        userAction: draft.action,
        gtoAction: gto,
        confidence: draft.confidence,
        onRangeClick: openWithRange,
      });

      // The legacy free-form gto_explanation paragraph is no longer rendered
      // — its content lives inside per-option action_analysis pros/cons.
      body = h("div", { class: "hand-reveal" },
        result,
        h("div", { class: "test-row" }, testBtn),
        testHost
      );

      primaryBtn = h("button", { type: "button", class: "primary hand-fwd" }, "Next hand →");
      primaryBtn.addEventListener("click", () => { nextHand(); });
    }

    container.appendChild(h(
      "section",
      { class: "in-game my-turn solo-view" },
      header,
      shareFallback,
      h("div", { class: "hand-card" }, spot, body),
      errorBox,
      h("div", { class: "hand-nav" }, primaryBtn)
    ));
  }

  // Pick the first scenario and render.
  nextHand();

  return {
    unmount: () => {
      if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
      clear(container);
    },
  };
}
