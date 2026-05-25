# Mockup drop zone

Place the mockup source files here so the implementation can reference them
directly. Used to bridge the gap between the spec (which lives outside the
repo in `Design Audits/app-02-gto-duel/`) and the code that has to ship
against it.

## Expected file naming

Match the spec's mockup identifiers — single-letter prefix + number, plus
a short descriptive suffix:

```
M5-results-header.{html,png,svg,jpg,pdf}
M5-results-highlight.{...}
M5-gto-summary-card.{...}
M6-crowd-block.{...}
M7-crowd-hierarchy.{...}
M9-villain-range-fullscreen.{...}
M10-tap-to-go-deeper.{...}
M11-your-take-bottom-sheet.{...}
S1-scenario-briefing.{...}
```

Or use the PROJECT-HANDOFF queue names — whatever is on the mockup file
itself is fine, as long as it's unambiguous which deliverable maps to it.

## Which formats work

- **HTML mockup** — best. The implementer can read DOM structure, computed
  styles, copy chunks of CSS that match.
- **PNG / SVG / JPG / PDF** — usable but slower. The implementer has to
  measure pixel sizes by eye and infer the type ramp / colour tokens.
- **Annotated screenshot** — also usable; annotations help.

## Which mockups are needed right now

Per the gap inventory in this PR's parent conversation, the pending items
that still need source mockups before implementation:

- **M5 / Results-Header-v2 / Results-Highlight** — §8.1 GTO Summary Card.
  Now unblocked on data side (PR #156 wires the solver_data field onto
  scenarios.json). UI source pending.
- **Results-Villain-Range** — fullscreen equity tester launched from a
  villain-range card tap. Equity panel + range cards exist; the fullscreen
  launch is the missing connector.
- **Results-Notes** — §8.7 your-take bottom sheet. Inline comment box
  exists; bottom-sheet treatment is the missing variant.
- **Results-Social-v2** — §8.3 comments-as-glow ring variant. Green note
  dot ships today; glow ring is the missing visual.
- **Scenario-Briefing** — pre-decision briefing card. Currently the spot
  context + framing chips serve part of this; full briefing card pending.

## Committed or gitignored?

By default this directory is **gitignored** (see the top-level `.gitignore`
addition) so design-property mockups don't end up in the public repo without
the owner explicitly choosing to. Drop files here freely; pull what you want
to commit out of the gitignore.
