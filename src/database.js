// database.js — the owner-only "Database" console.
//
// A read-only survey of the live response pool: a data overview, a
// comments table (every comment across all scenarios, each linking into
// the hand), and per-scenario coverage. Reached only by the owner — see
// owner.js. Nothing here is hidden from other signed-in users by the
// data rules; the owner gate just keeps this console out of their UI.

import { listScenarios, getScenarioById } from "./scenarios.js";
import { buildSolverConfig } from "./replay.js";
import { readAllResponses } from "./state.js";

// Tiny DOM helper — local, matching the per-module pattern.
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

// Trailing scenario number ("...-038" → "038").
function scenNum(id) {
  const m = String(id || "").match(/(\d+)\s*$/);
  return m ? m[1] : "?";
}

// Compact relative time from an ISO timestamp.
function timeAgo(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return Math.floor(m) + "m ago";
  const hr = m / 60;
  if (hr < 24) return Math.floor(hr) + "h ago";
  const d = hr / 24;
  if (d < 30) return Math.floor(d) + "d ago";
  return Math.floor(d / 30) + "mo ago";
}

/**
 * Mount the owner-only Database console.
 *
 * @param {HTMLElement} container
 * @param {() => void} onBack  Return to the play loop.
 */
export function mountDatabaseView(container, onBack) {
  clear(container);

  const backBtn = h("button", { type: "button", class: "secondary db-back" }, "← Back to play");
  backBtn.addEventListener("click", () => { if (onBack) onBack(); });

  const statusEl = h("p", { class: "muted db-status" }, "Loading database…");
  const bodyEl = h("div", { class: "db-body" });

  const root = h("section", { class: "database-view" },
    h("h2", null, "Database"),
    h("p", { class: "muted db-hint" },
      "Owner view — a survey of every recorded response and comment."),
    statusEl,
    bodyEl,
    h("div", { class: "db-actions" }, backBtn)
  );
  container.appendChild(root);

  (async () => {
    let responses = [];
    try { responses = await readAllResponses(); }
    catch (err) { console.warn("readAllResponses failed:", err); }
    const scenarios = listScenarios();

    clear(bodyEl);
    if (!responses.length) {
      statusEl.textContent = "No responses recorded yet.";
      return;
    }
    statusEl.remove();

    // --- overview ---------------------------------------------------------
    const comments = responses.filter((r) => r && r.note && String(r.note).trim());
    const players = new Set(responses.map((r) => r && r.uid).filter(Boolean));
    const withData = new Set(responses.map((r) => r && r.scenario_id).filter(Boolean));
    const stat = (num, label) => h("div", { class: "db-stat" },
      h("div", { class: "db-stat-num" }, String(num)),
      h("div", { class: "db-stat-label" }, label));
    bodyEl.appendChild(h("div", { class: "db-overview" },
      stat(responses.length, responses.length === 1 ? "Response" : "Responses"),
      stat(comments.length, comments.length === 1 ? "Comment" : "Comments"),
      stat(players.size, players.size === 1 ? "Player" : "Players"),
      stat(withData.size + " / " + scenarios.length, "Scenarios with data")
    ));

    // --- comments ---------------------------------------------------------
    bodyEl.appendChild(h("h3", { class: "db-section-h" }, "Comments (" + comments.length + ")"));
    if (!comments.length) {
      bodyEl.appendChild(h("p", { class: "muted db-empty" }, "No comments yet."));
    } else {
      const sorted = comments.slice().sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      const list = h("div", { class: "db-comments" });
      for (const r of sorted) {
        const scen = getScenarioById(r.scenario_id);
        list.appendChild(h("div", { class: "db-comment" },
          h("div", { class: "db-comment-head" },
            h("a", {
              class: "db-comment-link",
              href: "?scenario=" + encodeURIComponent(r.scenario_id),
            }, "Scenario #" + scenNum(r.scenario_id)),
            scen && scen.lesson_tag
              ? h("span", { class: "db-comment-title" }, scen.lesson_tag) : null,
            h("span", { class: "db-comment-meta" },
              (r.displayName || "Player") + " · " + timeAgo(r.updatedAt))
          ),
          // The answer the comment was written about — present for
          // comments saved after noteAction tracking; absent on older
          // ones (the comment still renders, just without the label).
          r.noteAction
            ? h("p", { class: "db-comment-ctx" },
                "Written when they answered “" + r.noteAction + "”")
            : null,
          h("p", { class: "db-comment-text" }, "“" + String(r.note).trim() + "”")
        ));
      }
      bodyEl.appendChild(list);
    }

    // --- scenario coverage ------------------------------------------------
    bodyEl.appendChild(h("h3", { class: "db-section-h" }, "Scenario coverage"));
    const countById = new Map();
    for (const r of responses) {
      if (!r || !r.scenario_id) continue;
      countById.set(r.scenario_id, (countById.get(r.scenario_id) || 0) + 1);
    }
    const rows = scenarios
      .map((s) => ({
        id: s.scenario_id,
        num: scenNum(s.scenario_id),
        title: s.lesson_tag || "",
        n: countById.get(s.scenario_id) || 0,
        scen: s,
      }))
      .sort((a, b) => (b.n - a.n) || a.num.localeCompare(b.num));
    const cov = h("div", { class: "db-coverage" });
    for (const row of rows) {
      const link = h("a", {
        class: "db-cov-row" + (row.n === 0 ? " is-empty" : ""),
        href: "?scenario=" + encodeURIComponent(row.id),
      },
        h("span", { class: "db-cov-num" }, "#" + row.num),
        h("span", { class: "db-cov-title" }, row.title),
        h("span", { class: "db-cov-count" },
          row.n + (row.n === 1 ? " response" : " responses"))
      );
      // Owner export — a TexasSolver config (.txt) for this scenario's
      // decision spot. Postflop scenarios only (a preflop spot has no
      // board to solve, so buildSolverConfig returns null).
      const cfg = buildSolverConfig(row.scen);
      let solverBtn = null;
      if (cfg) {
        solverBtn = h("button", {
          type: "button",
          class: "db-cov-solver",
          title: "Download a TexasSolver config (.txt) for this scenario",
        }, "⚙ Solver");
        solverBtn.addEventListener("click", () => {
          const blob = new Blob([cfg], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = h("a", { href: url, download: row.id + ".txt" });
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      }
      cov.appendChild(h("div", { class: "db-cov-rowwrap" }, link, solverBtn));
    }
    bodyEl.appendChild(cov);
  })();

  return { unmount: () => clear(container) };
}
