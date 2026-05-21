// app.js — top-level boot + router (section-6 Controller/Shell).
//
// GTO Duel is a crowd-response GTO trainer: sign in, play hands one at
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
} from "./state.js";
import { mountSignInView, buildAvatar } from "./onboarding.js";
import { mountSoloView } from "./solo.js";
import { mountEquityCalculator } from "./equity-calculator.js";
import { loadDictionary, mountDictionaryView } from "./dictionary.js";
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

// Route to the home experience: signed-in users go straight into the
// play loop; everyone else gets the sign-in gate.
function routeHome(root) {
  if (getCurrentUser()) {
    goPlay(root);
  } else {
    goSignIn(root);
  }
}

// The play loop — the whole app. mountSoloView runs the per-hand
// decide → reveal flow; the reveal records the answer to the crowd
// pool and shows the "How others played" breakdown. Exit signs out.
function goPlay(root) {
  renderHeaderUser();
  setTooltipOpenCallback((id) =>
    mountDictionaryView(root, () => goPlay(root), { initialTermId: id }));
  mountSoloView(root, async () => {
    try { await signOutUser(); } catch (_) { /* ignore */ }
    location.assign(stripQuery());
  });
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
    () => goPlay(root),
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
