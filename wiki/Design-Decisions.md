# Design Decisions

Key design choices in GTO Drill and the reasoning behind them. For the visual redesign direction, see [[Redesign Mockups]].

---

## No build step

GTO Drill is vanilla JS with ES modules loaded directly by the browser. No bundler, no transpiler, no framework.

**Why:** The app is small enough that a build step adds complexity without meaningful benefit. Direct ES module loading means the source you read is the source the browser runs. Debugging is straightforward — no source maps, no transpilation artifacts. Deployment is a `git push` — the repo root is the deployable artifact.

**Trade-off:** No tree-shaking, no minification, no TypeScript. Acceptable for an app of this size.

---

## Firebase from CDN

The Firebase SDK is loaded from Google's CDN via `import()` in `src/state.js`, not installed via npm.

**Why:** Since there's no build step, npm packages can't be bundled. CDN loading keeps the dependency chain at zero npm packages while still using Firebase's official SDK.

**Trade-off:** Depends on Google's CDN availability. No version pinning in `package-lock.json` (version is pinned in the import URL).

---

## Single production database

Development and production share the same Firebase project. There is no staging database.

**Why:** The app is static files on GitHub Pages — code deploys never touch stored data. Player responses are append-only, and the preservation invariants (see [[Data Schema and Preservation]]) guarantee that additive changes can't corrupt existing data. A staging database would add infrastructure overhead for a risk that's already mitigated by the data contract.

**Trade-off:** A developer's test answers go into the production dataset. Acceptable — the crowd aggregation is robust to a few extra data points.

---

## Hidden hole cards

Some scenarios hide the player's hole cards, forcing range-level reasoning.

**Why:** The single most important GTO insight is that *ranges* decide the action, not individual hands. Hiding the cards eliminates the "but I have top pair" reflex and forces the player to think about the range-vs-range matchup — exactly as a solver does. Scenario #1 (the flagship) uses this technique.

**Trade-off:** Confusing on first encounter. The INFO pane explains it, and the hidden-card scenarios are some of the most discussed in crowd comments.

---

## Mobile-first, dark theme only

The app ships a single dark theme with no light mode toggle.

**Why:** Poker apps are used in low-light environments (home games, late-night study). Dark theme reduces eye strain during extended sessions. A single theme keeps the CSS simple and avoids the "which theme was this tested in?" problem.

**Trade-off:** No light mode for users who prefer it.

---

## Confidence ratings as the core metric

Rather than just right/wrong, the app captures a 1–5 confidence rating on every decision.

**Why:** Accuracy alone misses the most valuable signal. A player who gets 70% right but rates every answer 5/5 has a dangerous blind spot that pure accuracy wouldn't reveal. The confidence dimension turns the app from a quiz into a calibration tool — it surfaces *where you're confidently wrong*, which is where the deepest learning happens.

**Trade-off:** Extra friction on every answer (one more tap). Worth it for the data quality.

---

## Overwrite-on-retest semantics

When a player re-answers a scenario, the new answer overwrites the old one. Only the latest answer counts.

**Why:** The crowd breakdown should reflect each player's *current* read, not their historical sequence of attempts. Keeping only the latest answer prevents a single player from weighting the distribution by answering many times.

**Trade-off:** No history of how a player's answer evolved. Local play history (`src/history.js`) keeps a client-side log for personal reference, but Firestore stores only the latest.

---

## Permanent scenario IDs

Once a `scenario_id` exists in `data/scenarios.json`, it can never be renamed, deleted, or reused.

**Why:** Every response in Firestore is keyed to a `scenario_id`. Renaming or recycling an ID would orphan all responses collected under that ID, silently breaking the crowd breakdown, completion percentages, and profile accuracy. The cost of a slightly messy ID namespace is far lower than the cost of lost data.

**Trade-off:** Retired scenarios leave orphaned IDs. Acceptable — the ID space is unbounded.
