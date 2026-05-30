# Redesign Roadmap

The four-wave redesign plan, reconciled with what has shipped. Source: the UX meta-deliverable (design audit × Mobile Redesign Master Spec, 2026-05-22).

> **Visual reference:** See [[Redesign Mockups]] for screenshots of all 10 interactive mockups, or open `wiki/GTO-Duel-Master-Redesign-Package.html` for the full interactive spec.

---

## Status key

| Symbol | Meaning |
|--------|---------|
| Done | Shipped |
| Mostly done | Core shipped, cosmetic delta remains |
| Open | Not yet built |
| Blocked | Waiting on an owner decision |

---

## Wave 0 — trivial fixes

| Item | Source | Status |
|------|--------|--------|
| Base patch — `:active`, `:focus-visible`, hover-gating, tap-highlight | Spec §2.3 | Done (PR #115) |
| Finish the pivot — rename, align footer, refresh README | Finding 01 | Done (PR #121 — GTO Drill rebrand) |
| Honest small-crowd state — graceful low-n treatment | Finding 02 | Open |

## Wave 1 — rebuild the results screen

| Item | Source | Status |
|------|--------|--------|
| GTO summary card — lesson + solver-frequency bar + verdict + EV cost | §8.1 / M5 | Open — **data dependency** on new per-option fields in `scenarios.json` |
| "How everyone answered" crowd block | §8.2 / M6–M7 | Open — restructure, not new build |
| Villain-range subsection + fullscreen equity tester | §8.4–8.5 / M9 | Open |
| Study-the-line accordion + your-take bottom sheet | §8.6–8.7 / M10 | Open |
| Comments-as-glow + avatar tooltips | §8.3 | Mostly done (PR #117 added answer-context) |

## Wave 2 — compress the loop

| Item | Source | Status |
|------|--------|--------|
| Hand matrix *looks* editable — Tier-1 cell styling | §4.3 | Done (PR #115) |
| Hand matrix fullscreen editor — real 44px cells | §5 | Open |
| Compressed four-stage workflow | §6 / M2–M3 | Open |
| View toggle (expanded ⇄ compact) + coach mark | §7 / M4 | Open |
| Secondary controls → Tier 2, 44px | §4.2 | Done (PR #115) |
| Accessibility layer | §3 | Done (PR #115, #127, #129) |
| Shape pass — boxes for tags/badges | §2.4 / M8 | Done (PR #129) |

## Wave 3 — build the trainer

| Item | Source | Status |
|------|--------|--------|
| Crowd blind-spots aggregate view | Finding 02 | Open — depends on Wave 1 |
| Confidence calibration readout | Finding 03 | Open |
| Chip-and-felt vocabulary propagation | Finding 05 | Blocked (Decision 2) |
| Duel mode, opt-in (off by default) | Spec §8.8 | Open |

**Tally:** ~18 items — 6 done, 1 mostly done, 9 open, 2 decision-blocked.

---

## Owner decisions

### Decision 1 — the name
*Status:* **Resolved.** The app is now **GTO Drill** (PR #121).

### Decision 2 — decoration vs affordance
*Blocks:* Wave 3 "chip-and-felt propagation."

The principle is "affordance over decoration" — poker's chip-and-felt vocabulary is in-scope only if each instance is a functional readout (e.g. a chip stack where a short stack reads instantly as a blind spot).

### Decision 3 — crowd per-hand vs aggregate
*Affects:* Wave 3 "crowd blind-spots aggregate."

Confirmation that the cross-hand aggregate ("where the whole crowd reliably misreads GTO") is the signature payoff. Sitting on Wave 1's crowd block.

---

## Execution order

Waves are **dependency-driven** — each wave is the floor the next stands on.

1. **Unblocked now:** honest small-crowd state (Wave 0)
2. **Wave 1:** rebuild the results screen — biggest payoff, foundation for Wave 3
3. **Wave 2:** structural — fullscreen matrix, compressed workflow, view toggle
4. **Wave 3:** trainer surfaces — crowd aggregate, confidence calibration, opt-in duel
