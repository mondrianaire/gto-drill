// stats.js — section-4 (Wrap-up statistics computation).
//
// Pure functions over a completed GameDocument plus the scenario library.

import { getScenarioById } from "./scenarios.js";

/**
 * Per-player % agreement with the GTO-verified action across the game.
 * @returns {Object<string, {correct:number, total:number, pct:number}>}
 */
export function perPlayerAccuracy(game) {
  const uids = (game.participantUids || []).slice();
  const out = {};
  for (const u of uids) out[u] = { correct: 0, total: 0, pct: 0 };
  for (const r of game.rounds || []) {
    const subs = r.submissionsByUid || {};
    for (const u of uids) {
      const playerSubs = subs[u];
      if (!Array.isArray(playerSubs)) continue;
      for (const s of playerSubs) {
        const scen = getScenarioById(s.scenario_id);
        if (!scen) continue;
        out[u].total++;
        if (s.action === scen.gto_action) out[u].correct++;
      }
    }
  }
  for (const u of uids) {
    out[u].pct = out[u].total === 0 ? 0 : Math.round((out[u].correct / out[u].total) * 100);
  }
  return out;
}

/**
 * Inter-player % agreement (fraction of scenarios where both players chose
 * the same action).
 */
export function interPlayerAgreement(game) {
  const uids = (game.participantUids || []).slice();
  if (uids.length < 2) return { same: 0, total: 0, pct: 0 };
  const [a, b] = uids;
  let same = 0;
  let total = 0;
  for (const r of game.rounds || []) {
    const subs = r.submissionsByUid || {};
    const aSubs = Array.isArray(subs[a]) ? subs[a] : [];
    const bSubs = Array.isArray(subs[b]) ? subs[b] : [];
    const byId = {};
    for (const s of aSubs) byId[s.scenario_id] = { a: s };
    for (const s of bSubs) (byId[s.scenario_id] = byId[s.scenario_id] || {}).b = s;
    for (const id of Object.keys(byId)) {
      const pair = byId[id];
      if (pair.a && pair.b) {
        total++;
        if (pair.a.action === pair.b.action) same++;
      }
    }
  }
  return { same, total, pct: total === 0 ? 0 : Math.round((same / total) * 100) };
}

/**
 * Disagreements ranked by joint-confidence-min (min(c_a, c_b)) descending.
 * Tie-broken by sum of confidences descending, then by scenario_id for
 * determinism. Returns full record per disagreement for UI to render.
 */
export function rankedDisagreements(game) {
  const uids = (game.participantUids || []).slice();
  if (uids.length < 2) return [];
  const [a, b] = uids;
  const out = [];
  for (const r of game.rounds || []) {
    const subs = r.submissionsByUid || {};
    const aSubs = Array.isArray(subs[a]) ? subs[a] : [];
    const bSubs = Array.isArray(subs[b]) ? subs[b] : [];
    const byId = {};
    for (const s of aSubs) byId[s.scenario_id] = { a: s };
    for (const s of bSubs) (byId[s.scenario_id] = byId[s.scenario_id] || {}).b = s;
    for (const id of Object.keys(byId)) {
      const pair = byId[id];
      if (!pair.a || !pair.b) continue;
      if (pair.a.action === pair.b.action) continue;
      const scen = getScenarioById(id);
      out.push({
        scenario_id: id,
        scenario: scen,
        playerA_uid: a,
        playerB_uid: b,
        playerA_action: pair.a.action,
        playerB_action: pair.b.action,
        playerA_confidence: pair.a.confidence,
        playerB_confidence: pair.b.confidence,
        playerA_note: pair.a.note || null,
        playerB_note: pair.b.note || null,
        joint_confidence_min: Math.min(pair.a.confidence, pair.b.confidence),
        joint_confidence_sum: pair.a.confidence + pair.b.confidence,
        roundIndex: r.roundIndex,
      });
    }
  }
  out.sort((x, y) => {
    if (y.joint_confidence_min !== x.joint_confidence_min) return y.joint_confidence_min - x.joint_confidence_min;
    if (y.joint_confidence_sum !== x.joint_confidence_sum) return y.joint_confidence_sum - x.joint_confidence_sum;
    return x.scenario_id.localeCompare(y.scenario_id);
  });
  return out;
}
