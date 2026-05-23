# Design Audit Summary

A UX audit was conducted against GTO Drill build v2026-05-21.106. The audit produced standalone HTML reports covering mobile formatting, decision-screen layout, and hand matrix alternatives.

---

## Audit reports

| Report | Focus | Location |
|--------|-------|----------|
| **Mobile formatting** | Touch affordance, tap targets, contrast, reduced-motion | `design-audit/mobile-audit.html` |
| **Decision-screen recomposition** | In-game decision screen layout and information architecture | `design-audit/decision-screen-recomposition.html` |
| **Grid alternatives** | Hand matrix display and interaction alternatives | `design-audit/grid-alternatives.html` |

---

## Key findings

### Finding 01 — the name
The original name "GTO Duel" promised a private one-to-one match. The app's actual telos is crowd GTO training, not dueling. **Resolved:** renamed to GTO Drill (PR #121).

### Finding 02 — honest small-crowd state
With a small player pool, crowd percentages can be misleading (3 of 5 = "60% picked this"). The app needs graceful low-n treatment — either suppressing percentages below a threshold or showing raw counts.

### Finding 03 — confidence calibration
The app collects 1–5 confidence ratings but doesn't yet surface a calibration readout ("you rated 5/5 confident on hands you got wrong 40% of the time"). This is a Wave 3 payoff.

### Finding 04 — GTO summary card
The reveal screen needs a headline GTO summary: the lesson in one sentence, a solver-frequency bar showing how often the solver picks each option, a verdict, and an EV-cost estimate. Requires new data fields in `scenarios.json`.

### Finding 05 — chip-and-felt vocabulary
Poker's visual vocabulary (chip stacks, felt colors, card fans) could extend onto non-game screens (profile, home). Only in-scope where each instance is a functional readout, not pure decoration.

---

## What shipped from the audit

The base mobile-affordance patch (PR #115) closed the most critical gap: zero `:active` rules, border contrast at 1.30:1, and no tap-target sizing. These are all resolved.

| Item | Status |
|------|--------|
| `:active` / `:focus-visible` / hover-gating | Done (PR #115) |
| 44px tap targets on primary + secondary controls | Done (PR #115) |
| `--border-interactive` at ≥3:1 contrast | Done (PR #115) |
| `prefers-reduced-motion` support | Done (PR #115) |
| Focus rings and ARIA | Done (PR #115, #127) |
| Shape pass — box radius for tags/badges | Done (PR #129) |

See [[Redesign Roadmap]] for the full wave-by-wave status.
