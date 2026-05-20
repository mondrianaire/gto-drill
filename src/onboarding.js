// onboarding.js — section-5 (Pairing and Onboarding)
//
// Landing, create-game, join-game, and waiting-for-opponent screens.
// All backend writes go through section-2's adapter; this module never
// touches Firebase directly.

import {
  createGame,
  joinGame,
  watchOpenLobbies,
  cancelLobby,
  watchMyActiveGames,
  cancelGame,
  signInWithGoogle,
  getCurrentUser,
  getCurrentUid,
  signOutUser,
} from "./state.js";
import { listHistory, historySummary, removeGame, writeActiveGameId } from "./history.js";

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

export function mountSignInView(container, onSignedIn, onSolo, onCalculator, onDictionary) {
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

  // Anonymous-solo escape hatch — same size as the Google button, muted.
  // Two-line label structure (bold action + muted subtext) so parenthetical
  // disclaimers don't wrap awkwardly inside the click target on narrow phones.
  const soloBtn = h(
    "button",
    { type: "button", class: "solo-btn" },
    h("span", { class: "alt-btn-label" }, "🃏  Practice solo"),
    h("span", { class: "alt-btn-sub" }, "No sign-in. No opponent. Random scenarios.")
  );
  soloBtn.addEventListener("click", () => {
    if (onSolo) onSolo();
  });

  // Standalone equity calculator — third main-menu option.
  const calcBtn = h(
    "button",
    { type: "button", class: "solo-btn calc-btn" },
    h("span", { class: "alt-btn-label" }, "🧮  Equity calculator"),
    h("span", { class: "alt-btn-sub" }, "Hole cards + board + range. Pure Monte Carlo.")
  );
  calcBtn.addEventListener("click", () => {
    if (onCalculator) onCalculator();
  });

  // Poker dictionary — fourth main-menu option.
  const dictBtn = h(
    "button",
    { type: "button", class: "solo-btn dict-btn" },
    h("span", { class: "alt-btn-label" }, "📖  Poker dictionary"),
    h("span", { class: "alt-btn-sub" }, "Browse GTO terms used throughout the app. Searchable.")
  );
  dictBtn.addEventListener("click", () => {
    if (onDictionary) onDictionary();
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
    soloBtn,
    calcBtn,
    dictBtn,
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
  // Live "Your active games" section — populated by a Firestore
  // subscription; the section hides itself when there are no active
  // games. Built first so we can pass its cleanup back in the unmount.
  const activeGames = buildActiveGamesSection();
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
      h("button", { class: "primary", onClick: () => onCreate() }, "Start a game"),
      h("button", { class: "secondary", onClick: () => onJoin() }, "Join a game")
    ),
    activeGames.el,
    h(
      "details",
      { class: "how-it-works" },
      h("summary", null, "How it works"),
      h(
        "ol",
        null,
        h("li", null, "One player presses Start and picks the game length. Their game opens as a lobby."),
        h("li", null, "The other player presses Join, sees the open game, and taps it — or follows the share link if you sent one."),
        h("li", null, "Each round you both get the same hands. You pick an action, rate your confidence 1-5, and (optionally) drop a note. Neither of you sees the other's answer until you've both submitted."),
        h("li", null, "When all rounds are done, you both see a wrap-up with your individual GTO accuracy, your agreement rate, and the disagreements where you were both most sure.")
      )
    ),
    buildHistorySection(),
    buildAccountBar()
  );
  container.appendChild(root);
  return { unmount: () => {
    try { activeGames.unsubscribe(); } catch (_) {}
    clear(container);
  }};
}

/**
 * Build the "Your active games" live panel. Subscribes to the user's
 * in-progress games; renders one row per game with Resume / Cancel
 * actions. Auto-hides when the user has no active games. Returns
 * { el, unsubscribe } so the landing view can clean up the listener
 * on unmount.
 */
function buildActiveGamesSection() {
  const base = location.origin + location.pathname;
  const list = h("ul", { class: "active-games-list" });
  const section = h("section", { class: "active-games", hidden: true },
    h("h2", null, "Your active games"),
    h("p", { class: "muted active-games-hint" },
      "Resume to keep playing, or cancel a stale game to close it out."),
    list
  );

  function render(games) {
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!games || games.length === 0) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const myUid = getCurrentUid();
    for (const g of games) {
      const isWaiting = g.status === "waiting_for_opponent";
      const opponent = g.opponentName
        ? "vs " + g.opponentName.split(/\s+/)[0]
        : "waiting to join";
      const roundLine = isWaiting
        ? "Round 1 of " + (g.totalRounds || 1) + " · 0 / " + (g.handfulSize || 0) + " played"
        : "Round " + (g.currentRoundIdx + 1) + " of " + (g.totalRounds || 1) +
          " · " + g.myInRound + " / " + (g.handfulSize || 0) + " played";

      // --- activity / "is the opponent coming back" interpretation ---
      // Use opponent's last submission if we have it, else fall back to
      // join time, else game creation. Compute days-ago; flag stalled
      // when >= 7 days with no opponent activity AND it's their turn.
      const oppFirst = g.opponentName ? g.opponentName.split(/\s+/)[0] : "Opponent";
      const myTurn = g.turnOwnerUid === myUid;
      let activityLine = "";
      let isStalled = false;
      if (isWaiting) {
        const ago = friendlyAgo(g.createdAt);
        activityLine = "Created " + ago + " · opponent hasn't joined yet";
      } else if (myTurn) {
        activityLine = "Your turn — opponent is waiting on you";
      } else {
        // It's their turn (or game just finished a round). Surface
        // when they last submitted.
        const oppLast = g.opponentLastSubmittedAt;
        if (oppLast) {
          const days = daysBetween(oppLast, new Date().toISOString());
          activityLine = oppFirst + " last submitted " + friendlyAgo(oppLast);
          if (days >= 7) isStalled = true;
        } else {
          // Opponent joined but never submitted.
          const days = daysBetween(g.lastActivityAt || g.createdAt, new Date().toISOString());
          activityLine = oppFirst + " joined but hasn't played a hand yet";
          if (days >= 7) isStalled = true;
        }
      }

      const resumeBtn = h("button", { type: "button", class: "primary active-games-resume" }, "Resume");
      resumeBtn.addEventListener("click", () => {
        writeActiveGameId(g.gameId);
        location.assign(base);
      });

      const cancelBtn = h("button", { type: "button", class: "secondary active-games-cancel" }, "Cancel");
      cancelBtn.addEventListener("click", async () => {
        const ok = confirm("Cancel game " + g.gameId + "? It can't be resumed once cancelled.");
        if (!ok) return;
        cancelBtn.disabled = true;
        resumeBtn.disabled = true;
        try { await cancelGame(g.gameId); } catch (err) { console.warn(err); }
        // Snapshot listener will re-render and drop this row.
      });

      const statusBadge = h("span", { class: "active-games-status" + (isWaiting ? " is-waiting" : " is-progress") },
        isWaiting ? "Waiting" : "In progress");
      const stalledBadge = isStalled
        ? h("span", { class: "active-games-status is-stalled", title: "No opponent activity for 7+ days" }, "Stalled")
        : null;

      list.appendChild(h("li", { class: "active-games-item" + (isStalled ? " is-stalled" : "") },
        h("div", { class: "active-games-main" },
          h("div", { class: "active-games-line" },
            h("strong", null, g.gameId),
            statusBadge,
            stalledBadge,
            h("span", { class: "muted active-games-vs" }, opponent)
          ),
          h("div", { class: "active-games-progress muted" }, roundLine),
          h("div", { class: "active-games-activity muted" }, activityLine)
        ),
        h("div", { class: "active-games-actions" },
          resumeBtn,
          cancelBtn
        )
      ));
    }
  }

  // ----- timestamp helpers -----
  // Both accept ISO strings; resilient to null/undefined.
  function daysBetween(aIso, bIso) {
    if (!aIso || !bIso) return 0;
    const a = Date.parse(aIso);
    const b = Date.parse(bIso);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.abs(b - a) / 86400000;
  }
  function friendlyAgo(iso) {
    if (!iso) return "recently";
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return "recently";
    const minutes = ms / 60000;
    if (minutes < 60) {
      const m = Math.max(1, Math.round(minutes));
      return m === 1 ? "1 minute ago" : m + " minutes ago";
    }
    const hours = minutes / 60;
    if (hours < 24) {
      const h = Math.round(hours);
      return h === 1 ? "1 hour ago" : h + " hours ago";
    }
    const days = hours / 24;
    if (days < 30) {
      const d = Math.round(days);
      return d === 1 ? "1 day ago" : d + " days ago";
    }
    const months = days / 30;
    if (months < 12) {
      const mo = Math.round(months);
      return mo === 1 ? "1 month ago" : mo + " months ago";
    }
    return "over a year ago";
  }

  let unsub = () => {};
  try {
    unsub = watchMyActiveGames((games, err) => {
      if (err) { console.warn("watchMyActiveGames err:", err); return; }
      render(games);
    });
  } catch (err) {
    console.warn("active-games subscribe failed:", err);
  }
  return { el: section, unsubscribe: unsub };
}

// A small "Signed in as … · Sign out" line for the landing screen.
function buildAccountBar() {
  const u = getCurrentUser();
  if (!u) return null;
  const signOutBtn = h("button", { type: "button", class: "link-btn" }, "Sign out");
  signOutBtn.addEventListener("click", () => {
    signOutBtn.disabled = true;
    // Clean reset: drop the active-game pointer so nothing stale carries
    // into the next session, then sign out and reload.
    writeActiveGameId(null);
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
// no games have been completed on this device yet. History is device-local
// and permanent — each row carries a remove control, the only way it clears.
function buildHistorySection() {
  if (listHistory().length === 0) return null;
  const base = location.origin + location.pathname;

  const items = h("ul", { class: "history-list" });
  const summaryLine = h("p", { class: "history-summary" });
  const section = h("section", { class: "past-games" },
    h("h2", null, "Past games"),
    summaryLine,
    items
  );

  function refreshSummary() {
    const s = historySummary();
    summaryLine.textContent = s
      ? s.games + (s.games === 1 ? " game" : " games") +
        (s.opponentName ? " vs " + s.opponentName : "") +
        "  ·  your GTO accuracy " + s.myPct + "%  ·  agreement " + s.agreePct + "%"
      : "";
  }

  for (const r of listHistory()) {
    let when = "";
    try { when = new Date(r.completedAt).toLocaleDateString(); } catch {}

    const viewBtn = h("button", { class: "secondary history-view" }, "View");
    viewBtn.addEventListener("click", () => {
      writeActiveGameId(r.gameId);
      location.assign(base);
    });

    const removeBtn = h("button", {
      class: "link-btn history-remove",
      title: "Remove from history",
      "aria-label": "Remove this game from history",
    }, "✕");

    const li = h(
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
      viewBtn,
      removeBtn
    );

    removeBtn.addEventListener("click", () => {
      removeGame(r.gameId);
      li.remove();
      if (listHistory().length === 0) section.remove();
      else refreshSummary();
    });

    items.appendChild(li);
  }

  refreshSummary();
  return section;
}

// -----------------------------------------------------------------------
// mountCreateGameView
// -----------------------------------------------------------------------

export function mountCreateGameView(container, onCreated) {
  clear(container);
  let busy = false;
  const errorBox = h("div", { class: "error", role: "alert" });
  const roundsInput = h("input", { type: "number", id: "create-rounds", min: "1", max: "10", value: "5" });
  const handfulInput = h("input", { type: "number", id: "create-handful", min: "1", max: "10", value: "3" });

  async function submit() {
    if (busy) return;
    busy = true;
    errorBox.textContent = "";
    const rounds = Math.max(1, Math.min(10, parseInt(roundsInput.value, 10) || 5));
    const handful = Math.max(1, Math.min(10, parseInt(handfulInput.value, 10) || 3));
    try {
      const { gameId } = await createGame({ rounds, handful_size: handful });
      onCreated(gameId);
    } catch (err) {
      console.error(err);
      errorBox.textContent = "Could not start the game. Check your connection and try again.";
      busy = false;
    }
  }

  const root = h(
    "section",
    { class: "create-game" },
    h("h2", null, "Start a game"),
    h(
      "p",
      { class: "muted" },
      "Choose how many rounds you'll play and how many hands per round, then start. Your game opens as a lobby for someone to join. Defaults: 5 rounds of 3 hands."
    ),
    h(
      "form",
      { onSubmit: (e) => { e.preventDefault(); submit(); } },
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
      h("button", { type: "submit", class: "primary" }, "Start the game"),
      errorBox
    )
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}

// -----------------------------------------------------------------------
// mountJoinGameView — a live list of open lobbies
// -----------------------------------------------------------------------

// Builds an avatar element: the player's Google photo, or a clean initials
// circle when they have no photo set.
export function buildAvatar(name, photoURL) {
  if (photoURL) {
    return h("img", { class: "avatar", src: photoURL, alt: "", referrerpolicy: "no-referrer" });
  }
  const initial = ((name || "?").trim()[0] || "?").toUpperCase();
  return h("div", { class: "avatar avatar-fallback" }, initial);
}

// Builds a lobby-list card for the Join screen — owner avatar, name,
// and game shape (rounds × hands).
function buildLobbyCard(lobby, onJoin) {
  const card = h(
    "button",
    { type: "button", class: "lobby-card" },
    buildAvatar(lobby.ownerName, lobby.ownerPhoto),
    h("div", { class: "lobby-main" },
      h("strong", null, lobby.ownerName),
      h("span", { class: "muted lobby-detail" },
        lobby.rounds + (lobby.rounds === 1 ? " round" : " rounds") + " · " +
        lobby.handfulSize + " hands each")
    ),
    h("span", { class: "lobby-go" }, "Join")
  );
  card.addEventListener("click", () => onJoin(card));
  return card;
}

/**
 * Open-lobby browser. Lists every waiting_for_opponent game (other
 * than the viewer's own) and lets the user tap one to join. Stale
 * lobbies older than the staleness threshold are filtered client-side
 * so dead test artifacts (deploytest, verifybot, etc.) don't clutter
 * the list. Includes a Back-to-home button — the previous version was
 * a dead-end with no way to exit.
 */
export function mountJoinGameView(container, onJoined, onBack) {
  clear(container);
  // Lobbies older than this with no opponent activity are considered
  // stale and filtered out client-side. Mirrors the active-games panel
  // staleness threshold (7 days).
  const STALE_DAYS = 7;

  let unsub = null;
  let busy = false;

  const statusEl = h("p", { class: "muted" }, "Looking for open games…");
  const listEl = h("div", { class: "lobby-list" });
  const errorBox = h("div", { class: "error", role: "alert" });
  const backBtn = h("button", { type: "button", class: "secondary join-back" }, "← Back to home");
  backBtn.addEventListener("click", () => { if (!busy && onBack) onBack(); });

  async function joinLobby(lobby, card) {
    if (busy) return;
    busy = true;
    card.disabled = true;
    backBtn.disabled = true;
    errorBox.textContent = "";
    try {
      const res = await joinGame(lobby.gameId);
      if (res && res.error) {
        if (res.error === "game_full") errorBox.textContent = "Someone else joined that game first — pick another.";
        else if (res.error === "cancelled" || res.error === "not_found") errorBox.textContent = "That game is no longer open.";
        else errorBox.textContent = "Couldn't join: " + res.error;
        busy = false;
        card.disabled = false;
        backBtn.disabled = false;
        return;
      }
      if (unsub) unsub();
      onJoined(res.gameId);
    } catch (err) {
      console.error(err);
      errorBox.textContent = "Couldn't join. Check your connection and try again.";
      busy = false;
      card.disabled = false;
      backBtn.disabled = false;
    }
  }

  function isStale(lobby) {
    if (!lobby.createdAt) return false;
    const ms = Date.now() - Date.parse(lobby.createdAt);
    if (Number.isNaN(ms)) return false;
    return ms / 86400000 > STALE_DAYS;
  }

  function render(lobbies, err) {
    clear(listEl);
    if (err) {
      statusEl.textContent = "";
      errorBox.textContent =
        "Couldn't load open games. If the Firestore rules were just updated, make sure they've been published in the Firebase Console.";
      return;
    }
    errorBox.textContent = "";
    const fresh = (lobbies || []).filter((l) => !isStale(l));
    const dropped = (lobbies || []).length - fresh.length;
    if (fresh.length === 0) {
      statusEl.textContent = dropped > 0
        ? "No open games right now (" + dropped + " stale lobbies hidden). Ask someone to press Start — or start one yourself."
        : "No open games right now. Ask someone to press Start — or start one yourself.";
      return;
    }
    const main = fresh.length === 1 ? "1 open game" : fresh.length + " open games";
    statusEl.textContent = dropped > 0
      ? main + " · " + dropped + " stale hidden"
      : main;
    for (const lobby of fresh) {
      listEl.appendChild(buildLobbyCard(lobby, (card) => joinLobby(lobby, card)));
    }
  }

  unsub = watchOpenLobbies((lobbies, err) => render(lobbies, err));

  const root = h(
    "section",
    { class: "join-game" },
    h("h2", null, "Join a game"),
    h("p", { class: "muted" }, "Tap an open game to join it. First come, first served."),
    statusEl,
    listEl,
    errorBox,
    h("div", { class: "join-actions" }, backBtn)
  );
  container.appendChild(root);
  return {
    unmount: () => {
      if (unsub) unsub();
      clear(container);
    },
  };
}

// -----------------------------------------------------------------------
// mountWaitingForOpponentView — shown to the lobby owner until someone joins
// -----------------------------------------------------------------------

export function mountWaitingForOpponentView(container, gameId) {
  clear(container);
  const base = location.origin + location.pathname;

  const cancelBtn = h("button", { type: "button", class: "secondary" }, "Cancel this game");
  cancelBtn.addEventListener("click", async () => {
    cancelBtn.disabled = true;
    try { await cancelLobby(gameId); } catch (err) { console.warn(err); }
    writeActiveGameId(null);
    location.assign(base);
  });

  const root = h(
    "section",
    { class: "waiting" },
    h("h2", null, "Waiting for an opponent"),
    h(
      "p",
      { class: "muted" },
      "Your game is open in the lobby. As soon as someone taps Join, you'll both start on the same hands."
    ),
    h(
      "p",
      { class: "muted" },
      "You can leave this page — the game is saved and will resume the next time you open the app."
    ),
    cancelBtn
  );
  container.appendChild(root);
  return { unmount: () => clear(container) };
}
