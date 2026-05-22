// solo.js — anonymous, single-player practice mode.
//
// No Firebase, no sign-in, no opponent. Pulls one random scenario at a
// time from the loaded library, runs the same decide -> reveal flow as
// the multiplayer in-game view (so the GTO explanation, range chips,
// and Monte Carlo equity panel all work identically), then shuffles to
// a fresh hand on "Next hand".

import { listScenarios } from "./scenarios.js";
import { mountReplay, buildSpotSummary } from "./replay.js";
import { mountEquityPanel } from "./equity-panel.js";
import { richText, buildRevealResult, buildVillainRangeBlock, buildGtoRead, buildLessonTakeaway, buildGtoExplanation, buildOptionsAnalysis, buildCrowdBreakdown, buildScenarioInfo } from "./ui.js";
import { buildShareLinkButton, shareUrlForScenario } from "./share.js";
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
      await saveResponseComment(scen.scenario_id, ta.value);
      status.textContent = "Saved ✓";
    } catch (err) {
      console.warn("saveResponseComment failed:", err);
      status.textContent = "Couldn't save — try again.";
    }
    saving = false;
    saveBtn.disabled = false;
  });
  return h("div", { class: "comment-box" },
    h("div", { class: "comment-label" }, "💬 Your take on this hand"),
    h("p", { class: "comment-hint muted" },
      "A comment on the spot and the GTO decision. Other players see it on the crowd breakdown."),
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

export function mountSoloView(container, onExit, onPlayers, knowledgeLevel) {
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
  let currentScen = null;
  // Per-hand state — gets reset on each Next hand.
  let draft = null;
  let replayCleanup = null;
  let handsCompleted = 0;
  let correctSoFar = 0;

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
    currentScen = pickScenario();
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
    // Icon-only share link button. buildUrl is evaluated at click time so
    // the URL always points at the scenario currently on screen.
    const { button: shareBtn, fallback: shareFallback } = buildShareLinkButton({
      buildUrl: () => shareUrlForScenario(scen.scenario_id),
      title: "Copy share link for this hand",
      className: "solo-share",
    });
    // Players button — opens the roster screen. Only present when the
    // caller wired onPlayers (signed-in users; the crowd pool needs an
    // identity to be meaningful).
    const playersBtn = onPlayers
      ? h("button",
          { type: "button", class: "link-btn solo-players icon-btn", title: "See all players", "aria-label": "See all players" },
          h("span", { "aria-hidden": "true" }, "👥"))
      : null;
    if (playersBtn) {
      playersBtn.addEventListener("click", () => {
        if (replayCleanup) { try { replayCleanup(); } catch {} replayCleanup = null; }
        onPlayers();
      });
    }
    const header = h("div", { class: "solo-header" },
      h("div", { class: "solo-header-top" },
        h("h2", null, "Solo practice"),
        h("div", { class: "solo-header-actions" }, playersBtn, shareBtn, exitBtn)
      ),
      stats
    );

    // --- scenario INFO pane --------------------------------------------------
    // Shown ABOVE the hand summary for any scenario whose setup deviates
    // from the 100bb-cash, cards-shown default (tournament, short stack,
    // hidden hole cards). null — and absent from the DOM — otherwise.
    const infoPane = buildScenarioInfo({ scen });

    // --- the spot ------------------------------------------------------------
    const spot = h("div", { class: "hand-spot" });
    if (scen.replay) {
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
      shareFallback,
      stickyNav,          // sticky "Next hand →" on reveal
      h("div", { class: "hand-card" }, infoPane, spot, body),
      errorBox
    ));
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
          for (const r of mine) {
            if (r && r.scenario_id) completedIds.add(r.scenario_id);
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
