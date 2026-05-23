# Scenario Library Overview

GTO Drill ships with a **45-scenario library** in `data/scenarios.json`. Each scenario is a solver-verified poker decision — a specific board, position, stack depth, and action sequence that isolates a GTO concept.

---

## What makes a good scenario

The library is curated around two principles:

1. **Conceptual density** — each scenario should teach a transferable GTO idea, not just a specific hand
2. **Disagreement potential** — the best scenarios are ones where thoughtful players disagree and rate their confidence differently, because that's where the crowd data is most valuable

---

## Scenario anatomy

Every scenario in `scenarios.json` contains:

| Field | Purpose |
|-------|---------|
| `scenario_id` | Permanent identifier — never renamed or reused (see [[Data Schema and Preservation]]) |
| `title` | Human-readable name |
| `description` | The setup and context |
| `board` | Community cards dealt |
| `hero_hand` | Player's hole cards (sometimes hidden for range-level decisions) |
| `position` / `villain_position` | Seat assignments |
| `available_actions` | The choices presented to the player |
| `gto_action` | The solver-verified optimal play |
| `explanation` | Why the GTO action is correct |
| `concept_tags` | GTO concepts this scenario teaches (e.g. `aggression`, `bluff-catching`, `icm`) |
| `priority` | 1–5, how important this scenario is to the library |
| `complexity` | 1–5, how difficult the decision is |
| `villain_ranges` | Opponent's range breakdown by hand class |
| `replay` | Street-by-street action data for the hand replay renderer |

---

## Coverage

The library covers the core of GTO no-limit hold'em across **eleven pillars** of study. See [[The 11 GTO Pillars]] for a detailed analysis.

**Strong coverage (pillars 1–7):**
- Preflop range construction
- Range/equity advantage & c-betting
- Bet sizing & polarization
- Board texture & runout dynamics
- Bluff-catching, MDF & blockers
- Drawing, semi-bluffing & equity realization
- Pot control & SPR

**Growth areas (pillars 8–11):**
- ICM & tournament play (2 scenarios)
- Multiway pots (1 scenario)
- Stack-depth variety (mostly 100bb)
- Heads-up / short-handed formats (none yet)

---

## Concept tags

Every scenario carries one or more `concept_tags`. The current distribution across 45 scenarios:

| Tag | Count |
|-----|-------|
| `aggression` | 16 |
| `preflop` | 14 |
| `range-reading` | 11 |
| `board-texture` | 11 |
| `bluffing` | 9 |
| `bluff-catching` | 9 |
| `equity-realization` | 8 |
| `pot-control` | 6 |
| `value-betting` | 6 |
| `icm` | 2 |

The weighted scenario picker uses these tags to balance what players see — under-practiced concepts surface more often. See [[Adding Scenarios]] for how to author new entries and balance the tag distribution.
