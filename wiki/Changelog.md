# Changelog

Release history for GTO Drill. The full changelog with every version is maintained in the repo at [`docs/CHANGELOG.md`](https://github.com/mondrianaire/gto-drill/blob/main/docs/CHANGELOG.md).

This page highlights major milestones and recent changes.

---

## Recent highlights

### Compressed workflow + compact view (v2026-05-22.128–136)
A series of releases building the compact one-screen hand view (spec §6.1 / §7):
- **Compact-view board-runout strip** — flop/turn/river as a compact strip
- **Compact-view hero strip** — hero's seat, hole cards, and stack on one line
- **Compact one-screen hand view + toggle** — switch between animated table and compact layout
- **First-run coach mark** — hints at compact view when the hand overflows the viewport
- **Compact decide-phase prompt** — villain-action prompt with pot/call/odds chips
- **Runout dividers + street-progress dots** — visual polish from the M3 mockup
- **Reveal "TAP TO GO DEEPER" accordion** — collapsible deeper-dive sections

### Per-scenario solver config export (v2026-05-22.133)
Owner tooling: the Database console exports TexasSolver configs for postflop scenarios.

### Shape pass (v2026-05-22.126)
Moved 7 static badges/tags from pill radius onto `--radius-box` token (PR #129).

### Spot-summary keyboard interaction (v2026-05-22.125)
Added `role="button"` + Enter/Space support to collapsible spot summaries (PR #127).

### Mobile affordance pass (v2026-05-21.111)
The base UX patch (PR #115): `:active` / `:focus-visible` / hover-gating, 44px tap targets, `--border-interactive` at ≥3:1 contrast, `prefers-reduced-motion`, focus rings.

### GTO Drill rebrand (v2026-05-22)
Renamed from "GTO Duel" to "GTO Drill" across all user-facing surfaces, source files, and documentation (PR #121).

---

## Firestore rules updates

Some releases require manually publishing updated `firestore.rules` in the Firebase Console:

- **v2026-05-20.63** — list query for participant's own active games
- **v2026-05-20.75** — delete on orphan lobbies (waiting_for_opponent)

See [[Firestore Rules]] for the current rule set.

---

## Full history

The complete version-by-version changelog is in the repo: [`docs/CHANGELOG.md`](https://github.com/mondrianaire/gto-drill/blob/main/docs/CHANGELOG.md).
