# What is GTO Drill

**GTO Drill** is a crowd-powered GTO poker trainer built as a static web app on GitHub Pages. Players sign in, work through solver-verified poker scenarios, rate their confidence on each decision, and then see how their answer compares to both the GTO-optimal play and the rest of the crowd.

---

## The core loop

1. **Play a scenario** — you're dealt into a real poker situation (preflop through river) and choose an action.
2. **Rate your confidence** — 1 to 5, how sure are you?
3. **See the reveal** — the GTO-correct answer, why it's correct, and how everyone else answered.
4. **Find the blind spots** — the wrap-up surfaces where high-confidence disagreements live across the crowd. The moments when you were *sure* and *wrong* are where the deepest learning happens.

The app is not a quiz with right/wrong answers — it's a tool for discovering *where your intuition diverges from solver-verified play*, and where the crowd reliably misreads optimal strategy.

---

## Features

| Feature | Description |
|---------|-------------|
| **45-scenario library** | Preflop through river — range advantage, bet sizing, bluff-catching, board texture, ICM, and more |
| **Confidence ratings** | Rate every decision 1–5; the app finds where high-confidence errors cluster |
| **Crowd breakdown** | After you answer, see the full distribution — who picked GTO, where the splits are |
| **Villain ranges & equity** | Explore opponent ranges on an interactive 13×13 hand matrix; built-in Monte Carlo equity calculator |
| **Comments & notes** | Attach reasoning to any hand; comments are tied to the specific answer they were written about |
| **Hand replay** | Animated oval table showing the action street-by-street |
| **Compact view** | One-screen hand layout for long multi-street scenarios |
| **GTO concept tags** | Every scenario is tagged by concept (aggression, bluff-catching, ICM, etc.) for targeted study |
| **Mobile-first** | 44px tap targets, `:active` press feedback, `prefers-reduced-motion` support |
| **PWA-capable** | Installable, works offline after first load |

---

## Tech stack

- **Vanilla JS** — ES modules, no framework, no bundler, no transpilation
- **Firebase** — Google Auth for sign-in, Firestore for crowd response data
- **GitHub Pages** — static hosting, no server
- **PWA** — service worker + web app manifest

---

## Who it's for

Anyone studying GTO poker — from players who know the basics and want to sharpen their reads, to study groups who want a shared reference point for discussing solver lines. The crowd layer means you're not studying alone: every answer you give adds to the dataset that everyone learns from.
