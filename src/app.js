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
      // callback mounts the router.
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
    const unsub = readGame(gameId, (game) => {
      if (!game) return;
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
  const remembered = readActiveGameId();
  if (remembered) {
    // Resume the active game. One-shot read to decide which view.
    let routed = false;
    const unsub = readGame(remembered, (game) => {
      if (routed || !game) return;
      routed = true;
      unsub();
      if (game.status === "complete") goWrapUp(remembered);
      else if (game.status === "waiting_for_opponent") goWaitingOrGame(remembered);
      else if (game.status === "cancelled") { writeActiveGameId(null); goLanding(); }
      else goInGame(remembered);
    });
    return;
  }
  goLanding();
}

boot();
