// history.js — browser-local persistence.
//
// Two things live in localStorage and neither touches Firebase:
//   - the active-game pointer (which game to resume on next open)
//   - a list of completed-game result records, used for the "Past games"
//     list and the running tally on the landing screen.

const ACTIVE_GAME_KEY = "gto-drill.activeGameId";
const HISTORY_KEY = "gto-drill.history";
const MAX_HISTORY = 50;

// -----------------------------------------------------------------------
// Active-game pointer
// -----------------------------------------------------------------------

export function readActiveGameId() {
  try { return localStorage.getItem(ACTIVE_GAME_KEY); } catch { return null; }
}

export function writeActiveGameId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_GAME_KEY, id);
    else localStorage.removeItem(ACTIVE_GAME_KEY);
  } catch {}
}

// -----------------------------------------------------------------------
// Completed-game history
// -----------------------------------------------------------------------

/**
 * @returns {Array<Object>} completed-game records, most-recent first.
 */
export function listHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Insert or update a completed-game record, keyed by gameId so re-recording
 * the same game is idempotent. Kept most-recent first, capped at MAX_HISTORY.
 * @param {Object} record Must include a `gameId`.
 */
export function recordGame(record) {
  if (!record || !record.gameId) return;
  try {
    const rest = listHistory().filter((r) => r.gameId !== record.gameId);
    rest.unshift(record);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rest.slice(0, MAX_HISTORY)));
  } catch {}
}

/**
 * Remove one completed-game record from local history, by gameId. History is
 * otherwise kept indefinitely — this is the only thing that deletes it.
 * @param {string} gameId
 */
export function removeGame(gameId) {
  if (!gameId) return;
  try {
    const kept = listHistory().filter((r) => r.gameId !== gameId);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(kept));
  } catch {}
}

/**
 * Aggregate tally across every recorded game.
 * @returns {{games:number, myPct:number, oppPct:number, agreePct:number,
 *            opponentName:(string|null)}|null} null when there is no history.
 */
export function historySummary() {
  const all = listHistory();
  if (all.length === 0) return null;
  let myCorrect = 0, myTotal = 0, oppCorrect = 0, oppTotal = 0, agreeSame = 0, agreeTotal = 0;
  for (const r of all) {
    myCorrect += r.myCorrect || 0;
    myTotal += r.myTotal || 0;
    oppCorrect += r.oppCorrect || 0;
    oppTotal += r.oppTotal || 0;
    agreeSame += r.agreeSame || 0;
    agreeTotal += r.agreeTotal || 0;
  }
  const names = new Set(all.map((r) => r.opponentName).filter(Boolean));
  return {
    games: all.length,
    myPct: myTotal ? Math.round((myCorrect / myTotal) * 100) : 0,
    oppPct: oppTotal ? Math.round((oppCorrect / oppTotal) * 100) : 0,
    agreePct: agreeTotal ? Math.round((agreeSame / agreeTotal) * 100) : 0,
    // Surface the opponent name only when every game was against the same person.
    opponentName: names.size === 1 ? [...names][0] : null,
  };
}
