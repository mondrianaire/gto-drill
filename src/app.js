// app.js — top-level boot + router for GTO Duel (section-6 Controller/Shell).
//
// Boot sequence (strict order):
//   1. Load the scenario library.
//   2. Initialize Firebase from src/config.js.
//   3. Resolve Google auth — show the sign-in gate if not signed in.
//   4. Mount the router.
//
// Routing:
//   - If there's a remembered active game (localStorage), resume it.
//   - Else, route to LandingView (Start / Join).

import { loadScenarios, listScenarios } from "./scenarios.js";
import {
  initFirebase,
  initAuth,
  getCurrentUser,
  readGame,
} from "./state.js";
import {
  mountSignInView,
  mountLandingView,
  mountCreateGameView,
  mountJoinGameView,
  mountWaitingForOpponentView,
  buildAvatar,
} from "./onboarding.js";
import { mountInGameView, mountWrapUpView } from "./ui.js";
import { mountSoloView } from "./solo.js";
import { mountEquityCalculator } from "./equity-calculator.js";
import { FIREBASE_CONFIG } from "./config.js";
import { readActiveGameId, writeActiveGameId } from "./history.js";
import { APP_VERSION } from "./version.js";

function setBootState(msg) {
  const el = document.getElementById("boot-state");
  if (el) el.textContent = msg;
}

function renderVersionStamp() {
  const el = document.getElementById("app-version");
  if (el) el.textContent = "v" + APP_VERSION;
}

async function boot() {
  renderVersionStamp();
  const root = document.getElementById("app-root");
  try {
    setBootState("Loading scenarios…");
    await loadScenarios();
    if (listScenarios().length === 0) throw new Error("Scenario library is empty.");

    setBootState("Connecting…");
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith("PASTE_")) {
      renderConfigError(root);
      return;
    }
    await initFirebase(FIREBASE_CONFIG);

    setBootState("Checking sign-in…");
    const user = await initAuth();

    // `?scenario=<id>` deep-link → go straight to solo mode pinned on that
    // scenario, regardless of sign-in state. Lets us share specific spots
    // by URL ("look at this hand → live.url/?scenario=…").
    const params = new URLSearchParams(location.search);
    if (params.get("scenario")) {
      const goSignIn = () => mountSignInView(root, () => mountRouter(root), () => goSolo());
      const goSolo = () => mountSoloView(root, () => {
        // On exit from a pinned solo session, drop the param and go home.
        history.replaceState({}, "", location.origin + location.pathname);
        if (user) mountRouter(root);
        else goSignIn();
      });
      goSolo();
      return;
    }

    if (!user) {
      // Not signed in — show the Google sign-in gate. Once signed in, the
      // callback mounts the router. There's also a "Practice solo" escape
      // hatch and a standalone equity calculator that bypass Firebase
      // entirely for anonymous use.
      const goSignIn = () => mountSignInView(root, () => mountRouter(root), () => goSolo(), () => goCalc());
      const goSolo = () => mountSoloView(root, () => goSignIn());
      const goCalc = () => mountEquityCalculator(root, () => goSignIn());
      goSignIn();
      return;
    }

    mountRouter(root);
  } catch (err) {
    console.error("Boot failed:", err);
    setBootState("Something went wrong on boot. See console.");
  }
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

// Fill the header with the signed-in user's avatar + first name.
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

function mountRouter(root) {
  renderHeaderUser();

  function clearRoot() {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function goLanding() {
    clearRoot();
    writeActiveGameId(null);
    history.replaceState({}, "", stripQuery());
    mountLandingView(
      root,
      () => goCreate(),
      () => goJoin()
    );
  }

  function goCreate() {
    clearRoot();
    mountCreateGameView(root, (gameId) => {
      writeActiveGameId(gameId);
      goWaitingOrGame(gameId);
    });
  }

  function goJoin() {
    clearRoot();
    mountJoinGameView(root, (gameId) => {
      writeActiveGameId(gameId);
      goInGame(gameId);
    });
  }

  function goWaitingOrGame(gameId) {
    // After Start, show the waiting screen until an opponent joins
    // (status flips to in_progress), or jump straight to the in-game /
    // wrap-up view if the game is already further along.
    clearRoot();
    let mounted = null;
    let firstRender = true;
    const bail = () => {
      if (unsub) unsub();
      if (mounted) mounted.unmount();
      writeActiveGameId(null);
      goLanding();
    };
    const unsub = readGame(
      gameId,
      (game) => {
        if (!game) { bail(); return; } // game document is gone
        if (game.status === "waiting_for_opponent" && firstRender) {
          firstRender = false;
          if (mounted) mounted.unmount();
          mounted = mountWaitingForOpponentView(root, gameId);
        } else if (game.status === "in_progress" || game.status === "complete") {
          unsub();
          if (mounted) mounted.unmount();
          if (game.status === "complete") goWrapUp(gameId);
          else goInGame(gameId);
        } else if (game.status === "cancelled") {
          unsub();
          if (mounted) mounted.unmount();
          goLanding();
        }
      },
      () => bail() // can't read the game — drop it and go home
    );
  }

  function goInGame(gameId) {
    clearRoot();
    mountInGameView(root, gameId);
  }

  function goWrapUp(gameId) {
    clearRoot();
    mountWrapUpView(root, gameId);
  }

  function stripQuery() {
    return location.origin + location.pathname;
  }

  // Initial route resolution.
  const remembered = readActiveGameId();
  if (remembered) {
    // Resume the remembered game with a one-shot read. If it can't be read —
    // a stale pointer, no longer a participant, deleted, or a slow network —
    // drop the pointer and fall through to the home screen rather than
    // hanging forever on the boot screen.
    let settled = false;
    let unsub = null;
    const dropToLanding = () => {
      if (settled) return;
      settled = true;
      if (unsub) unsub();
      clearTimeout(watchdog);
      writeActiveGameId(null);
      goLanding();
    };
    const watchdog = setTimeout(dropToLanding, 9000);
    unsub = readGame(
      remembered,
      (game) => {
        if (settled) return;
        if (!game) { dropToLanding(); return; }
        settled = true;
        if (unsub) unsub();
        clearTimeout(watchdog);
        if (game.status === "complete") goWrapUp(remembered);
        else if (game.status === "waiting_for_opponent") goWaitingOrGame(remembered);
        else if (game.status === "cancelled") { writeActiveGameId(null); goLanding(); }
        else goInGame(remembered);
      },
      () => dropToLanding()
    );
    return;
  }
  goLanding();
}

boot();
