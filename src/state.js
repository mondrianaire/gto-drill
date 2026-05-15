// state.js — section-2 (State and Backend Adapter)
//
// Wraps Firebase Firestore + Anonymous Auth. The ONLY module in the app that
// imports the Firebase SDK directly. Every other section uses this adapter's
// exported functions.
//
// We use the official Firebase JS SDK loaded via ES module imports from the
// gstatic CDN. The version is pinned to 10.12.x — a 10.x stable line. The
// user's config (apiKey/projectId/etc., plus VAPID public key) lives in
// ../config.js and is imported here.
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
  signInAnonymously as fbSignInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  enableNetwork,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { sampleNScenarioIds } from "./scenarios.js";

// -----------------------------------------------------------------------
// Internal state — module-scoped singletons.
// -----------------------------------------------------------------------

let _app = null;
let _auth = null;
let _db = null;
let _uid = null;
let _authReadyPromise = null;

// -----------------------------------------------------------------------
// Lifecycle: initFirebase + signInAnonymously
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
 * Sign in anonymously and resolve with the UID. Idempotent: if already
 * signed in, returns the existing UID.
 * @returns {Promise<{uid: string}>}
 */
export async function signInAnonymously() {
  if (!_auth) throw new Error("initFirebase() must be called before signInAnonymously()");
  if (_uid) return { uid: _uid };
  if (!_authReadyPromise) {
    _authReadyPromise = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(
        _auth,
        (user) => {
          if (user) {
            _uid = user.uid;
            unsub();
            resolve({ uid: _uid });
          }
        },
        (err) => {
          unsub();
          reject(err);
        }
      );
      fbSignInAnonymously(_auth).catch((err) => {
        unsub();
        reject(err);
      });
    });
  }
  return _authReadyPromise;
}

export function getCurrentUid() {
  if (!_uid) {
    throw new Error("getCurrentUid() called before signInAnonymously() resolved");
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

function buildJoinUrl(code) {
  // Anchored at current origin + pathname so the URL reflects whichever
  // GitHub Pages subpath the artifact is served from.
  const loc = globalThis.location;
  if (!loc) return "?join=" + encodeURIComponent(code);
  return `${loc.origin}${loc.pathname}?join=${encodeURIComponent(code)}`;
}

// -----------------------------------------------------------------------
// Game lifecycle: createGame, joinGame
// -----------------------------------------------------------------------

/**
 * Create a new game in Firestore.
 * @param {{rounds:number, handful_size:number}} config
 * @param {string} displayName
 * @returns {Promise<{gameId:string, shareCode:string, joinUrl:string}>}
 */
export async function createGame(config, displayName) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const rounds = clampInt(config.rounds, 1, 10);
  const handful = clampInt(config.handful_size, 1, 10);

  // Generate share codes until we find an unused one. In practice the first
  // attempt almost always succeeds (32^6 = ~1 billion codes).
  let shareCode = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShareCode(6);
    const ref = doc(_db, "games", candidate);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      shareCode = candidate;
      break;
    }
  }
  if (!shareCode) throw new Error("Could not allocate a share code; please try again.");

  const scenarioSeed = shareCode; // deterministic per game
  const gameDoc = {
    gameId: shareCode,
    createdAt: new Date().toISOString(),
    createdAtServer: serverTimestamp(),
    config: { rounds, handful_size: handful, scenario_seed: scenarioSeed },
    participantUids: [uid], // queryable array for Security Rules
    participants: [
      {
        uid,
        displayName: (displayName || "Player A").slice(0, 40),
        joinedAt: new Date().toISOString(),
        pushSubscription: null,
      },
    ],
    rounds: precomputeRounds(rounds, handful, scenarioSeed, [uid]),
    status: "waiting_for_opponent",
  };
  await setDoc(doc(_db, "games", shareCode), gameDoc);
  return {
    gameId: shareCode,
    shareCode,
    joinUrl: buildJoinUrl(shareCode),
  };
}

/**
 * Join an existing game by share code. Returns gameId on success, or an
 * error tag on failure (so section-5 can render a specific message).
 * @param {string} shareCode
 * @param {string} displayName
 * @returns {Promise<{gameId:string}|{error:'not_found'|'game_full'|'permission_denied'}>}
 */
export async function joinGame(shareCode, displayName) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const normalized = String(shareCode || "").trim().toUpperCase();
  if (!normalized) return { error: "not_found" };
  const ref = doc(_db, "games", normalized);
  try {
    const result = await runTransaction(_db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { error: "not_found" };
      const data = snap.data();
      const uids = data.participantUids || [];
      if (uids.includes(uid)) return { gameId: normalized };
      if (uids.length >= 2) return { error: "game_full" };
      const newParticipants = (data.participants || []).concat([
        {
          uid,
          displayName: (displayName || "Player B").slice(0, 40),
          joinedAt: new Date().toISOString(),
          pushSubscription: null,
        },
      ]);
      const newUids = uids.concat([uid]);
      // Set round leader alternation now that we have both UIDs.
      const newRounds = (data.rounds || []).map((r, i) => ({
        ...r,
        leaderUid: i % 2 === 0 ? uids[0] : uid,
      }));
      tx.update(ref, {
        participantUids: newUids,
        participants: newParticipants,
        rounds: newRounds,
        status: "in_progress",
      });
      return { gameId: normalized };
    });
    return result;
  } catch (err) {
    if (err && err.code === "permission-denied") return { error: "permission_denied" };
    throw err;
  }
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
export function readGame(gameId, onChange) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const ref = doc(_db, "games", gameId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const raw = snap.data();
    onChange(redactGameForViewer(raw, uid));
  });
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
// Push-subscription persistence
// -----------------------------------------------------------------------

/**
 * Persist the current player's push subscription on their participant entry.
 * @param {string} gameId
 * @param {Object} subscription PushSubscriptionRecord shape
 */
export async function savePushSubscription(gameId, subscription) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const ref = doc(_db, "games", gameId);
  await runTransaction(_db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("game not found");
    const data = snap.data();
    const participants = (data.participants || []).map((p) =>
      p.uid === uid ? { ...p, pushSubscription: subscription } : p
    );
    tx.update(ref, { participants });
  });
}

/**
 * Read the opponent's stored push subscription (if any).
 * @param {string} gameId
 * @returns {Promise<Object|null>}
 */
export async function readOpponentPushSubscription(gameId) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const ref = doc(_db, "games", gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  const opponent = (data.participants || []).find((p) => p.uid !== uid);
  return opponent && opponent.pushSubscription ? opponent.pushSubscription : null;
}

/**
 * @param {string} gameId
 * @returns {Promise<string|null>}
 */
export async function getOpponentUid(gameId) {
  if (!_db) throw new Error("initFirebase() must be called first");
  const uid = getCurrentUid();
  const ref = doc(_db, "games", gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  const uids = data.participantUids || [];
  return uids.find((u) => u !== uid) || null;
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
