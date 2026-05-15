// flow.js — section-4 (Game Flow), turn/round state machine helpers.
//
// Pure functions over the GameDocument shape. No DOM, no Firebase.
// This module is unit-testable by section-7 in isolation.

/**
 * @param {Object} game GameDocument
 * @param {string} uid The current player's UID
 * @returns {Object} { currentRoundIndex, currentRound, myTurn, opponentTurn, gameComplete, waitingForOpponent }
 */
export function computePhase(game, uid) {
  if (!game || !Array.isArray(game.rounds) || game.rounds.length === 0) {
    return { gameComplete: false, currentRoundIndex: 0, myTurn: false, waitingForOpponent: false };
  }
  const uids = (game.participantUids || []).slice();
  const opponentUid = uids.find((u) => u !== uid) || null;
  // Find first round that is not fully completed by both players.
  let idx = -1;
  for (let i = 0; i < game.rounds.length; i++) {
    const r = game.rounds[i];
    const expected = (r.scenarioIds || []).length;
    const mineLen = (r.submissionsByUid && Array.isArray(r.submissionsByUid[uid])) ? r.submissionsByUid[uid].length : 0;
    const oppRaw = r.submissionsByUid && r.submissionsByUid[opponentUid];
    let oppLen = 0;
    if (Array.isArray(oppRaw)) oppLen = oppRaw.length;
    else if (oppRaw && oppRaw._redacted) oppLen = oppRaw.count;
    if (mineLen < expected || oppLen < expected) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    return {
      gameComplete: true,
      currentRoundIndex: game.rounds.length - 1,
      currentRound: game.rounds[game.rounds.length - 1],
      myTurn: false,
      opponentTurn: false,
      waitingForOpponent: false,
    };
  }
  const round = game.rounds[idx];
  const expected = (round.scenarioIds || []).length;
  const mineLen = (round.submissionsByUid && Array.isArray(round.submissionsByUid[uid])) ? round.submissionsByUid[uid].length : 0;
  const oppRaw = round.submissionsByUid && round.submissionsByUid[opponentUid];
  let oppLen = 0;
  if (Array.isArray(oppRaw)) oppLen = oppRaw.length;
  else if (oppRaw && oppRaw._redacted) oppLen = oppRaw.count;
  const myTurn = mineLen < expected;
  const opponentTurn = !myTurn && oppLen < expected;
  return {
    gameComplete: false,
    currentRoundIndex: idx,
    currentRound: round,
    myTurn,
    opponentTurn,
    waitingForOpponent: !myTurn && oppLen < expected,
    revealReady: mineLen === expected && oppLen === expected,
  };
}

/**
 * Are both players done with the given round?
 */
export function roundComplete(game, roundIndex) {
  const uids = (game.participantUids || []).slice();
  if (uids.length < 2) return false;
  const round = game.rounds[roundIndex];
  if (!round) return false;
  const expected = (round.scenarioIds || []).length;
  return uids.every((u) => {
    const sub = round.submissionsByUid && round.submissionsByUid[u];
    return Array.isArray(sub) && sub.length === expected;
  });
}
