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
  onSnapshot,
  serverTimestamp,
  runTransaction,
  collection,
  query,
  where,
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
  const gameDoc = {
    gameId,
    createdAt: new Date().toISOString(),
    createdAtServer: serverTimestamp(),
    config: { rounds, handful_size: handful, scenario_seed: scenarioSeed },
    participantUids: [me.uid], // queryable array for Security Rules
    participants: [participantRecord(me)],
    rounds: precomputeRounds(rounds, handful, scenarioSeed, [me.uid]),
    status: "waiting_for_opponent",
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

// -----------------------------------------------------------------------
// Live read + submit
// -----------------------------------------------------------------------

/**
 * Subscribe to live updates for a game document. Returns an unsubscribe fn.
 * onChange may receive a *redacted* GameDocument — opponent submissions for
 * the current round are masked until the current player has submitted.
 * Security Rules separately deny direct reads of the opponent's pre-submit
 * data; this redaction is defense-in-depth at the UI layer.
 *
 * @param {string} gameId
 * @param {(game:Object)=>void} onChange
 * @returns {()=>void} unsubscribe
 */
export function readGame(gameId, onChange, onError) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const ref = doc(_db, "games", gameId);
  return onSnapshot(
    ref,
    (snap) => {
      // onChange(null) signals the document does not exist.
      if (!snap.exists()) { onChange(null); return; }
      onChange(redactGameForViewer(snap.data(), uid));
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
    tx.update(ref, { rounds, status: newStatus });
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

/**
 * Mask opponent submissions for rounds where the viewer has not yet
 * submitted. This is layered behind Firestore Security Rules, not in place
 * of them.
 */
function redactGameForViewer(game, viewerUid) {
  if (!game || !Array.isArray(game.rounds)) return game;
  const rounds = game.rounds.map((r) => {
    const subs = r.submissionsByUid || {};
    const viewerSub = subs[viewerUid];
    if (Array.isArray(viewerSub) && viewerSub.length === (r.scenarioIds || []).length) {
      // viewer has submitted this round; opponent submissions can be revealed
      return r;
    }
    // Viewer has NOT submitted this round; mask opponent submissions.
    const redactedSubs = {};
    for (const uid of Object.keys(subs)) {
      if (uid === viewerUid) redactedSubs[uid] = subs[uid];
      else redactedSubs[uid] = { _redacted: true, count: (subs[uid] || []).length };
    }
    return { ...r, submissionsByUid: redactedSubs };
  });
  return { ...game, rounds };
}
