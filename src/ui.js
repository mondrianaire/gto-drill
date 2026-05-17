// ui.js — section-4 (Game Flow and UI)
//
// In-game UI (per-scenario submission + waiting + per-round reveal) plus
// the end-of-game wrap-up screen. All state reads go through section-2's
// adapter via readGame; all submissions go through submitHandful. Scenario
// metadata comes from section-1. Notifications are triggered through
// section-3.

import { readGame, submitHandful, getCurrentUid, createGame, joinGame, setRematchGameId } from "./state.js";
import { getScenarioById } from "./scenarios.js";
import { computePhase } from "./flow.js";
import { perPlayerAccuracy, interPlayerAgreement, rankedDisagreements } from "./stats.js";
import { recordGame, writeActiveGameId } from "./history.js";
import { mountReplay } from "./replay.js";

// -----------------------------------------------------------------------
// Small DOM helpers (duplicated from onboarding.js intentionally to keep
// each module self-contained; both are tiny).
// -----------------------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== false && v != null) {
        el.setAttribute(k, v);
      }
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

function getDisplayName(game, uid) {
  const p = (game.participants || []).find((x) => x.uid === uid);
  return (p && p.displayName) || "Unknown";
}

// -----------------------------------------------------------------------
// mountInGameView — main per-round loop
// -----------------------------------------------------------------------

export function mountInGameView(container, gameId) {
  let unsub = null;
  let lastGame = null;
  let draft = null; // current player's in-progress submission set
  let handIdx = 0;  // which hand of the handful is currently on screen
  let submitting = false;
  let replayCleanup = null; // stops the active replay's timer before re-render

  function render(game) {
    if (replayCleanup) { try { replayCleanup(); } catch (_) {} replayCleanup = null; }
    clear(container);
    const myUid = getCurrentUid();
    const phase = computePhase(game, myUid);
    const headerBar = h("div", { class: "game-header" },
      h("span", null, "Round ", String((phase.currentRoundIndex || 0) + 1), " of ", String(game.rounds.length))
    );
    container.appendChild(headerBar);

    if (phase.gameComplete) {
      mountWrapUpView(container, gameId, { reuseGame: game });
      return;
    }

    const round = phase.currentRound;
    if (!round) {
      container.appendChild(h("p", null, "Loading round..."));
      return;
    }

    if (phase.myTurn) {
      renderMyTurn(round, game, myUid);
    } else if (phase.revealReady) {
      renderReveal(round, game, myUid);
    } else if (phase.waitingForOpponent) {
      renderWaiting(round, game, myUid);
    } else {
      container.appendChild(h("p", null, "Waiting..."));
    }
  }

  // The decision screen — one hand of the handful at a time. The replay
  // table is the hero; the prose description is demoted; the action choice
  // is the primary control and confidence a lighter secondary step.
  function renderMyTurn(round, game, myUid) {
    // (Re)initialise the draft when the round changes.
    if (!draft || draft.roundIndex !== round.roundIndex) {
      draft = {
        roundIndex: round.roundIndex,
        submissions: round.scenarioIds.map((id) => ({
          scenario_id: id, action: null, confidence: null, note: "",
        })),
      };
      handIdx = 0;
    }
    const total = round.scenarioIds.length;
    handIdx = Math.max(0, Math.min(total - 1, handIdx));
    const sub = draft.submissions[handIdx];
    const scen = getScenarioById(round.scenarioIds[handIdx]);
    const errorBox = h("div", { class: "error", role: "alert" });

    // --- progress: "Hand X of N" + dots ---
    const dots = h("div", { class: "hand-dots" });
    for (let i = 0; i < total; i++) {
      const done = draft.submissions[i].action && draft.submissions[i].confidence;
      dots.appendChild(h("span", {
        class: "hand-dot" + (i === handIdx ? " is-current" : "") + (done ? " is-done" : ""),
      }));
    }
    const progress = h("div", { class: "hand-progress" },
      h("span", { class: "hand-count" }, "Hand " + (handIdx + 1) + " of " + total),
      dots
    );

    // --- the spot (hero) ---
    const spot = h("div", { class: "hand-spot" });
    if (scen && scen.replay) {
      const replayHost = h("div", { class: "replay-host" });
      spot.appendChild(replayHost);
      const r = mountReplay(replayHost, scen.replay);
      replayCleanup = r && r.unmount ? r.unmount : null;
      spot.appendChild(h("details", { class: "hand-words" },
        h("summary", null, "The spot in words"),
        h("p", null, scen.description)
      ));
    } else if (scen) {
      spot.appendChild(h("p", { class: "scenario-desc" }, scen.description));
      if (scen.board) {
        spot.appendChild(h("div", { class: "board" }, h("strong", null, "Board: "), scen.board));
      }
      if (Array.isArray(scen.action_history) && scen.action_history.length) {
        spot.appendChild(h("div", { class: "action-history" },
          h("strong", null, "Action: "), scen.action_history.join(" → ")));
      }
    }

    // --- decision: action (primary) ---
    const actionRow = h("div", { class: "actions-row", role: "radiogroup", "aria-label": "Your move" });
    (scen ? scen.available_actions : []).forEach((a) => {
      const btn = h("button", { type: "button", class: "action-btn" + (sub.action === a ? " selected" : "") }, a);
      btn.addEventListener("click", () => {
        sub.action = a;
        actionRow.querySelectorAll(".action-btn").forEach((x) => x.classList.toggle("selected", x === btn));
        errorBox.textContent = "";
      });
      actionRow.appendChild(btn);
    });

    // --- decision: confidence (secondary) ---
    const confRow = h("div", { class: "confidence-row", role: "radiogroup", "aria-label": "How sure are you" });
    for (let c = 1; c <= 5; c++) {
      const btn = h("button", { type: "button", class: "conf-btn" + (sub.confidence === c ? " selected" : "") }, String(c));
      btn.addEventListener("click", () => {
        sub.confidence = c;
        confRow.querySelectorAll(".conf-btn").forEach((x) => x.classList.toggle("selected", x === btn));
        errorBox.textContent = "";
      });
      confRow.appendChild(btn);
    }

    // --- note (tertiary, collapsed) ---
    const noteInput = h("textarea", {
      class: "note-input", maxlength: "280", rows: "2",
      placeholder: "What's your read here? (optional, max 280 chars)",
    });
    noteInput.value = sub.note || "";
    noteInput.addEventListener("input", () => { sub.note = noteInput.value.slice(0, 280); });
    const noteToggle = h("details", { class: "note-toggle" },
      h("summary", null, sub.note ? "Note added ✓" : "Add a note"),
      noteInput
    );
    if (sub.note) noteToggle.open = true;

    const decide = h("div", { class: "decide" },
      h("span", { class: "decide-label" }, "Your move"),
      actionRow,
      h("span", { class: "decide-label decide-label-sub" }, "How sure?  (1 = guess, 5 = certain)"),
      confRow,
      noteToggle
    );

    // --- navigation ---
    const isLast = handIdx === total - 1;
    const backBtn = h("button", { type: "button", class: "secondary hand-back" }, "Back");
    backBtn.disabled = handIdx === 0;
    backBtn.addEventListener("click", () => { handIdx -= 1; render(lastGame); });

    const fwdBtn = h("button", { type: "button", class: "primary hand-fwd" },
      isLast ? "Submit handful" : "Next hand →");
    fwdBtn.addEventListener("click", async () => {
      if (submitting) return;
      if (!sub.action) { errorBox.textContent = "Pick your move for this hand."; return; }
      if (!sub.confidence) { errorBox.textContent = "Rate how sure you are (1–5)."; return; }
      if (!isLast) { handIdx += 1; render(lastGame); return; }
      // Last hand — make sure every hand is answered, then submit.
      for (let i = 0; i < draft.submissions.length; i++) {
        const s = draft.submissions[i];
        if (!s.action || !s.confidence) { handIdx = i; render(lastGame); return; }
      }
      submitting = true;
      fwdBtn.disabled = true;
      const finalSubs = draft.submissions.map((s) => ({
        scenario_id: s.scenario_id,
        action: s.action,
        confidence: s.confidence,
        note: s.note ? s.note.slice(0, 280) : null,
        submitted_at: new Date().toISOString(),
      }));
      try {
        const result = await submitHandful(gameId, draft.roundIndex, finalSubs);
        if (!result.success) {
          errorBox.textContent = "Submit failed (" + result.status + "). Try again.";
          submitting = false;
          fwdBtn.disabled = false;
          return;
        }
        draft = null;
        submitting = false;
        // The Firestore write triggers a snapshot, which re-renders into the
        // waiting / reveal view.
      } catch (err) {
        console.error(err);
        errorBox.textContent = "Network error. Try again.";
        submitting = false;
        fwdBtn.disabled = false;
      }
    });

    container.appendChild(h(
      "section",
      { class: "in-game my-turn" },
      progress,
      h("div", { class: "hand-card" }, spot, decide),
      errorBox,
      h("div", { class: "hand-nav" }, backBtn, fwdBtn)
    ));
  }

  function renderWaiting(round, game, myUid) {
    const oppUid = (game.participantUids || []).find((u) => u !== myUid);
    const oppName = oppUid ? getDisplayName(game, oppUid) : "your opponent";
    container.appendChild(h(
      "section",
      { class: "in-game waiting" },
      h("h2", null, "Waiting for " + oppName),
      h("p", { class: "muted" }, "You submitted your handful for this round. We'll show the results once " + oppName + " submits theirs."),
      h("p", { class: "muted" }, "You can close this page — the game's saved. It'll pick up right here the next time you open the app.")
    ));
  }

  function renderReveal(round, game, myUid) {
    const uids = (game.participantUids || []).slice();
    const [a, b] = uids;
    const aName = getDisplayName(game, a);
    const bName = getDisplayName(game, b);
    const reveals = h("div", { class: "reveal-list" });
    round.scenarioIds.forEach((id, idx) => {
      const scen = getScenarioById(id);
      if (!scen) return;
      const subsA = (round.submissionsByUid && round.submissionsByUid[a]) || [];
      const subsB = (round.submissionsByUid && round.submissionsByUid[b]) || [];
      const subA = Array.isArray(subsA) ? subsA[idx] : null;
      const subB = Array.isArray(subsB) ? subsB[idx] : null;
      const gto = scen.gto_action;
      const aRight = subA && subA.action === gto;
      const bRight = subB && subB.action === gto;
      const card = h("div", { class: "reveal-card" },
        h("h3", null, "Scenario " + (idx + 1) + ": " + scen.lesson_tag),
        h("p", { class: "scenario-desc" }, scen.description),
        h("div", { class: "player-result" },
          h("strong", null, aName),
          h("span", { class: aRight ? "ok" : "miss" }, subA ? subA.action : "—"),
          h("span", { class: "conf" }, "Conf: ", String(subA ? subA.confidence : "-")),
          subA && subA.note ? h("p", { class: "player-note" }, "“", subA.note, "”") : null
        ),
        h("div", { class: "player-result" },
          h("strong", null, bName),
          h("span", { class: bRight ? "ok" : "miss" }, subB ? subB.action : "—"),
          h("span", { class: "conf" }, "Conf: ", String(subB ? subB.confidence : "-")),
          subB && subB.note ? h("p", { class: "player-note" }, "“", subB.note, "”") : null
        ),
        h("div", { class: "gto-line" },
          h("strong", null, "GTO answer: "),
          h("span", { class: "gto-action" }, gto)
        ),
        h("p", { class: "gto-explanation" }, scen.gto_explanation)
      );
      reveals.appendChild(card);
    });

    container.appendChild(h(
      "section",
      { class: "in-game reveal" },
      h("h2", null, "Round " + (round.roundIndex + 1) + " reveal"),
      h("p", { class: "muted" }, "Both submitted. Here's how you each played the spots, and what the GTO answer was."),
      reveals,
      h("p", { class: "muted" }, "Next round will load automatically once your opponent opens the app.")
    ));
  }

  unsub = readGame(
    gameId,
    (g) => {
      if (!g) return;
      lastGame = g;
      render(g);
    },
    (err) => { console.warn("in-game game read failed:", (err && err.code) || err); }
  );

  return {
    unmount: () => {
      if (unsub) unsub();
      if (replayCleanup) { try { replayCleanup(); } catch (_) {} }
      clear(container);
    },
  };
}

// -----------------------------------------------------------------------
// mountWrapUpView
// -----------------------------------------------------------------------

export function mountWrapUpView(container, gameId, opts) {
  opts = opts || {};
  let unsub = null;

  function render(game) {
    clear(container);
    const uids = (game.participantUids || []).slice();
    if (uids.length < 2) {
      container.appendChild(h("p", null, "Game not yet complete."));
      return;
    }
    const [a, b] = uids;
    const aName = getDisplayName(game, a);
    const bName = getDisplayName(game, b);
    const acc = perPlayerAccuracy(game);
    const agree = interPlayerAgreement(game);
    const disagree = rankedDisagreements(game);

    // Save this finished game to local history (idempotent — keyed by gameId).
    const myUid = getCurrentUid();
    const oppUid = uids.find((u) => u !== myUid) || b;
    recordGame({
      gameId,
      completedAt: new Date().toISOString(),
      myName: getDisplayName(game, myUid),
      opponentName: getDisplayName(game, oppUid),
      rounds: (game.rounds || []).length,
      handfulSize: game.rounds[0] ? game.rounds[0].scenarioIds.length : 0,
      myCorrect: acc[myUid] ? acc[myUid].correct : 0,
      myTotal: acc[myUid] ? acc[myUid].total : 0,
      myPct: acc[myUid] ? acc[myUid].pct : 0,
      oppCorrect: acc[oppUid] ? acc[oppUid].correct : 0,
      oppTotal: acc[oppUid] ? acc[oppUid].total : 0,
      oppPct: acc[oppUid] ? acc[oppUid].pct : 0,
      agreeSame: agree.same,
      agreeTotal: agree.total,
      agreePct: agree.pct,
    });

    const accuracySection = h("section", { class: "wrap-accuracy" },
      h("h3", null, "Individual performance"),
      h("div", { class: "stats-row" },
        h("div", { class: "stat-block" },
          h("div", { class: "stat-name" }, aName),
          h("div", { class: "stat-pct" }, String(acc[a].pct) + "%"),
          h("div", { class: "stat-detail" }, acc[a].correct + " / " + acc[a].total + " matched GTO")
        ),
        h("div", { class: "stat-block" },
          h("div", { class: "stat-name" }, bName),
          h("div", { class: "stat-pct" }, String(acc[b].pct) + "%"),
          h("div", { class: "stat-detail" }, acc[b].correct + " / " + acc[b].total + " matched GTO")
        )
      )
    );

    const agreementSection = h("section", { class: "wrap-agreement" },
      h("h3", null, "How often you agreed"),
      h("div", { class: "stat-block big" },
        h("div", { class: "stat-pct" }, String(agree.pct) + "%"),
        h("div", { class: "stat-detail" }, agree.same + " of " + agree.total + " spots, you both picked the same action")
      )
    );

    const disagreementList = h("ol", { class: "disagreement-list" });
    if (disagree.length === 0) {
      disagreementList.appendChild(h("li", { class: "muted" }, "You agreed on every spot. That's either harmonious or suspicious."));
    } else {
      disagree.forEach((d) => {
        const card = h("li", { class: "disagreement-card" },
          h("div", { class: "dis-header" },
            h("strong", null, "Joint confidence: " + d.joint_confidence_min + " (min of " + d.playerA_confidence + ", " + d.playerB_confidence + ")"),
            h("span", { class: "muted" }, " Round " + (d.roundIndex + 1))
          ),
          h("h4", null, d.scenario ? d.scenario.lesson_tag : d.scenario_id),
          h("p", { class: "scenario-desc" }, d.scenario ? d.scenario.description : ""),
          h("div", { class: "dis-row" },
            h("strong", null, aName + ": "), d.playerA_action, " (conf " + d.playerA_confidence + ")",
            d.playerA_note ? h("p", { class: "player-note" }, "“" + d.playerA_note + "”") : null
          ),
          h("div", { class: "dis-row" },
            h("strong", null, bName + ": "), d.playerB_action, " (conf " + d.playerB_confidence + ")",
            d.playerB_note ? h("p", { class: "player-note" }, "“" + d.playerB_note + "”") : null
          ),
          h("div", { class: "dis-row gto" },
            h("strong", null, "GTO: "), d.scenario ? d.scenario.gto_action : "—"
          ),
          d.scenario ? h("p", { class: "gto-explanation" }, d.scenario.gto_explanation) : null
        );
        disagreementList.appendChild(card);
      });
    }

    const disagreementSection = h("section", { class: "wrap-disagreements" },
      h("h3", null, "Where you both felt sure and disagreed"),
      h("p", { class: "muted" }, "Spots where you picked different actions, ranked by how confident you both were. These are the conversations worth having."),
      disagreementList
    );

    // Rematch + navigation controls.
    const base = location.origin + location.pathname;
    const errorBox = h("div", { class: "error", role: "alert" });
    let rematchControl;
    if (game.rematchGameId) {
      if (game.rematchBy === myUid) {
        rematchControl = h("button", { type: "button", class: "primary" }, "Go to your rematch");
        rematchControl.addEventListener("click", () => {
          writeActiveGameId(game.rematchGameId);
          location.assign(base);
        });
      } else {
        rematchControl = h("button", { type: "button", class: "primary" }, "Join the rematch");
        rematchControl.addEventListener("click", async () => {
          rematchControl.disabled = true;
          errorBox.textContent = "";
          try {
            const res = await joinGame(game.rematchGameId);
            if (res && res.error) {
              errorBox.textContent = "Could not join the rematch (" + res.error + ").";
              rematchControl.disabled = false;
              return;
            }
            writeActiveGameId(res.gameId);
            location.assign(base);
          } catch (err) {
            console.error(err);
            errorBox.textContent = "Could not join the rematch. Check your connection.";
            rematchControl.disabled = false;
          }
        });
      }
    } else {
      rematchControl = h("button", { type: "button", class: "primary" }, "Rematch — same settings");
      rematchControl.addEventListener("click", async () => {
        rematchControl.disabled = true;
        errorBox.textContent = "";
        try {
          const { gameId: newId } = await createGame({
            rounds: game.config.rounds,
            handful_size: game.config.handful_size,
          });
          try { await setRematchGameId(gameId, newId, myUid); } catch (_) {}
          writeActiveGameId(newId);
          location.assign(base);
        } catch (err) {
          console.error(err);
          errorBox.textContent = "Could not start a rematch. Check your connection and try again.";
          rematchControl.disabled = false;
        }
      });
    }
    const homeBtn = h("button", { type: "button", class: "secondary" }, "Back to home");
    homeBtn.addEventListener("click", () => {
      writeActiveGameId(null);
      location.assign(base);
    });
    const wrapActions = h("section", { class: "wrap-actions" },
      rematchControl,
      homeBtn,
      errorBox
    );

    container.appendChild(h(
      "section",
      { class: "wrap-up" },
      h("h2", null, "Game complete"),
      h("p", { class: "muted" }, "You played " + (game.rounds || []).length + " rounds, " + (game.rounds[0] ? game.rounds[0].scenarioIds.length : 0) + " spots each."),
      accuracySection,
      agreementSection,
      disagreementSection,
      wrapActions
    ));
  }

  if (opts.reuseGame) {
    render(opts.reuseGame);
    return { unmount: () => clear(container) };
  }
  unsub = readGame(
    gameId,
    (g) => { if (g) render(g); },
    (err) => { console.warn("wrap-up game read failed:", (err && err.code) || err); }
  );
  return {
    unmount: () => {
      if (unsub) unsub();
      clear(container);
    },
  };
}
