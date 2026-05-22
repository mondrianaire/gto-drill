// players.js — the Players screen.
//
// Lists every player who has recorded responses, with their library
// completion (distinct scenarios answered / total) and GTO accuracy.
// Aggregated client-side from the full `responses` pool. Tapping a
// player opens their profile (wired via the optional onOpenProfile
// callback — added in the player-profile phase).

import { listScenarios, getScenarioById } from "./scenarios.js";
import { readAllResponses, getCurrentUser } from "./state.js";
import { buildAvatar } from "./onboarding.js";

// Tiny DOM helper — local, matching the per-module pattern used across
// this codebase.
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
 * Aggregate the raw response pool into per-player rows.
 *
 * Each response doc is one (player, scenario) pair — latest-overwrites
 * — so a player's response count IS their distinct-scenario count.
 *
 * @param {Array} responses  from readAllResponses()
 * @returns {Array<{uid,name,photo,done,correct}>}
 */
export function aggregatePlayers(responses) {
  const byUid = new Map();
  for (const r of responses || []) {
    if (!r || !r.uid) continue;
    let p = byUid.get(r.uid);
    if (!p) {
      p = { uid: r.uid, name: r.displayName || "Player", photo: r.photoURL || null, done: 0, correct: 0 };
      byUid.set(r.uid, p);
    }
    // Keep the freshest identity we see for this player.
    if (r.displayName) p.name = r.displayName;
    if (r.photoURL) p.photo = r.photoURL;
    p.done += 1;
    const scen = getScenarioById(r.scenario_id);
    if (scen && r.action === scen.gto_action) p.correct += 1;
  }
  const players = [...byUid.values()];
  // Most-engaged first; tie-break on accuracy.
  players.sort((a, b) => (b.done - a.done) || (b.correct - a.correct));
  return players;
}

/**
 * Mount the Players screen.
 *
 * @param {HTMLElement} container
 * @param {() => void} onBack          Return to the play loop.
 * @param {(uid:string) => void} [onOpenProfile]  Tap a player → profile.
 */
export function mountPlayersView(container, onBack, onOpenProfile) {
  clear(container);
  const total = listScenarios().length;
  const me = getCurrentUser();

  const backBtn = h("button", { type: "button", class: "secondary players-back" }, "← Back to play");
  backBtn.addEventListener("click", () => { if (onBack) onBack(); });

  const statusEl = h("p", { class: "muted players-status" }, "Loading players…");
  const listEl = h("div", { class: "players-list" });

  const root = h("section", { class: "players-view" },
    h("h2", null, "Players"),
    h("p", { class: "muted players-hint" },
      "Everyone's progress through the " + total + "-hand library."),
    statusEl,
    listEl,
    h("div", { class: "players-actions" }, backBtn)
  );
  container.appendChild(root);

  (async () => {
    let responses = [];
    try {
      responses = await readAllResponses();
    } catch (err) {
      console.warn("readAllResponses failed:", err);
    }
    const players = aggregatePlayers(responses);

    clear(listEl);
    if (players.length === 0) {
      statusEl.textContent = "No one has played yet — be the first.";
      return;
    }
    statusEl.textContent = players.length === 1 ? "1 player" : players.length + " players";

    for (const p of players) {
      const pct = total > 0 ? Math.round((p.done / total) * 100) : 0;
      const acc = p.done > 0 ? Math.round((p.correct / p.done) * 100) : 0;
      const isMe = !!(me && p.uid === me.uid);
      const firstName = (p.name || "Player").split(/\s+/)[0];

      const av = buildAvatar(p.name, p.photo);
      av.classList.add("players-avatar");

      const card = h("div",
        { class: "players-card" + (isMe ? " is-me" : "") + (onOpenProfile ? " is-clickable" : "") },
        av,
        h("div", { class: "players-main" },
          h("div", { class: "players-name" }, firstName + (isMe ? " (you)" : "")),
          h("div", { class: "players-stats muted" },
            p.done + " / " + total + " done · " + pct + "%  ·  " + acc + "% GTO-correct")
        ),
        onOpenProfile ? h("span", { class: "players-go", "aria-hidden": "true" }, "›") : null
      );
      if (onOpenProfile) {
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.addEventListener("click", () => onOpenProfile(p.uid));
        card.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpenProfile(p.uid); }
        });
      }
      listEl.appendChild(card);
    }
  })();

  return { unmount: () => clear(container) };
}
