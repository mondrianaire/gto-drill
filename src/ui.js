// ui.js — section-4 (Game Flow and UI)
//
// In-game UI (per-scenario submission + waiting + per-round reveal) plus
// the end-of-game wrap-up screen. All state reads go through section-2's
// adapter via readGame; all submissions go through submitHandful. Scenario
// metadata comes from section-1. Notifications are triggered through
// section-3.

import { readGame, submitHandful, getCurrentUid, getOpponentUid } from "./state.js";
import { getScenarioById } from "./scenarios.js";
import { computePhase } from "./flow.js";
import { perPlayerAccuracy, interPlayerAgreement, rankedDisagreements } from "./stats.js";
import { sendTurnNotification, notificationStatus, enableNotifications, setActiveGameForPush } from "./push.js";

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
  let submitting = false;
  setActiveGameForPush(gameId);

  function render(game) {
    clear(container);
    const myUid = getCurrentUid();
    const phase = computePhase(game, myUid);
    const headerBar = h("div", { class: "game-header" },
      h("span", null, "Round ", String((phase.currentRoundIndex || 0) + 1), " of ", String(game.rounds.length)),
      buildNotifControl(game)
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

  function renderMyTurn(round, game, myUid) {
    // Initialize draft if this is a new round.
    if (!draft || draft.roundIndex !== round.roundIndex) {
      draft = {
        roundIndex: round.roundIndex,
        submissions: round.scenarioIds.map((id) => ({
          scenario_id: id,
          action: null,
          confidence: null,
          note: "",
        })),
      };
    }

    const errorBox = h("div", { class: "error", role: "alert" });
    const list = h("div", { class: "scenario-list" });

    round.scenarioIds.forEach((id, idx) => {
      const scen = getScenarioById(id);
      if (!scen) return;
      const card = h("div", { class: "scenario-card" });
      card.appendChild(h("h3", null, "Scenario " + (idx + 1) + ": " + scen.lesson_tag));
      card.appendChild(h("p", { class: "scenario-desc" }, scen.description));
      if (scen.board) {
        card.appendChild(h("div", { class: "board" }, h("strong", null, "Board: "), scen.board));
      }
      if (Array.isArray(scen.action_history) && scen.action_history.length) {
        card.appendChild(h(
          "div",
          { class: "action-history" },
          h("strong", null, "Action: "),
          scen.action_history.join(" -> ")
        ));
      }

      // Action buttons
      const actionRow = h("div", { class: "actions-row", role: "radiogroup", "aria-label": "Choose an action" });
      for (const a of scen.available_actions) {
        const btn = h("button", { type: "button", class: "action-btn", "data-action": a }, a);
        btn.addEventListener("click", () => {
          draft.submissions[idx].action = a;
          actionRow.querySelectorAll(".action-btn").forEach((x) => x.classList.toggle("selected", x === btn));
        });
        actionRow.appendChild(btn);
      }
      card.appendChild(h("label", { class: "field-label" }, "Your action"));
      card.appendChild(actionRow);

      // Confidence 1-5
      const confRow = h("div", { class: "confidence-row", role: "radiogroup", "aria-label": "Confidence" });
      for (let c = 1; c <= 5; c++) {
        const btn = h("button", { type: "button", class: "conf-btn", "data-conf": String(c) }, String(c));
        btn.addEventListener("click", () => {
          draft.submissions[idx].confidence = c;
          confRow.querySelectorAll(".conf-btn").forEach((x) => x.classList.toggle("selected", x === btn));
        });
        confRow.appendChild(btn);
      }
      card.appendChild(h("label", { class: "field-label" }, "Confidence (1 = guess, 5 = sure)"));
      card.appendChild(confRow);

      // Note (optional)
      const noteInput = h("textarea", {
        class: "note-input",
        placeholder: "Optional note (max 280 chars) — what's your read here?",
        maxlength: "280",
        rows: "2",
      });
      noteInput.addEventListener("input", () => {
        draft.submissions[idx].note = noteInput.value.slice(0, 280);
      });
      card.appendChild(h("label", { class: "field-label" }, "Note (optional)"));
      card.appendChild(noteInput);

      list.appendChild(card);
    });

    const submitBtn = h("button", { type: "button", class: "primary submit-handful" }, "Submit handful");
    submitBtn.addEventListener("click", async () => {
      if (submitting) return;
      errorBox.textContent = "";
      // Validate
      for (let i = 0; i < draft.submissions.length; i++) {
        const s = draft.submissions[i];
        if (!s.action) {
          errorBox.textContent = "Pick an action for scenario " + (i + 1) + ".";
          return;
        }
        if (!s.confidence) {
          errorBox.textContent = "Pick a confidence (1-5) for scenario " + (i + 1) + ".";
          return;
        }
      }
      submitting = true;
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
          return;
        }
        // Fire turn notification to opponent (best-effort).
        try {
          const opp = await getOpponentUid(gameId);
          if (opp) {
            sendTurnNotification(gameId, opp, {
              title: "Your turn",
              body: getDisplayName(game, myUid) + " just submitted — it's your move.",
              url: "./",
            });
          }
        } catch (_) {}
        draft = null;
        submitting = false;
      } catch (err) {
        console.error(err);
        errorBox.textContent = "Network error. Try again.";
        submitting = false;
      }
    });

    container.appendChild(h(
      "section",
      { class: "in-game my-turn" },
      h("h2", null, "Your handful"),
      h("p", { class: "muted" }, "Pick an action and a confidence rating for each spot. The GTO answer is hidden until you and your opponent have both submitted."),
      list,
      errorBox,
      submitBtn
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
      h("p", { class: "muted" }, "You can close this page — the game's saved. If you turned on notifications, we'll let you know.")
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

  function buildNotifControl(game) {
    const status = notificationStatus();
    if (!status.platform_supports_push) {
      return h("span", { class: "notif-state muted" }, "Notifications not supported on this browser.");
    }
    if (status.ios_requires_home_screen_install) {
      return h("span", { class: "notif-state muted" }, "On iPhone? Add to Home Screen for notifications.");
    }
    if (status.permission === "denied") {
      return h("span", { class: "notif-state muted" }, "Notifications blocked in browser settings.");
    }
    if (status.permission === "granted") {
      return h("span", { class: "notif-state" }, "Notifications on.");
    }
    const btn = h("button", { type: "button", class: "notif-enable" }, "Enable turn notifications");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const res = await enableNotifications();
      btn.disabled = false;
      if (res.granted) btn.replaceWith(h("span", { class: "notif-state" }, "Notifications on."));
      else if (res.reason === "denied") btn.replaceWith(h("span", { class: "notif-state muted" }, "Notifications blocked."));
      else if (res.reason === "requires_pwa_install") btn.replaceWith(h("span", { class: "notif-state muted" }, "Add to Home Screen first (iOS)."));
      else btn.replaceWith(h("span", { class: "notif-state muted" }, "Couldn't enable notifications."));
    });
    return btn;
  }

  unsub = readGame(gameId, (g) => {
    lastGame = g;
    render(g);
  });

  return {
    unmount: () => {
      if (unsub) unsub();
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

    container.appendChild(h(
      "section",
      { class: "wrap-up" },
      h("h2", null, "Game complete"),
      h("p", { class: "muted" }, "You played " + (game.rounds || []).length + " rounds, " + (game.rounds[0] ? game.rounds[0].scenarioIds.length : 0) + " spots each."),
      accuracySection,
      agreementSection,
      disagreementSection
    ));
  }

  if (opts.reuseGame) {
    render(opts.reuseGame);
    return { unmount: () => clear(container) };
  }
  unsub = readGame(gameId, (g) => render(g));
  return {
    unmount: () => {
      if (unsub) unsub();
      clear(container);
    },
  };
}
