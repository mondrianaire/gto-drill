You are picking up gto-poker-async-duel — a repo that was auto-built by AutoBuilder
(https://github.com/mondrianaire/auto-builder), ratified on 2026-05-16,
and promoted here for product life.

The current state of the deployed application is at: https://mondrianaire.github.io/gto-poker-async-duel-AB/

WHERE THIS CAME FROM (informational, not regulatory)

The original AutoBuilder prompt was:

Previously you created an application called "GTO Poker Training" that was a proof of concept and a mini research and analysis project for creating a web application that allows a user to play poker, track useful GTO orientated poker stats and had an almost "quiz like" application relating to presenting various "edge cases" that highlight specific GTO philosophies and presenting the user with various choices and ranking them and providing feedback based on interpretation of GTO research.

AutoBuilder's Discovery role interpreted that as:

An asynchronous two-player head-to-head GTO poker quiz game, hostable in full on GitHub Pages.

Major choices AutoBuilder made on the user's behalf (the inflection
points it surfaced and defaulted):

- Async-multiplayer state transport on GitHub Pages (static-only): External free-tier BaaS (specifically a free-tier Firebase or Supabase free project) — closest match to the stated requirements (async + notifications + persistence) without forcing the user to copy-paste links every turn, and avoids URL-length and re-encryption complexity
- Cross-user notification delivery mechanism: Web Push API + service worker + push relay tied to the IP1-selected BaaS
- Player identity / authentication model: BaaS anonymous auth (assumes IP1 lands on a BaaS) — gives the security-rules predicate required to lock a game's state to its two participants without forcing the user through a sign-up flow
- Pairing / game-creation flow: One player creates a game and shares a join URL/code with the other — simplest, matches the user's stated relationship (one specific opponent: his mom)
- Scenario source for the new build: Port the ancestor library as static data — fastest path, preserves the user's familiarity from playing with his mom
- 'Handful' size per turn batch: Game-creator-configurable handful size at game-creation time, alongside round count — matches the prompt's explicit 'set number of rounds' configurability for the symmetric axis
- Asynchronous in-game communication mechanism (A10): Per-scenario async note/comment — matches the user's anecdote (mom and son talking through hands), preserves async, light to build
- Confidence rating granularity: Discrete 1-5 scale — simplest input, comparable across scenarios for the confidence-gap computation, familiar UI vocabulary

Verification verdict was pass_with_concerns.



WHERE TO LOOK NEXT

Read .claude/CLAUDE.md in this repo — it's auto-generated and contains
the full orientation: build provenance, "you are here" framing, repo
structure, visual iteration paths (Chrome MCP or puppeteer), product-
life mode guidance, and links into the AutoBuilder corpus for deeper
"why was this built this way" forensics.

The build is your STARTING POINT, not a specification. The user's actual
goals may have shifted since the build ran, and the AutoBuilder choices
above were defensible defaults — not commitments. Treat them as context
for understanding what's currently there, not as a frame the product
must stay within.

FIRST ACTION

Read .claude/CLAUDE.md, take a look at https://mondrianaire.github.io/gto-poker-async-duel-AB/
(via Chrome MCP or puppeteer per the CLAUDE.md guidance), and tell me
what you see — what seems solid, what looks broken or unfinished, what
you'd want to know before making changes. Don't touch any files yet.
