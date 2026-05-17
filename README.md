# gto-poker-async-duel

> Build a GitHub-Pages-hostable web application that lets two users play an asynchronous head-to-head GTO poker quiz, submit per-decision confidence ratings, and receive a post-game summary highlighting their highest-confidence disagreements.

This standalone repository is the production deliverable from AutoBuilder run **`gto-poker-async-duel`**, forked here on 2026-05-16T21:06:14Z for ongoing product development.

## Original prompt

```
Previously you created an application called "GTO Poker Training" that was a proof of concept and a mini research and analysis project for creating a web application that allows a user to play poker, track useful GTO orientated poker stats and had an almost "quiz like" application relating to presenting various "edge cases" that highlight specific GTO philosophies and presenting the user with various choices and ranking them and providing feedback based on interpretation of GTO research.

I introduced my mom to this application and she loved it. We would read through the hand descriptions, and guess to each other what the correct answer was. When we entered it and saw the actual data, it was so much fun and so informative to be able to read the GTO description and defense of "optimal" plays while identifying plays where confidence may be lower and the answer may not be as clear cut.

I do not live physically near my mom and I was thinking how easy it would be to extrapolate on this GTO build and attempt to create an asynchronous multiplayer GTO Poker head to head quiz game where users are presented with identical GTO "gotchas" and there is some type of communication either direct or in game to discuss or diagree with the GTO verified action.

In addition to a selection of a correct answer, it would be neat to implement a "confidence" function where users indicate how sure they are of their decisions. This would allow a post-game wrap up screen that highlighted the GTO gotchas that showed the highest confidence gap between differing answers.

It is imperative that this application fully can be hosted on github pages, that the game fully functions asynchronsly, and users can "build up" a handful of answers before they must wait for the other user to submit their answers and then create more for the opposing player. This rotation goes for a set number of rounds and then statistics regarding player performance and player agreement is shown to both users. If possible implement an opt in notification function that will use mobile or desktop notification libraries to notify the opposing player that it is their turn.
```

## Build provenance

| Field | Value |
|---|---|
| AutoBuilder verdict | `pass_with_concerns` |
| First-delivery outcome | `succeeded_with_concerns` |
| Ratified | 2026-05-16T10:17:18.869Z by **Jett** |
| Architecture version | `unknown` |
| Build wall-clock | 135 minutes |

## What's here

This repository contains the production deliverable as built by AutoBuilder — the contents of `runs/gto-poker-async-duel/output/final/` at the time of ratification. The build substrate (design decisions, audit logs, run report, state, etc.) lives in the AutoBuilder corpus and is not duplicated here.

The entry point is typically `index.html` (for web apps) or the main script file for other deliverable kinds. See the build context link below for the run-report's full description of what this artifact is and how it was built.

## Build context

Full build provenance — design decisions, audit logs, run report, root-cause analysis if any — lives in the AutoBuilder corpus at:

  https://github.com/mondrianaire/auto-builder/tree/main/runs/gto-poker-async-duel

That corpus entry is **frozen at the ratification commit** and will not change going forward. The build factory is done with this build; what you're looking at here is the product, free to evolve.

## Local development

GTO Duel is a static ES-module app, but it **cannot be opened directly as a
`file://` page** — browsers block module imports and the `fetch()` of
`data/scenarios.json` under the `file:` protocol, and service workers /
notifications require an `http` origin. Run the bundled dev server instead:

```bash
npm start
# or, equivalently, with no install step:
node scripts/dev-server.mjs
```

Then open <http://localhost:8000/>. The default port is `8000`; override it
with `node scripts/dev-server.mjs 3000` or the `PORT` environment variable.
The server has no dependencies — it uses only Node's built-in modules
(requires Node 18+).

> **Note:** local runs connect to the same production Firebase project as the
> deployed site, so games you create while testing locally land in the same
> Firestore as real games.

## Continuing development

This repository is yours to evolve. Future commits, refactors, features, bug fixes — all land here, not in the AutoBuilder repo. The AutoBuilder corpus measurement of this build does not change retroactively based on what happens here.
