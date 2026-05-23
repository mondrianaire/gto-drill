# Redesign Mockups

Ten interactive mockups from the **Mobile Redesign Master Spec**. Each mockup is a self-contained HTML prototype built on the app's existing CSS tokens — the AFTER versions respond to tap and click.

For the full interactive experience, open `wiki/GTO-Duel-Master-Redesign-Package.html` in a browser.

---

## M1 — Component library, compact hand view, view toggle

Before/after for every interactive component, plus the one-screen hand view and the view toggle. Covers the base patch (`:active` + `:focus-visible`), Tier-1 matrix cells, Tier-2 secondary controls, Tier-4 range cards, and the pill-vs-box shape rule.

**Refs:** Spec §2–4, §6, §7

![M1 — Component library](https://app.devin.ai/attachments/fbef000f-1de8-41fe-88ae-beb46dcb0844/M1.png)

---

## M2 — The four-stage compressed loop

Hand display → input → results → next hand, each fitting one ~700px viewport. The results stage compresses via progressive disclosure — verdict + lesson + crowd always visible; deep content collapses into tap-to-open sections.

**Refs:** Spec §6

![M2 — Compressed workflow](https://app.devin.ai/attachments/0e88f5f2-be0f-4113-b5ca-9501a5b28e35/M2.png)

---

## M3 — Compact hand-display layout

The oval 6-seat table collapsed to a board runout strip + one-line action timeline. Board, hand, history and the decision all fit above the fold on a 390px iPhone. Before: ~3 scrolls. After: 0 scrolls.

**Refs:** Spec §6.1

![M3 — One-screen hand view](https://app.devin.ai/attachments/6918bfd6-f814-4c69-83be-33354e8c672c/M3.png)

---

## M4 — View toggle — placement and states

The expanded ⇄ compact toggle in the scenario card's top-right corner, clear of the animation layer. A 32px icon button, absolutely positioned — adds 0px of layout height. Four states: resting, keyboard focus, first-run coach mark, active.

**Refs:** Spec §7

![M4 — View toggle](https://app.devin.ai/attachments/d43be85b-a9c9-4022-a07d-9d253b1ad022/M4.png)

---

## M5 — GTO summary card

The lesson header, solver-frequency bar, verdict and EV cost fused into one compact card (~84px vs the old ~128px). Shows the solver's mix across every action with a `YOU` pin on the player's pick. The EV cost quantifies the mistake.

**Refs:** Spec §8.1

![M5 — GTO summary card](https://app.devin.ai/attachments/29e1369a-9468-4ecd-b83a-9082b5e06ff1/M5.png)

---

## M6 — User-pick highlight in the crowd block

The player's chosen answer becomes an elevated, red-framed card with a filled `YOUR PICK` marker. The GTO line gets its own green-flagged card. Other rows recede to thin, dimmed lines.

**Refs:** Spec §8.2

![M6 — User-pick highlight](https://app.devin.ai/attachments/75704cf7-55be-400a-91e0-8e3601ae2912/M6.png)

---

## M7 — Crowd default, optional duel, comments-as-glow

The crowd database as the always-visible spine. The head-to-head duel returns as an optional mode (off by default). Comments are an indicator, not a feed — a green glow ring on a player's avatar means they left a take; the text appears on hover/tap.

**Refs:** Spec §8.2, §8.3, §8.8

![M7 — Crowd and duel](https://app.devin.ai/attachments/2c1506b4-b180-441b-af84-7b8849b54f71/M7.png)

---

## M8 — Lesson header + compact box tags

GTO concept tags as low-profile boxes (~17px) instead of pills (~23px). The pill shape is reserved for action buttons. ~6px saved per tag row — on a stacked mobile layout, those pixels are the budget.

**Refs:** Spec §8.1, §2.4

![M8 — Compact box tags](https://app.devin.ai/attachments/616d1f08-310a-4e97-b78a-a0378135aa36/M8.png)

---

## M9 — Villain-range subsection + fullscreen equity tester

Villain's range as its own titled subsection with compact range cards (~52px each: mini grid thumbnail + summary). Tapping a card launches the fullscreen equity tester — the matrix finally gets the room it needs.

**Refs:** Spec §8.4, §8.5

![M9 — Villain range](https://app.devin.ai/attachments/57f18c9f-1b38-46ba-ad84-e37e89c7d047/M9.png)

---

## M10 — Your-take section + bottom-sheet editor

A compact entry point for the player's public take. One dashed row when empty, one solid row when filled. Writing happens in a bottom sheet — 0px cost to the results layout. Posting lights the green ring on the player's avatar in the crowd rows.

**Refs:** Spec §8.7

![M10 — Your-take section](https://app.devin.ai/attachments/2276e135-4099-4f11-8eb2-2fe185d183d4/M10.png)

---

## Implementation priority

| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 1 | Base patch — `:active` + `:focus-visible` + `touch-action` + hover-gating | XS | Highest |
| 2 | GTO summary card — lesson header, solver-mix bar, EV cost | M | Highest |
| 3 | "How everyone answered" — crowd block with user-pick highlight | M | Highest |
| 4 | Matrix — Tier-1 styling + fullscreen equity tester | M–L | Highest |
| 5 | Villain's range subsection — range cards + launch | M | High |
| 6 | Compressed workflow — the four one-viewport stages | M–L | High |
| 7 | View toggle + first-run coach mark | S–M | High |
| 8 | Secondary controls → Tier 2, 44px | S | High |
| 9 | Accessibility layer | M | High |
| 10 | Comments-as-glow + avatar tooltips | S | Medium |
| 11 | Your-take section + bottom-sheet editor | S–M | Medium |
| 12 | Shape pass — pills → boxes for all tags/badges | S | Medium |
| 13 | Duel mode (opt-in) | M | Medium |

**Ship first:** items 1–4. Item 1 is a ~25-line drop-in; items 2–4 rebuild the results screen.

See [[Redesign Roadmap]] for current status of each item.
