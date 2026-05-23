# Adding Scenarios

How to author new scenarios for the GTO Drill library.

---

## The rules

1. **New IDs only.** Per [[Data Schema and Preservation]], `scenario_id` values are permanent. Give every new scenario a **fresh ID** — never rename or recycle an existing one.

2. **Tag the concepts.** Every scenario needs `concept_tags` from the standard set: `aggression`, `preflop`, `range-reading`, `board-texture`, `bluffing`, `bluff-catching`, `equity-realization`, `pot-control`, `value-betting`, `icm`. New tags (e.g. `multiway`, `heads-up`) can be added — keep them consistent so the weighted picker and player profile can reason about them.

3. **Non-standard setups trip the INFO pane.** Tournament format, short/deep stacks, and hidden hole cards already surface the cool-blue notice. Keep the `replay` and framing data accurate so the pane fires correctly for new scenarios.

4. **Lean into the gotcha.** The best scenarios have counter-intuitive answers that generate confidence gaps on the wrap-up screen. That's the app's whole point.

---

## Scenario JSON structure

Add entries to `data/scenarios.json`. Each scenario needs:

```json
{
  "scenario_id": "descriptive-slug-NNN",
  "title": "Human-readable title",
  "description": "The setup — board, positions, stacks, action so far",
  "board": ["Kh", "7d", "2s"],
  "hero_hand": ["Jc", "Tc"],
  "position": "BTN",
  "villain_position": "BB",
  "available_actions": ["Fold", "Call", "Raise to 12bb"],
  "gto_action": "Call",
  "explanation": "Why this is the GTO-correct play...",
  "concept_tags": ["bluff-catching", "range-reading"],
  "priority": 4,
  "complexity": 3,
  "villain_ranges": [...],
  "replay": {...}
}
```

### Field reference

| Field | Required | Notes |
|-------|----------|-------|
| `scenario_id` | Yes | Permanent. Use `descriptive-slug-NNN` format |
| `title` | Yes | Short, descriptive |
| `description` | Yes | The full setup — enough to understand the spot without seeing the board |
| `board` | Yes | Array of card strings. Empty array for preflop |
| `hero_hand` | Yes | Array of 2 cards, or `null` for hidden-hole-card scenarios |
| `position` / `villain_position` | Yes | Standard abbreviations: UTG, HJ, CO, BTN, SB, BB |
| `available_actions` | Yes | Array of action strings the player chooses from |
| `gto_action` | Yes | Must match one of `available_actions` exactly |
| `explanation` | Yes | The GTO reasoning — this is the teaching content |
| `concept_tags` | Yes | Array of tag strings from the standard set |
| `priority` | Yes | 1–5, how important to the library |
| `complexity` | Yes | 1–5, how difficult the decision |
| `villain_ranges` | Yes | Opponent range breakdown for the equity tester |
| `replay` | Yes | Street-by-street action data for the hand replay |

---

## Current gaps to fill

The library is strong on pillars 1–7 (core cash-game GTO) but thin on context:

### Multiway pots (1 of 45 — major gap)
The library needs 3–4 multiway scenarios: overpair in a 4-way pot, sandwiched flush draw, squeezed 3-bet pot, multiway river thin value.

### ICM & tournament (2 of 45 — thin)
8 proposed ICM scenarios covering: call-off on the bubble, satellite fold-the-premium, pay-jump laddering, big-stack pressure, ICM-leveraged bluffs, ICM turn folds, thin-value tightening, reading ICM-adjusted ranges.

### Stack depth (mostly 100bb — narrow)
200bb deep scenarios (overpairs become bluff-catchers, preflop ranges widen for implied odds) and additional short-stack scenarios.

### Heads-up / short-handed (absent)
Heads-up SB raise-first-in (raise ~80–90% of hands), heads-up BB defense vs min-raise. Natural fit for the app's two-player framing.

See [[The 11 GTO Pillars]] for the full coverage analysis.

---

## Tag balancing

When adding scenarios, aim to balance the `concept_tags` distribution. The current state:

| Tag | Current | Target |
|-----|---------|--------|
| `aggression` | 16 | (ceiling — can't lower) |
| `preflop` | 14 | (ceiling — can't lower) |
| `icm` | 2 | **Raise to 10+** |
| `pot-control` | 6 | **Raise to 11+** |
| `value-betting` | 6 | **Raise to 11+** |

See `docs/SCENARIOS.md` §6 for the full tag-balance analysis and 14 proposed scenarios that close the gaps.
