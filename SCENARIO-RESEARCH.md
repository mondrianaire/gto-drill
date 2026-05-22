# GTO Duel — Scenario Research & Curation

A research pass over the current scenario library (`data/scenarios.json`,
**45 scenarios**) plus a curated set of recommendations. Produced 2026-05-22.

Three deliverables:

1. **Top 5 — most GTO information** — existing scenarios that teach the deepest,
   most transferable theory.
2. **Top 5 — best feature showcases** — existing scenarios that best demonstrate
   what the GTO Duel app does.
3. **Top 20 — proposed new scenarios** — gaps worth filling, with reasoning.

---

## 1. Coverage analysis (the research deep-dive)

GTO no-limit hold'em study breaks into roughly eleven pillars. Here is how the
current 45 scenarios cover them.

| # | Pillar | Current coverage | Verdict |
|---|--------|------------------|---------|
| 1 | Preflop range construction (RFI, vs-3-bet, vs-4-bet/5-bet, squeeze, blind play, set-mining) | 14 scenarios (#2,4,8,11,13,14,20,26,27,28,36,37,41,44) | **Strong** |
| 2 | Range / equity advantage & c-betting (who is *allowed* to bet, and how often) | #1,10,21,24,25,34,42 | **Strong** |
| 3 | Bet sizing & polarization (small range-bet vs large polar bet vs overbet) | #3,5,16,21,22,32,42 | **Strong** |
| 4 | Board texture & runout dynamics (dry/wet/paired/monotone; turn & river shifts) | #1,3,6,17,18,29,30,38,39,43 | **Strong** |
| 5 | Bluff-catching, MDF & blockers | #6,7,9,12,17,29,33,39,40,41 | **Strong** |
| 6 | Drawing, semi-bluffing & equity realization | #4,8,9,16,23,26,35,37 | **Strong** |
| 7 | Pot control & SPR | #1,15,21,30,31,38,43 | **Strong** |
| 8 | ICM & tournament-specific play | #11,36 only — both *shove-or-fold* | **Thin** |
| 9 | Multiway pots | #34 only | **Major gap** |
| 10 | Stack-depth variety | Mostly 100bb; 40bb (#4), 20bb (#36), 12bb (#11) | **Narrow** |
| 11 | Player count / table format (heads-up, short-handed) | None | **Absent** |

**Summary.** The library is excellent on the core single-raised-pot and 3-bet-pot
cash game at 100bb — pillars 1–7 are mature and well-balanced across streets.
The gaps are all on the *context* axis: what changes when the pot is multiway,
when it's a tournament with real money jumps, when stacks are very deep or very
shallow, and when only two or three players are dealt in. Those four contexts
(pillars 8–11) are where new scenarios add the most.

---

## 2. Top 5 — scenarios that give the most GTO player information

Ranked by conceptual density, transferability, and how foundational the lesson
is. Together these five teach the complete spine of postflop GTO: who has the
range edge (static and dynamic), the polar offense/defense pair, and the
SPR/range-bet tool.

### 1. Scenario #1 — `btn-vs-bb-3bet-pot-c-bet-decision-001` *(priority 5, complexity 4)*
**The spot.** 3-bet pot, flop `Kh 7d 2s`, you are the in-position pre-flop
raiser, BB checks to you — and the scenario *hides your hole cards*.
**Why it teaches the most.** It forces the single most important postflop
realization: *range advantage decides whether you bet, not your hand.* On a
king-high flop in a 3-bet pot the BB's range is full of KK/AK/KQ — the
in-position player does **not** have the nut advantage and checks back a large
share. Hiding the hole cards is the perfect delivery: the player must reason
range-vs-range, exactly as a solver does.
**Transferable lesson.** "I have to c-bet" is the most expensive habit in
amateur poker. Betting frequency is a property of *ranges*, not hands.

### 2. Scenario #7 — `facing-river-overbet-with-bluff-catcher-007` *(priority 5, complexity 5)*
**The spot.** River, facing a 50bb overbet into a 39bb pot, holding JTs (a pure
bluff-catcher). Fold or call.
**Why it teaches the most.** It is the defensive half of polar-pot theory in one
hand: **Minimum Defense Frequency** (how often you must continue so villain
can't profitably bluff any two), **why an overbet signals a polarized range**
(nuts or air, nothing in between), and **blocker reasoning** (do your exact cards
remove villain's value combos or their bluffs?). Three of the hardest GTO ideas
converge on one binary decision.
**Transferable lesson.** Against a polar bet your hand strength barely matters —
your *blockers* and the *price* do.

### 3. Scenario #32 — `overbet-the-nuts-vs-capped-range-032` *(priority 5, complexity 5)*
**The spot.** River, you hold the nut straight, villain checked the turn (so
their range is *capped* — no monsters). You can overbet 165% pot.
**Why it teaches the most.** It is the exact offensive mirror of #7. It teaches
**polarization**, **capped ranges**, and **range leverage** — *why* the overbet
is even available: villain literally cannot have the nuts, so you can charge the
maximum. Studied alongside #7, the player sees both sides of the same coin.
**Transferable lesson.** Bet sizing is a function of *range shape*. When you're
polarized and they're capped, bigger is better — often bigger than the pot.

### 4. Scenario #3 — `small-blind-vs-button-srp-turn-overbet-003` *(priority 5, complexity 5)*
**The spot.** Turn brings the third club (`9c 6c 2h` → `Tc`), completing a
flush. The decision is a sizing/check choice on the new board.
**Why it teaches the most.** Range advantage is **not static** — every street's
card re-deals it. The flush card flips the nut advantage to whichever player's
range holds more flushes, and the correct line changes accordingly. This is the
concept most players never internalize: you must re-ask "who is ahead now?" on
every single card.
**Transferable lesson.** A scare card is not scary or safe in the abstract — it
is scary or safe *for a specific range*. Re-evaluate every street.

### 5. Scenario #21 — `four-bet-pot-range-cbet-021` *(priority 3, complexity 4)*
**The spot.** 4-bet pot, flop `Kd 7s 4h`, SPR ≈ 1.8. The 4-bettor's range is so
strong it bets ~16% pot with its *entire* range.
**Why it teaches the most.** It isolates two ideas the other four don't:
**SPR** (how deep the pot is relative to stacks dictates everything) and the
**range-bet** — when your whole range crushes, you bet tiny with all of it
rather than picking hands. It completes the toolkit: #1/#3 are *whether* to bet,
#7/#32 are *how big* when polar, #21 is *how big* when you have a pure range
advantage.
**Transferable lesson.** Sizing shrinks as your range advantage grows. A nut
advantage + low SPR = a small bet with everything.

> **Honorable mentions.** #10 (`donk-bet-decision-low-board`) — the *out-of-
> position* player can hold the range edge and should lead; a useful counter to
> "the raiser always c-bets." #36 (`icm-bubble-fold`) — optimal play under a
> payout structure is a genuinely different optimization than chip-EV.

---

## 3. Top 5 — scenarios that best showcase GTO Duel's features

Chosen to demo distinct app capabilities, with **no overlap** with Section 2 —
so these ten scenarios together surface the widest cross-section of the library.

### 1. Scenario #36 — `icm-bubble-fold-marginal-shove-036`
**Showcases:** the **INFO pane** + **replay context tag** for non-standard
setups. A satellite final table (tournament format, 20bb stacks, ICM live) trips
every "this scenario is different" surface the app built — the cool-blue notice
pane and the tournament/short-stack tag on the replay table.
**Why this one:** it is the richest non-cash setup in the library, so it
exercises the most context machinery at once. (The INFO pane also has a
*hidden-hole-cards* variant — see Scenario #1 — worth demoing separately.)

### 2. Scenario #34 — `multiway-cbet-sizing-overpair-034`
**Showcases:** the **multi-opponent replay table** and the "use position names,
not VILLAIN" labelling. A three-handed pot (UTG/HJ/BTN) fills the felt with
three live seats and proves the table renders multiway hands cleanly.
**Why this one:** it is the *only* multiway scenario in the set — the single
hand that demonstrates the app isn't limited to heads-up pots.

### 3. Scenario #30 — `overpair-on-monotone-flop-030`
**Showcases:** the **board-texture modifier tags** (`.tok-modtag`). The flop
`9c 6c 3c` renders with the monotone modifier glyph — the clearest demo of the
suit-pattern tag system (monotone / two-tone / rainbow).
**Why this one:** the lesson *is* the texture ("check overpairs on monotone
boards"), so the modifier tag and the teaching point reinforce each other.

### 4. Scenario #5 — `blind-vs-blind-river-thin-value-005`
**Showcases:** the **options-analysis matrix with four sizing options** (check /
~30% / ~70% / overbet) and, crucially, the app's headline premise — a
**genuine GTO gotcha that produces a confidence gap**. River thin-value sizing
is close enough that two thoughtful players will disagree and rate their
confidence differently, which is exactly the post-game "biggest confidence gap"
screen the app was built around.
**Why this one:** it is a true coin-flip-feel decision with a wide option
spread — ideal for the discuss-and-guess loop. (Scenarios #6 and #29 are also
strong disagreement spots.)

### 5. Scenario #12 — `bluff-catcher-with-blocker-012`
**Showcases:** the **villain-range cards → "Test it" Monte Carlo equity panel**.
A river bluff-catch turning on a nut blocker is the archetypal "open Test it,
build villain's range, see the equity" spot — the feature exists for exactly
this decision. It is also a prime **crowd-comment** scenario: players love to
write their read on a close bluff-catch.
**Why this one:** it routes the player through the deepest interactive feature
(the equity calculator) as a natural part of solving the hand.

---

## 4. Top 20 — proposed new scenarios for consideration

Each fills a coverage gap from Section 1. Prioritised toward **multiway**,
**ICM**, **stack depth**, and **heads-up/short-handed** — the four weak pillars —
and toward counter-intuitive "gotcha" answers, since disagreement + confidence
gaps are the app's core loop.

> Authoring note: give every new scenario a **fresh `scenario_id`** — never
> rename or recycle an existing one (see `SCHEMA.md`).

### A. Multiway pots — the biggest gap (1 of 45)

**1. Overpair, wet board, 4-way — c-bet or check.**
*Spot:* HJ (Hero) opens, CO/BTN/BB call. Flop `Jh 9h 7c`, Hero has QQ, 4-way.
*Concept:* multiway shrinks fold equity and uncaps caller ranges — an overpair
on a coordinated board is often a **check**. *Why include:* the canonical
multiway gotcha; most players auto-bet the overpair. `concept_tags: multiway,
pot-control, board-texture`.

**2. Flush draw, sandwiched.**
*Spot:* CO opens, BTN calls, BB (Hero) calls. Flop, BB checks, CO bets, BTN
calls — action on Hero with a bare flush draw. *Concept:* being sandwiched
between bettor and caller worsens your price and your equity realization; bare
draws play tighter multiway than the raw pot odds suggest. *Why include:*
teaches that *position relative to live players*, not just the odds, governs a
draw. `concept_tags: multiway, equity-realization`.

**3. Squeezed pot, 3-way, out of position.**
*Spot:* Hero squeezes from the BB over an open + a call; both call. 3-way 3-bet
pot, Hero OOP, flop c-bet decision. *Concept:* a bloated multiway 3-bet pot OOP
demands tight, mostly-checking flop play despite Hero being the aggressor.
*Why include:* combines two thin areas (multiway + 3-bet-pot OOP).
`concept_tags: multiway, range-reading, pot-control`.

**4. Multiway river thin value.**
*Spot:* three players reach the river; Hero has top pair, decent kicker; bet or
check. *Concept:* the value threshold rises sharply multiway — with two players
behind, someone usually has a better hand. *Why include:* directly contrasts
with the heads-up thin-value spots (#5, #15) and shows the multiway adjustment.
`concept_tags: multiway, value-betting, pot-control`.

### B. ICM depth — currently 2 of 45, both shove-or-fold

**5. ICM call-off on the bubble.**
*Spot:* ~15bb effective, bubble. SB shoves, Hero in the BB with a hand that is
clearly +chip-EV to call but −$EV. *Concept:* the **call** side of ICM — chip-EV
and real-money EV diverge; you fold profitable chip spots to survive. *Why
include:* the current ICM pair only ever asks "should I shove?" — never "should
I call?" `concept_tags: icm, bluff-catching`.

**6. Satellite — fold the premium.**
*Spot:* satellite, top N seats paid, Hero is a near-lock to qualify; a short
stack shoves and Hero holds QQ (or AA). *Concept:* when survival already secures
the prize, folding a premium to zero out bust risk is correct. *Why include:*
the single highest-discussion gotcha possible — "fold aces?!" is the perfect
read-aloud-and-guess hand. `concept_tags: icm, preflop`.

**7. Pay-jump laddering at a final table.**
*Spot:* final table, 5 left, meaningful pay jumps, Hero a medium stack with a
marginal spot while a shorter stack is still to act. *Concept:* fold to let the
short stack bust first and ladder up. *Why include:* teaches survival EV as a
positive strategy, not just bubble fear. `concept_tags: icm, preflop`.

**8. Big-stack ICM pressure.**
*Spot:* final table, Hero is the chip leader on the button; the blinds are
ICM-shackled medium stacks. *Concept:* the chip leader widens shoves
dramatically to attack opponents who *can't* call without ICM suicide. *Why
include:* the aggressor side of ICM — the current scenarios only show ICM as a
constraint, never as a weapon. `concept_tags: icm, preflop, aggression`.

### C. Stack-depth variety — currently almost all 100bb

**9. 200bb deep — overpair facing barrels.**
*Spot:* 200bb, Hero has QQ/KK and faces turn + river aggression. *Concept:* deep
stacks make one-pair hands *worse* — high SPR turns an overpair into a
bluff-catcher; nut-or-fold. *Why include:* the inverse of #21's low-SPR lesson —
shows SPR cuts both ways. `concept_tags: pot-control, range-reading`.

**10. 200bb deep — preflop range widening.**
*Spot:* 200bb, a flat-or-fold decision with a suited connector or small pair.
*Concept:* implied-odds hands (sets, straights, flushes) gain value as stacks
deepen; calling ranges widen toward hands that flop big. *Why include:* pairs
with #9 to teach depth-adjusted preflop play. `concept_tags: preflop,
equity-realization`.

### D. Heads-up & short-handed — currently absent (and thematically perfect)

**11. Heads-up SB raise-first-in with "trash."**
*Spot:* heads-up, Hero on the SB/BTN with a hand like Q4o. *Concept:* heads-up
the SB raises ~80–90% of hands — a hand that is an instant 6-max fold is a
clear raise. *Why include:* a huge gotcha, and heads-up is exactly how the app's
two players (you and your mom) play together. `concept_tags: preflop, heads-up`.

**12. Heads-up BB defense vs a min-raise.**
*Spot:* heads-up, Hero in the BB facing a min-raise with a weak offsuit hand.
*Concept:* the pot odds force a very wide defense — calling hands that would be
trivial folds full-ring. *Why include:* completes the heads-up preflop picture
and teaches pot-odds-driven defense at the extreme. `concept_tags: preflop,
heads-up`.

### E. Targeted concept gaps

**13. Facing a turn overbet.**
*Spot:* SRP, Hero called the flop; villain overbets the turn ~150% pot; Hero has
a medium-strength hand. *Concept:* MDF on the *turn* — unlike the river overbet
(#7), a card is still to come, so implied odds and equity realization change the
defense. *Why include:* extends overbet theory off the river. `concept_tags:
bluff-catching, board-texture`.

**14. 3-bet pot played out of position.**
*Spot:* Hero 3-bets from the BB, BTN calls; Hero must navigate the flop OOP.
*Concept:* c-bet-vs-check the 3-bet-pot range from OOP — range-bet dry boards,
check boards that smash the caller. *Why include:* the library's 3-bet pots are
mostly IP or as the caller; the OOP 3-bettor is under-covered. `concept_tags:
range-reading, pot-control`.

**15. Protection / equity-denial bet.**
*Spot:* Hero has top pair on a draw-soaked board (e.g. `Q T 8` two-tone); a bet
charges villain's many draws. *Concept:* betting to **deny equity**, distinct
from betting for value or as a bluff. *Why include:* the current set frames
betting as value/bluff/range — protection is a missing fourth reason.
`concept_tags: value-betting, board-texture`.

**16. Blocker-driven bet sizing.**
*Spot:* a river value bet where the exact card Hero holds (blocking villain's
calls vs blocking their folds) dictates the *size*. *Concept:* blockers change
not just bet-or-check (#7, #12, #40) but *how much*. *Why include:* deepens
blocker theory into sizing — a genuinely advanced, discussion-rich idea.
`concept_tags: value-betting, range-reading`.

**17. Floating in position.**
*Spot:* Hero calls a flop c-bet IP with a marginal hand (overcards/backdoors),
planning to take the pot on a blank turn if checked to. *Concept:* the float as
a deliberate, named line — calling now to bet later. *Why include:* the library
has check-raises and probes but not the IP float. `concept_tags: bluffing,
range-reading`.

**18. The third-barrel decision.**
*Spot:* Hero barreled the flop and turn; the river bricks; fire again or give
up. *Concept:* a disciplined triple-barrel bluff — turning on blockers and
whether villain's range arrived capped. *Why include:* the set has give-up (#31)
and busted-draw-bet (#22) but not the live "should I keep going" choice.
`concept_tags: bluffing, range-reading`.

**19. Cold 4-bet.**
*Spot:* UTG opens, HJ 3-bets, Hero (CO/BTN) holds a cold-4-bet candidate (e.g.
KK or A5s). *Concept:* 4-betting with no prior chips in the pot — a distinct,
tighter, more polarized range than the opener's 4-bet (#14). *Why include:*
a real preflop gap; cold 4-bet ranges surprise most players. `concept_tags:
preflop, bluffing`.

**20. Limped family pot — postflop.**
*Spot:* multiple limpers, Hero checks the BB; play a flop in an unraised
multiway pot. *Concept:* with no preflop raiser, every range is wide and
*uncapped* — nobody is credibly strong or weak; value-bet carefully, almost
never bluff into the field. *Why include:* limped pots are common in low-stakes
and live play and are entirely absent here. `concept_tags: multiway,
board-texture`.

---

## 5. Authoring notes

- **New IDs only.** Per `SCHEMA.md`, `scenario_id` values are permanent — give
  each new scenario a fresh id; never rename or recycle.
- **Tag the new contexts.** `multiway`, `icm`, `heads-up` (new), and stack-depth
  are worth consistent `concept_tags` so the weighted picker and the player
  profile can reason about them.
- **Non-standard setups trip the INFO pane.** Tournament, short/deep stacks, and
  hidden hole cards already surface the cool-blue notice — proposals 5–12 and
  9–10 will use it; keep their `replay`/framing data accurate so it fires.
- **Lean into the gotcha.** Proposals 1, 6, 9, and 11 have the most
  counter-intuitive answers — they will generate the biggest confidence gaps on
  the wrap-up screen, which is the app's whole point.

---

## 6. Tag-balance analysis — evening out `concept_tags`

A second pass, this time on the `concept_tags` field: which concept labels are
over- and under-represented across the 45 scenarios, and what to add so the
distribution flattens.

### 6.1 Current distribution

92 tag-instances across 45 scenarios (avg 2.04 tags each; an even split across
the 10 tags would be **9.2** each).

| Tag | Count | vs even (9.2) |
|-----|-------|----------------|
| `aggression` | 16 | **+6.8 — over** |
| `preflop` | 14 | **+4.8 — over** |
| `range-reading` | 11 | +1.8 |
| `board-texture` | 11 | +1.8 |
| `bluffing` | 9 | −0.2 |
| `bluff-catching` | 9 | −0.2 |
| `equity-realization` | 8 | −1.2 |
| `pot-control` | 6 | **−3.2 — under** |
| `value-betting` | 6 | **−3.2 — under** |
| `icm` | 2 | **−7.2 — severely under** |

**The hard constraint.** `aggression` (16) and `preflop` (14) cannot be *lowered*
— their tags are correctly applied to existing scenarios, and `SCHEMA.md` rules
out editing collected data casually. So "equal" here means **lifting the four
laggards** (`icm`, `value-betting`, `pot-control`, `equity-realization`) up to
the mid-pack. `aggression`/`preflop` stay as the natural ceiling — but note that
*their share shrinks anyway*: `aggression` is 17.4% of instances now and 14.2%
after the additions below, because the denominator grows.

### 6.2 The balancing set — 14 proposed scenarios

Each scenario's `concept_tags` are assigned to fill the deficit, and every tag
is honest to the decision the scenario actually teaches. Adds **+35 instances**:
`icm +8`, `value-betting +6`, `pot-control +5`, `equity-realization +3`,
`range-reading +3`, `bluffing +2`, `bluff-catching +2`, `board-texture +2`,
`preflop +2`, `aggression +2`.

**ICM block (8)** — `icm` is the worst gap (2 of 92); these 8 lift it to 10. ICM
is also a deep enough domain to carry a varied second tag each, so the block
doubles as a `value-betting` / `pot-control` / `equity-realization` lift.

| # | Proposed scenario | `concept_tags` |
|---|-------------------|----------------|
| N1 | **ICM turn fold** — FT, top pair facing a shove from a covering stack; survival outweighs a clear chip-EV call | `icm, bluff-catching, pot-control` |
| N2 | **Satellite — fold the premium** — fold QQ/AA when already a lock to qualify *(= §4 #6)* | `icm, preflop` |
| N3 | **ICM thin-value tightening** — a marginal river value bet becomes a check; getting raised under ICM is ruin | `icm, value-betting` |
| N4 | **ICM pot-control with a big hand** — take the smaller value line / refuse the stack-off to protect the ladder | `icm, pot-control, value-betting` |
| N5 | **Big-stack pressure** — chip leader shoves wide into ICM-shackled mediums *(= §4 #8)* | `icm, aggression, range-reading` |
| N6 | **Pay-jump laddering** — medium stack folds a +chip-EV spot to let a short stack bust *(= §4 #7)* | `icm, equity-realization` |
| N7 | **ICM-leveraged bluff** — max pressure on a player ICM-incentivised to fold everything but the nuts | `icm, bluffing, aggression` |
| N8 | **Reading ICM-adjusted ranges** — the shover's range is distorted by stack/payout; respond to that, not to chip-EV | `icm, preflop, range-reading` |

**Value / pot-control / equity block (6)** — closes the remaining
`value-betting`, `pot-control`, and `equity-realization` gaps with fresh angles
not already in the library (existing value/pot-control scenarios lean toward
"clear big hands" and "check back on scary turns").

| # | Proposed scenario | `concept_tags` |
|---|-------------------|----------------|
| N9 | **Bet-thin or pot-control** — a medium hand on a textured river: the choice itself is the lesson | `value-betting, pot-control, board-texture` |
| N10 | **Protection-value bet** — value-bet a vulnerable made hand partly to deny villain's equity *(= §4 #15)* | `value-betting, equity-realization` |
| N11 | **Pot-control to realise equity** — check a decent-but-vulnerable hand for a cheap showdown rather than bet into a raise | `pot-control, equity-realization, board-texture` |
| N12 | **Merged river value bet** — a thin/merged bet justified by a precise read on a capped calling range *(≈ §4 #16)* | `value-betting, range-reading` |
| N13 | **Pot-control a bluff-catcher** — keep the pot small across streets so the river call stays affordable | `pot-control, bluff-catching` |
| N14 | **The value/bluff boundary** — a river hand right at the threshold between thin value and pure give-up | `bluffing, value-betting` |

### 6.3 Projected distribution after the 14 additions

127 tag-instances across 59 scenarios (even split would be **12.7** each).

| Tag | Before | After | vs even (12.7) |
|-----|--------|-------|-----------------|
| `aggression` | 16 | 18 | +5.3 (natural ceiling) |
| `preflop` | 14 | 16 | +3.3 (natural ceiling) |
| `range-reading` | 11 | 14 | +1.3 |
| `board-texture` | 11 | 13 | +0.3 |
| `value-betting` | 6 | 12 | −0.7 |
| `bluffing` | 9 | 11 | −1.7 |
| `bluff-catching` | 9 | 11 | −1.7 |
| `equity-realization` | 8 | 11 | −1.7 |
| `pot-control` | 6 | 11 | −1.7 |
| `icm` | 2 | 10 | −2.7 |

**Result.** The spread collapses from **[2 … 16]** to **[10 … 18]**. The eight
*controllable* tags converge into a tight **10–14 band** (standard deviation
across those eight drops from ~2.9 to ~1.2); `aggression` and `preflop` remain
the un-loweravable ceiling. `icm` rises 5× and is no longer a catastrophic
outlier — to close it the rest of the way, add 2–4 more ICM scenarios, though
that would weight the proposal heavily toward one domain.

### 6.4 Notes

- **Overlap with §4 is deliberate.** N2, N5, N6 (and loosely N10, N12)
  correspond to §4 proposals — those scenarios serve both goals at once
  (context-gap *and* tag-balance). The other nine are new, tag-driven proposals.
- **`multiway` / `heads-up` are not in this histogram.** §4 proposes them as
  *new* tags. If adopted, they start at 0 and the §4 proposals seed them — they
  would then warrant their own balancing pass. This section balances only the
  10 tags that currently exist in the data.
- **Tag honestly, not to hit a number.** Every tag above reflects a real
  teaching point of the scenario. If authoring drifts, re-run the one-line
  tally in this doc's history rather than back-filling tags to chase the count.

---

## 7. Consolidated build queue

§4 proposed 20 scenarios (context gaps); §6 proposed 14 (tag balance). This
section merges them into one de-duplicated, prioritised queue.

### 7.1 De-duplication — 34 raw → 29 unique

Five collapses:

| §6 item | Resolution |
|---------|-----------|
| N2 "Satellite — fold the premium" | **= §4 #6** (exact duplicate) |
| N5 "Big-stack pressure" | **= §4 #8** (exact duplicate) |
| N6 "Pay-jump laddering" | **= §4 #7** (exact duplicate) |
| N10 "Protection-value bet" | **merged into §4 #15** (same scenario) |
| N12 "Merged river value bet" | **merged into §4 #16** — one "value bet driven by a blocker/range read" |

The other nine §6 items (N1, N3, N4, N7, N8, N9, N11, N13, N14) are genuinely
new. **29 unique proposed scenarios.**

### 7.2 Scoring rubric

- **Gap** — how under-covered the area is. *Severe* = multiway / ICM / heads-up
  (0–2 of 45 today). *Moderate* = stack depth. *Specific* = a missing sub-concept
  inside an otherwise well-covered pillar.
- **Gotcha** — confidence-gap potential, i.e. how counter-intuitive the answer
  is. This is the app's core engine, so it is weighted heavily.
  **★★★** big disagreement · **★★** moderate · **★** mild.
- **Effort** — authoring cost *in this app*. *Low* = a standard 100bb heads-up
  pot, prose + board + options only (identical to the existing 45). *Med* = ICM
  framing + INFO pane, a `heads-up` tag, or a deep-stack setup. *High* = multiway
  replay data for 3–4 seats.
- **Rank** = gap severity + gotcha, with low effort breaking ties upward.

### 7.3 Master ranked queue

#### Tier 1 — build first (ranks 1–10)
Highest gotcha value, covers every major gap at least once, effort-mixed so it
ships as one coherent "Scenario Pack v2."

| # | Scenario | Source | Gap | Gotcha | Effort |
|---|----------|--------|-----|--------|--------|
| 1 | Satellite — fold the premium (fold QQ/AA as a qualified lock) | §4 #6 | ICM (severe) | ★★★ | Med |
| 2 | Overpair, wet board, c-bet or check — 4-way | §4 #1 | Multiway (severe) | ★★★ | Med-High |
| 3 | 200bb deep — overpair is nut-or-fold facing barrels | §4 #9 | Depth (moderate) | ★★★ | Low-Med |
| 4 | Heads-up SB raise-first-in with "trash" | §4 #11 | Heads-up (severe) | ★★★ | Low-Med |
| 5 | Facing a turn overbet (turn-MDF) | §4 #13 | Specific: overbet defense | ★★★ | Low |
| 6 | ICM bubble call-off (fold a +chip-EV call) | §4 #5 | ICM (severe) | ★★★ | Med |
| 7 | Protection / equity-denial bet | §4 #15 + N10 | Specific: 4th reason to bet | ★★ | Low |
| 8 | The third-barrel decision | §4 #18 | Specific: barreling | ★★★ | Low |
| 9 | Heads-up BB defend vs a min-raise | §4 #12 | Heads-up (severe) | ★★ | Low-Med |
| 10 | Pay-jump laddering at a final table | §4 #7 | ICM (severe) | ★★★ | Med |

#### Tier 2 — build next (ranks 11–21)

| # | Scenario | Source | Gap | Gotcha | Effort |
|---|----------|--------|-----|--------|--------|
| 11 | Blocker-driven / merged value bet (read drives size) | §4 #16 + N12 | Specific: blockers → sizing | ★★★ | Low-Med |
| 12 | Big-stack ICM pressure (attack the shackled mediums) | §4 #8 | ICM (severe) | ★★ | Med |
| 13 | ICM thin-value tightening (a value bet becomes a check) | §6 N3 | ICM (severe) | ★★★ | Med |
| 14 | Sandwiched flush draw, multiway | §4 #2 | Multiway (severe) | ★★ | Med-High |
| 15 | 3-bet pot played out of position | §4 #14 | Specific: 3-bet pot OOP | ★★ | Low |
| 16 | Multiway river thin value (the threshold rises) | §4 #4 | Multiway (severe) | ★★ | Med-High |
| 17 | ICM turn fold (postflop reinforcement of #6) | §6 N1 | ICM (severe) | ★★★ | Med |
| 18 | 200bb deep — preflop range-widening | §4 #10 | Depth (moderate) | ★★ | Low |
| 19 | Floating in position | §4 #17 | Specific: the float | ★★ | Low |
| 20 | Reading ICM-adjusted ranges | §6 N8 | ICM (severe) | ★★ | Med |
| 21 | Bet-thin-or-pot-control river | §6 N9 | Specific: value vs pot-control | ★★ | Low |

#### Tier 3 — later / nice-to-have (ranks 22–29)

| # | Scenario | Source | Gap | Gotcha | Effort |
|---|----------|--------|-----|--------|--------|
| 22 | Squeezed pot, 3-way, out of position | §4 #3 | Multiway (severe) | ★★ | High |
| 23 | ICM pot-control with a big hand | §6 N4 | ICM (severe) | ★★ | Med |
| 24 | Cold 4-bet | §4 #19 | Specific: preflop | ★★ | Low |
| 25 | Pot-control to realise equity cheaply | §6 N11 | Specific: pot-control | ★★ | Low |
| 26 | ICM-leveraged bluff | §6 N7 | ICM (severe) | ★★ | Med |
| 27 | The value/bluff boundary (the polar threshold) | §6 N14 | Specific: polarisation | ★★ | Low |
| 28 | Limped family pot — postflop | §4 #20 | Multiway / limped | ★★ | Med-High |
| 29 | Pot-control a bluff-catcher | §6 N13 | Specific: pot-control | ★ | Low |

### 7.4 Recommended first batch — "Scenario Pack v2" (Tier 1, 10 scenarios)

Tier 1 is designed to ship as one unit. It takes the library **45 → 55** and:

- **Touches every gap:** ICM 2 → 5, heads-up 0 → 2, multiway 1 → 2, plus the
  first deep-stack scenario.
- **Front-loads the gotchas:** seven of the ten are ★★★ — including the four
  best disagreement hands in the whole proposal (fold-the-premium, the 4-way
  overpair check, the 200bb nut-or-fold, the heads-up raise-trash).
- **Mixes effort:** four Low-effort quick wins (#5, #7, #8 — standard 100bb
  pots) balance the heavier multiway/ICM builds, so the batch is not blocked on
  the hardest scenario.
- **Needs two small bits of plumbing:** a `heads-up` `concept_tag`, and a check
  that the INFO pane copy covers a *deep-stack* (200bb) setup as well as it
  covers short stacks (it already flags non-standard stacks, so this is likely
  a copy tweak, not new logic).

### 7.5 Tier 2 / 3 and tag balance

Tier 2 finishes the job §6 started: it adds four more ICM scenarios (#12, #13,
#17, #20), so by the end of Tier 2 the `icm` tag has risen from 2 to ~9 — the
tag histogram is essentially balanced (see §6.3) without Tier 3 being required.
Tier 3 is polish: the highest-effort multiway build (#22), the limped pot, and
the remaining pot-control / boundary scenarios that round out the count.

**Suggested next step:** flesh Tier 1 into full `scenarios.json` specs — boards,
`action_history`, `available_actions`, `gto_action`, `framing`, `villain_ranges`
— each with a fresh `scenario_id`.
