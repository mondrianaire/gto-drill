# Top Scenarios

Two curated lists: the five scenarios that teach the most GTO theory, and the five that best showcase GTO Drill's features. Together, these ten scenarios surface the widest cross-section of the library with no overlap.

---

## Top 5 — most GTO information

Ranked by conceptual density, transferability, and how foundational the lesson is. These five teach the complete spine of postflop GTO.

### 1. Scenario #1 — `btn-vs-bb-3bet-pot-c-bet-decision-001`
**The spot.** 3-bet pot, flop K♥ 7♦ 2♠, you're the in-position raiser, BB checks — and the scenario *hides your hole cards*.

**Why it teaches the most.** It forces the single most important postflop realization: *range advantage decides whether you bet, not your hand.* On a king-high flop in a 3-bet pot the BB's range is full of KK/AK/KQ — the in-position player does **not** have the nut advantage and checks back a large share. Hiding the hole cards forces pure range-vs-range reasoning.

**Transferable lesson.** "I have to c-bet" is the most expensive habit in amateur poker. Betting frequency is a property of *ranges*, not hands.

### 2. Scenario #7 — `facing-river-overbet-with-bluff-catcher-007`
**The spot.** River, facing a 50bb overbet into a 39bb pot, holding JTs (a pure bluff-catcher).

**Why it teaches the most.** Three of the hardest GTO ideas converge on one binary decision: **Minimum Defense Frequency** (how often you must continue so villain can't profitably bluff any two), **why an overbet signals a polarized range** (nuts or air), and **blocker reasoning** (do your cards remove villain's value combos or their bluffs?).

**Transferable lesson.** Against a polar bet your hand strength barely matters — your *blockers* and the *price* do.

### 3. Scenario #32 — `overbet-the-nuts-vs-capped-range-032`
**The spot.** River, you hold the nut straight, villain checked the turn (capped range). You can overbet 165% pot.

**Why it teaches the most.** The exact offensive mirror of #7. Teaches **polarization**, **capped ranges**, and **range leverage** — why the overbet is even available. Studied alongside #7, the player sees both sides of the same coin.

**Transferable lesson.** Bet sizing is a function of *range shape*. When you're polarized and they're capped, bigger is better.

### 4. Scenario #3 — `small-blind-vs-button-srp-turn-overbet-003`
**The spot.** Turn brings the third club, completing a flush. Sizing/check choice on the new board.

**Why it teaches the most.** Range advantage is **not static** — every street's card re-deals it. The flush card flips the nut advantage, and the correct line changes accordingly.

**Transferable lesson.** A scare card is not scary in the abstract — it is scary *for a specific range*. Re-evaluate every street.

### 5. Scenario #21 — `four-bet-pot-range-cbet-021`
**The spot.** 4-bet pot, flop K♦ 7♠ 4♥, SPR ≈ 1.8. The 4-bettor's range is so strong it bets ~16% pot with its *entire* range.

**Why it teaches the most.** Isolates **SPR** and the **range-bet** — when your whole range crushes, you bet tiny with everything. Completes the sizing toolkit: #1/#3 are *whether* to bet, #7/#32 are *how big* when polar, #21 is *how big* when you have a pure range advantage.

**Transferable lesson.** Sizing shrinks as your range advantage grows.

---

## Top 5 — best feature showcases

Chosen to demo distinct app capabilities, with no overlap with the GTO-information list above.

### 1. Scenario #36 — `icm-bubble-fold-marginal-shove-036`
**Showcases:** the **INFO pane** and **replay context tags** for non-standard setups.

A satellite final table (tournament format, 20bb stacks, ICM live) trips every "this scenario is different" surface the app built — the cool-blue notice pane and the tournament/short-stack tag on the replay table.

### 2. Scenario #34 — `multiway-cbet-sizing-overpair-034`
**Showcases:** the **multi-opponent replay table**.

A three-handed pot (UTG/HJ/BTN) fills the felt with three live seats and proves the table renders multiway hands cleanly. The only multiway scenario in the set.

### 3. Scenario #30 — `overpair-on-monotone-flop-030`
**Showcases:** the **board-texture modifier tags**.

The flop 9♣ 6♣ 3♣ renders with the monotone modifier glyph — the clearest demo of the suit-pattern tag system. The lesson *is* the texture ("check overpairs on monotone boards"), so the tag and the teaching point reinforce each other.

### 4. Scenario #5 — `blind-vs-blind-river-thin-value-005`
**Showcases:** the **options-analysis matrix with four sizing options** and the **confidence-gap reveal**.

River thin-value sizing with four choices (check / ~30% / ~70% / overbet) — close enough that thoughtful players disagree and rate their confidence differently. This is exactly the post-game "biggest confidence gap" screen the app was built around.

### 5. Scenario #12 — `bluff-catcher-with-blocker-012`
**Showcases:** the **villain-range cards → "Test it" Monte Carlo equity panel**.

A river bluff-catch turning on a nut blocker is the archetypal "open Test it, build villain's range, see the equity" spot. Routes the player through the deepest interactive feature as a natural part of solving the hand.
