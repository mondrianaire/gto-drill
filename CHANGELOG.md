# Changelog

All notable changes to GTO Duel after its promotion from AutoBuilder
(2026-05-16) are recorded here.

## [Unreleased]

### ⚠ Firestore rules update required (v2026-05-20.63 and v2026-05-20.75)

Two cumulative rule changes need to be live in the Firebase Console
(Firestore Database → Rules → Publish):

1. **List query for participant's own active games** (v2026-05-20.63)
   — adds an OR branch on the existing `allow list` rule so the
   "Your active games" panel can read games where the caller is a
   participant.

2. **Delete on orphan lobbies** (v2026-05-20.75) — flips the previous
   `allow delete: if false` to allow any signed-in user to delete a
   game whose status is still `waiting_for_opponent`. Powers the
   new "×" delete button on the Join-screen lobby browser; in-progress
   and completed games still cannot be deleted.

Both changes live in the repo's `firestore.rules`. Paste the full file
into the Console and Publish — both the active-games panel and the
lobby delete button silently no-op until the rules are live.

### Changed
- **Dealer button pinned to the BTN seat.** The "D" disc was floating
  in an ambiguous spot on the felt. It's now rendered as a child of the
  BTN seat, hugging the seat corner that faces table centre — so it's
  unambiguously that seat's button on desktop and mobile alike. It
  stays bright when the BTN folds (folded seats now dim their content,
  not the whole seat box).
- **Suited / offsuit hand-classes as a bordered group.** "AKs" / "AKo"
  in prose now render as the two cards sitting on a red/black diagonal
  frame (red + black being the two playing-card colours). The frame's
  right side extends into a band that carries the suited/offsuit "s" /
  "o" marker — the marker is part of the border itself, not a separate
  card-like cell.

### Added
- **Running pot per street.** Each street row in the spot summary now
  shows a small right-aligned "Pot Nbb" tag (light grey on a dark pill)
  — the total pot at the end of that street — so the reader watches the
  pot grow PRE → FLOP → TURN → RIVER.

### Changed
- **Last action and the decision point are now distinct replay states.**
  The last villain action and the decision point are separately
  selectable: selecting the last action chip shows that action's badge
  on the table ("raises to 35bb"); selecting "← Action on HERO" shows
  the clean decision-time table state with no action badge. The replay
  gained a `topStep` (one beyond the last action) for this clean view,
  which is where it now settles by default.
- **Scenario headline replaces the share-link button.** Each scenario
  now shows a `Scenario #NNN` headline at the top of the hand card
  (the number is the atomic reference — the trailing digits of the
  scenario slug). The 🔗 permalink/copy-link icon is removed from the
  solo-practice header; the scenario number is the reference now. The
  Exit control is also now an always-rendered labelled button instead
  of a bare `←` arrow.

### Fixed
- **Playing-card suits + replay controls drawn as inline SVG.** The
  earlier text-glyph fix (U+FE0E selector) still wasn't reliable in
  every Chrome — Unicode ♠♥♦♣ and the media glyphs (⏮ ◀ ▶ ❚❚) render
  inconsistently across browsers/font configs. Card suits and the
  rewind / previous / play-pause / next replay controls are now drawn
  as inline SVG shapes (`fill: currentColor`), deterministic everywhere
  with no font dependency.

### Changed
- **Folded seats keep a bounding box.** A player who has folded now
  shows a faint grey container box + ring on the replay table (still
  dimmed) instead of collapsing to floating dimmed text — the seat's
  position on the table stays visible.
- **Players control is a labelled button.** The "see all players"
  control in the solo header is now a labelled "Players" button
  (matching the Exit button) instead of a 👥 emoji icon — both reliably
  rendered and a clearer tap target.
- **Replay table cluttered on mobile.** The seat layout (80px seats,
  46px corner insets) is tuned for the wide desktop table; on a phone
  the table collapses toward square and the seats overlapped each other,
  the board, and the pot. At ≤560px the seats shrink to 62px (with
  slightly smaller cards) and the four corner seats are pulled back out
  to the edges, so all six seats and the five-card board no longer
  overlap. The phone table is near-square, so the felt is drawn by a
  short full-width `::before` — a true horizontal capsule — instead of
  rounding the square box into a near-circle. The seat layout box keeps
  its full height; the corner seats overhang the felt's rounded ends,
  which is fine on a squeezed phone table.
- **Reveal-screen gap before the Lesson pill.** The reveal body sat
  flush against the hand-summary (replay table + spot-summary), so the
  💡 Lesson pill read as overlapping the last spot-summary row. The
  reveal now carries the same top-margin + hairline divider treatment
  as the decide form, clearly separating the GTO reveal from the hand
  summary above it.
- **Replay table seat positions.** The four "corner" seats were anchored
  4 px from the table edges, but the table is a capsule with a 140 px
  corner radius — the felt curves sharply away there, so the 80 px-wide
  seats overhung the rounded ends onto the page. Corner seats are now
  inset ~46 px from each edge, turning the six seats into a clean
  hexagon that sits fully on the felt.

### Added
- **Scenario INFO pane.** Scenarios that deviate from the default setup
  (100bb cash, Hero's cards shown) now display a blue heads-up pane
  above the hand summary, with one row per deviation stating *what* is
  different and *why* it matters. Detected: tournament hands, non-standard
  stack depth (e.g. 12/20/40bb effective), and spots where Hero's hole
  cards are deliberately hidden (range-vs-range decisions). Standard
  scenarios show no pane. The pane is decide-safe — it never reveals the
  GTO answer.
- **`SCHEMA.md`** — documents the Firestore `responses` / `users`
  collections and the preservation invariants (append-only, immutable
  `scenario_id`s, additive-only field changes) so development can
  continue safely while the live link collects real player data.

### Changed
- **Mobile pass 1 fixes** (from `design-audit/mobile-audit.html`).
  Five of the six audit findings, sequenced before the deeper table
  rework. **H-2** (replay-table seat overlap) is intentionally deferred
  to the table-rework pass since any CSS we'd ship would be redone.
  - **L-1.** The sign-in card no longer prints "GTO Duel" twice (the
    page header already shows it, same pattern as the landing screen).
  - **M-2.** The "Practice solo" and "Equity calculator" buttons on the
    sign-in screen are restructured as bold action label + muted
    subtext, so parenthetical disclaimers don't wrap awkwardly inside
    the click target.
  - **H-1.** The solo-practice header is now two-row: title + action
    buttons (Share / Exit) on row 1, running stats on row 2. At &lt;480 px
    the action buttons collapse to icon-only (🔗 / ←) so the row never
    overflows and the Exit label can't clip.
  - ~~**H-3** / **M-1**~~ (grid horizontal scroll + bigger cells) —
    initially shipped, then reverted. On the audience's actual phones
    (iPhone 15 / iPhone 17 Pro Max), the original cells were tight but
    tappable, and the horizontal-scroll workaround was a worse user
    experience than the problem it solved. Reverted in
    `2026-05-19.12-mobile-relax`. The original fluid grids stay on
    mobile.

### Added
- **🔗 Copy share link** button in the solo-practice header. Click to
  copy the current scenario's deep-link URL to the clipboard ("✓ Link
  copied!" briefly confirms). Send the link to a friend (or paste it
  into a chat for analysis) and they land directly on the same spot.
  Falls back to a read-only input field if the Clipboard API is blocked
  (insecure context, etc.).
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
