// app.js — top-level boot + router (section-6 Controller/Shell).
//
// GTO Drill is a crowd-response GTO trainer: sign in, play hands one at
// a time, and each reveal shows the GTO line PLUS how the whole crowd
// of players answered (the "How others played" breakdown).
//
// Boot sequence (strict order):
//   1. Load the scenario library + dictionary.
//   2. Initialize Firebase from src/config.js.
//   3. Resolve Google auth.
//   4. Route: signed in → the play loop; not signed in → the sign-in gate.
//
// The former async 1v1 duel mode (lobbies / join / waiting / wrap-up)
// was retired in the crowd-response pivot — `mountSoloView` IS the app
// now. Its duel-era view functions still exist in their modules but
// are no longer routed to.

import { loadScenarios, listScenarios } from "./scenarios.js";
import {
  initFirebase,
  initAuth,
  getCurrentUser,
  signOutUser,
  readUserProfile,
  saveKnowledgeLevel,
} from "./state.js";
import {
  mountSignInView,
  buildAvatar,
  mountKnowledgeView,
  knowledgeThreshold,
} from "./onboarding.js";
import { mountSoloView } from "./solo.js";
import { mountPlayersView } from "./players.js";
import { mountProfileView } from "./profile.js";
import { mountDatabaseView } from "./database.js";
import { isOwnerUser } from "./owner.js";
import { mountEquityCalculator } from "./equity-calculator.js";
import { loadDictionary, mountDictionaryView, setTooltipThreshold } from "./dictionary.js";
import { setOpenCallback as setTooltipOpenCallback } from "./tooltip.js";
import { FIREBASE_CONFIG } from "./config.js";
import { APP_VERSION } from "./version.js";

function setBootState(msg) {
  const el = document.getElementById("boot-state");
  if (el) el.textContent = msg;
}

function renderVersionStamp() {
  const el = document.getElementById("app-version");
  if (el) el.textContent = "v" + APP_VERSION;
}

function stripQuery() {
  return location.origin + location.pathname;
}

async function boot() {
  renderVersionStamp();
  const root = document.getElementById("app-root");
  try {
    setBootState("Loading scenarios…");
    await Promise.all([loadScenarios(), loadDictionary()]);
    if (listScenarios().length === 0) throw new Error("Scenario library is empty.");

    setBootState("Connecting…");
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith("PASTE_")) {
      renderConfigError(root);
      return;
    }
    await initFirebase(FIREBASE_CONFIG);

    setBootState("Checking sign-in…");
    const user = await initAuth();

    const params = new URLSearchParams(location.search);

    // Retired deep-link: `?game=<id>` pointed at the old duel view.
    // Strip it so an old share link just lands in the play loop.
    if (params.get("game")) {
      history.replaceState({}, "", stripQuery());
    }

    // `?dictionary[=term-id]` deep-link → opens the dictionary, optionally
    // scrolled to a specific entry. Tooltips also navigate here.
    const dictParam = params.get("dictionary");
    if (dictParam !== null) {
      const goDict = (termId) => mountDictionaryView(root, () => {
        history.replaceState({}, "", stripQuery());
        routeHome(root);
      }, { initialTermId: termId || (dictParam !== "1" ? dictParam : null) });
      setTooltipOpenCallback((id) => goDict(id));
      goDict();
      return;
    }

    // `?scenario=<id>` deep-link → go straight into the play loop pinned
    // on that scenario, regardless of sign-in state. Lets specific spots
    // be shared by URL.
    if (params.get("scenario")) {
      setTooltipOpenCallback((id) =>
        mountDictionaryView(root, () => goPlay(root), { initialTermId: id }));
      mountSoloView(root, () => {
        // Exit from a pinned solo session → drop the param, route home.
        history.replaceState({}, "", stripQuery());
        routeHome(root);
      });
      return;
    }

    routeHome(root, user);
  } catch (err) {
    console.error("Boot failed:", err);
    setBootState("Something went wrong on boot. See console.");
  }
}

// Route to the home experience: signed-in users go into the play
// loop (via the knowledge-onboarding gate on first sign-in);
// everyone else gets the sign-in gate.
function routeHome(root) {
  if (getCurrentUser()) {
    enterSignedIn(root);
  } else {
    goSignIn(root);
  }
}

// The signed-in user's self-reported poker-knowledge level. Set on
// sign-in (from their profile) or when they answer the first-time
// question; threaded into the play loop to weight scenario difficulty.
let knowledgeLevel = null;

// Whether the signed-in user is the app owner — resolved once on sign-in
// (owner.js hashes their email). Gates the owner-only Database menu.
let isOwner = false;

// Signed-in entry: read the user's profile. First time (no knowledge
// level recorded) → the knowledge question. Returning → apply their
// stored level to the dictionary-tooltip granularity, then play.
async function enterSignedIn(root) {
  let profile = null;
  try { profile = await readUserProfile(); } catch (err) { console.warn(err); }
  try { isOwner = await isOwnerUser(getCurrentUser()); } catch (_) { isOwner = false; }
  if (profile && profile.knowledgeLevel) {
    knowledgeLevel = profile.knowledgeLevel;
    try { setTooltipThreshold(knowledgeThreshold(knowledgeLevel)); } catch (_) {}
    goPlay(root);
  } else {
    goKnowledge(root);
  }
}

// First-sign-in knowledge question. The pick seeds the dictionary
// granularity + scenario-difficulty weighting, is saved to the
// user's profile, then → play.
function goKnowledge(root) {
  renderHeaderUser();
  mountKnowledgeView(root, async (levelId) => {
    knowledgeLevel = levelId;
    try { setTooltipThreshold(knowledgeThreshold(levelId)); } catch (_) {}
    try { await saveKnowledgeLevel(levelId); } catch (err) { console.warn(err); }
    goPlay(root);
  });
}

// The play loop — the whole app. mountSoloView runs the per-hand
// decide → reveal flow; the reveal records the answer to the crowd
// pool and shows the "How others played" breakdown. Exit signs out.
// The Players button (signed-in only) opens the roster screen.
// knowledgeLevel weights which scenarios surface.
function goPlay(root) {
  renderHeaderUser();
  setTooltipOpenCallback((id) =>
    mountDictionaryView(root, () => goPlay(root), { initialTermId: id }));
  const signedIn = !!getCurrentUser();
  mountSoloView(
    root,
    async () => {
      try { await signOutUser(); } catch (_) { /* ignore */ }
      location.assign(stripQuery());
    },
    signedIn ? () => goPlayers(root) : null,
    knowledgeLevel,
    (signedIn && isOwner) ? () => goDatabase(root) : null
  );
}

// Owner-only Database console — a survey of all recorded responses and
// comments. Reachable from the play header for the owner; Back returns
// to the play loop.
function goDatabase(root) {
  renderHeaderUser();
  setTooltipOpenCallback((id) =>
    mountDictionaryView(root, () => goDatabase(root), { initialTermId: id }));
  mountDatabaseView(root, () => goPlay(root));
}

// The Players screen — every player's library completion + accuracy.
// Reachable from the play header; Back returns to the play loop.
// Tapping a player opens their profile.
function goPlayers(root) {
  renderHeaderUser();
  setTooltipOpenCallback((id) =>
    mountDictionaryView(root, () => goPlayers(root), { initialTermId: id }));
  mountPlayersView(
    root,
    () => goPlay(root),
    (uid) => goProfile(root, uid)
  );
}

// A player's profile — aggression bias, per-concept accuracy,
// confidence calibration. Back returns to the Players screen.
function goProfile(root, uid) {
  renderHeaderUser();
  mountProfileView(root, uid, () => goPlayers(root));
}

// The sign-in gate. Once signed in → the play loop. Escape hatches for
// anonymous use (practice without recording, equity calculator,
// dictionary) bypass Firebase entirely.
function goSignIn(root) {
  renderHeaderUser(); // clears the header user when signed out
  const goDict = (termId) =>
    mountDictionaryView(root, () => goSignIn(root), { initialTermId: termId });
  setTooltipOpenCallback((id) => goDict(id));
  mountSignInView(
    root,
    () => enterSignedIn(root),
    () => mountSoloView(root, () => goSignIn(root)),
    () => mountEquityCalculator(root, () => goSignIn(root)),
    (termId) => goDict(termId)
  );
}

function renderConfigError(root) {
  while (root.firstChild) root.removeChild(root.firstChild);
  const div = document.createElement("section");
  div.className = "config-error";
  div.innerHTML = `
    <h2>Setup needed</h2>
    <p>Open <code>src/config.js</code> and paste your Firebase config values
    in the marked placeholders, then refresh.</p>
    <p>See the <a href="./README.md">README</a> for step-by-step instructions.</p>
  `;
  root.appendChild(div);
}

// Fill the header with the signed-in user's avatar + first name (or
// clear it when signed out).
function renderHeaderUser() {
  const el = document.getElementById("header-user");
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  const u = getCurrentUser();
  if (!u) return;
  const label = (u.displayName || u.email || "You").trim();
  const first = label.split(/\s+/)[0];
  el.appendChild(buildAvatar(label, u.photoURL));
  const nameEl = document.createElement("span");
  nameEl.className = "header-user-name";
  nameEl.textContent = first;
  el.appendChild(nameEl);
}

boot();
