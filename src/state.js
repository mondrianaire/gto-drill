// state.js — section-2 (State and Backend Adapter)
//
// Wraps Firebase Firestore + Google Auth. The ONLY module in the app that
// imports the Firebase SDK directly. Every other section uses this adapter's
// exported functions.
//
// We use the official Firebase JS SDK loaded via ES module imports from the
// gstatic CDN. The version is pinned to 10.12.x — a 10.x stable line. The
// user's Firebase config (apiKey/projectId/etc.) lives in ../config.js and
// is imported here.
//
// Idempotency:
//   - initFirebase() guards against double-init.
//   - submitHandful() uses a deterministic doc field path keyed by
//     (gameId, roundIndex, uid) so re-calling overwrites rather than
//     duplicates.

import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  enableNetwork,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  collection,
  query,
  where,
  getDocs,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { sampleNScenarioIds } from "./scenarios.js";

// -----------------------------------------------------------------------
// Internal state — module-scoped singletons.
// -----------------------------------------------------------------------

let _app = null;
let _auth = null;
let _db = null;
let _uid = null;
let _user = null;
let _authReadyPromise = null;

// -----------------------------------------------------------------------
// Lifecycle: initFirebase + Google Auth
// -----------------------------------------------------------------------

/**
 * Initialize Firebase from user-supplied config. Idempotent.
 * @param {Object} config The Firebase web config (apiKey, projectId, etc.).
 * @returns {Promise<void>}
 */
export async function initFirebase(config) {
  if (_app) return;
  if (!config || !config.apiKey || !config.projectId) {
    throw new Error(
      "Firebase config is missing required fields. Edit src/config.js and paste the values from the Firebase console."
    );
  }
  const existing = getApps();
  _app = existing.length ? existing[0] : initializeApp(config);
  _auth = getAuth(_app);
  // Force HTTP long-polling rather than WebChannel/gRPC streaming. Streaming
  // gets blocked by a wide range of network conditions (corporate firewalls,
  // VPNs, HTTP/2 proxies, browser extensions, even ordinary IPv6 oddities)
  // — and when it fails, Firestore returns "Missing or insufficient
  // permissions" or "client is offline" even though the issue is transport-
  // layer. Forcing long-polling sacrifices a small amount of latency for
  // dramatically more reliable connectivity.
  try {
    _db = initializeFirestore(_app, {
      experimentalForceLongPolling: true,
    });
  } catch (_) {
    // initializeFirestore throws if Firestore is already initialized for
    // this app (e.g., hot-reload). Fall back to the existing instance.
    _db = getFirestore(_app);
  }
  // Explicitly enable network — in case the SDK got into an offline-cache-
  // only state from prior failed sessions persisted in IndexedDB.
  try { await enableNetwork(_db); } catch (_) { /* best effort */ }
}

/**
 * Resolve the initial auth state. Completes any pending redirect sign-in,
 * then resolves once Firebase has determined whether a user is signed in
 * (from a persisted session) or not. Idempotent.
 * @returns {Promise<Object|null>} the signed-in user, or null.
 */
export function initAuth() {
  if (_authReadyPromise) return _authReadyPromise;
  if (!_auth) throw new Error("initFirebase() must be called before initAuth()");
  _authReadyPromise = (async () => {
    // If we just came back from a redirect-based sign-in, consume it first.
    try { await getRedirectResult(_auth); } catch (_) { /* no pending redirect */ }
    return new Promise((resolve) => {
      onAuthStateChanged(_auth, (user) => {
        // A leftover anonymous session (from before Google sign-in existed)
        // is treated as "not signed in" so the Google gate still shows.
        const real = user && !user.isAnonymous ? user : null;
        _user = real;
        _uid = real ? real.uid : null;
        // resolve() only takes effect on the first call; later sign-in /
        // sign-out events still keep _user and _uid current.
        resolve(_user);
      });
    });
  })();
  return _authReadyPromise;
}

/**
 * Trigger Google sign-in. Uses a popup; falls back to a full-page redirect
 * on browsers that block popups (common on mobile). MUST be called from a
 * user gesture (click handler).
 * @returns {Promise<Object|null>} the signed-in user, or null when a
 *   redirect was started (the page navigates away in that case).
 */
export async function signInWithGoogle() {
  if (!_auth) throw new Error("initFirebase() must be called first");
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(_auth, provider);
    _user = cred.user;
    _uid = cred.user.uid;
    return _user;
  } catch (err) {
    const code = err && err.code;
    if (
      code === "auth/popup-blocked" ||
      code === "auth/cancelled-popup-request" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(_auth, provider);
      return null; // the page is navigating away to Google.
    }
    throw err; // e.g. auth/popup-closed-by-user — let the caller surface it.
  }
}

/** Sign the current user out. */
export async function signOutUser() {
  if (!_auth) return;
  await signOut(_auth);
  _user = null;
  _uid = null;
}

/**
 * @returns {{uid:string, displayName:(string|null), email:(string|null),
 *            photoURL:(string|null)}|null} the current user, or null.
 */
export function getCurrentUser() {
  if (!_user) return null;
  return {
    uid: _user.uid,
    displayName: _user.displayName || null,
    email: _user.email || null,
    photoURL: _user.photoURL || null,
  };
}

export function getCurrentUid() {
  if (!_uid) {
    throw new Error("getCurrentUid() called before the user is signed in");
  }
  return _uid;
}

// -----------------------------------------------------------------------
// Share-code generation
// -----------------------------------------------------------------------

const SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // base32-ish, omits ambiguous 0/O/1/I

function generateShareCode(len = 6) {
  let s = "";
  const buf = new Uint32Array(len);
  (globalThis.crypto || globalThis.msCrypto).getRandomValues(buf);
  for (let i = 0; i < len; i++) {
    s += SHARE_CODE_ALPHABET[buf[i] % SHARE_CODE_ALPHABET.length];
  }
  return s;
}

// -----------------------------------------------------------------------
// Game lifecycle: createGame, joinGame, watchOpenLobbies, cancelLobby
// -----------------------------------------------------------------------

/**
 * Create a new game (an open lobby) in Firestore. The creator is the owner;
 * their Google name and photo identify the lobby to other players.
 * @param {{rounds:number, handful_size:number}} config
 * @returns {Promise<{gameId:string}>}
 */
export async function createGame(config) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const me = getCurrentUser();
  if (!me) throw new Error("Must be signed in to create a game");
  const rounds = clampInt(config.rounds, 1, 10);
  const handful = clampInt(config.handful_size, 1, 10);

  // The game id is a random code used as the Firestore document id. With
  // 32^6 (~1 billion) values, collisions are negligible, and the create rule
  // rejects a write that would land on an existing game — so a collision
  // fails safely rather than corrupting another game.
  const gameId = generateShareCode(6);

  const scenarioSeed = gameId; // deterministic per game
  const nowIso = new Date().toISOString();
  const gameDoc = {
    gameId,
    createdAt: nowIso,
    createdAtServer: serverTimestamp(),
    config: { rounds, handful_size: handful, scenario_seed: scenarioSeed },
    participantUids: [me.uid], // queryable array for Security Rules
    participants: [participantRecord(me)],
    rounds: precomputeRounds(rounds, handful, scenarioSeed, [me.uid]),
    status: "waiting_for_opponent",
    // Activity tracking — surfaces "is the opponent still around?" in
    // the active-games panel. lastActivityAt is touched on join + each
    // submitHandful; lastSubmittedAt is per-user.
    lastActivityAt: nowIso,
    lastSubmittedAt: {}, // map uid → ISO timestamp of latest handful submission
  };
  await setDoc(doc(_db, "games", gameId), gameDoc);
  return { gameId };
}

/**
 * Join an open lobby by its game id. Returns gameId on success, or an error
 * tag on failure (so section-5 can render a specific message).
 * @param {string} gameId
 * @returns {Promise<{gameId:string}|{error:string}>}
 */
export async function joinGame(gameId) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const me = getCurrentUser();
  if (!me) return { error: "not_signed_in" };
  const id = String(gameId || "").trim().toUpperCase();
  if (!id) return { error: "not_found" };
  const ref = doc(_db, "games", id);
  try {
    const result = await runTransaction(_db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { error: "not_found" };
      const data = snap.data();
      if (data.status === "cancelled") return { error: "cancelled" };
      const uids = data.participantUids || [];
      if (uids.includes(me.uid)) return { gameId: id };
      if (uids.length >= 2) return { error: "game_full" };
      const newParticipants = (data.participants || []).concat([participantRecord(me)]);
      const newUids = uids.concat([me.uid]);
      // Set round leader alternation now that we have both UIDs.
      const newRounds = (data.rounds || []).map((r, i) => ({
        ...r,
        leaderUid: i % 2 === 0 ? uids[0] : me.uid,
      }));
      tx.update(ref, {
        participantUids: newUids,
        participants: newParticipants,
        rounds: newRounds,
        status: "in_progress",
        lastActivityAt: new Date().toISOString(),
      });
      return { gameId: id };
    });
    return result;
  } catch (err) {
    if (err && err.code === "permission-denied") return { error: "permission_denied" };
    throw err;
  }
}

/** Build a participant record from a signed-in user. */
function participantRecord(me) {
  return {
    uid: me.uid,
    displayName: (me.displayName || me.email || "Player").slice(0, 60),
    photoURL: me.photoURL || null,
    joinedAt: new Date().toISOString(),
  };
}

/**
 * Subscribe to the list of open lobbies (games waiting for an opponent).
 * The viewer's own lobbies are filtered out. onChange receives an array of
 * lobby summaries, or (null, error) if the read failed.
 * @param {(lobbies:(Array|null), error?:Error)=>void} onChange
 * @returns {()=>void} unsubscribe
 */
export function watchOpenLobbies(onChange) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const q = query(collection(_db, "games"), where("status", "==", "waiting_for_opponent"));
  return onSnapshot(
    q,
    (snap) => {
      const lobbies = [];
      snap.forEach((d) => {
        const g = d.data();
        const owner = (g.participants || [])[0] || {};
        if (owner.uid === _uid) return; // can't join your own lobby
        lobbies.push({
          gameId: g.gameId || d.id,
          ownerUid: owner.uid || null,
          ownerName: owner.displayName || "Player",
          ownerPhoto: owner.photoURL || null,
          rounds: (g.config && g.config.rounds) || 0,
          handfulSize: (g.config && g.config.handful_size) || 0,
          createdAt: g.createdAt || "",
        });
      });
      // Newest first.
      lobbies.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      onChange(lobbies);
    },
    (err) => {
      console.warn("watchOpenLobbies error:", err);
      onChange(null, err);
    }
  );
}

/** Cancel an open lobby (owner abandons it before anyone joins). */
export async function cancelLobby(gameId) {
  if (!_db) throw new Error("initFirebase() must be called first");
  await updateDoc(doc(_db, "games", gameId), { status: "cancelled" });
}

/**
 * Cancel any game I'm a participant in (lobby OR in-progress). Same
 * Firestore write as cancelLobby — separate export name so call sites
 * downstream of the "stale active game" UI read as their intent.
 */
export async function cancelGame(gameId) {
  if (!_db) throw new Error("initFirebase() must be called first");
  await updateDoc(doc(_db, "games", gameId), { status: "cancelled" });
}

/**
 * Permanently delete a lobby that's still waiting_for_opponent.
 * Used by the Join-screen × button to nuke orphan / bot-created
 * lobbies that nobody's going to join.
 *
 * Firestore rules only allow this on docs with
 * status == 'waiting_for_opponent'; in-progress and completed games
 * cannot be deleted (their participants still own the data).
 */
export async function deleteLobby(gameId) {
  if (!_db) throw new Error("initFirebase() must be called first");
  await deleteDoc(doc(_db, "games", gameId));
}

// -----------------------------------------------------------------------
// Crowd responses — the global answer pool
// -----------------------------------------------------------------------
//
// Every player's answer to a scenario is recorded as one document in the
// `responses` collection, keyed `${scenario_id}__${uid}` so re-answering
// overwrites rather than duplicates (one data point per player per
// scenario). The reveal screen aggregates these into a "how others
// played" breakdown.

/**
 * Record (or overwrite) the signed-in user's answer to a scenario.
 * No-ops silently when not signed in — the play view still works for
 * anonymous users, they just don't contribute to / can't read the
 * crowd pool.
 *
 * @param {string} scenarioId
 * @param {string} action     The action label the user picked.
 * @param {number} confidence 1–5.
 * @returns {Promise<boolean>} true if recorded, false if skipped.
 */
export async function recordResponse(scenarioId, action, confidence) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const me = getCurrentUser();
  if (!me || !scenarioId || !action) return false;
  const docId = scenarioId + "__" + me.uid;
  // Merge-written so a re-answer (the retest flow) overwrites action /
  // confidence but PRESERVES any `note` the player attached on an
  // earlier pass. A plain setDoc would silently delete that comment;
  // instead the note is kept and the reveal flags it as stale when the
  // new action differs from the one the note was written about.
  await setDoc(doc(_db, "responses", docId), {
    scenario_id: scenarioId,
    uid: me.uid,
    displayName: (me.displayName || me.email || "Player").slice(0, 60),
    photoURL: me.photoURL || null,
    action: action,
    confidence: Number(confidence) || null,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return true;
}

/**
 * Save (or clear) the user's comment on a hand — a post-reveal note
 * about the spot and the GTO decision. Merge-written so it sits
 * alongside the existing action/confidence on the same response doc.
 *
 * @param {string} scenarioId
 * @param {string} note  free text (trimmed + capped at 280 chars).
 * @returns {Promise<boolean>}
 */
export async function saveResponseComment(scenarioId, note) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const me = getCurrentUser();
  if (!me || !scenarioId) return false;
  const docId = scenarioId + "__" + me.uid;
  await setDoc(doc(_db, "responses", docId), {
    note: String(note || "").slice(0, 280),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return true;
}

/**
 * Read every recorded response for a scenario — the raw crowd pool the
 * reveal aggregates. Returns [] when not signed in or on error (the
 * reveal degrades gracefully to a no-crowd-data state).
 *
 * @param {string} scenarioId
 * @returns {Promise<Array<{uid,displayName,photoURL,action,confidence}>>}
 */
export async function readScenarioResponses(scenarioId) {
  if (!_db) throw new Error("initFirebase() must be called first");
  if (!getCurrentUser() || !scenarioId) return [];
  try {
    const q = query(collection(_db, "responses"), where("scenario_id", "==", scenarioId));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach((d) => out.push(d.data()));
    return out;
  } catch (err) {
    console.warn("readScenarioResponses failed:", err);
    return [];
  }
}

/**
 * Read the signed-in user's own responses across every scenario.
 * Powers (a) the "don't re-show completed scenarios" logic in the play
 * loop and (b) the player-profile analysis. Returns [] when not signed
 * in or on error.
 *
 * @returns {Promise<Array<{scenario_id,action,confidence,updatedAt}>>}
 */
export async function readMyResponses() {
  const me = getCurrentUser();
  return me ? readResponsesByUid(me.uid) : [];
}

/**
 * Read every response recorded by a specific player — the input for
 * that player's profile (any player's profile is viewable, consistent
 * with the crowd model). Returns [] when not signed in or on error.
 *
 * @param {string} uid
 * @returns {Promise<Array<{scenario_id,uid,displayName,photoURL,action,confidence}>>}
 */
export async function readResponsesByUid(uid) {
  if (!_db) throw new Error("initFirebase() must be called first");
  if (!getCurrentUser() || !uid) return [];
  try {
    const q = query(collection(_db, "responses"), where("uid", "==", uid));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach((d) => out.push(d.data()));
    return out;
  } catch (err) {
    console.warn("readResponsesByUid failed:", err);
    return [];
  }
}

// -----------------------------------------------------------------------
// Per-user profile doc — users/{uid}
// -----------------------------------------------------------------------
//
// Holds account-level settings, currently the poker-knowledge level
// captured on first sign-in (which seeds the dictionary-tooltip
// granularity). One doc per user, read on every sign-in.

/**
 * Read the signed-in user's profile doc, or null if they don't have
 * one yet (first sign-in) / not signed in / error.
 * @returns {Promise<Object|null>}
 */
export async function readUserProfile() {
  if (!_db) throw new Error("initFirebase() must be called first");
  const me = getCurrentUser();
  if (!me) return null;
  try {
    const snap = await getDoc(doc(_db, "users", me.uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("readUserProfile failed:", err);
    return null;
  }
}

/**
 * Persist the user's self-reported poker-knowledge level. Merged into
 * the users/{uid} doc so it can sit alongside future settings.
 * @param {string} level  one of the KNOWLEDGE_LEVELS ids.
 */
export async function saveKnowledgeLevel(level) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const me = getCurrentUser();
  if (!me || !level) return;
  await setDoc(doc(_db, "users", me.uid), {
    uid: me.uid,
    knowledgeLevel: level,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

/**
 * Read EVERY recorded response across all scenarios and players — the
 * input for the Players screen (completion + accuracy per player) and
 * for viewing other players' profiles. Returns [] when not signed in
 * or on error.
 *
 * For a small friends-and-family app this is a cheap full-collection
 * read; if the response pool ever grows large this should move to a
 * maintained per-user aggregate doc.
 *
 * @returns {Promise<Array<{scenario_id,uid,displayName,photoURL,action,confidence}>>}
 */
export async function readAllResponses() {
  if (!_db) throw new Error("initFirebase() must be called first");
  if (!getCurrentUser()) return [];
  try {
    const snap = await getDocs(collection(_db, "responses"));
    const out = [];
    snap.forEach((d) => out.push(d.data()));
    return out;
  } catch (err) {
    console.warn("readAllResponses failed:", err);
    return [];
  }
}

/**
 * Subscribe to MY active games (statuses: waiting_for_opponent, in_progress).
 * Returns summaries with enough info to render a "stale game" row: status,
 * opponent identity, my progress in the current round, total rounds.
 *
 * Implementation: queries on `participantUids array-contains uid` only —
 * status filter is applied client-side so we don't need a composite
 * Firestore index. Cancelled and complete games are filtered out.
 *
 * @param {(games:(Array|null), error?:Error)=>void} onChange
 * @returns {()=>void} unsubscribe
 */
export function watchMyActiveGames(onChange) {
  if (!_db) throw new Error("initFirebase() must be called first");
  if (!_uid) {
    // Not signed in — nothing to watch; behave like an empty subscription.
    onChange([]);
    return () => {};
  }
  const myUid = _uid;
  const q = query(collection(_db, "games"), where("participantUids", "array-contains", myUid));
  return onSnapshot(
    q,
    (snap) => {
      const games = [];
      snap.forEach((d) => {
        const g = d.data();
        if (g.status !== "waiting_for_opponent" && g.status !== "in_progress") return;
        const uids = g.participantUids || [];
        const oppUid = uids.find((u) => u !== myUid) || null;
        const opp = oppUid
          ? (g.participants || []).find((p) => p.uid === oppUid)
          : null;
        // Current-round progress: find the first non-completed round
        // (mirrors computePhase, but kept inline so we don't import
        // flow.js into state.js).
        const rounds = g.rounds || [];
        const handful = (g.config && g.config.handful_size) || 0;
        const totalRounds = (g.config && g.config.rounds) || rounds.length;
        let currentRoundIdx = 0;
        let myInRound = 0;
        for (let i = 0; i < rounds.length; i++) {
          const r = rounds[i];
          const expected = (r.scenarioIds || []).length;
          const sbu = r.submissionsByUid || {};
          const myLen = Array.isArray(sbu[myUid]) ? sbu[myUid].length : 0;
          const oppLen = oppUid && Array.isArray(sbu[oppUid]) ? sbu[oppUid].length : 0;
          if (myLen < expected || oppLen < expected) {
            currentRoundIdx = i;
            myInRound = myLen;
            break;
          }
        }
        const lastSubByUid = g.lastSubmittedAt || {};
        games.push({
          gameId: g.gameId || d.id,
          status: g.status,
          opponentUid: oppUid,
          opponentName: opp ? opp.displayName : null,
          opponentPhoto: opp ? opp.photoURL : null,
          opponentJoinedAt: opp ? (opp.joinedAt || null) : null,
          currentRoundIdx,
          myInRound,
          handfulSize: handful,
          totalRounds,
          createdAt: g.createdAt || "",
          // Activity signals: when did the game last see ANY action
          // (join or submit), and when did each side last submit?
          // Used by the active-games panel to render "is the opponent
          // coming back" status text + a stalled-warning badge.
          lastActivityAt: g.lastActivityAt || g.createdAt || "",
          myLastSubmittedAt: lastSubByUid[myUid] || null,
          opponentLastSubmittedAt: oppUid ? (lastSubByUid[oppUid] || null) : null,
          // Whose turn is it right now? Computed inline so the panel
          // can label the row without re-running computePhase.
          turnOwnerUid: (function () {
            const r = rounds[currentRoundIdx];
            if (!r) return null;
            const expected = (r.scenarioIds || []).length;
            const sbu = r.submissionsByUid || {};
            const myLen = Array.isArray(sbu[myUid]) ? sbu[myUid].length : 0;
            const oppLen = oppUid && Array.isArray(sbu[oppUid]) ? sbu[oppUid].length : 0;
            if (myLen < expected) return myUid;
            if (oppUid && oppLen < expected) return oppUid;
            return null;
          })(),
        });
      });
      // Newest first.
      games.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      onChange(games);
    },
    (err) => {
      console.warn("watchMyActiveGames error:", err);
      onChange(null, err);
    }
  );
}

// -----------------------------------------------------------------------
// Live read + submit
// -----------------------------------------------------------------------

/**
 * Subscribe to live updates for a game document. Returns an unsubscribe fn.
 * onChange receives the full GameDocument, or null when the document does
 * not exist. The in-game view gates the opponent's per-hand answers itself —
 * each is shown only once the viewer has locked their own answer for that
 * hand — so no document-level redaction happens here.
 *
 * @param {string} gameId
 * @param {(game:(Object|null))=>void} onChange
 * @param {(err:Error)=>void} [onError]
 * @returns {()=>void} unsubscribe
 */
export function readGame(gameId, onChange, onError) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const ref = doc(_db, "games", gameId);
  return onSnapshot(
    ref,
    (snap) => {
      // onChange(null) signals the document does not exist.
      if (!snap.exists()) { onChange(null); return; }
      onChange(snap.data());
    },
    (err) => {
      // A failed read (e.g. permission-denied on a game the viewer is not in)
      // would otherwise silently kill the listener and onChange would never
      // fire — leaving callers hanging. Surface it instead.
      console.warn("readGame: listener error —", (err && err.code) || err);
      if (onError) onError(err);
    }
  );
}

/**
 * Submit a handful of submissions for the current round. Idempotent on
 * (gameId, roundIndex, uid): re-calling overwrites the previous write.
 *
 * @param {string} gameId
 * @param {number} roundIndex
 * @param {Array<Object>} submissions
 * @returns {Promise<{success:boolean, status:string}>}
 */
export async function submitHandful(gameId, roundIndex, submissions) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const ref = doc(_db, "games", gameId);
  return runTransaction(_db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return { success: false, status: "not_found" };
    const data = snap.data();
    const rounds = (data.rounds || []).map((r) => ({ ...r, submissionsByUid: { ...(r.submissionsByUid || {}) } }));
    if (roundIndex < 0 || roundIndex >= rounds.length) {
      return { success: false, status: "bad_round" };
    }
    const round = rounds[roundIndex];
    // Validate submissions reference this round's scenario IDs in order.
    const expectedIds = round.scenarioIds || [];
    if (submissions.length !== expectedIds.length) {
      return { success: false, status: "bad_submissions" };
    }
    for (let i = 0; i < submissions.length; i++) {
      if (submissions[i].scenario_id !== expectedIds[i]) {
        return { success: false, status: "bad_submissions" };
      }
      const c = submissions[i].confidence;
      if (!Number.isInteger(c) || c < 1 || c > 5) {
        return { success: false, status: "bad_submissions" };
      }
      const note = submissions[i].note;
      if (note != null && (typeof note !== "string" || note.length > 280)) {
        return { success: false, status: "bad_submissions" };
      }
    }
    round.submissionsByUid[uid] = submissions;
    // Determine new game status.
    const uids = data.participantUids || [];
    const everyRoundComplete = rounds.every(
      (r) => uids.every((u) => Array.isArray(r.submissionsByUid[u]) && r.submissionsByUid[u].length === (r.scenarioIds || []).length)
    );
    const newStatus = everyRoundComplete ? "complete" : "in_progress";
    // Activity tracking — game-wide last-touched plus per-user
    // last-submitted-at so the active-games panel can surface
    // "Opponent last submitted X ago" / staleness flags.
    const nowIso = new Date().toISOString();
    const lastSubmittedAt = Object.assign({}, data.lastSubmittedAt || {}, { [uid]: nowIso });
    tx.update(ref, {
      rounds,
      status: newStatus,
      lastActivityAt: nowIso,
      lastSubmittedAt,
    });
    // Return the status this submission triggered for the section-4 caller.
    const bothInThisRound = uids.length === 2 && uids.every(
      (u) => Array.isArray(round.submissionsByUid[u]) && round.submissionsByUid[u].length === expectedIds.length
    );
    let returned = "waiting_for_opponent";
    if (everyRoundComplete) returned = "game_complete";
    else if (bothInThisRound) returned = "round_complete";
    return { success: true, status: returned };
  });
}

// -----------------------------------------------------------------------
// Rematch
// -----------------------------------------------------------------------

/**
 * Stamp a rematch pointer onto a finished game so the other player can find
 * and join the follow-up game from the wrap-up screen.
 * @param {string} gameId         The finished game's id.
 * @param {string} rematchGameId  The newly created follow-up game's id.
 * @param {string} byUid          The uid of the player who started the rematch.
 */
export async function setRematchGameId(gameId, rematchGameId, byUid) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const ref = doc(_db, "games", gameId);
  await updateDoc(ref, { rematchGameId, rematchBy: byUid });
}

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

function clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function precomputeRounds(roundCount, handful, seed, knownUids) {
  // Each round has a distinct seed so it samples distinct scenarios.
  const out = [];
  for (let r = 0; r < roundCount; r++) {
    const roundSeed = `${seed}#round-${r}`;
    const scenarioIds = sampleNScenarioIds(handful, roundSeed);
    out.push({
      roundIndex: r,
      leaderUid: knownUids[r % knownUids.length] || null,
      scenarioIds,
      submissionsByUid: {},
    });
  }
  return out;
}

// (Opponent-answer gating is handled per-hand in the in-game view, so there
// is no document-level redaction here. The Firestore rules already permit a
// participant to read the whole game document.)
