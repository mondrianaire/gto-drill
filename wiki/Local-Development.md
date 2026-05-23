# Local Development

GTO Drill has no build step, no install step, and no dependencies beyond Node.

---

## Quick start

```bash
npm start
# or directly:
node scripts/dev-server.mjs
```

Open **http://localhost:8000/**. Requires **Node 18+**.

That's it. The dev server uses only Node built-in modules — no `npm install` needed.

---

## How it works

The dev server (`scripts/dev-server.mjs`) is a minimal static file server that serves `index.html` and all assets. The app is vanilla JS with ES modules loaded directly by the browser — no transpilation, no bundling, no hot-module replacement. Edit a file, refresh the browser.

---

## Firebase connection

Local runs connect to the **same production Firebase project** (`gto-poker-qui`) as the deployed site. This means:

- You see real crowd data while developing
- Any answers you submit locally go into the production database
- Auth uses the same Google sign-in flow

There is no separate staging database. This is safe because code deploys (pushing HTML/JS/CSS to GitHub Pages) never touch stored data — see [[Data Schema and Preservation]] for the full contract.

---

## Project layout

```
index.html          Entry point (loaded directly, no build)
src/                Application modules (vanilla ES modules)
styles/app.css      Vanilla CSS, dark theme, mobile-first
data/               Scenario library + poker dictionary
scripts/            Dev server
icons/              PWA icons (SVG)
firestore.rules     Firestore security rules
design-audit/       Design audit HTML reports
docs/               Product documentation
```

See [[Project Structure]] for a full module-by-module breakdown.

---

## Deployment

The app deploys to **GitHub Pages** from the repo root. Push to `main` and GitHub Pages serves the new version. No CI, no build step — the repo root *is* the deployable artifact.

**Live URL:** https://mondrianaire.github.io/gto-drill/
