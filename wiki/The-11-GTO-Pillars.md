# The 11 GTO Pillars

GTO no-limit hold'em study breaks into roughly eleven pillars. This page maps the current 45-scenario library against each one — what's covered, what's thin, and where the gaps are.

---

## Pillar breakdown

### 1. Preflop range construction
**RFI, vs-3-bet, vs-4-bet/5-bet, squeeze, blind play, set-mining.**

| Coverage | Scenarios |
|----------|-----------|
| **Strong** (14 scenarios) | #2, #4, #8, #11, #13, #14, #20, #26, #27, #28, #36, #37, #41, #44 |

The library's deepest pillar. Covers open-raising, 3-bet defense, 4-bet pots, blind-vs-blind, and ICM shove-or-fold.

### 2. Range / equity advantage & c-betting
**Who is *allowed* to bet, and how often.**

| Coverage | Scenarios |
|----------|-----------|
| **Strong** (7 scenarios) | #1, #10, #21, #24, #25, #34, #42 |

Scenario #1 is the flagship — it hides the hole cards so the player must reason range-vs-range, exactly as a solver does. Scenario #10 teaches the reverse: when the *out-of-position* player holds the range edge and should lead.

### 3. Bet sizing & polarization
**Small range-bet vs large polar bet vs overbet.**

| Coverage | Scenarios |
|----------|-----------|
| **Strong** (7 scenarios) | #3, #5, #16, #21, #22, #32, #42 |

The polar pair (#7 defense + #32 offense) teaches both sides of overbet theory. #21 isolates the range-bet — when your whole range crushes, you bet tiny with everything.

### 4. Board texture & runout dynamics
**Dry/wet/paired/monotone; turn & river shifts.**

| Coverage | Scenarios |
|----------|-----------|
| **Strong** (10 scenarios) | #1, #3, #6, #17, #18, #29, #30, #38, #39, #43 |

Scenario #3 is the standout — the turn flush card flips the nut advantage, teaching that range advantage is re-dealt on every street. #30 demonstrates checking overpairs on monotone boards.

### 5. Bluff-catching, MDF & blockers
**Minimum defense frequency and blocker reasoning.**

| Coverage | Scenarios |
|----------|-----------|
| **Strong** (10 scenarios) | #6, #7, #9, #12, #17, #29, #33, #39, #40, #41 |

Scenario #7 is the defensive masterclass — a river overbet forces MDF, polarized-range recognition, and blocker reasoning into one binary decision. #12 routes through the equity calculator as a natural part of solving a blocker problem.

### 6. Drawing, semi-bluffing & equity realization

| Coverage | Scenarios |
|----------|-----------|
| **Strong** (8 scenarios) | #4, #8, #9, #16, #23, #26, #35, #37 |

Covers flush draws, straight draws, combo draws, and the semi-bluff decision. Good variety of street and position.

### 7. Pot control & SPR
**Stack-to-pot ratio management.**

| Coverage | Scenarios |
|----------|-----------|
| **Strong** (7 scenarios) | #1, #15, #21, #30, #31, #38, #43 |

#21 isolates SPR directly — a 4-bet pot with SPR ≈ 1.8 where the entire range bets small. The SPR lesson transfers to every pot size.

### 8. ICM & tournament-specific play

| Coverage | Scenarios |
|----------|-----------|
| **Thin** (2 scenarios) | #11, #36 |

Both are shove-or-fold. The library needs the *call* side of ICM, satellite folds, pay-jump laddering, and big-stack pressure. See [[Adding Scenarios]] for 8 proposed ICM scenarios.

### 9. Multiway pots

| Coverage | Scenarios |
|----------|-----------|
| **Major gap** (1 scenario) | #34 |

Only one three-handed pot in the entire set. Multiway dynamics — shrunk fold equity, wider caller ranges, tighter value thresholds — are almost entirely absent. 4 multiway scenarios are proposed.

### 10. Stack-depth variety

| Coverage | Scenarios |
|----------|-----------|
| **Narrow** | Mostly 100bb; 40bb (#4), 20bb (#36), 12bb (#11) |

The library is an excellent 100bb cash-game trainer but barely explores what changes at 200bb or at 30bb. Deep-stack scenarios (SPR flips overpairs into bluff-catchers) and short-stack scenarios (preflop range widening for implied odds) are proposed.

### 11. Player count / table format

| Coverage | Scenarios |
|----------|-----------|
| **Absent** | None |

No heads-up or short-handed scenarios. Heads-up is a natural fit — the SB raises ~80–90% of hands, which produces dramatic "fold this full-ring, raise it heads-up" gotcha moments.

---

## Summary

Pillars 1–7 are mature and well-balanced across streets. The gaps are on the **context axis**: what changes when the pot is multiway, when it's a tournament with real money jumps, when stacks are very deep or very shallow, and when only two players are dealt in. Those four contexts (pillars 8–11) are where new scenarios add the most value. See [[Adding Scenarios]] for the full proposal.
