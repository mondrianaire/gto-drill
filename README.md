# GTO Drill

A crowd-powered GTO poker trainer. Sign in, play real poker scenarios, rate your confidence, and learn alongside a crowd — see how your reads stack up against the field and against solver-verified optimal play.

**Live:** https://mondrianaire.github.io/gto-drill/

---

## What it does

- **45 scenario library** — preflop through river, covering range advantage, bet sizing, bluff-catching, board texture, ICM, and more.
- **Confidence ratings** — rate how sure you are on every decision (1–5). The app surfaces where high-confidence disagreements live across the crowd.
- **Crowd breakdown** — after you answer, see how everyone else answered, who picked the GTO-optimal action, and where the blind spots are.
- **Villain ranges & equity tools** — explore opponent ranges with an interactive 13×13 hand matrix and a built-in equity calculator.
- **Comments & notes** — attach a note to any hand to capture your reasoning; comments are tied to the answer they were written about.
- **Mobile-first** — designed for phones with 44px tap targets, `:active` press feedback, and `prefers-reduced-motion` support.

## Quick start

```bash
npm start
# or directly:
node scripts/dev-server.mjs
```

Open http://localhost:8000/. Requires Node 18+. No install step needed — the dev server uses only Node built-in modules.

> **Note:** local runs connect to the same production Firebase project as the deployed site.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Release history |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Redesign roadmap — the four-wave plan |
| [docs/SCENARIOS.md](docs/SCENARIOS.md) | Scenario research & curation |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Firestore data schema & preservation guarantees |
| [docs/DESIGN-AUDIT.md](docs/DESIGN-AUDIT.md) | Design audit index |

## Project structure

```
index.html          Entry point
src/                Application modules (ES modules, no build step)
styles/app.css      Vanilla CSS, dark theme, mobile-first
data/               Scenario library (scenarios.json) and dictionary
scripts/            Dev server and tooling
icons/              PWA icons
firestore.rules     Firestore security rules
design-audit/       Design audit HTML reports
```

## Tech stack

- Vanilla JS (ES modules, no framework, no bundler)
- Firebase (Auth + Firestore) for persistence and crowd data
- GitHub Pages for hosting
- PWA-capable (service worker + web app manifest)
