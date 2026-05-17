// app.js — top-level boot + router for GTO Duel (section-6 Controller/Shell).
//
// Boot sequence (strict order):
//   1. Load the scenario library.
//   2. Initialize Firebase from src/config.js.
//   3. Sign in anonymously.
//   4. Mount the router.
//
// Routing:
//   - If ?join=<code> is in the URL and no active game state, route to JoinView.
//   - Else if there's a remembered active game (localStorage), route to InGameView.
//   - Else, route to LandingView.

import { loadScenarios, listScenarios } from "./scenarios.js";
import {
  initFirebase,
  initAuth,
} from "./state.js";
import {
  mountSignInView,
  mountLandingView,
  mountCreateGameView,
  mountJoinGameView,
  mountWaitingForOpponentView,
} from "./onboarding.js";
import { mountInGameView, mountWrapUpView } from "./ui.js";
import { readGame } from "./state.js";
import { FIREBASE_CONFIG } from "./config.js";
import { readActiveGameId, writeActiveGameId } from "./history.js";

function setBootState(msg) {
  const el = document.getElementById("boot-state");
  if (el) el.textContent = msg;
}

async function boot() {
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
    if (!user) {
      // Not signed in — show the Google sign-in gate. Once signed in, the
      // callback mounts the router (which honours any ?join= code in the URL).
      mountSignInView(root, () => mountRouter(root));
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

function mountRouter(root) {
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
      () => goJoin(null)
    );
  }

  function goCreate() {
    clearRoot();
    mountCreateGameView(root, (gameId) => {
      writeActiveGameId(gameId);
      goWaitingOrGame(gameId);
    });
  }

  function goJoin(prefilledCode) {
    clearRoot();
    mountJoinGameView(root, prefilledCode, (gameId) => {
      writeActiveGameId(gameId);
      goInGame(gameId);
    });
  }

  function goWaitingOrGame(gameId) {
    // After create, we either show the waiting-for-opponent share screen
    // (status === waiting_for_opponent) or jump to the in-game view (if
    // the opponent has already joined via the URL).
    clearRoot();
    // Subscribe long enough to read the initial state.
    let mounted = null;
    let firstRender = true;
    const unsub = readGame(gameId, (game) => {
      if (!game) return;
      if (game.status === "waiting_for_opponent" && firstRender) {
        firstRender = false;
        if (mounted) mounted.unmount();
        const shareCode = game.gameId;
        const joinUrl = `${location.origin}${location.pathname}?join=${encodeURIComponent(shareCode)}`;
        mounted = mountWaitingForOpponentView(root, gameId, shareCode, joinUrl);
      } else if (game.status === "in_progress" || game.status === "complete") {
        unsub();
        if (mounted) mounted.unmount();
        if (game.status === "complete") goWrapUp(gameId);
        else goInGame(gameId);
      }
    });
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
  const params = new URLSearchParams(location.search);
  const joinCode = params.get("join");
  if (joinCode) {
    goJoin(joinCode.toUpperCase());
    return;
  }
  const remembered = readActiveGameId();
  if (remembered) {
    // Resume the active game.
    // Use a one-shot read to decide which view: status -> in-game or wrap-up.
    let routed = false;
    const unsub = readGame(remembered, (game) => {
      if (routed || !game) return;
      routed = true;
      unsub();
      if (game.status === "complete") goWrapUp(remembered);
      else if (game.status === "waiting_for_opponent") goWaitingOrGame(remembered);
      else goInGame(remembered);
    });
    return;
  }
  goLanding();
}

boot();
