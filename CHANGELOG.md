# Changelog

All notable changes to GTO Duel after its promotion from AutoBuilder
(2026-05-16) are recorded here.

## [Unreleased]

### Added
- Local development server (`scripts/dev-server.mjs`) — a zero-dependency Node
  static file server so the app can be run and tested locally over
  `http://localhost` before pushing to GitHub Pages. Run with `npm start` or
  `node scripts/dev-server.mjs`.
- `package.json` with `start` / `dev` scripts (no dependencies).
- "Local development" section in the README.
- 25 new GTO scenarios in `data/scenarios.json` (the library now holds 45),
  covering 4-bet pots, probe/delayed c-bets, ICM, blocker-driven river spots,
  rematch-relevant turn decisions, and more.
- Local game history (`src/history.js`): completed games are saved to the
  browser, and the landing screen shows a "Past games" list with a running
  tally (games played, your GTO accuracy, agreement rate). Each past game can
  be reopened from the landing screen.
- Rematch: the wrap-up screen now has a "Rematch — same settings" button that
  spins up a fresh game with the same round/handful configuration. The
  finished game is stamped with a pointer to the rematch so the other player
  sees a "Join the rematch" button on their wrap-up.
- A "Back to home" button on the wrap-up screen.
- A remove (✕) control on each row of the landing-screen "Past games" list.
  History is device-local and kept indefinitely — this is the only thing that
  clears it. Removing the last game hides the panel.
- Visual hand replay (`src/replay.js`): scenarios with structured `replay`
  data render as a poker table — felt, seated players with stacks, CSS-drawn
  cards (no image assets), board, pot, and a prev/next/autoplay stepper with a
  clickable action history. Wired into the in-game decision screen; scenarios
  without `replay` data still show the text description. The first 5 scenarios
  carry replay data (see the Replay schema). `scripts/replay-dev.html` renders
  every replay-enabled scenario standalone for visual review.

### Changed
- Sign-in is now **Google sign-in** instead of silent anonymous auth. On first
  open the app shows a "Continue with Google" gate; once signed in, the session
  persists and follows the account across devices. This is stage one of the
  pairing rework — it gives each player a stable identity so games and history
  are no longer tied to a single browser. (Requires the Google provider to be
  enabled in the Firebase Console, and the serving domain added to the
  Authorized domains list.) A leftover anonymous session from before this
  change is treated as "not signed in" so the Google gate still appears.
- Pairing is now a **lobby model** instead of share codes. Pressing **Start**
  opens a lobby; pressing **Join** shows a live list of open lobbies, each
  identified by the owner's Google name and photo — tap one to join,
  first-come-first-served. Share codes, the join link, and the `?join=` URL
  parameter are gone. The waiting screen drops the code/link UI and gains a
  "Cancel this game" button. Player display names and photos now come straight
  from the Google profile (the manual name field is removed).
  **Requires republishing `firestore.rules`** — listing open lobbies needs the
  new `allow list` rule for waiting games.
- Sign out is now a clean reset — it clears the active-game pointer in
  addition to ending the Firebase session, so nothing stale carries into the
  next session. Local "Past games" history is intentionally kept.
- The poker-hand replay now renders the **full six-handed table** and the
  **complete preflop betting round** — posted blinds and every fold around to
  the action, with folded players shown mucked. Blinds are modelled as posts
  so pot sizes are exact. (Applies to the 5 scenarios with replay data.)
- The in-game **decision screen is recomposed** (per the design audit): one
  hand at a time with a "Hand X of N" progress indicator and Back / Next
  navigation, instead of the whole handful stacked into one scroll. The replay
  table is the visual hero; the prose description is demoted to a collapsible
  ("The spot in words"); the action choice is the primary full-width control
  and confidence a lighter secondary strip; the note collapses until wanted.

### Removed
- The turn-notification subsystem (Web Push). Reliable browser-to-browser push
  delivery needs server-side infrastructure that doesn't fit this app's
  GitHub-Pages-only model. Removed `src/push.js`, `sw.js`, all service-worker
  registration, and the in-game notification controls.
- The `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` values from
  `src/config.js`. With notifications gone the key pair is unused; it is also
  no longer present in the current source. (The Firebase config remains — a
  Firebase web `apiKey` is public by design.)

### Fixed
- The app could hang on the boot screen ("Checking sign-in…") when the
  remembered active-game pointer in `localStorage` referred to a game the
  signed-in user can no longer read (a stale pointer left over from earlier
  testing / the anonymous-auth era). `readGame()` now reports listener errors
  and a missing document instead of silently dying, and the router treats an
  unreadable or missing remembered game as "no active game" — it drops the
  pointer and falls through to the home screen. A 9-second boot watchdog
  guarantees the app can never hang on the boot screen again.
