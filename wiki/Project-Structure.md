# Project Structure

GTO Drill is a static web app with no build step. The repo root *is* the deployable artifact — push to `main` and GitHub Pages serves it.

---

## Source tree

```
index.html            Entry point (static, no build step)
src/                  Application modules (vanilla ES modules)
  app.js              Boot + router
  state.js            Firebase adapter (only file importing firebase-app)
  onboarding.js       Landing / sign-in views
  solo.js             Solo play mode (the main flow)
  ui.js               In-game + reveal + wrap-up views
  scenarios.js        Scenario library API
  replay.js           Hand replay renderer
  equity.js           Equity calculator
  equity-panel.js     Equity tester UI
  range-picker.js     13×13 hand matrix
  profile.js          Player profile
  flow.js             Round/phase state machine
  stats.js            Wrap-up math
  history.js          Local play history
  dictionary.js       Poker term definitions + tooltips
  share.js            Share functionality
  concepts.js         GTO concept tags
  config.js           Firebase + VAPID config
  version.js          App version stamp
  owner.js            Owner utilities
  players.js          Player management
  tooltip.js          Tooltip system
styles/app.css        Vanilla CSS, dark theme, mobile-first
data/scenarios.json   45-scenario GTO library
data/dictionary.json  Poker term definitions
scripts/              Dev server and tooling
icons/                PWA icons (SVG)
firestore.rules       Firestore security rules (paste into Firebase Console)
design-audit/         Design audit HTML reports
docs/                 Product documentation (changelog, roadmap, schema, scenarios)
```

---

## Key modules

### `app.js` — Boot + router
The entry point. Initializes Firebase, checks auth state, and routes between the onboarding, solo play, and profile views.

### `state.js` — Firebase adapter
The **only** file that imports the Firebase SDK. Every other module goes through `state.js` to read/write Firestore or check auth. This keeps the Firebase dependency contained.

### `solo.js` — Solo play mode
The main game flow. Picks a scenario, renders the decision screen, records the player's answer, and hands off to the reveal.

### `ui.js` — Views
Builds all the in-game UI: the decision screen, the reveal with crowd breakdown, and the wrap-up summary. The largest module.

### `replay.js` — Hand replay
Renders the animated oval poker table — seats, cards, chips, action markers — street by street. Also builds the compact-view components (runout strip, hero strip, action timeline).

### `equity.js` + `equity-panel.js` — Equity tools
Monte Carlo equity calculator and the "Test it" UI panel. Given a hero hand and a villain range (built on the hand matrix), simulates random boards and reports equity.

### `range-picker.js` — Hand matrix
The interactive 13×13 grid of all 169 starting hand classes. Players toggle hand classes on/off to build a villain range, which feeds into the equity calculator.

### `scenarios.js` — Scenario library
Loads `data/scenarios.json`, provides the weighted picker (balancing by concept tag and player history), and exposes the scenario API.

### `flow.js` — State machine
Manages the round lifecycle: onboarding → scenario selection → decide → reveal → wrap-up. Tracks which phase the player is in and handles transitions.

---

## Conventions

- **No framework, no bundler.** All source is ES modules loaded directly by the browser via `<script type="module">`.
- **Firebase from CDN.** The Firebase SDK is loaded from the Google CDN in `state.js`, not installed via npm.
- **Mobile-first CSS.** A single `styles/app.css` file with dark theme, 44px tap targets, `:active` press feedback, `prefers-reduced-motion` support, and `@media (hover: hover)` gating.
- **Permanent scenario IDs.** `scenario_id` values in `data/scenarios.json` are permanent identifiers. Never rename, delete, or reuse them — player responses are keyed to them. See [[Data Schema and Preservation]].
