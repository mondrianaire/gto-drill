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
import { richText } from "./ui.js";

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

/**
 * Copy a string to the OS clipboard. Returns a promise resolving to true on
 * success, false on failure. Tries the modern Clipboard API first; falls
 * back to a hidden-textarea + execCommand("copy") for older browsers and
 * insecure contexts (since `navigator.clipboard` needs HTTPS).
 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {}
  return false;
}

/** Build the deep-link URL for a given scenario id. */
function shareUrlForScenario(scenarioId) {
  return location.origin + location.pathname + "?scenario=" + encodeURIComponent(scenarioId);
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
    // Two-row header: title + action buttons on row 1, stats on row 2. The
    // action buttons (Share + Exit) are icon-only at <480px so the row never
    // overflows on narrow phones.
    const exitIcon = h("span", { "aria-hidden": "true" }, "←");
    const exitLabel = h("span", { class: "solo-exit-label" }, " Exit solo");
    const exitBtn = h("button",
      { type: "button", class: "link-btn solo-exit", title: "Exit solo practice" },
      exitIcon, exitLabel);
    exitBtn.addEventListener("click", () => {
      if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
      if (onExit) onExit();
    });
    const stats = handsCompleted
      ? h("span", { class: "muted solo-stats" },
          "Hands " + handsCompleted + " · GTO accuracy " +
          Math.round((correctSoFar / handsCompleted) * 100) + "%")
      : h("span", { class: "muted solo-stats" }, "Hands 0");
    // "Copy share link" — writes the deep-link URL for the current scenario
    // to the clipboard. Brief "Copied!" confirmation; falls back to showing
    // the URL inline if clipboard access is blocked.
    const shareIcon = h("span", { "aria-hidden": "true" }, "🔗");
    const shareLabel = h("span", { class: "solo-share-label" }, " Copy share link");
    const shareBtn = h("button",
      { type: "button", class: "link-btn solo-share", title: "Copy a permalink for this hand to the clipboard" },
      shareIcon, shareLabel);
    const shareFallback = h("div", { class: "solo-share-fallback", hidden: true });
    shareBtn.addEventListener("click", async () => {
      const url = shareUrlForScenario(scen.scenario_id);
      const ok = await copyToClipboard(url);
      if (ok) {
        const prevIcon = shareIcon.textContent;
        const prevLabel = shareLabel.textContent;
        shareBtn.classList.add("is-copied");
        shareIcon.textContent = "✓";
        shareLabel.textContent = " Copied!";
        setTimeout(() => {
          shareBtn.classList.remove("is-copied");
          shareIcon.textContent = prevIcon;
          shareLabel.textContent = prevLabel;
        }, 1800);
      } else {
        // Clipboard failed — surface the URL inline so the user can copy by hand.
        shareFallback.hidden = false;
        clear(shareFallback);
        const input = h("input", { type: "text", readonly: true, value: url, class: "solo-share-input" });
        const close = h("button", { type: "button", class: "link-btn" }, "✕");
        close.addEventListener("click", () => { shareFallback.hidden = true; clear(shareFallback); });
        shareFallback.appendChild(h("span", { class: "muted" }, "Copy this link:"));
        shareFallback.appendChild(input);
        shareFallback.appendChild(close);
        setTimeout(() => { input.focus(); input.select(); }, 0);
      }
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
        const btn = h("button", { type: "button", class: "action-btn" + (draft.action === a ? " selected" : "") }, a);
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
      const correct = draft.action === gto;

      const result = h("div", { class: "hand-result" + (correct ? " is-ok" : " is-miss") },
        h("div", { class: "result-verdict" }, correct ? "✓ You matched the GTO line" : "✗ Off the GTO line"),
        h("div", { class: "result-picks" },
          h("div", null,
            h("span", { class: "muted" }, "You played  "),
            h("strong", { class: correct ? "ok" : "miss" }, draft.action),
            h("span", { class: "muted" }, "   ·   confidence " + draft.confidence + "/5")),
          h("div", null,
            h("span", { class: "muted" }, "GTO line  "),
            h("strong", { class: "gto-action" }, gto))
        )
      );

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
        if (eqState.open) closePanel();
        else openWithRange(null);
      });

      const explain = h("p", { class: "gto-explanation" },
        richText(scen.gto_explanation, scen, { onRangeClick: openWithRange }));

      body = h("div", { class: "hand-reveal" },
        result,
        explain,
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
