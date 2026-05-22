# GTO Drill — Redesign Roadmap (reconciled)

Reconciles the UX **meta-deliverable** (design audit × Mobile Redesign Master
Spec, 2026-05-22) with what has actually shipped since. The audit's snapshot was
**build v2026-05-21.106**; live at reconciliation is **v2026-05-22.113**, so a
chunk of the roadmap was completed in parallel and is de-staled below.

The meta-deliverable and its two source documents live in the owner's
`Design Audits/app-02-gto-duel/` folder (outside this repo). `SCENARIO-RESEARCH.md`
is a separate, parallel track — scenario *content*, not UX.

---

## Shipped in parallel with the audit

The audit was walked against v.106. These merged afterward:

- **PR #115 — mobile affordance pass (v.111).** Affordance tokens; the base
  patch (`:active` / `:focus-visible` / hover-gating / tap-highlight); Tier-2
  secondary controls at 44px; Tier-1 matrix-cell styling; focus rings;
  `--border-interactive` at ≥3:1 contrast; `prefers-reduced-motion`.
- **PR #116 — retest no longer destroys a saved comment (v.112).**
- **PR #117 — comments store the answer they were written about (v.113).**

The meta-deliverable's gap-callout — *"the app has zero `:active` rules"* and
*"`--border` at 1.30:1"* — was closed by #115. Both statements are now stale.

---

## The four waves — re-scoped

Status key: ✅ done · ◑ mostly done · ⏳ open · 🔒 blocked on an owner decision.

### Wave 0 — trivial fixes

| Item | Source | Status |
|------|--------|--------|
| Base patch — `:active`, `:focus-visible`, hover-gating, tap-highlight | Spec §2.3 | ✅ PR #115 |
| Finish the pivot — rename, align footer, refresh README | Finding 01 | 🔒 Decision 1 (the name); the edit is trivial once chosen |
| Honest small-crowd state — graceful low-n treatment | Finding 02 | ⏳ open · small · unblocked |

### Wave 1 — rebuild the results screen

| Item | Source | Status |
|------|--------|--------|
| GTO summary card — lesson + solver-frequency bar + verdict + EV cost | §8.1 / M5 (Finding 04) | ⏳ open · **data dependency** — `scenarios.json` carries no EV-cost or solver-frequency field; the card's headline numbers need a new per-option data field across every scenario |
| "How everyone answered" crowd block | §8.2 / M6–M7 | ⏳ open · **restructure**, not new build — `buildCrowdBreakdown` already has the per-option distribution, GTO / your-pick / blind-spot tags, avatars and confidence; this brings it to the M6–M7 layout |
| Villain-range subsection + fullscreen equity tester | §8.4–8.5 / M9 | ⏳ open · range cards + the equity panel exist; the fullscreen launch is new |
| Study-the-line accordion + your-take bottom sheet | §8.6–8.7 / M10 | ⏳ open · the GTO explanation + comment box exist; the accordion + bottom-sheet patterns are new |
| Comments-as-glow + avatar tooltips | §8.3 | ◑ already in the app — green note-dot + tap popover on crowd avatars; #117 added the answer-context line. Only a cosmetic delta vs the spec (dot vs glow ring) |

### Wave 2 — compress the loop

| Item | Source | Status |
|------|--------|--------|
| Hand matrix *looks* editable — Tier-1 cell styling | §4.3 | ✅ PR #115 |
| Hand matrix fullscreen editor — real 44px cells | §5 | ⏳ open · structural · the actual touch-target fix (cells are still ~20px inline) |
| Compressed four-stage workflow — board strip, action timeline, decision panel | §6 / M2–M3 | ⏳ open · structural |
| View toggle (expanded ⇄ compact) + first-run coach mark | §7 / M4 | ⏳ open · structural |
| Secondary controls → Tier 2, 44px | §4.2 | ✅ PR #115 |
| Accessibility layer — focus rings, contrast, reduced-motion, ARIA | §3 | ✅ focus rings / contrast / reduced-motion (#115); spot-summary keyboard role + Enter/Space (#127) closed the last ARIA gap |
| Shape pass — boxes for tags/badges | §2.4 / M8 | ✅ PR #129 — 7 static badges/tags moved off the 999px pill onto a `--radius-box` token; buttons left as-is per owner call (consistency-only scope) |

### Wave 3 — build the trainer

| Item | Source | Status |
|------|--------|--------|
| Crowd blind-spots aggregate view | Finding 02 | ⏳ open · depends on Wave 1's crowd block |
| Confidence calibration readout | Finding 03 | ⏳ open · spends the 1–5 input already collected |
| Chip-and-felt vocabulary propagation | Finding 05 | 🔒 Decision 2 |
| Duel mode, opt-in (off by default) | Spec §8.8 | ⏳ open · the retired duel code still exists (task #79) — this is partly a revive, not a from-scratch build |

**Tally:** ~18 items — 6 done, 1 mostly done, 9 open, 2 decision-blocked.

---

## The three owner decisions

### Decision 1 — the name
*Blocks:* Wave 0 "finish the pivot."
The audit's test (not the word): the name should signal **GTO practice** and
**a crowd you learn alongside**, and must **not promise a private one-to-one
match**. "Duel" survives as the name of the opt-in mode (§8.8).
*Recommendation:* rename; the word is the owner's call.

### Decision 2 — decoration vs affordance
*Blocks:* Wave 3 "chip-and-felt propagation."
Finding 05 wants poker's chip-and-felt vocabulary extended onto the profile,
roster and home screens; the spec's principle is "affordance over decoration."
They reconcile **only if each instance is a functional readout** — e.g. a chip
stack where a short stack reads instantly as a blind spot, beating a flat bar.
*Recommendation:* in-scope under that test, scheduled in Wave 3; cut any
instance that is theme-only.

### Decision 3 — crowd per-hand vs aggregate
*Affects:* Wave 3 "crowd blind-spots aggregate."
Not a design conflict — a scheduling confirmation. The corrected telos says the
cross-hand aggregate ("where the whole crowd reliably misreads GTO") is the
signature payoff.
*Recommendation:* confirm yes; it is a Wave 3 build sitting on Wave 1's crowd
block.

---

## Execution order once the decisions land

Wave order is **dependency-driven** (per the meta-deliverable) — each wave is the
floor the next stands on.

1. **Unblocked now — startable without any decision:** the honest small-crowd
   state (Wave 0). The shape pass and the residual ARIA gaps (both Wave 2) are
   done (PR #129, #127).
2. **After Decision 1:** finish the pivot (Wave 0) — trivial once the name exists.
3. **Wave 1 — rebuild the results screen.** The biggest payoff chunk and the
   foundation Wave 3's aggregate sits on; build it before Wave 3 regardless of
   impact ranking. Resolve the §8.1 EV-cost / solver-frequency **data dependency**
   early — it gates the summary card.
4. **Wave 2 structural** — fullscreen matrix editor, compressed workflow, view
   toggle. May run in parallel with Wave 1 but lands after it.
5. **Wave 3 — the trainer surfaces** — crowd aggregate (Decision 3), confidence
   calibration, opt-in duel; chip-and-felt pending Decision 2.

This document is the plan; nothing here is built yet. Execution starts once the
three decisions above are made.
