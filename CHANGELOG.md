# Changelog

All notable changes to GTO Duel after its promotion from AutoBuilder
(2026-05-16) are recorded here.

## [Unreleased]

### Added
- **Accumulating Run + trials-per-click selector** on every equity
  surface (per-scenario panel + standalone calculator). The Run button
  now accumulates: each click adds the selected trial count (5,000 /
  25,000 / 100,000) to the running totals, so the user can dial in
  precision with extra clicks. Result shows total trials (with commas)
  + W/T/L + a "reset" link. Any input change (hero / board / villain
  range) resets the accumulator automatically.
- **Standalone equity calculator** — a third main-menu button below
  "Practice solo" opens a freestanding Monte Carlo tool: pick 2 hero
  cards from a 52-card grid (hero ring blue), pick 0–5 board cards from
  the same grid (board ring amber), pick a villain range on the 13×13,
  Run. No Firebase, no scenario context. Useful for ad-hoc equity
  questions outside of any specific scenario.
- **`?scenario=<id>` deep-link** routes straight into solo mode pinned
  on that scenario — useful for sharing spots by URL and for inspecting
  any single scenario without depending on the random shuffle.
- **Hero-hand picker for the two range-perspective scenarios.** The
  scenarios where `replay.hero_cards` is null (BTN vs BB 3-bet pot c-bet
  decision, SB vs BTN turn overbet) now mount a compact 4-suit × 13-rank
  card-select grid in the equity panel. Click two cards to set your
  sample hero hand — the Run button enables and the rest of the panel
  works identically to the pinned-hero scenarios. Board cards are
  disabled in the grid; FIFO replacement when both slots are taken.
- **App version stamp** in the header (`v2026-05-19.4-...`) so you can
  tell at a glance which build you're on. If GitHub Pages serves a
  stale cache (~10 min TTL) the version will still read the old build —
  that's the cue to hard-refresh (Ctrl+Shift+R / Cmd+Shift+R). Bumped
  every commit in `src/version.js`.
- **Solo practice mode** — a "🃏 Practice solo (no sign-in, no
  opponent)" button below the Google sign-in button on the gate screen.
  No Firebase, no opponent, no progress saved across sessions: one
  random scenario at a time, the full decide → reveal flow with the GTO
  explanation, range chips, and Monte Carlo equity panel all working
  identically to multiplayer. Running stats show "Hands N · GTO
  accuracy X%" at the top, and an Exit button returns to the sign-in
  screen. The scenario picker avoids immediate repeats (sliding window
  of ~10 recent hands).
- **Inline range chips in GTO prose**. Whenever a scenario's GTO
  explanation calls out a named villain range ("BB's 3-bet range", "BTN's
  c-bet range", "CO's polar c-betting range" …), that phrase is now an
  underlined 🎲 chip you can click — the Monte Carlo equity panel opens
  below the explanation with that range pre-selected on the 13×13 grid.
  Hit Run to see the equity. Click another chip and the panel switches
  to that range without remounting. **40 of the 45 scenarios** carry
  range annotations (45 named ranges total); the remaining 5 scenarios
  are pure hero-side strategy spots with no explicit villain-range
  reference.
- The equity engine now also understands fully-specified 2-card combos
  like `AcKc` / `Th9h` (not just hand-class labels), so range
  annotations can pin down specific suited holdings on a textured board
  (the heart-flush combos, etc.).
- **Monte Carlo equity tool (the "Test it" button)**. On the per-hand reveal,
  the previously-stubbed "🎲 Test it — equity vs a range" button now opens a
  full equity calculator. The user picks a villain range on a 13×13 hand
  grid (with `Any two` / `Pairs` / `Broadways` / `Clear` presets), and the
  app runs a 5000-trial Monte Carlo against the scenario's hero hand + the
  current board, displaying hero equity with a hero/villain split bar,
  win/tie/loss counts, and timing. Engine (`src/equity.js`) verified
  against full enumeration (1.7M boards) and against eight known
  benchmark matchups. Scenarios without a pinned `hero_cards` show a
  friendly notice (a hand-picker for those is coming next).
- Every one of the 45 GTO scenarios now has structured `replay` data — the
  visual poker-table replay is no longer limited to the first 5. Each scenario
  plays out the full six-handed table and complete betting line up to the
  decision point. (Also corrected a card clash in scenario 043, where the
  hero's hand collided with a board card.)
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
- **Hero/Villain visual identity.** The hero (blue) and the live opponent(s)
  (amber) now share one colour identity across the whole game. On the replay
  table the villain seat(s) get an amber ring and amber position label;
  in the GTO prose the matching position chips are tinted to match, and the
  words "Hero"/"Villain" pick up the same colours.
- **Iconified GTO prose.** Scenario descriptions and GTO explanations now
  render card codes (`Kh 7d 2s`) as inline mini-cards and position names
  (`BTN`, `BB`, …) as chips, instead of as plain text.
- Playing-card rank/suit now sit in fixed flex-centred boxes, so the differing
  metrics of the Unicode suit glyphs (♣♦♥♠) no longer nudge them off-centre.
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
- **Per-hand feedback.** Each hand now plays in two beats: decide (pick your
  action + confidence, then "Lock in & see GTO"), then reveal — the GTO line,
  whether you matched it, and the GTO defence, immediately, hand by hand,
  instead of only at the end of the game. When your opponent has already
  played a hand, the reveal also shows their call, the agreement, and the
  confidence gap. A "Test it" button stubs the upcoming Monte Carlo equity
  tool. Opponent-answer gating moved from document-level redaction to
  per-hand in the UI (an answer is shown only after you have locked yours).

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
