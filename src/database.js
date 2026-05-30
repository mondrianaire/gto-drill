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
import { deriveRanges } from "./preflop-ranges.js";

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

// ----- GTO+ manual workflow helper -----
//
// Per-scenario setup data the owner pastes into GTO+'s "Run solver" dialog to
// solve that scenario by hand. Mirrors the offline `scripts/gto-pastepack.mjs`
// data shape — same source-of-truth ranges + decision-state pot/stack — but
// wired into the in-app Database console so the owner doesn't need to flip to
// a terminal mid-workflow. Returns null for preflop scenarios (no board to
// solve).

// Per-replay reducer: walks the action history and returns the pot + the
// hero/villain effective stack at the decision point. Mirrors the
// decisionState helper in `scripts/gto-pastepack.mjs` (kept in sync — both
// derive from the same `replay` schema).
function decisionState(replay) {
  const seats = {};
  for (const s of replay.seats) seats[s.pos] = { stack: s.stack_bb, street: 0 };
  let pot = replay.starting_pot_bb || 0;
  let cur = "preflop";
  for (const a of replay.actions || []) {
    if (a.street !== cur) {
      for (const p of Object.values(seats)) { pot += p.street; p.street = 0; }
      cur = a.street;
    }
    const seat = seats[a.actor]; if (!seat) continue;
    if (a.type === "bet" || a.type === "raise" || a.type === "call") {
      const add = (a.amount_bb || 0) - seat.street;
      seat.street += add; seat.stack -= add;
    } else if (a.type === "post") {
      seat.street += a.amount_bb || 0; seat.stack -= a.amount_bb || 0;
    }
  }
  const livePot = pot + Object.values(seats).reduce((s, p) => s + p.street, 0);
  const heroStack = (seats[replay.hero_seat] && seats[replay.hero_seat].stack) || 100;
  let villStack = heroStack;
  for (const [pos, s] of Object.entries(seats)) {
    if (pos !== replay.hero_seat && s.stack > 0) villStack = Math.min(villStack, s.stack);
  }
  return { potBb: livePot, effStackBb: Math.min(heroStack, villStack) };
}

const SEAT_ORDER = ["SB", "BB", "UTG", "UTG1", "UTG2", "MP", "LJ", "HJ", "CO", "BTN"];
function heroIsIP(scen) {
  const r = scen.replay;
  if (!r) return true;
  const villains = (r.seats || []).map(s => s.pos).filter(p => p !== r.hero_seat);
  if (!villains.length) return true;
  const rank = (p) => { const i = SEAT_ORDER.indexOf(p); return i < 0 ? 99 : i; };
  return rank(r.hero_seat) > Math.min(...villains.map(rank));
}

/**
 * Build the per-scenario GTO+ setup data the owner copies into GTO+.
 * Returns null for scenarios that can't be solved in GTO+ (no flop) or
 * are missing range data.
 */
function buildGtoPlusSetup(scen) {
  const replay = scen && scen.replay;
  if (!replay) return null;

  const board = []
    .concat(replay.board?.flop || [])
    .concat(replay.board?.turn || [])
    .concat(replay.board?.river || []);
  if (board.length < 3) return null;     // no flop → not solvable in GTO+

  const derived = deriveRanges(scen);
  const heroRange = derived.hero_range;
  // Prefer authored villain range (carries postflop narrowing) over derived.
  const authoredVill = (scen.villain_ranges && scen.villain_ranges[0]) || null;
  const villRange = (authoredVill && authoredVill.classes && authoredVill.classes.length)
    ? { ...authoredVill, source: "scenarios.json authored" }
    : derived.villain_range;
  if (!heroRange || !villRange) return null;

  const ds = decisionState(replay);
  const ip = heroIsIP(scen);
  const lastAction = replay.actions && replay.actions.length
    ? replay.actions[replay.actions.length - 1] : null;
  const lastActionText = lastAction
    ? `${lastAction.actor} ${lastAction.type}${lastAction.amount_bb ? " " + lastAction.amount_bb + "bb" : ""}`
    : "(none)";

  return {
    scenarioId: scen.scenario_id,
    lessonTag: scen.lesson_tag || "",
    heroSeat: replay.hero_seat,
    heroIsIp: ip,
    heroDealt: (replay.hero_cards || []).join(""),
    lastAction: lastActionText,
    // GTO+ "Range 1" is OOP, "Range 2" is IP — assemble accordingly.
    range1Label: ip ? "Range 1 (OOP) — Villain" : "Range 1 (OOP) — Hero",
    range1: ip ? villRange.classes.join(",") : heroRange.classes.join(","),
    range1Source: (ip ? villRange : heroRange).source || "",
    range2Label: ip ? "Range 2 (IP) — Hero" : "Range 2 (IP) — Villain",
    range2: ip ? heroRange.classes.join(",") : villRange.classes.join(","),
    range2Source: (ip ? heroRange : villRange).source || "",
    board: board.join(" "),
    pot: String(ds.potBb),
    stack: String(ds.effStackBb),
    filename: scen.scenario_id + ".gto2",
  };
}

/**
 * Mount the GTO+ setup modal — a step-by-step paste-and-click walkthrough
 * for a single scenario, with Prev/Next navigation across the postflop set.
 *
 * @param {Array} setups   pre-built setup objects from buildGtoPlusSetup()
 * @param {number} startIdx
 */
function openGtoPlusModal(setups, startIdx) {
  let idx = Math.max(0, Math.min(startIdx, setups.length - 1));

  // Singleton-ish: if a modal is already open, replace it
  document.querySelectorAll(".gtop-scrim").forEach((el) => el.remove());

  function copyToClipboard(text, btn) {
    const restore = btn.textContent;
    const ok = () => {
      btn.textContent = "✓ Copied";
      btn.classList.add("is-ok");
      setTimeout(() => { btn.textContent = restore; btn.classList.remove("is-ok"); }, 1200);
    };
    const fail = (e) => {
      btn.textContent = "✗ Failed";
      btn.classList.add("is-err");
      console.warn("clipboard write failed:", e);
      setTimeout(() => { btn.textContent = restore; btn.classList.remove("is-err"); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(fail);
    } else {
      // Fallback for non-HTTPS / older browsers
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        ok();
      } catch (e) { fail(e); }
    }
  }

  function buildStep(num, label, value, hint) {
    const valueBox = h("code", { class: "gtop-step-value" }, value);
    const copyBtn = h("button", { type: "button", class: "gtop-copy-btn" }, "Copy");
    copyBtn.addEventListener("click", () => copyToClipboard(value, copyBtn));
    return h("div", { class: "gtop-step" },
      h("div", { class: "gtop-step-head" },
        h("span", { class: "gtop-step-num" }, "[" + num + "]"),
        h("span", { class: "gtop-step-label" }, label)),
      h("div", { class: "gtop-step-row" }, valueBox, copyBtn),
      hint ? h("div", { class: "gtop-step-hint muted" }, hint) : null
    );
  }

  function buildInstruction(num, label) {
    return h("div", { class: "gtop-step gtop-step-instruction" },
      h("div", { class: "gtop-step-head" },
        h("span", { class: "gtop-step-num" }, "[" + num + "]"),
        h("span", { class: "gtop-step-label" }, label))
    );
  }

  const scrim = h("div", { class: "gtop-scrim", role: "dialog", "aria-modal": "true" });
  const modal = h("div", { class: "gtop-modal" });
  scrim.appendChild(modal);

  function render() {
    while (modal.firstChild) modal.removeChild(modal.firstChild);
    const setup = setups[idx];

    // --- header ---
    const closeBtn = h("button", { type: "button", class: "gtop-close", "aria-label": "Close" }, "×");
    closeBtn.addEventListener("click", destroy);
    modal.appendChild(h("div", { class: "gtop-head" },
      h("div", { class: "gtop-head-titles" },
        h("div", { class: "gtop-eyebrow" }, "GTO+ SETUP · " + (idx + 1) + " / " + setups.length),
        h("h3", { class: "gtop-title" }, "Scenario #" + scenNum(setup.scenarioId)),
        h("div", { class: "gtop-subtitle muted" }, setup.lessonTag)
      ),
      closeBtn));

    // --- context line ---
    modal.appendChild(h("div", { class: "gtop-context muted" },
      "Hero: " + setup.heroSeat + " (" + (setup.heroIsIp ? "IP" : "OOP") + ")" +
      (setup.heroDealt ? " holding " + setup.heroDealt : "") +
      " · Last: " + setup.lastAction));

    // --- step list ---
    const stepsHost = h("div", { class: "gtop-steps" });
    stepsHost.appendChild(buildInstruction("0", "Open GTO+ → Run solver → Build decision tree dialog"));
    stepsHost.appendChild(buildStep("1", setup.range1Label, setup.range1, setup.range1Source));
    stepsHost.appendChild(buildStep("2", setup.range2Label, setup.range2, setup.range2Source));
    stepsHost.appendChild(buildStep("3", "Board", setup.board));
    stepsHost.appendChild(buildStep("4", "Starting pot (bb)", setup.pot));
    stepsHost.appendChild(buildStep("5", "Effective stacks (bb)", setup.stack));
    stepsHost.appendChild(buildInstruction("6", "Click Build tree (left panel) — wait for build to finish"));
    stepsHost.appendChild(buildStep("7", "File → Save As — filename", setup.filename,
      "Save to solver-output/ folder. Don't click Solve — PROCESS FILES will batch-solve all 31 after."));
    modal.appendChild(stepsHost);

    // --- nav ---
    const prevBtn = h("button", { type: "button", class: "gtop-nav-btn" }, "← Previous");
    const nextBtn = h("button", { type: "button", class: "gtop-nav-btn primary" }, "Next →");
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === setups.length - 1;
    prevBtn.addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
    nextBtn.addEventListener("click", () => { if (idx < setups.length - 1) { idx++; render(); } });
    modal.appendChild(h("div", { class: "gtop-nav" }, prevBtn,
      h("span", { class: "gtop-nav-spacer muted" }, (idx + 1) + " of " + setups.length),
      nextBtn));
  }

  function destroy() {
    document.removeEventListener("keydown", onKey, true);
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
  }
  function onKey(ev) {
    if (ev.key === "Escape") { ev.preventDefault(); destroy(); }
    else if (ev.key === "ArrowLeft" && idx > 0) { ev.preventDefault(); idx--; render(); }
    else if (ev.key === "ArrowRight" && idx < setups.length - 1) { ev.preventDefault(); idx++; render(); }
  }
  document.addEventListener("keydown", onKey, true);
  // Scrim tap-to-close (but not when clicking inside the modal)
  scrim.addEventListener("click", (ev) => { if (ev.target === scrim) destroy(); });

  document.body.appendChild(scrim);
  render();
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
        gtoSetup: buildGtoPlusSetup(s),     // null for preflop / missing-range scenarios
      }))
      .sort((a, b) => (b.n - a.n) || a.num.localeCompare(b.num));

    // Pre-compute the ordered list of postflop setups for the GTO+ modal's
    // Prev/Next navigation. Order matches the display order so "Next" in
    // the modal walks the same sequence the owner sees in the list.
    const gtoSetups = rows.map((r) => r.gtoSetup).filter(Boolean);

    // GTO+ batch banner — visible only when there are scenarios to solve.
    if (gtoSetups.length > 0) {
      const startBtn = h("button", { type: "button", class: "db-gtop-start" },
        "📋 Open GTO+ setup walkthrough (" + gtoSetups.length + " scenarios)");
      startBtn.addEventListener("click", () => openGtoPlusModal(gtoSetups, 0));
      bodyEl.appendChild(h("div", { class: "db-gtop-banner" },
        h("div", { class: "db-gtop-banner-text" },
          h("strong", null, "GTO+ manual batch — " + gtoSetups.length + " postflop scenarios."),
          " Open the walkthrough to step through each scenario with copy-ready ranges/board/pot/stack + filename. Solve all 31 in GTO+ in ~5 min of paste + click."),
        startBtn));
    }

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
      // GTO+ setup button — opens the walkthrough modal jumped to THIS
      // scenario's step (so the owner can re-open mid-batch if they get
      // distracted). Only present for postflop scenarios that have ranges.
      let gtoBtn = null;
      if (row.gtoSetup) {
        gtoBtn = h("button", {
          type: "button",
          class: "db-cov-gtop",
          title: "Open the GTO+ setup walkthrough at this scenario",
        }, "📋 GTO+");
        gtoBtn.addEventListener("click", () => {
          const idx = gtoSetups.findIndex((g) => g.scenarioId === row.id);
          openGtoPlusModal(gtoSetups, idx >= 0 ? idx : 0);
        });
      }
      cov.appendChild(h("div", { class: "db-cov-rowwrap" }, link, solverBtn, gtoBtn));
    }
    bodyEl.appendChild(cov);
  })();

  return { unmount: () => clear(container) };
}
