# GTO Drill

A crowd-powered GTO poker trainer hosted on GitHub Pages. Players sign in,
play solver-verified poker scenarios, rate their confidence, and learn
alongside a crowd — seeing how their reads compare to the field and to
optimal play.

## Live URL

https://mondrianaire.github.io/gto-drill/

## Project structure

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

## Local development

```bash
npm start          # or: node scripts/dev-server.mjs
```

Opens at http://localhost:8000/. Requires Node 18+. No install step — uses
only Node built-in modules.

Local runs connect to the same production Firebase project as the deployed
site.

## Key conventions

- **Vanilla JS, no framework, no bundler.** All source is ES modules loaded
  directly by the browser. No transpilation.
- **Firebase for persistence.** Auth (Google sign-in) + Firestore for crowd
  response data. The Firebase SDK is loaded from CDN in `src/state.js`.
- **Mobile-first CSS.** 44px tap targets, `:active` press feedback,
  `prefers-reduced-motion` support, `@media (hover: hover)` gating.
- **Scenario IDs are permanent.** Never rename, delete, or reuse a
  `scenario_id` in `data/scenarios.json` — responses are keyed to them.
  See `docs/SCHEMA.md` for the full data contract.

## Session-resume hygiene — stale plan files

Plan-mode plans are saved to `~/.claude/plans/*.md` and are **never
auto-deleted** — not when implemented, not when merged. On every session
resume / context compaction the harness re-injects whatever it finds there as
a "continue working on it" reminder, so a finished plan keeps resurfacing as
phantom unfinished work. (Harness behavior, not specific to this repo.)

When a resume surfaces a plan file, **verify before acting** — compare it to
the repo and `git log`. If it already shipped, say so and delete the file
(`rm ~/.claude/plans/<name>.md`) rather than "resuming" it. After any plan
merges, delete its plan file as part of wrapping up — that is the only durable
fix.

## Documentation

- [docs/CHANGELOG.md](../docs/CHANGELOG.md) — Release history
- [docs/ROADMAP.md](../docs/ROADMAP.md) — Four-wave redesign plan
- [docs/SCENARIOS.md](../docs/SCENARIOS.md) — Scenario research & curation
- [docs/SCHEMA.md](../docs/SCHEMA.md) — Firestore data schema & preservation guarantees
- [docs/DESIGN-AUDIT.md](../docs/DESIGN-AUDIT.md) — Design audit index
