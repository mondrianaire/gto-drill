// profile.js — the player profile.
//
// Synthesises a player's recorded responses into a behavioural read:
//   - Aggression bias: do they pick hotter / colder lines than GTO?
//   - Per-concept accuracy: GTO-correct % bucketed by concept tag.
//   - Confidence calibration: are they sure on the hands they miss?
//     do they under-trust the areas they actually nail?
//
// Pure aggregation over the responses + scenario data — no DOM in
// computeProfile (so it's unit-testable); mountProfileView renders it.

import { getScenarioById, listScenarios } from "./scenarios.js";
import { conceptLabel, CONCEPT_ORDER } from "./concepts.js";
import { readResponsesByUid, getCurrentUser } from "./state.js";
import { buildAvatar } from "./onboarding.js";

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

/**
 * Aggression rank of an action label, 0 (most passive) → 5 (most
 * aggressive). Keyword-classified from the label text; the checks run
 * most-aggressive-first so compound labels ("Check-raise", "Open
 * shove") resolve to the dominant intent.
 */
export function aggressionRank(label) {
  const a = String(label || "").toLowerCase();
  if (/\bfold\b/.test(a)) return 0;
  if (/overbet|shove|all.?in/.test(a)) return 5;
  if (/raise|[345]-bet|re-raise|squeeze|isolat|check-raise|\bopen\b/.test(a)) return 4;
  if (/bet|barrel|c-?bet|probe|donk|lead/.test(a)) return 3;
  if (/call|complete|limp/.test(a)) return 2;
  if (/check/.test(a)) return 1;
  return 2;
}

/**
 * Compute a player profile from their responses.
 *
 * @param {Array<{scenario_id,action,confidence}>} responses
 * @returns {Object} profile — see fields built below.
 */
export function computeProfile(responses) {
  const list = (responses || []).filter((r) => r && r.scenario_id);
  let correct = 0;
  let aggrDeltaSum = 0;
  let aggrDeltaCount = 0;
  let confRightSum = 0, confRightN = 0;
  let confWrongSum = 0, confWrongN = 0;
  const concepts = {}; // key → { total, correct, confSum, confN }

  for (const r of list) {
    const scen = getScenarioById(r.scenario_id);
    if (!scen) continue;
    const isCorrect = r.action === scen.gto_action;
    if (isCorrect) correct++;

    // Aggression delta — player's pick vs the GTO line.
    aggrDeltaSum += aggressionRank(r.action) - aggressionRank(scen.gto_action);
    aggrDeltaCount++;

    // Confidence calibration buckets.
    const conf = Number(r.confidence);
    const validConf = conf >= 1 && conf <= 5;
    if (validConf) {
      if (isCorrect) { confRightSum += conf; confRightN++; }
      else { confWrongSum += conf; confWrongN++; }
    }

    // Per-concept tallies.
    for (const tag of (scen.concept_tags || [])) {
      const c = concepts[tag] || (concepts[tag] = { total: 0, correct: 0, confSum: 0, confN: 0 });
      c.total++;
      if (isCorrect) c.correct++;
      if (validConf) { c.confSum += conf; c.confN++; }
    }
  }

  const total = list.length;
  const accuracyPct = total ? Math.round((correct / total) * 100) : 0;
  const aggressionBias = aggrDeltaCount ? aggrDeltaSum / aggrDeltaCount : 0;

  // Per-concept rows — weakest accuracy first (most actionable).
  const conceptRows = [];
  for (const key of CONCEPT_ORDER) {
    const c = concepts[key];
    if (!c || c.total === 0) continue;
    const acc = Math.round((c.correct / c.total) * 100);
    const avgConfidence = c.confN ? c.confSum / c.confN : null;
    let flag = null;
    if (c.total >= 2 && avgConfidence != null) {
      if (acc < 50 && avgConfidence >= 3.5) flag = "blindspot";
      else if (acc >= 75 && avgConfidence <= 2.5) flag = "strength";
    }
    conceptRows.push({
      key, label: conceptLabel(key),
      total: c.total, correct: c.correct, accuracyPct: acc, avgConfidence, flag,
    });
  }
  conceptRows.sort((a, b) => a.accuracyPct - b.accuracyPct);

  const confWhenRight = confRightN ? confRightSum / confRightN : null;
  const confWhenWrong = confWrongN ? confWrongSum / confWrongN : null;

  return {
    total, correct, accuracyPct,
    aggressionBias,
    concepts: conceptRows,
    confWhenRight, confWhenWrong,
  };
}

// --- profile read-outs ---------------------------------------------------

function aggressionVerdict(bias) {
  if (bias >= 0.6) return { text: "Runs noticeably hotter than GTO — you reach for the aggressive line more than the solver does.", tone: "hot" };
  if (bias >= 0.25) return { text: "Leans slightly more aggressive than GTO.", tone: "hot" };
  if (bias <= -0.6) return { text: "Runs noticeably more passive than GTO — you check and call where the solver bets and raises.", tone: "cold" };
  if (bias <= -0.25) return { text: "Leans slightly more passive than GTO.", tone: "cold" };
  return { text: "Well-calibrated aggression — your line selection tracks the solver closely.", tone: "even" };
}

function calibrationVerdict(right, wrong) {
  if (right == null || wrong == null) return null;
  const gap = wrong - right;
  if (gap >= 0.4) {
    return "You're more confident on the hands you get wrong (" + wrong.toFixed(1) +
      ") than the ones you get right (" + right.toFixed(1) +
      ") — a sign of overconfidence in spots that feel clearer than they are.";
  }
  if (gap <= -0.4) {
    return "You're more confident when you're right (" + right.toFixed(1) +
      ") than when you're wrong (" + wrong.toFixed(1) +
      ") — your confidence tracks your accuracy well. You tend to know when you know.";
  }
  return "Your confidence is roughly even whether you're right (" + right.toFixed(1) +
    ") or wrong (" + wrong.toFixed(1) + ") — it isn't yet a strong signal of correctness.";
}

/**
 * Mount the profile view for a given player uid.
 *
 * @param {HTMLElement} container
 * @param {string} uid
 * @param {() => void} onBack
 */
export function mountProfileView(container, uid, onBack) {
  clear(container);
  const totalScenarios = listScenarios().length;
  const me = getCurrentUser();
  const isMe = !!(me && uid === me.uid);

  const backBtn = h("button", { type: "button", class: "secondary profile-back" }, "← Back to players");
  backBtn.addEventListener("click", () => { if (onBack) onBack(); });

  const bodyEl = h("div", { class: "profile-body" },
    h("p", { class: "muted" }, "Loading profile…"));

  const root = h("section", { class: "profile-view" },
    bodyEl,
    h("div", { class: "profile-actions" }, backBtn)
  );
  container.appendChild(root);

  (async () => {
    let responses = [];
    try {
      responses = await readResponsesByUid(uid);
    } catch (err) {
      console.warn("readResponsesByUid failed:", err);
    }
    clear(bodyEl);

    // Identity from the freshest response (responses carry it).
    let name = "Player";
    let photo = null;
    for (const r of responses) {
      if (r && r.displayName) name = r.displayName;
      if (r && r.photoURL) photo = r.photoURL;
    }
    const firstName = (name || "Player").split(/\s+/)[0];

    const avatar = buildAvatar(name, photo);
    avatar.classList.add("profile-avatar");
    bodyEl.appendChild(h("div", { class: "profile-header" },
      avatar,
      h("div", { class: "profile-id" },
        h("div", { class: "profile-name" }, isMe ? "Your profile" : firstName + "'s profile"),
        h("div", { class: "profile-sub muted" },
          responses.length + " / " + totalScenarios + " scenarios answered")
      )
    ));

    if (responses.length === 0) {
      bodyEl.appendChild(h("p", { class: "muted profile-empty" },
        (isMe ? "You haven't" : firstName + " hasn't") + " answered any hands yet."));
      return;
    }

    const p = computeProfile(responses);

    // --- overall accuracy ---
    bodyEl.appendChild(h("div", { class: "profile-stat-big" },
      h("span", { class: "profile-stat-num" }, p.accuracyPct + "%"),
      h("span", { class: "profile-stat-label muted" },
        "GTO-correct  ·  " + p.correct + " of " + p.total)
    ));

    // --- aggression bias meter ---
    const av = aggressionVerdict(p.aggressionBias);
    // Map bias (~ -2..+2) to a 0–100% marker position.
    const markerPct = Math.max(2, Math.min(98, 50 + p.aggressionBias * 25));
    bodyEl.appendChild(h("div", { class: "profile-section" },
      h("div", { class: "profile-section-label" }, "Aggression"),
      h("div", { class: "aggr-meter" },
        h("div", { class: "aggr-meter-track" },
          h("div", { class: "aggr-meter-marker aggr-tone-" + av.tone, style: "left:" + markerPct + "%" })
        ),
        h("div", { class: "aggr-meter-ends muted" },
          h("span", null, "Passive"),
          h("span", null, "GTO"),
          h("span", null, "Aggressive")
        )
      ),
      h("p", { class: "profile-verdict" }, av.text)
    ));

    // --- per-concept accuracy ---
    const conceptList = h("div", { class: "profile-concepts" });
    for (const c of p.concepts) {
      const tags = h("div", { class: "profile-concept-tags" });
      if (c.flag === "blindspot") {
        tags.appendChild(h("span", { class: "profile-concept-flag is-blindspot",
          title: "Low accuracy here, but you answer confidently" }, "⚠ Blind spot"));
      } else if (c.flag === "strength") {
        tags.appendChild(h("span", { class: "profile-concept-flag is-strength",
          title: "High accuracy here, but you answer with low confidence" }, "★ Hidden strength"));
      }
      const accClass = c.accuracyPct >= 70 ? " is-good" : c.accuracyPct < 45 ? " is-weak" : "";
      conceptList.appendChild(h("div", { class: "profile-concept" + (c.flag ? " is-flagged" : "") },
        h("div", { class: "profile-concept-head" },
          h("span", { class: "profile-concept-name" }, c.label),
          tags.children.length ? tags : null,
          h("span", { class: "profile-concept-pct muted" },
            c.accuracyPct + "%  ·  " + c.correct + "/" + c.total +
            (c.avgConfidence != null ? "  ·  conf " + c.avgConfidence.toFixed(1) : ""))
        ),
        h("div", { class: "profile-concept-bar" },
          h("div", { class: "profile-concept-fill" + accClass, style: "width:" + c.accuracyPct + "%" })
        )
      ));
    }
    bodyEl.appendChild(h("div", { class: "profile-section" },
      h("div", { class: "profile-section-label" }, "By concept"),
      h("p", { class: "profile-section-hint muted" }, "Weakest first — where the practice pays off most."),
      conceptList
    ));

    // --- confidence calibration ---
    const calNote = calibrationVerdict(p.confWhenRight, p.confWhenWrong);
    if (calNote) {
      bodyEl.appendChild(h("div", { class: "profile-section" },
        h("div", { class: "profile-section-label" }, "Confidence calibration"),
        h("p", { class: "profile-verdict" }, calNote)
      ));
    }
  })();

  return { unmount: () => clear(container) };
}
