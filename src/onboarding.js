// onboarding.js — section-5 (Pairing and Onboarding)
//
// Landing, create-game, join-game, and waiting-for-opponent screens.
// All backend writes go through section-2's adapter; this module never
// touches Firebase directly.

import { createGame, joinGame, signInWithGoogle, getCurrentUser, signOutUser } from "./state.js";
import { listHistory, historySummary, writeActiveGameId } from "./history.js";

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

// The standard four-colour Google "G" mark, inlined so the sign-in button
// needs no network request and works offline-friendly.
const GOOGLE_G_SVG =
  '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>' +
  '<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>' +
  '<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>' +
  '<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>' +
  "</svg>";

// -----------------------------------------------------------------------
// mountSignInView — the Google sign-in gate, shown before anything else
// when no user is signed in.
// -----------------------------------------------------------------------

export function mountSignInView(container, onSignedIn) {
  clear(container);
  const errorBox = h("div", { class: "error", role: "alert" });

  const btn = h("button", { type: "button", class: "google-btn" });
  btn.innerHTML = GOOGLE_G_SVG + "<span>Continue with Google</span>";

  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    errorBox.textContent = "";
    try {
      const user = await signInWithGoogle();
      if (user) onSignedIn();
      // user === null means a redirect sign-in began; the page is navigating
      // away to Google and will re-boot on return.
    } catch (err) {
      console.error(err);
      const code = err && err.code;
      if (code === "auth/popup-closed-by-user") {
        errorBox.textContent = "Sign-in was cancelled. Tap the button to try again.";
      } else if (code === "auth/unauthorized-domain") {
        errorBox.textContent =
          "This site isn't an authorized domain in Firebase yet. Add it under Authentication > Settings > Authorized domains.";
      } else {
        errorBox.textContent = "Could not sign in. Check your connection and try again.";
      }
      busy = false;
      btn.disabled = false;
    }
  });

  const root = h(
    "section",
    { class: "signin" },
    h("h1", { class: "appname" }, "GTO Duel"),
    h(
      "p",
      { class: "tagline" },
      "An asynchronous head-to-head GTO poker quiz. Sign in to start a game with a friend — your games follow your account on any device."
    ),
    btn,
    errorBox,
    h(
      "p",
      { class: "signin-note muted" },
      "Your Google account is used only to identify you to your opponent. Nothing is ever posted on your behalf."
    )
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
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
    ),
    buildHistorySection(),
    buildAccountBar()
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}

// A small "Signed in as … · Sign out" line for the landing screen.
function buildAccountBar() {
  const u = getCurrentUser();
  if (!u) return null;
  const signOutBtn = h("button", { type: "button", class: "link-btn" }, "Sign out");
  signOutBtn.addEventListener("click", () => {
    signOutBtn.disabled = true;
    signOutUser()
      .catch(() => {})
      .then(() => location.assign(location.origin + location.pathname));
  });
  return h(
    "p",
    { class: "account-bar muted" },
    "Signed in as " + (u.displayName || u.email || "you") + " · ",
    signOutBtn
  );
}

// Builds the "Past games" panel from local history, or returns null when
// no games have been completed on this device yet.
function buildHistorySection() {
  const history = listHistory();
  if (history.length === 0) return null;
  const summary = historySummary();
  const base = location.origin + location.pathname;

  const items = h("ul", { class: "history-list" });
  for (const r of history) {
    let when = "";
    try { when = new Date(r.completedAt).toLocaleDateString(); } catch {}
    const viewBtn = h("button", { class: "secondary history-view" }, "View");
    viewBtn.addEventListener("click", () => {
      writeActiveGameId(r.gameId);
      location.assign(base);
    });
    items.appendChild(h(
      "li",
      { class: "history-item" },
      h("div", { class: "history-main" },
        h("div", { class: "history-line" },
          h("strong", null, "vs " + (r.opponentName || "opponent")),
          h("span", { class: "muted" }, when)
        ),
        h("div", { class: "history-stats muted" },
          "You " + (r.myPct || 0) + "%  ·  " + (r.opponentName || "Them") + " " + (r.oppPct || 0) +
          "%  ·  agreed " + (r.agreePct || 0) + "%"
        )
      ),
      viewBtn
    ));
  }

  const summaryLine = summary
    ? h(
        "p",
        { class: "history-summary" },
        summary.games + (summary.games === 1 ? " game" : " games") +
        (summary.opponentName ? " vs " + summary.opponentName : "") +
        "  ·  your GTO accuracy " + summary.myPct + "%  ·  agreement " + summary.agreePct + "%"
      )
    : null;

  return h(
    "section",
    { class: "past-games" },
    h("h2", null, "Past games"),
    summaryLine,
    items
  );
}

// -----------------------------------------------------------------------
// mountCreateGameView
// -----------------------------------------------------------------------

export function mountCreateGameView(container, onCreated) {
  clear(container);
  let busy = false;
  const me = getCurrentUser();
  const errorBox = h("div", { class: "error", role: "alert" });
  const nameInput = h("input", { type: "text", id: "create-name", placeholder: "Your display name (e.g., Mom)", maxlength: "40", value: (me && me.displayName) || "" });
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
  const me = getCurrentUser();
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
  const nameInput = h("input", { type: "text", id: "join-name", placeholder: "Your display name", maxlength: "40", value: (me && me.displayName) || "" });

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
    h(
      "details",
      { class: "share-help" },
      h("summary", null, "How to share"),
      h(
        "ul",
        null,
        h("li", null, "Text the link to your friend. When they open it, the code is filled in automatically."),
        h("li", null, "Or have them open this app and paste the code on the Join screen."),
        h("li", null, "You can leave this page — the game is saved. It will pick up where you left off the next time you open the app.")
      )
    )
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}
