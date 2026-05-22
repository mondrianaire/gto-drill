// solo.js — anonymous, single-player practice mode.
//
// No Firebase, no sign-in, no opponent. Pulls one random scenario at a
// time from the loaded library, runs the same decide -> reveal flow as
// the multiplayer in-game view (so the GTO explanation, range chips,
// and Monte Carlo equity panel all work identically), then shuffles to
// a fresh hand on "Next hand".

import { listScenarios } from "./scenarios.js";
import { mountReplay, buildSpotSummary, buildRunoutStrip, buildHeroStrip } from "./replay.js";
import { mountEquityPanel } from "./equity-panel.js";
import { richText, buildRevealResult, buildVillainRangeBlock, buildGtoRead, buildLessonTakeaway, buildGtoExplanation, buildOptionsAnalysis, buildCrowdBreakdown, buildScenarioInfo, buildRetestCompare } from "./ui.js";
import { recordResponse, readScenarioResponses, readMyResponses, saveResponseComment, getCurrentUser } from "./state.js";

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
 * Fill the crowd-breakdown host on the reveal screen. Records the
 * user's answer to the global response pool, reads the full pool for
 * the scenario, and renders the "how others played" block.
 *
 * Async + best-effort: the reveal renders instantly with a "loading"
 * placeholder; this swaps in the real block once Firestore responds.
 * Bails if the host was detached (user advanced to the next hand).
 *
 * Not signed in → shows a sign-in nudge instead (the crowd pool needs
 * an identity to read/write).
 */
async function loadCrowd(scen, draft, host) {
  host.appendChild(h("p", { class: "crowd-loading muted" }, "Loading how others played…"));

  // Not signed in — show a sign-in nudge. This branch is synchronous
  // (no awaits), so the host being momentarily detached at call time
  // is fine: mutations land and show once the host is appended to the
  // reveal body. getCurrentUser() is null-safe (returns null before
  // sign-in / Firebase init) — unlike getCurrentUid() which throws.
  if (!getCurrentUser()) {
    clear(host);
    host.appendChild(h("div", { class: "crowd-breakdown" },
      h("div", { class: "crowd-header" },
        h("div", { class: "crowd-title" }, "How others played"),
        h("div", { class: "crowd-subtitle muted" }, "Sign in to record your answer and see the crowd")
      )
    ));
    return;
  }

  // Record first so the subsequent read includes this answer, then
  // read the full pool. Both are best-effort — a failure just yields
  // a smaller / empty crowd block, never blocks the reveal.
  try {
    await recordResponse(scen.scenario_id, draft.action, draft.confidence);
  } catch (err) {
    console.warn("recordResponse failed:", err);
  }
  let responses = [];
  try {
    responses = await readScenarioResponses(scen.scenario_id);
  } catch (err) {
    console.warn("readScenarioResponses failed:", err);
  }
  // Only NOW guard on connectivity — after the awaits, the user may
  // have advanced to the next hand and this host is stale.
  if (!host.isConnected) return;
  clear(host);
  const block = buildCrowdBreakdown({ scen, responses, userAction: draft.action });
  if (block) host.appendChild(block);
}

/**
 * Post-reveal comment box — a comment on the hand and the GTO
 * decision (not a pre-decision note). Saved to the user's response
 * doc; other players see it as a note indicator on the crowd
 * breakdown. Returns null for anonymous users (no doc to attach to).
 */
function buildCommentBox(scen, draft) {
  if (!getCurrentUser()) return null;
  const ta = h("textarea", {
    class: "comment-input", maxlength: "280", rows: "3",
    placeholder: "Your take on this spot and the GTO call… (optional — other players see it)",
  });
  ta.value = draft.note || "";
  const status = h("span", { class: "comment-status muted" });
  const saveBtn = h("button", { type: "button", class: "secondary comment-save" }, "Save comment");
  let saving = false;
  ta.addEventListener("input", () => {
    draft.note = ta.value.slice(0, 280);
    status.textContent = "";
  });
  saveBtn.addEventListener("click", async () => {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    status.textContent = "Saving…";
    try {
      await saveResponseComment(scen.scenario_id, ta.value, draft.action, draft.confidence);
      // The comment now describes the current selection — refresh the
      // snapshot so a later retest compares against the right answer.
      draft.noteAction = draft.action;
      draft.noteConfidence = draft.confidence;
      status.textContent = "Saved ✓";
    } catch (err) {
      console.warn("saveResponseComment failed:", err);
      status.textContent = "Couldn't save — try again.";
    }
    saving = false;
    saveBtn.disabled = false;
  });
  // Stale-note flag — the player wrote this note about a DIFFERENT
  // answer on an earlier pass (recordResponse keeps the note via a
  // merge write). Surface the mismatch rather than auto-deleting it:
  // only the player can judge whether their reasoning still holds.
  const prior = draft.priorAnswer;
  let staleFlag = null;
  if (prior && prior.note && prior.noteAction && draft.action &&
      prior.noteAction !== draft.action) {
    staleFlag = h("p", { class: "comment-stale-flag" },
      "⚠ This note was written when you answered " + prior.noteAction +
      ". You have now answered " + draft.action +
      " — update or clear it so it still fits this hand.");
  }
  return h("div", { class: "comment-box" },
    h("div", { class: "comment-label" }, "💬 Your take on this hand"),
    h("p", { class: "comment-hint muted" },
      "A comment on the spot and the GTO decision. Other players see it on the crowd breakdown."),
    staleFlag,
    ta,
    h("div", { class: "comment-actions" }, saveBtn, status)
  );
}

// -----------------------------------------------------------------------
// mountSoloView — the whole solo practice loop.
//
// @param {HTMLElement} container
// @param {() => void} onExit  Called when the user backs out to sign-in.
// -----------------------------------------------------------------------

// Verdict tint — drive the browser toolbar's theme-color to the hand's
// outcome on the GTO reveal (a dark green on a match, a dark red on a
// miss), and rest it at the neutral near-black everywhere else. A
// peripheral, redundant echo of the on-screen verdict — never the only
// channel. Implements the verdict-tint design note (extends Finding 04).
const THEME_NEUTRAL = "#0f1a24";
const THEME_MATCH = "#1f4d3a";
const THEME_MISS = "#4a2326";
function setThemeColor(hex) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", hex);
}

export function mountSoloView(container, onExit, onPlayers, knowledgeLevel, onDatabase) {
  const scenarios = listScenarios();
  if (scenarios.length === 0) {
    container.appendChild(h("p", { class: "muted" }, "No scenarios loaded — try refreshing."));
    return { unmount: () => clear(container) };
  }

  // Ideal scenario complexity for the player's self-reported level —
  // the weighted picker pulls toward this. Anonymous / unknown → a
  // neutral mid-table 3.0.
  const IDEAL_COMPLEXITY = { new: 1.8, some: 2.6, familiar: 3.6, master: 4.4 };
  const idealComplexity = IDEAL_COMPLEXITY[knowledgeLevel] || 3.0;

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
  // Scenario ids the signed-in user has already ANSWERED — populated
  // from readMyResponses() on mount, and added to on every lock-in.
  // The picker skips these so a player works through fresh hands;
  // once every scenario is completed it recycles (see pickScenario).
  const completedIds = new Set();
  // The signed-in user's last recorded answer per scenario — { action,
  // confidence }, keyed by scenario_id. Seeded from readMyResponses() on
  // mount, refreshed on every Next hand. Drives the "retest" treatment:
  // a scenario the player has answered before gets a Replay marker and a
  // then-vs-now comparison on the reveal.
  const priorById = new Map();
  let currentScen = null;
  // Per-hand state — gets reset on each Next hand.
  let draft = null;
  let replayCleanup = null;
  let handsCompleted = 0;
  let correctSoFar = 0;
  // Hand-display layout: "expanded" — the animated oval table — or
  // "compact" — the one-screen runout strip + hero strip + timeline
  // (spec §6.1 / mockup M3). The table is the default; a toggle in the
  // scenario headline switches, and the choice persists per device.
  let viewMode = "expanded";
  try {
    const saved = window.localStorage.getItem("gto-drill.viewMode");
    if (saved === "compact" || saved === "expanded") viewMode = saved;
  } catch { /* private mode — keep the expanded default */ }

  // Selection weight for a scenario. priority^1.6 keeps the "golden
  // example" scenarios (priority 5) surfacing ~2.4× their share of
  // the library — they're guaranteed the most player-response data
  // even though few users complete everything — without letting
  // priority swamp the complexity match. complexityMatch pulls
  // toward the player's level: exact match ×1.0, off by 3 still
  // ×~0.18 — strongly deprioritised, never hard-excluded.
  function scenarioWeight(s) {
    const priority = s.priority || 3;
    const complexity = s.complexity || 3;
    const priorityWeight = Math.pow(priority, 1.6);
    const complexityMatch = 1 / (1 + 1.5 * Math.abs(complexity - idealComplexity));
    return priorityWeight * complexityMatch;
  }

  function weightedPick(pool) {
    let total = 0;
    for (const s of pool) total += scenarioWeight(s);
    if (total <= 0) return pool[(Math.random() * pool.length) | 0];
    let r = Math.random() * total;
    for (const s of pool) {
      r -= scenarioWeight(s);
      if (r <= 0) return s;
    }
    return pool[pool.length - 1];
  }

  function pickScenario() {
    if (pinned) return pinned;
    // Prefer scenarios that are neither completed nor recently shown.
    let pool = scenarios.filter(
      (s) => !completedIds.has(s.scenario_id) && !recent.includes(s.scenario_id)
    );
    // All fresh ones happen to be in the recent window — drop the
    // recent constraint but keep excluding completed.
    if (pool.length === 0) {
      pool = scenarios.filter((s) => !completedIds.has(s.scenario_id));
    }
    // Exhausted — the user has answered every scenario. Recycle,
    // avoiding only the recent window.
    if (pool.length === 0) {
      pool = scenarios.filter((s) => !recent.includes(s.scenario_id));
    }
    if (pool.length === 0) pool = scenarios.slice();
    // Weighted by priority (golden examples surface most) and
    // complexity match to the player's knowledge level.
    const next = weightedPick(pool);
    recent.push(next.scenario_id);
    while (recent.length > recentWindow) recent.shift();
    return next;
  }

  function nextHand() {
    // Commit the answer just given so a later replay of THIS scenario
    // compares its then-vs-now against the most recent attempt.
    if (currentScen && draft && draft.revealed && draft.action) {
      priorById.set(currentScen.scenario_id, {
        action: draft.action, confidence: draft.confidence,
        note: draft.note || "",
        noteAction: draft.noteAction || null,
        noteConfidence: draft.noteConfidence || null,
      });
    }
    currentScen = pickScenario();
    // priorAnswer — the user's recorded answer to this scenario BEFORE
    // the current attempt, or null if they've never played it. Captured
    // once here so the decide + reveal screens read a stable value.
    const priorAnswer = priorById.get(currentScen.scenario_id) || null;
    draft = {
      action: null, confidence: null,
      // Seed the comment box with the note the player left on an earlier
      // pass (retests) so it stays visible and editable instead of
      // silently vanishing. "" for a first-time scenario.
      note: (priorAnswer && priorAnswer.note) || "",
      // The selection that seeded note was written about — carried so
      // the reveal can flag a mismatch and a re-saved comment stays
      // self-describing. Refreshed when the player saves a new comment.
      noteAction: (priorAnswer && priorAnswer.noteAction) || null,
      noteConfidence: (priorAnswer && priorAnswer.noteConfidence) || null,
      revealed: false,
      priorAnswer,
    };
    render();
  }

  // First-run coach mark (spec §7) — the one-time "try Compact view"
  // hint. Shown at most once per device: the first decide screen that
  // overflows the viewport in the expanded layout. It fades in beside
  // the toggle, auto-dismisses on any tap or after 6s, and is then
  // recorded as seen so it never repeats.
  function maybeShowCompactCoach(headlineEl, toggleBtn) {
    if (viewMode !== "expanded" || !toggleBtn || !headlineEl) return;
    if (draft && draft.revealed) return;            // decide screens only
    try {
      if (window.localStorage.getItem("gto-drill.compactCoachSeen") === "1") return;
    } catch { return; }
    // Defer a beat so layout (the replay table, the cards) has settled
    // before measuring whether the hand overflows the screen.
    setTimeout(() => {
      if (!headlineEl.isConnected) return;          // already re-rendered
      // > innerHeight + 72 clears the body's 4rem bottom padding, so
      // this fires only on genuine overflow — the hand needs a scroll.
      if (document.documentElement.scrollHeight <= window.innerHeight + 72) return;
      try { window.localStorage.setItem("gto-drill.compactCoachSeen", "1"); } catch {}
      const coach = h("div", { class: "view-coach", role: "status" },
        "This hand runs long — tap ",
        h("b", null, "Compact view"),
        " to fit it on one screen.");
      headlineEl.appendChild(coach);
      requestAnimationFrame(() => coach.classList.add("is-in"));
      let done = false;
      const dismiss = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener("pointerdown", dismiss, true);
        coach.classList.remove("is-in");
        setTimeout(() => { if (coach.isConnected) coach.remove(); }, 240);
      };
      const timer = setTimeout(dismiss, 6000);
      // Any tap anywhere dismisses it — including a tap on the toggle.
      document.addEventListener("pointerdown", dismiss, true);
    }, 200);
  }

  function render() {
    if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
    clear(container);

    const scen = currentScen;
    const errorBox = h("div", { class: "error", role: "alert" });

    // --- header strip --------------------------------------------------------
    // Two-row header: title + action buttons on row 1, stats on row 2.
    // Exit is an always-rendered labelled button (no bare arrow); the
    // Players control stays an icon (👥) with a tooltip.
    const exitBtn = h("button",
      { type: "button", class: "solo-exit", title: "Exit solo practice", "aria-label": "Exit solo practice" },
      "Exit");
    exitBtn.addEventListener("click", () => {
      if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
      if (onExit) onExit();
    });
    // Stats line: this-session hands + accuracy, plus lifetime
    // completion (distinct scenarios answered / library size) for
    // signed-in users so they can see how far through the set they
    // are.
    const completionSuffix = getCurrentUser()
      ? " · " + completedIds.size + "/" + scenarios.length + " scenarios done"
      : "";
    const stats = handsCompleted
      ? h("span", { class: "muted solo-stats" },
          "Hands " + handsCompleted + " · GTO accuracy " +
          Math.round((correctSoFar / handsCompleted) * 100) + "%" + completionSuffix)
      : h("span", { class: "muted solo-stats" }, "Hands 0" + completionSuffix);
    // Players button — opens the roster screen. Only present when the
    // caller wired onPlayers (signed-in users; the crowd pool needs an
    // identity to be meaningful).
    const playersBtn = onPlayers
      ? h("button",
          { type: "button", class: "solo-players", title: "See all players", "aria-label": "See all players" },
          "Players")
      : null;
    if (playersBtn) {
      playersBtn.addEventListener("click", () => {
        if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
        setThemeColor(THEME_NEUTRAL);  // leaving the reveal — drop the tint
        onPlayers();
      });
    }
    // Database button — the owner-only console. Only present when the
    // caller wired onDatabase (the signed-in owner; see owner.js).
    const databaseBtn = onDatabase
      ? h("button",
          { type: "button", class: "solo-database", title: "Owner database console", "aria-label": "Owner database console" },
          "Database")
      : null;
    if (databaseBtn) {
      databaseBtn.addEventListener("click", () => {
        if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
        setThemeColor(THEME_NEUTRAL);  // leaving the reveal — drop the tint
        onDatabase();
      });
    }
    const header = h("div", { class: "solo-header" },
      h("div", { class: "solo-header-top" },
        h("h2", null, "Solo practice"),
        h("div", { class: "solo-header-actions" }, databaseBtn, playersBtn, exitBtn)
      ),
      stats
    );

    // --- scenario headline ---------------------------------------------------
    // "Scenario #NNN" — the atomic reference, i.e. the trailing number of
    // the scenario slug. Sits at the very top of the hand card, above the
    // table's CASH/TOURNAMENT context line. This is how a scenario is
    // referred to now that the share-link button is gone.
    const scenNum = String(scen.scenario_id || "").match(/(\d+)\s*$/);
    // A "Replay" marker rides on the headline when the player has
    // answered this scenario before — a heads-up that it's a retest.
    // The prior answer itself stays hidden until the reveal.
    const isReplay = !!(draft && draft.priorAnswer && draft.priorAnswer.action);
    // View toggle — switches the hand display between the animated
    // table and the compact one-screen layout (spec §6.1 / §7). Only
    // shown when the scenario has a replay to render either way.
    let viewToggleBtn = null;
    if (scen.replay) {
      const goCompact = viewMode === "expanded";
      viewToggleBtn = h("button", {
        type: "button",
        class: "view-toggle",
        "aria-pressed": String(viewMode === "compact"),
        title: goCompact
          ? "Switch to the compact one-screen view"
          : "Switch to the animated table view",
      }, goCompact ? "Compact view" : "Table view");
      viewToggleBtn.addEventListener("click", () => {
        viewMode = goCompact ? "compact" : "expanded";
        try { window.localStorage.setItem("gto-drill.viewMode", viewMode); } catch {}
        render();
      });
    }
    const headlineMain = h("span", { class: "scenario-headline-main" },
      scenNum ? "Scenario " : null,
      scenNum ? h("span", { class: "scenario-headline-num" }, "#" + scenNum[1]) : null,
      (scenNum && isReplay)
        ? h("span", { class: "scenario-replay-tag", title: "You've answered this scenario before" }, "Replay")
        : null);
    // Four-dot PRE / FLOP / TURN / RIVER progress indicator (mockup M3 —
    // compressed-workflow pass). Dots before the decision street are
    // ".is-done" (dim), the decision street itself is ".is-now" (accent
    // glow), and any unreached future streets stay at neutral border tint.
    const decisionStreet = (() => {
      const b = (scen.replay && scen.replay.board) || {};
      if (b.river && b.river.length) return 3;
      if (b.turn && b.turn.length) return 2;
      if (b.flop && b.flop.length) return 1;
      return 0;
    })();
    const streetsDots = scen.replay
      ? h("div", { class: "scenario-streets", "aria-hidden": "true" },
          ...[0, 1, 2, 3].map((i) => h("span", {
            class: "scenario-street-dot"
              + (i < decisionStreet ? " is-done" : "")
              + (i === decisionStreet ? " is-now" : ""),
          })))
      : null;
    const scenarioHeadline = (scenNum || viewToggleBtn)
      ? h("div", { class: "scenario-headline" }, headlineMain, streetsDots, viewToggleBtn)
      : null;

    // --- scenario INFO pane --------------------------------------------------
    // Shown ABOVE the hand summary for any scenario whose setup deviates
    // from the 100bb-cash, cards-shown default (tournament, short stack,
    // hidden hole cards). null — and absent from the DOM — otherwise.
    const infoPane = buildScenarioInfo({ scen });

    // --- the spot ------------------------------------------------------------
    const spot = h("div", { class: "hand-spot" });
    if (scen.replay && viewMode === "compact") {
      // Compact one-screen layout (spec §6.1 / mockup M3): the oval
      // table collapses to a board-runout strip + a hero strip; the
      // spot-summary timeline carries the action history. No animated
      // table here, so the summary is a static display — built without
      // onJumpToStep (there is nothing to scrub).
      const runout = buildRunoutStrip(scen.replay);
      const hero = buildHeroStrip(scen.replay);
      if (runout) spot.appendChild(runout);
      if (hero) spot.appendChild(hero);
      const summary = buildSpotSummary(scen.replay);
      if (summary) spot.appendChild(summary);
    } else if (scen.replay) {
      // Expanded layout (the default) — the animated oval table.
      const replayHost = h("div", { class: "replay-host" });
      spot.appendChild(replayHost);
      // Build the spot-summary BEFORE mounting the replay. Two-way sync:
      //   replay → summary: mountReplay's onStep drives summary.setStep
      //   summary → replay: summary's onJumpToStep drives replay.jumpTo
      // The replay handle is captured in a closure ref because the
      // summary references it before mountReplay returns.
      let replayHandle = null;
      const summary = buildSpotSummary(scen.replay, {
        onJumpToStep: (s) => { if (replayHandle) replayHandle.jumpTo(s); },
      });
      replayHandle = mountReplay(replayHost, scen.replay, {
        onStep: summary ? (s) => summary.setStep(s) : null,
      });
      replayCleanup = replayHandle && replayHandle.unmount ? replayHandle.unmount : null;
      if (summary) spot.appendChild(summary);
    } else {
      spot.appendChild(h("p", { class: "scenario-desc" }, richText(scen.description, scen)));
    }

    // --- body: decide or reveal ---------------------------------------------
    // IMPORTANT: spot-context (framing + villain range chips) is GTO content
    // and MUST NOT appear during decide — that would give away the answer.
    // Both the framing and the named villain ranges encode the solver's
    // read of the spot; they live ONLY in the post-submission GTO screen.
    let body, primaryBtn;
    if (!draft.revealed) {
      // Decide phase — the toolbar rests at the neutral near-black.
      setThemeColor(THEME_NEUTRAL);
      // Lock-in button is built first so the action/confidence click
      // handlers below can reveal it once both are picked. It lives
      // INSIDE the decide body (below the note), not in the separate
      // hand-nav row at the bottom — so the call-to-action visually
      // belongs to the form it's submitting.
      const lockInBtn = h("button", { type: "button", class: "primary hand-fwd lock-in-btn", hidden: true }, "Lock in & see GTO →");
      function refreshLockBtn() {
        lockInBtn.hidden = !(draft.action && draft.confidence);
        // When a move is picked but confidence isn't, glow the
        // confidence row to point the user at the missing input.
        // (confRow is declared just below — only ever called after.)
        confRow.classList.toggle("needs-confidence", !!draft.action && !draft.confidence);
      }

      const actionRow = h("div", { class: "actions-row", role: "radiogroup", "aria-label": "Your move" });
      (scen.available_actions || []).forEach((a) => {
        // Run action label through richText so bb chips / any-suit / etc.
        // apply consistently with the prose voice.
        const btn = h("button", { type: "button", class: "action-btn" + (draft.action === a ? " selected" : "") }, richText(a, scen, { asAction: true }));
        btn.addEventListener("click", () => {
          draft.action = a;
          actionRow.querySelectorAll(".action-btn").forEach((x) => x.classList.toggle("selected", x === btn));
          errorBox.textContent = "";
          refreshLockBtn();
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
          refreshLockBtn();
        });
        confRow.appendChild(btn);
      }

      // (The hand comment moved to AFTER the reveal — it's a comment
      // on the spot + GTO decision, not a pre-decision note.)

      lockInBtn.addEventListener("click", () => {
        if (!draft.action) { errorBox.textContent = "Pick your move."; return; }
        if (!draft.confidence) { errorBox.textContent = "Rate how sure you are (1–5)."; return; }
        draft.revealed = true;
        handsCompleted += 1;
        if (draft.action === scen.gto_action) correctSoFar += 1;
        // Mark this scenario completed so the picker won't re-serve it
        // (this session, and — once the Firestore write lands — across
        // future sessions via readMyResponses).
        completedIds.add(scen.scenario_id);
        render();
      });

      body = h("div", { class: "decide" },
        h("span", { class: "decide-label" }, "Your move"),
        actionRow,
        h("span", { class: "decide-label decide-label-sub" }, "How sure?  (1 = guess, 5 = certain)"),
        confRow,
        lockInBtn
      );

      // Set initial visibility for the case where draft already had an
      // action+confidence from a prior render (e.g. user navigated away
      // and back without locking in).
      refreshLockBtn();
      // No primaryBtn during decide — the lock-in button lives inside
      // the body. hand-nav stays empty until reveal.
      primaryBtn = null;
    } else {
      // ===================== REVEAL (the GTO screen) =====================
      // EVERYTHING below this line is GTO content and only appears AFTER
      // the user locks in their answer:
      //   - spot context (framing + villain range chips)
      //   - equity host (the Monte Carlo panel mounts here)
      //   - verdict + per-option pros/cons matrix + opponent panel
      //   - "Test it" fallback button
      const gto = scen.gto_action;
      // Verdict tint — the toolbar greens on a match, reds on a miss;
      // an ambient echo of the on-screen verdict (verdict-tint note).
      setThemeColor(draft.action === gto ? THEME_MATCH : THEME_MISS);

      // Equity panel state — local to the reveal branch since chips and
      // the Test-it button both live here.
      const equityHost = h("div", { class: "equity-host" });
      const eqState = { open: false, handle: null };
      function openWithRange(range) {
        const classes = (range && range.classes) || [];
        const label = (range && range.label) || "";
        if (eqState.open && eqState.handle) {
          eqState.handle.setRange(classes, label);
        } else {
          eqState.handle = mountEquityPanel(equityHost, scen, { initialRange: classes, initialRangeLabel: label });
          eqState.open = true;
        }
        if (eqState.handle && eqState.handle.root && eqState.handle.root.scrollIntoView) {
          eqState.handle.root.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
      function closeEquityPanel() {
        if (eqState.handle) try { eqState.handle.unmount(); } catch {}
        eqState.handle = null;
        eqState.open = false;
      }

      // Villain range — framed as a deduction ("based on the action so
      // far, here's what villain looks like"). Sits just above the
      // equity panel + Test it so clicking flows into verification.
      const villainRangeBlock = buildVillainRangeBlock({ scen, onRangeClick: openWithRange });

      // GTO line — a small one-line blurb naming the solver's choice.
      const gtoRead = buildGtoRead({ scen, gtoAction: gto });

      // GTO description preamble — paragraph that introduces the
      // strategic landscape and telegraphs the impact of each option.
      // Replaces the redundant "The hand" intro (positions/board/pot
      // are already on the table and in the spot-summary action log).
      const gtoExplanation = buildGtoExplanation({ scen });

      // Options analysis matrix — every available action as a card with
      // pros/cons, GTO pick highlighted, user pick tagged. Lets the
      // reader compare the trade-offs of every choice they had.
      const optionsAnalysis = buildOptionsAnalysis({
        scen, userAction: draft.action, gtoAction: gto,
      });

      // Test-it fallback — auto-loads the LAST villain range as a quick
      // entry into the equity panel, for users who prefer one click.
      const testBtn = h("button", { type: "button", class: "secondary test-it" }, "🎲  Test it — equity vs a range");
      testBtn.addEventListener("click", () => {
        if (eqState.open) {
          closeEquityPanel();
          testBtn.textContent = "🎲  Test it — equity vs a range";
          return;
        }
        const ranges = (scen && scen.villain_ranges) || [];
        const last = ranges.length ? ranges[ranges.length - 1] : null;
        if (last) {
          openWithRange({ classes: last.classes, label: "Auto-loaded: " + last.label });
        } else {
          openWithRange(null);
        }
        testBtn.textContent = "Hide equity panel";
      });

      const result = buildRevealResult({
        scen,
        userAction: draft.action,
        gtoAction: gto,
        confidence: draft.confidence,
      });

      const takeaway = buildLessonTakeaway({ scen });
      // Retest comparison — only when the player has answered this
      // scenario before: their previous answer + a then-vs-now verdict.
      const retestCompare = buildRetestCompare({
        scen, prior: draft.priorAnswer, currentAction: draft.action, gtoAction: gto,
      });
      // Crowd breakdown mounts here — async: we record this answer and
      // read the scenario's full response pool, then fill the host.
      const crowdHost = h("div", { class: "crowd-host" });
      loadCrowd(scen, draft, crowdHost);

      // Post-reveal comment box — a comment on the spot + GTO decision,
      // shared with other players (shows on their crowd breakdown).
      const commentBox = buildCommentBox(scen, draft);

      body = h("div", { class: "hand-reveal" },
        takeaway,           // LEAD: one-line lesson takeaway
        gtoRead,            // GTO line: small blurb (the answer)
        result,             // verdict + compact comparison
        retestCompare,      // then-vs-now (replays only; null otherwise)
        crowdHost,          // "how others played" crowd distribution
        gtoExplanation,     // preamble: strategic landscape + option impacts
        optionsAnalysis,    // matrix: every option's pros/cons
        villainRangeBlock,  // deduced villain range — into Test it
        commentBox,         // "your take on this hand" comment box
        equityHost,         // equity panel mounts here
        h("div", { class: "test-row" }, testBtn)
      );

      primaryBtn = h("button", { type: "button", class: "primary hand-fwd" }, "Next hand →");
      primaryBtn.addEventListener("click", () => { nextHand(); });
    }

    // On REVEAL, the Next-hand button gets a sticky pane anchored to
    // the top of the viewport so the user can advance from any scroll
    // position in the reveal content. During decide there's no
    // primaryBtn (lock-in lives inside the form), so the sticky pane
    // simply doesn't render.
    const stickyNav = primaryBtn
      ? h("div", { class: "hand-nav hand-nav-sticky" }, primaryBtn)
      : null;

    container.appendChild(h(
      "section",
      { class: "in-game my-turn solo-view" },
      header,
      stickyNav,          // sticky "Next hand →" on reveal
      h("div", { class: "hand-card" }, scenarioHeadline, infoPane, spot, body),
      errorBox
    ));

    // Once per device: nudge toward the compact layout if this decide
    // screen overflows the viewport.
    maybeShowCompactCoach(scenarioHeadline, viewToggleBtn);
  }

  // Start: load the signed-in user's completed-scenario set first so
  // the very first hand already skips scenarios they've answered, then
  // render. Best-effort + bounded — a slow/failed read just means the
  // first hand isn't completion-filtered (later hands still are, as
  // completedIds fills in). Not signed in → start immediately.
  let unmounted = false;
  container.appendChild(h("p", { class: "muted solo-loading" }, "Loading…"));
  (async () => {
    if (getCurrentUser()) {
      try {
        const mine = await Promise.race([
          readMyResponses(),
          new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        if (Array.isArray(mine)) {
          // Only count responses for scenarios still in the live
          // library. A retired scenario_id (one replaced under a new
          // id — see docs/SCHEMA.md) leaves an orphaned response in
          // Firestore; counting it would push the completion tally
          // past the library size ("46/45 scenarios done").
          const libraryIds = new Set(scenarios.map((s) => s.scenario_id));
          for (const r of mine) {
            if (r && r.scenario_id && libraryIds.has(r.scenario_id)) {
              completedIds.add(r.scenario_id);
              priorById.set(r.scenario_id, {
                action: r.action, confidence: r.confidence,
                note: r.note || "",
                // The selection the stored note was written about. Falls
                // back to the recorded answer for comments saved before
                // noteAction was tracked.
                noteAction: r.noteAction || r.action || null,
                noteConfidence: r.noteConfidence || r.confidence || null,
              });
            }
          }
        }
      } catch (err) {
        console.warn("readMyResponses (completed-set) failed:", err);
      }
    }
    if (unmounted) return;
    nextHand();
  })();

  return {
    unmount: () => {
      unmounted = true;
      if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
      clear(container);
    },
  };
}
