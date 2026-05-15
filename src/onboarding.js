// onboarding.js — section-5 (Pairing and Onboarding)
//
// Landing, create-game, join-game, and waiting-for-opponent screens.
// All backend writes go through section-2's adapter; this module never
// touches Firebase directly.

import { createGame, joinGame } from "./state.js";
import { notificationStatus } from "./push.js";

// -----------------------------------------------------------------------
// Small DOM helpers — vanilla, no framework. We keep things tactile.
// -----------------------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== false && v != null) {
        el.setAttribute(k, v);
      }
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

// -----------------------------------------------------------------------
// mountLandingView
// -----------------------------------------------------------------------

export function mountLandingView(container, onCreate, onJoin) {
  clear(container);
  const root = h(
    "section",
    { class: "landing" },
    h("h1", { class: "appname" }, "GTO Duel"),
    h(
      "p",
      { class: "tagline" },
      "An asynchronous head-to-head GTO quiz. You and one friend, the same gotcha hands, your confidence on each call. At the end, we surface where you both felt sure and disagreed."
    ),
    h(
      "div",
      { class: "landing-actions" },
      h("button", { class: "primary", onClick: () => onCreate() }, "Create a new game"),
      h("button", { class: "secondary", onClick: () => onJoin() }, "Join a game")
    ),
    h(
      "details",
      { class: "how-it-works" },
      h("summary", null, "How it works"),
      h(
        "ol",
        null,
        h("li", null, "One player creates a game, picks how many rounds and how many hands per round, and shares the join link."),
        h("li", null, "Each round, one of you plays the handful first. You see the spot, pick an action, rate your confidence 1-5, and (optionally) drop a note."),
        h("li", null, "The other player gets the same handful. Neither of you sees the other's answer until you've both submitted."),
        h("li", null, "When all rounds are done, you both see a wrap-up with your individual GTO accuracy, your agreement rate, and the disagreements where you were both most sure.")
      )
    )
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}

// -----------------------------------------------------------------------
// mountCreateGameView
// -----------------------------------------------------------------------

export function mountCreateGameView(container, onCreated) {
  clear(container);
  let busy = false;
  const errorBox = h("div", { class: "error", role: "alert" });
  const nameInput = h("input", { type: "text", id: "create-name", placeholder: "Your display name (e.g., Mom)", maxlength: "40" });
  const roundsInput = h("input", { type: "number", id: "create-rounds", min: "1", max: "10", value: "5" });
  const handfulInput = h("input", { type: "number", id: "create-handful", min: "1", max: "10", value: "3" });

  async function submit() {
    if (busy) return;
    busy = true;
    errorBox.textContent = "";
    const rounds = Math.max(1, Math.min(10, parseInt(roundsInput.value, 10) || 5));
    const handful = Math.max(1, Math.min(10, parseInt(handfulInput.value, 10) || 3));
    const name = (nameInput.value || "").trim() || "Player A";
    try {
      const { gameId } = await createGame(
        { rounds, handful_size: handful, scenario_seed: "" },
        name
      );
      onCreated(gameId);
    } catch (err) {
      console.error(err);
      errorBox.textContent =
        "Could not create the game. Check that Firebase is configured in src/config.js and that Firestore is enabled.";
      busy = false;
    }
  }

  const root = h(
    "section",
    { class: "create-game" },
    h("h2", null, "Create a new game"),
    h(
      "p",
      { class: "muted" },
      "Pick a display name, how many rounds you'll play, and how many hands per round. Defaults: 5 rounds of 3 hands."
    ),
    h(
      "form",
      { onSubmit: (e) => { e.preventDefault(); submit(); } },
      h("label", { for: "create-name" }, "Your display name"),
      nameInput,
      h("div", { class: "input-row" },
        h("div", null,
          h("label", { for: "create-rounds" }, "Rounds (1-10)"),
          roundsInput
        ),
        h("div", null,
          h("label", { for: "create-handful" }, "Hands per round (1-10)"),
          handfulInput
        )
      ),
      h("button", { type: "submit", class: "primary" }, "Create and get a share link"),
      errorBox
    )
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}

// -----------------------------------------------------------------------
// mountJoinGameView
// -----------------------------------------------------------------------

export function mountJoinGameView(container, prefilledCode, onJoined) {
  clear(container);
  let busy = false;
  const errorBox = h("div", { class: "error", role: "alert" });
  const codeInput = h("input", {
    type: "text",
    id: "join-code",
    placeholder: "Share code (e.g., AB3C7K)",
    maxlength: "8",
    value: prefilledCode || "",
    autocapitalize: "characters",
    autocomplete: "off",
  });
  const nameInput = h("input", { type: "text", id: "join-name", placeholder: "Your display name", maxlength: "40" });

  async function submit() {
    if (busy) return;
    busy = true;
    errorBox.textContent = "";
    const code = (codeInput.value || "").trim().toUpperCase();
    const name = (nameInput.value || "").trim() || "Player B";
    if (!code) {
      errorBox.textContent = "Please enter the share code your friend gave you.";
      busy = false;
      return;
    }
    try {
      const res = await joinGame(code, name);
      if (res && res.error) {
        if (res.error === "not_found") errorBox.textContent = "No game with that code. Double-check the code and try again.";
        else if (res.error === "game_full") errorBox.textContent = "That game already has two players.";
        else errorBox.textContent = "Could not join: " + res.error;
        busy = false;
        return;
      }
      onJoined(res.gameId);
    } catch (err) {
      console.error(err);
      errorBox.textContent = "Could not join. Check your connection.";
      busy = false;
    }
  }

  const root = h(
    "section",
    { class: "join-game" },
    h("h2", null, "Join a game"),
    h(
      "p",
      { class: "muted" },
      prefilledCode
        ? "Your friend's share code is filled in. Add your name and tap join."
        : "Enter the share code your friend sent you and pick a display name."
    ),
    h(
      "form",
      { onSubmit: (e) => { e.preventDefault(); submit(); } },
      h("label", { for: "join-code" }, "Share code"),
      codeInput,
      h("label", { for: "join-name" }, "Your display name"),
      nameInput,
      h("button", { type: "submit", class: "primary" }, "Join the game"),
      errorBox
    )
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}

// -----------------------------------------------------------------------
// mountWaitingForOpponentView
// -----------------------------------------------------------------------

export function mountWaitingForOpponentView(container, gameId, shareCode, joinUrl) {
  clear(container);
  const status = notificationStatus();
  const iosNeeded = status.ios_requires_home_screen_install;

  function copy(text, btn) {
    const oldText = btn.textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = oldText; }, 1500);
      })
      .catch(() => {
        // Fallback: select the text in a hidden input.
        const t = document.createElement("textarea");
        t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
        document.body.appendChild(t); t.select();
        try { document.execCommand("copy"); btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = oldText; }, 1500); }
        finally { document.body.removeChild(t); }
      });
  }

  const codeBtn = h("button", { class: "copy-btn" }, "Copy code");
  const urlBtn = h("button", { class: "copy-btn" }, "Copy link");
  codeBtn.addEventListener("click", () => copy(shareCode, codeBtn));
  urlBtn.addEventListener("click", () => copy(joinUrl, urlBtn));

  const root = h(
    "section",
    { class: "waiting" },
    h("h2", null, "Waiting for your opponent to join"),
    h(
      "p",
      { class: "muted" },
      "Send your friend the share code (or the join link). Once they join, your game starts."
    ),
    h("div", { class: "share-block" },
      h("label", null, "Share code"),
      h("div", { class: "share-row" },
        h("code", { class: "share-code" }, shareCode),
        codeBtn
      ),
      h("label", null, "Join link"),
      h("div", { class: "share-row" },
        h("code", { class: "share-url" }, joinUrl),
        urlBtn
      )
    ),
    iosNeeded
      ? h("div", { class: "ios-note" },
          h("strong", null, "On iPhone or iPad?"),
          h("p", null, "To get turn notifications on iOS, tap the Share icon in Safari, choose ", h("em", null, "Add to Home Screen"), ", then open GTO Duel from the new icon and enable notifications from there."))
      : null,
    h(
      "details",
      { class: "share-help" },
      h("summary", null, "How to share"),
      h(
        "ul",
        null,
        h("li", null, "Text the link to your friend. When they open it, the code is filled in automatically."),
        h("li", null, "Or have them open this app and paste the code on the Join screen."),
        h("li", null, "You can leave this page — when they join, you'll be notified (if you enabled notifications) or you'll see the game on next open.")
      )
    )
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}
