# Changelog

All notable changes to GTO Drill are recorded here.

## [Unreleased]

### ⚠ Firestore rules update required (v2026-05-20.63 and v2026-05-20.75)

Two cumulative rule changes need to be live in the Firebase Console
(Firestore Database → Rules → Publish):

1. **List query for participant's own active games** (v2026-05-20.63)
   — adds an OR branch on the existing `allow list` rule so the
   "Your active games" panel can read games where the caller is a
   participant.

2. **Delete on orphan lobbies** (v2026-05-20.75) — flips the previous
   `allow delete: if false` to allow any signed-in user to delete a
   game whose status is still `waiting_for_opponent`. Powers the
   new "×" delete button on the Join-screen lobby browser; in-progress
   and completed games still cannot be deleted.

Both changes live in the repo's `firestore.rules`. Paste the full file
into the Console and Publish — both the active-games panel and the
lobby delete button silently no-op until the rules are live.

### Changed
- **Comments-as-glow on crowd avatars** (v2026-05-24.145). The green
  corner dot from v.117 is gone; in its place the avatar itself gets a
  green glow ring when the player has left a take — quieter, reads as
  part of the avatar at a glance, and matches Results-View-Spec §5 /
  mockup `GTO-Duel-Results-Social-v2.html`. The hover/tap tooltip now
  shows the player's name + the pick they made + their confidence + the
  take text (e.g. `Theo · Squeeze · conf 5 · "Range's capped — squeeze
  just prints."`) so the take stays anchored to what they actually
  answered at the time, not their current answer if they later
  retested. A one-line hint appears under the crowd block ("Green ring
  = left a take · tap an avatar to read it") only when at least one
  response in the displayed pool actually has a take, so it doesn't
  show up as noise on a take-less crowd.

  The avatar wrap is now a real `<button>` with `aria-haspopup` /
  `aria-expanded`, replacing the previous role=button div. Tooltip
  enters with a 120 ms opacity+scale transition; clicking outside the
  avatar closes any open tooltip (scoped to the crowd element — no
  leaked global listener).

### Changed
- **Dual-lane solver-data with per-lane file separation** (v2026-05-25.149).
  Until now both extractors (`texas-extract.mjs`, `gto-extract.mjs`) wrote
  to the same `solver-output/solver-data.json`, which meant running one
  lane after the other clobbered the first's data. This kept the project
  from doing the practical thing: run TexasSolver across all 31 scenarios
  for cheap baseline freq, then layer GTO+ on top for the EV annotation
  the M5 GTO Summary Card consumes (`≈X BB cost` on misses) — without
  losing the TexasSolver freq for scenarios GTO+ doesn't solve.

  Now:
  - `texas-extract.mjs` writes `solver-output/solver-data-texas.json`
  - `gto-extract.mjs`   writes `solver-output/solver-data-gto-plus.json`
  - `gto-merge.mjs` reads BOTH lane files (plus the legacy single-file
    `solver-data.json` for back-compat), unions them per scenario, and
    GTO+ wins on overlap because it carries EV. Each merged scenario
    gets a `source` tag (`"TexasSolver"` / `"GTO+"`) reflecting which
    lane fed it.
  - The merge output now shows a per-scenario lane tag
    `[GTO+]`/`[Tex ]`/`[leg ]` and a final breakdown by lane.

  Plus a bug fix in the merger: `best_solver_action` was null on every
  TexasSolver-fed scenario because the picker required EV (which
  TexasSolver dumps don't carry). It now falls back to the highest-
  frequency action when EV is unavailable, so the field is always
  populated. This refreshes `best_solver_action` + `best_scenario_action`
  on all 31 previously-merged scenarios in `data/scenarios.json` — pure
  null → populated, no behavior change beyond that.

### Added
- **Scenario-Briefing modal + Header-v2 tooltips** (v2026-05-25.148). Two
  mockup items land together because they share the same `data/dictionary.json`
  + scenario-flag infrastructure:

  1. **Briefing modal for major-flag scenarios** —
     `GTO-Duel-Special-Scenarios-Spec.md` §4 / mockup
     `mockups/GTO-Duel-Scenario-Briefing.html`. Scenarios whose setup
     materially changes what the player is judging (right now: hidden hole
     cards — a range-vs-range spot) open a clickthrough briefing before
     the hand becomes interactive. Centered modal over a scrim, focus
     trapped on the `Start hand →` button, no Escape / scrim-tap exit
     (the spec's deliberate one-friction-point so the player can't
     miss the difference). After dismissal the hand displays normally
     and a compact `⚠ HIDDEN CARDS` tag stays in the scenario header
     (§5) — tap it to re-open the briefing in review mode (which DOES
     allow Escape / scrim-tap dismissal because the player has already
     read it). Per spec §6 the briefing re-arms on every scenario entry,
     including Replay.

  2. **Concept tags become tap-to-define** —
     `mockups/GTO-Duel-Results-Header-v2.html`. The four `.gc-tag` boxes
     on the M5 GTO Summary card are now wired to the same dictionary
     tooltip used by inline term-triggers: hover on desktop, tap on
     mobile, with the popover carrying the term + short definition + an
     `Open in dictionary →` affordance. 6 of the 10 distinct
     `concept_tags` in `data/scenarios.json` map cleanly to existing
     dictionary entries (directly or via aliases — `bluffing` → bluff,
     `bluff-catching` → bluff-catcher, `equity-realization`,
     `value-betting` → value bet, `pot-control`, `icm`); the remaining
     four (`aggression`, `board-texture`, `preflop`, `range-reading`)
     stay as static prettified-label tags until their dictionary
     entries land.

  New exports in `src/ui.js`: `getScenarioFlags()` (the generic flag
  model — minor and major flags as data, no bespoke UI per type),
  `hasMajorScenarioFlag()`, `buildScenarioFlagTag()` (the persistent
  header tag), and `buildScenarioBriefingModal()` (the popup). The
  existing `buildScenarioInfo` pane is unchanged in look but now
  scopes itself to MINOR flags only — major flags are surfaced via the
  modal + header tag, and showing both would be a duplicate. The
  `solo.js` render() now hosts a small briefing state-machine
  (`activeBriefing`, `briefingDismissedFor`) so the gate-mode modal
  fires once per scenario entry, the header tag re-opens it in review
  mode mid-hand without re-gating, and `unmount()` tears down any
  open modal so leaving the solo view doesn't orphan it.

- **M5 — GTO Summary Card** (v2026-05-25.146). The reveal screen now leads
  with a single ~84px card that replaces three previously stacked elements
  (the lesson takeaway pill, the GTO line one-liner, and the verdict bar).
  Three rows per the spec:
  1. **Lesson + concept tags** — the scenario's `lesson_tag` as the title,
     plus up to 4 `concept_tags` rendered as compact boxes (caps at +N for
     scenarios with more than 4).
  2. **Solver-mix bar** — a horizontal bar segmented by per-action
     frequency from `scen.solver_data.options`, with the GTO segment in
     green, the player's pick in pink with a `YOU` pin above it, and any
     remaining lines in neutral grey. Includes a `≈X BB cost` annotation
     on misses. Gracefully omitted when `solver_data` is absent — the
     card still works as a tighter lesson+verdict block until the solver
     pipeline lands data on this scenario.
  3. **Verdict + EV + why** — `✓`/`✗` + EV-cost chip + one-sentence
     reason (first sentence of `gto_explanation`).

  New `buildGtoSummaryCard()` in `src/ui.js`. `buildRevealResult` now
  accepts a `hideVerdict` option so it can keep showing the comparison +
  opponent panel without duplicating the verdict the card carries. The
  legacy `buildLessonTakeaway` + `buildGtoRead` are still exported for
  any non-reveal callers but the reveal layout no longer mounts them.

  Implements `GTO-Duel-Results-View-Spec.md` §3 / mockup
  `design-audit/mockups/gto-duel-mobile-redesign/mockups/GTO-Duel-Results-GTO-Summary.html`.

### Changed
- **Compact-view polish round** (v2026-05-23.143). Five small moves on the
  compact one-screen hand view that close the remaining recommendations from
  spec §6.1 / §7 and the decision-screen-recomposition design audit:
  - **Confidence reveals after action is picked.** Move 04 of the audit:
    "the player meets one question at a time." The 1–5 confidence strip + its
    label are now hidden until an action lands, then slide in with a 280 ms
    opacity/height transition (instant for `prefers-reduced-motion`). The
    `.needs-confidence` glow + lock-in-button gate behave exactly as before.
  - **Villain seat surfaced on the hero strip.** The compact layout otherwise
    loses the positional opposition the oval table draws by placing seats
    across the felt — a "vs BB" suffix on the hero seat label now restores it,
    rendered in the project's villain accent so the opposition reads at a
    glance without competing with the hero label. `primaryVillainSeat()`
    picks the most-recent non-folded actor, falling back to the first non-hero
    seat in table order.
  - **SPR chip in the decide prompt.** Stack-to-Pot Ratio joins Pot / To call
    / Pot odds when there's a board to act on — postflop's go/no-go shorthand.
    Capped at "20+" to keep deep-stack start-of-flop spots from showing a
    number the player can't usefully act on; rounded to 1 dp under 10, whole
    numbers above.
  - **View-toggle icon glyph.** The toggle picks up a CSS-masked SVG glyph
    that mirrors the destination view — three rows when the target is compact,
    an oval when the target is table. The mask uses `background-color:
    currentColor`, so the existing dim → accent state change applies to the
    glyph for free.
  - **ROADMAP de-staled.** Wave 2's "Compressed four-stage workflow" and
    "View toggle + first-run coach mark" rows were ⏳ open but actually
    shipped in v.128–135 + v.131–132. Both flipped to ✅ with the version
    trail.

### Fixed
- **Batch generator: strip template's solved MAIN TREE** (v2026-05-22.139).
  `gto-batch-generate.mjs` was inheriting the template's MAIN TREE section
  verbatim, so if the template was saved *after* a solve (which it typically is —
  you set up wide ranges, hit solve, then save), the per-scenario `.gto2` files
  carried the template's stale 500+ KB strategy data alongside the substituted
  HEADER. GTO+ would then either skip them in PROCESS FILES (sees them as
  already-solved) or use the stale wide-range solve data with the wrong HEADER
  ranges. Fix: replace MAIN TREE with the 62-byte empty stub (captured from
  `test.gto2`) during generation, so GTO+ re-solves from scratch. Output size
  drops from ~545 KB per file to ~1.5 KB per file.

### Added
- **GTO+ batch-solve infrastructure** (v2026-05-22.138). Two new scripts that
  close the gap between paste-pack-by-hand and fully-batch-solved scenarios:
  `scripts/gto-batch-generate.mjs` takes a max-budget `.gto2` template and emits
  one ready-to-batch-solve `.gto2` per scenario (45 files) into `solver-output/`,
  substituting per-scenario hero range / villain range / board / pot / stack
  into the template's HEADER section and recomputing section length, content
  bytesum, and the `@12` forward pointer per the binary spec we reverse-
  engineered earlier. `scripts/gto-template-check.mjs` validates that a template
  has enough combo budget for the widest scenario (688 hero combos / 1326 villain
  combos across our 45) — prevents the OOM-during-solve failure mode we hit
  empirically. New runbook at `docs/SOLVER-PIPELINE.md` covers the full
  four-step workflow: generate → PROCESS FILES batch solve → socket extract →
  merge to scenarios.json.
- **Preflop range library + GTO+ solver pipeline** (v2026-05-22.137). Three-source
  consensus preflop range data (`data/preflop-ranges.json`, 52 scenario keys,
  6 RFI ranges + all major defense scenarios at 100bb 6-max cash) aggregated from
  greenline, pekarstas, and tyloo (each cell requires ≥2 source agreement to be
  included). `src/preflop-ranges.js` exports `deriveRanges(scen)` which walks the
  scenario's preflop action chain, identifies hero + villain archetypes
  (RFI / vs-open / vs-3bet / etc), and returns derived ranges for the decision
  point — 76% of our 45 scenarios resolve cleanly to chart-cited ranges, the rest
  fall back to the dealt-hand class (limped pots, ICM short-stacks, BB-vs-SB
  heads-up). New scripts: `scripts/gto-pastepack.mjs` generates per-scenario
  GTO+ setup sheets to `solver-input/<id>.gtopaste.txt` (chart-derived hero range
  + authored postflop villain range or chart-derived preflop fallback);
  `scripts/gto-extract.mjs` connects to GTO+'s socket interface (TCP 55143,
  auth via `tmp/customconnect.txt`) and extracts per-action FREQ + EV per combo
  from solved `.gto2` files into `solver-output/solver-data.json` — the input
  for the §8.1 GTO Summary Card.

### Changed
- **Reveal "TAP TO GO DEEPER" accordion** (v2026-05-22.136). The deeper-dive
  reveal sections — strategic preamble, per-option matrix, villain range +
  equity tester, "your take" comment — now sit in collapsible `<details>`
  accordion items below a centered "TAP TO GO DEEPER" divider. Above-fold
  stays focused: takeaway → GTO answer → verdict → crowd. Each accordion item
  is one tap to open, defaults closed; the rotating chevron and dim/accent
  open-state are pure CSS, the native `<details>` element handles tap +
  keyboard + a11y. The villain-range + equity panel + Test-it row are
  grouped into a single "Villain's range + equity" section so clicking a
  range card or Test-it opens the equity panel inline within the same
  accordion section. Mockup M3 §8.6 compressed-workflow pass.
- **Compact decide-phase prompt + context chips** (v2026-05-22.135). On the
  compact-view DECIDE screen the action timeline now hides and is replaced by a
  one-line villain-action prompt ("BB raises to 7 bb on the flop — your move")
  plus a small chip strip of the three numbers a poker decision actually turns
  on: **Pot**, **To call**, **Pot odds** (auto-omitted when there's no live
  bet). The timeline returns on REVEAL where action history is part of the
  post-decision analysis. New helper `buildDecidePrompt` in `replay.js`.
- **M3 polish: runout dividers + street-progress dots** (v2026-05-22.134). Two
  small visuals from the compressed-workflow mockup: a thin vertical separator
  between FLOP / TURN / RIVER groups inside the runout strip, and a four-dot
  PRE / FLOP / TURN / RIVER progress indicator in the scenario headline (done /
  current / not-yet — accent-glow on the current street).

### Added
- **Per-scenario TexasSolver config export** (v2026-05-22.133). The owner
  Database console now shows a **⚙ Solver** button on every postflop scenario's
  coverage row — it downloads a TexasSolver console config (`.txt`) for that
  scenario's decision spot: board, decision-point pot + effective stack, the
  villain range (merged from `villain_ranges[].classes`), and the static
  bet-tree / solve block. The hero range is a marked `PASTE_HERO_RANGE_HERE`
  placeholder — scenario data stores only the dealt hand, not a hero range — so
  each config needs the hero range filled before solving. Owner tooling toward
  the §8.1 solver data; preflop scenarios (no board) get no export.
- **First-run compact-view coach mark** (v2026-05-22.132). The first time a
  decide screen overflows the viewport in the expanded (table) layout, a
  one-time hint fades in beside the view toggle — "This hand runs long — tap
  Compact view to fit it on one screen." It auto-dismisses on any tap or after
  six seconds and is recorded as seen, so it appears at most once per device.
  Completes the §6.1 / §7 compact one-screen hand view.
- **Compact one-screen hand view + toggle** (v2026-05-22.131). The compact
  layout (spec §6.1 / §7) is now live and wired into the play screen: a
  **Compact view** toggle in the scenario headline switches the hand display
  from the animated oval table to the runout strip + hero strip + action
  timeline, so a long hand fits one viewport with no scroll to the decision.
  The animated table stays the default; the choice persists per device
  (`localStorage`). The first-run overflow coach mark (§7) follows.
- **Compact-view hero strip** (v2026-05-22.130). Second component of the compact
  one-screen hand view (spec §6.1 / mockup M3): `buildHeroStrip` renders the
  hero's seat, hole cards, and decision-point stack on one line — the compact
  layout's replacement for the oval table's hero seat. Standalone component for
  now; the compact assembly and the §7 view toggle follow.
- **Compact-view board-runout strip** (v2026-05-22.128). First component of the
  compact one-screen hand view (spec §6.1 / mockup M3): `buildRunoutStrip`
  renders the flop/turn/river board dealt once as a compact strip with the
  decision-point pot — the compact layout's replacement for the oval table's
  felt board. Standalone component for now; the hero strip, the compact
  assembly, and the expanded⇄compact view toggle (§7) follow.
- **Verdict tint on the GTO reveal** (v2026-05-22.127). On the reveal screen
  the browser toolbar's `theme-color` now shifts to the hand's outcome — a dark
  green on a match, a dark red on a miss — and rests at the neutral near-black
  `#0f1a24` on every other screen. A peripheral, ambient echo of the on-screen
  verdict at zero layout cost; it only reinforces the verdict already shown in
  text and shape (the ✓/✗ band), never replaces it, and moves only at that one
  high-signal moment. Implements the verdict-tint design note (extends the
  audit's Finding 04).
- **Rich link-preview card** (v2026-05-22.126). Sharing the app's URL in a text
  message, Slack, etc. now shows a proper preview card — the GTO Drill wordmark,
  tagline, and the READ → DECIDE → REVEAL → LEARN flow on the dark brand
  background — instead of a bare title and URL. Adds Open Graph + Twitter Card
  meta tags to `index.html` and a 1200×630 `og-image.png` (79 KB) at the repo
  root. The `og:image` URL is absolute — link-preview crawlers run no
  JavaScript and have no page context to resolve a relative path.

### Fixed
- **Explicit-suit cards now carry a tooltip** (v2026-05-22.129). In results-view
  prose, the abstract card glyphs already had hover tooltips — `K — any suit`,
  `K — suit unknown`, `Suited — same suit` — but a card rendered with a real
  suit (e.g. `K♥` in the GTO read) had none: it was the one card type with no
  tooltip. `cardEl()` now sets a `title` with the full card name (`King of
  hearts`), so every card carries the same scout info, consistently — in prose
  and on the table.
- **Double-tap-to-zoom no longer fights navigation** (v2026-05-22.123). On iOS
  Safari, `touch-action: manipulation` (the CSS base patch) does not reliably
  suppress double-tap-to-zoom — a fast second tap in the same spot still
  zoomed, which made the tightly-packed mobile UI awkward to use. A small
  document-level `touchend` guard now cancels only a genuine double-tap (two
  taps close in both time and position). Single taps, fast taps on different
  controls, scrolling, and two-finger pinch-zoom — the accessibility zoom — are
  all untouched. The CSS `touch-action` rule is kept as-is (it still earns its
  place removing the 300 ms tap delay); the guard is an additive second layer.
- **Hand notation now tokenizes everywhere** (v2026-05-22.122). The prose
  tokenizer only renders a hand as a card glyph when the suited/offsuit suffix
  is bound tight to the ranks (`A8o`, `KQs`) — never the spelled-out form
  (`A8 offsuit`). Four scenarios used the word form and so rendered as bare
  cards plus a stray word: `all-in-or-fold-short-stack-011` (`A8 offsuit`),
  `isolation-vs-limper-013` (`89 suited`), `four-bet-pot-range-cbet-021`
  (`AK suited`), and `bb-squeeze-vs-open-and-caller-027` (`AK/AQ/AJ offsuit`).
  All four are corrected to the compact form the other 100+ uses already use,
  so they render the proper suited/offsuit glyph. Prose-only edits — no
  `scenario_id` changes.

### Changed
- **Villain-range cards show the range shape** (v2026-05-22.125). Each card in
  the "Villain's range" section now leads with a mini 13×13 heat-grid
  thumbnail — the range's shape at a glance — plus a combo count, in the spec's
  §8.4 / mockup M9 layout (thumbnail, then label + summary + count). The data
  was already there: every villain range carries its hand `classes`. The
  card's launch affordance is now an ↗ arrow, per the spec's expand-vs-launch
  convention. Second piece of the Wave 1 results-screen rebuild.
- **Crowd breakdown restructured into a hierarchy** (v2026-05-22.124). "How
  others played" was a flat list of look-alike rows — the player's own pick a
  small sub-line tag, easily lost in the stack. It now follows the spec's
  §8.2 / mockup M6 three-tier hierarchy: the player's pick is an elevated card
  (tinted, left identity bar, lifted shadow, taller bar, a prominent ✓/✗ YOUR
  PICK marker — green when it matched the GTO line, red when it missed); the
  GTO line is its own green-flagged card; every other action recedes to a thin
  dimmed line. A crowd blind spot the player avoided stays a full card so a
  spot the crowd misreads is never hidden. First piece of the Wave 1
  results-screen rebuild.
- **Shape pass — tags and badges are boxes, not pills** (v2026-05-22.121). The
  visual language now uses shape to encode interactivity: a pill reads as
  pressable, a box reads as a static label. Seven status badges/tags that were
  pill-shaped (999px) but not interactive — the profile concept flag, the
  stalled-game badge, the option-analysis tags, the crowd tags, the active-game
  status badge, the replay context tag, the villain-evidence chips — are now
  boxes via a new `--radius-box` token. Genuinely-pressable chips
  (`.spot-range-chip`, `.rp-cat`) keep their pill shape, and the poker-table
  chip skeuomorphs (bet bubble, pot pill, action badge) keep theirs — a chip is
  meant to look round. Buttons are unchanged. Closes the §2.4 / M8 shape-pass
  item from the redesign roadmap.

### Fixed
- **Completion count clamped to the live library** (v2026-05-22.120). The
  solo stats line could read `46/45 scenarios done` — over 100%. A retired
  `scenario_id` (one replaced under a new id, e.g. the corrected flopped-straight
  spot) leaves an orphaned response in Firestore; the completed-set loader
  counted it even though the scenario is no longer in the library. The loader
  now intersects the player's answered `scenario_id`s with the live library, so
  the tally can never exceed the scenario count.

### Changed
- **Keyboard access for the spot-summary** (v2026-05-22.119). The replay's
  spot-summary action rows can be tapped to drive the replay table, but the
  rows are `<div>`s with no keyboard path. When the summary is interactive,
  each action row (and the "Action on Hero" marker) now carries button
  semantics and a tab stop, with an Enter/Space handler — so a keyboard user
  can scrub the replay too, not just mouse and touch. Closes the residual
  ARIA gap from the Wave 2 accessibility work.
- **Scenario prose corrections** (v2026-05-22.118). A hand-vs-board audit of all
  45 scenarios — re-deriving each Hero hand objectively against its board —
  turned up two minor equity overstatements in the analysis text.
  `nut-flush-draw-check-raise-3bet-pot-035` claimed `AcTc` on `8 7 5` had "a
  gutshot to the nut straight"; the board supports no one-card straight, so it
  is corrected to a backdoor straight draw. `fold-ace-high-vs-donk-lead-039`
  credited `AKo` on `6 5 4` with "a runner-runner straight draw"; those runouts
  complete a straight on the board, not in Hero's hand. Both are prose-only —
  the hands, GTO actions, and lessons are unchanged, so recorded responses
  stay valid. No other hand-vs-prose mismatches were found.
- **Fixed a mis-described scenario** (v2026-05-22.117). The donk-lead low-board
  scenario gave Hero `8h 4h` on a `7 6 5` flop — a **flopped straight** — but
  its framing, options analysis, and GTO explanation all described the hand as
  a *draw* ("open-ended draw potential", "bigger pot if Hero turns the
  straight", "donking bluff candidate"). Root cause: the analysis was written
  in a later bulk pass, keyed off the lesson rather than re-deriving the hand
  on the board. The scenario was retired and replaced by a corrected version
  under a new `scenario_id` — Hero now holds `Th 8h` (a genuine open-ended
  straight draw), which is the bluff the lesson always meant to teach. The old
  scenario's recorded responses orphan harmlessly (see `docs/SCHEMA.md`).
- **Rebrand cleanup** (v2026-05-22.116). Repo housekeeping that completes the
  GTO Drill rename: dev-facing AutoBuilder artifacts removed, the root
  documentation (changelog, schema, roadmap, scenarios) restructured into
  `docs/`, and the README + `.claude/CLAUDE.md` rewritten as product docs.
  Returning players keep their local state — a one-time boot migration copies
  the old `gto-duel.*` localStorage keys to the new `gto-drill.*` prefix, so
  the Past-Games list, active-game pointer, and tooltip preference all survive
  the rename.
- **Honest small-crowd state** (v2026-05-22.115). The "How others played"
  breakdown showed percentage bars even when only one or two players had
  answered — so "100% · 1 player" read as crowd wisdom when it was a
  sample of one. With fewer than five answers the breakdown now leads
  with a plain notice ("Just your answer so far…" / "Early sample — only
  N answers…") so a thin sample isn't mistaken for a real crowd read.
- **Renamed: GTO Duel → GTO Drill** (v2026-05-22.114). Finishes the pivot
  the app made long ago — from a private two-player duel to a crowdsourced
  GTO trainer — by making the name describe what the app actually is. The
  page `<title>`, header wordmark, PWA manifest (`name` / `short_name`),
  footer, and onboarding screens all now read "GTO Drill". Stale
  "head-to-head duel" copy in the page meta description, the manifest
  description, and the landing tagline is refreshed to the crowd-trainer
  voice. "Duel" is reserved for the planned opt-in head-to-head mode.
- **Comments now carry the answer they were written about**
  (v2026-05-22.113). A comment used to be a bare string — on a retest,
  only a session-only heuristic tied it to an answer. Now
  `saveResponseComment` snapshots the action + confidence selected when
  the comment was written (`noteAction` / `noteConfidence` on the
  response doc), so the comment is self-describing and a later answer
  change can't misrepresent it. The retest stale-flag reads this stored
  snapshot instead of guessing, and the crowd-breakdown comment popover
  and the Database console now label each comment with the answer it
  was written about. Additive fields — comments saved before this
  render fine, just without the label.
- **Retest comments no longer silently lost** (v2026-05-22.112). Re-
  answering a scenario you had already played (the retest flow)
  overwrote the whole response document — deleting any note you had
  attached on the earlier pass — and the comment box never showed that
  earlier note in the first place. Now: `recordResponse` is a merge
  write, so the note survives a re-answer; the comment box pre-fills
  with your prior note on a retest; and when your new answer differs
  from the one the note was written about, the box shows an amber flag
  prompting you to update or clear it. The note is never auto-deleted,
  and never silently left on a mismatched answer.
- **Mobile touch affordance — interaction-system pass** (v2026-05-22.111).
  A consolidated pass over every interactive control so each reads as
  obviously tappable on a phone, without changing app layout or
  structure:
  - Added affordance design tokens (`--border-interactive`,
    `--border-tap`, shadow/glow scales, `--tap-min`). The dim `--border`
    (#243646) is now reserved for dividers; tappable elements use a
    higher-contrast border that clears the 3:1 WCAG non-text-contrast
    minimum.
  - Every interactive element now gives press feedback (a scale-down on
    `:active`) and shows a visible keyboard focus ring (`:focus-visible`).
  - All `:hover` rules are gated behind `@media (hover: hover)`, so a
    hover style never sticks after a tap on a touch device.
  - Secondary controls (range-picker Customize / Clear, the replay
    playback buttons, the equity trials selector) gained a solid fill, a
    visible border and a full 44px tap target — they previously read as
    disabled.
  - The 13×13 range matrix now reads as editable — raised cells, a
    visible cell border, a 5px radius, and an accent glow on selected
    hands.
  - Villain-range cards became Tier-4 "explore" surfaces — a solid panel
    with a villain-amber identity bar and depth, instead of a full amber
    border (which read as a warning).
  - Honoured the OS "reduce motion" setting app-wide.

  Structural items from the design spec (a compact one-screen hand view,
  an expanded⇄compact view toggle, a fullscreen matrix editor) are
  intentionally deferred to the in-progress redesign.
- **Dealer button pinned to the BTN seat.** The "D" disc was floating
  in an ambiguous spot on the felt. It's now rendered as a child of the
  BTN seat, hugging the seat corner that faces table centre — so it's
  unambiguously that seat's button on desktop and mobile alike. It
  stays bright when the BTN folds (folded seats now dim their content,
  not the whole seat box).
- **Unified modifier-tag styling.** Every suit-pattern modifier now
  renders as one consistent framed tag — a run of cards wrapped in a
  frame whose right side extends into a band carrying a one-letter
  marker. Covers hand suitedness (suited "S" / offsuit "O") and board
  texture (monotone "M" / two-tone "2" / rainbow 🌈); letter markers are
  uppercase for legibility at the small band size. The frame fill
  carries the texture: solid blue (suited / monotone), red/black
  diagonal (offsuit), red/black horizontal stripes (two-tone), and a
  four-colour diagonal (rainbow). Each tag is exactly 23px — a
  standalone card glyph's height — so it costs no extra line height.

### Added
- **Running pot per street.** Each street row in the spot summary now
  shows a small right-aligned "Pot Nbb" tag (light grey on a dark pill)
  — the total pot at the end of that street — so the reader watches the
  pot grow PRE → FLOP → TURN → RIVER.

### Changed
- **Last action and the decision point are now distinct replay states.**
  The last villain action and the decision point are separately
  selectable: selecting the last action chip shows that action's badge
  on the table ("raises to 35bb"); selecting "← Action on HERO" shows
  the clean decision-time table state with no action badge. The replay
  gained a `topStep` (one beyond the last action) for this clean view,
  which is where it now settles by default.
- **Scenario headline replaces the share-link button.** Each scenario
  now shows a `Scenario #NNN` headline at the top of the hand card
  (the number is the atomic reference — the trailing digits of the
  scenario slug). The 🔗 permalink/copy-link icon is removed from the
  solo-practice header; the scenario number is the reference now. The
  Exit control is also now an always-rendered labelled button instead
  of a bare `←` arrow.

### Added
- **Owner-only Database console.** A "Database" button appears in the
  play header *only* for the owner — a survey of the live data: an
  overview (total responses, comments, distinct players, scenarios with
  data), a comments table (every comment, newest first, each linking
  into its scenario), and per-scenario coverage. The owner is identified
  by a SHA-256 hash of their email (`owner.js`) — the literal address is
  never in the repo. This is a UX gate, not a security boundary: the
  underlying data is readable by any signed-in user by Firestore-rules
  design; the gate just keeps the console out of other users' UI.
- **Retest workflow for replayed scenarios.** A scenario the player has
  already answered is now a deliberate retest rather than a silent
  re-serve. The decide screen shows a "Replay" marker on the headline
  (the prior answer stays hidden, so it's a genuine re-test). On the
  reveal, a then-vs-now panel shows the previous answer + confidence and
  a verdict on whether the new answer moved toward the GTO line
  (Improved / Slipped / Same / Still off), tinted green or red. The new
  answer overwrites the old, as before. First plays are unchanged.

### Changed
- **Card runs never break across a line.** Whenever 2+ cards are
  rendered together inline in prose — a board, a hand — they're wrapped
  in a no-wrap run, so the line breaks before the run rather than
  splitting it across two lines. The run reads as a single entity.
- **Per-action pot indicator.** The running pot total moved from a
  per-street tag to an inline, right-aligned indicator on every action
  that moves chips (bet / raise / call) in the spot summary — each shows
  the pot size *after* that action is applied. Checks get none.
- **No "VILLAIN" label in multi-opponent spots.** When two or more
  opponents are live at the decision point (or more than one distinct
  opponent appears in the action log), opponents are referred to by
  position name everywhere — the spot-summary action log and the reveal
  prose — rather than the ambiguous "VILLAIN". Single-opponent scenarios
  are unchanged. (One stray "villain" reference in `bb-squeeze-027`'s
  text was also corrected to the position.)

### Fixed
- **Turn/river card missing at the decision point.** The replay's
  board-advance logic (which deals the decision-street card when the
  hero is first to act on a new street) was keyed to the old single
  decision step; after the last-action / decision-view split it fired
  one step too early — showing the decision-street card on the *last
  action* frame and hiding it at the actual decision. It now fires at
  the decision view, so the turn (or river) card is visible exactly
  when hero is deciding on that street.
- **Playing-card suits + replay controls drawn as inline SVG.** The
  earlier text-glyph fix (U+FE0E selector) still wasn't reliable in
  every Chrome — Unicode ♠♥♦♣ and the media glyphs (⏮ ◀ ▶ ❚❚) render
  inconsistently across browsers/font configs. Card suits and the
  rewind / previous / play-pause / next replay controls are now drawn
  as inline SVG shapes (`fill: currentColor`), deterministic everywhere
  with no font dependency.

### Changed
- **Folded seats keep a bounding box.** A player who has folded now
  shows a faint grey container box + ring on the replay table (still
  dimmed) instead of collapsing to floating dimmed text — the seat's
  position on the table stays visible.
- **Players control is a labelled button.** The "see all players"
  control in the solo header is now a labelled "Players" button
  (matching the Exit button) instead of a 👥 emoji icon — both reliably
  rendered and a clearer tap target.
- **Replay table cluttered on mobile.** The seat layout (80px seats,
  46px corner insets) is tuned for the wide desktop table; on a phone
  the table collapses toward square and the seats overlapped each other,
  the board, and the pot. At ≤560px the seats shrink to 62px (with
  slightly smaller cards) and the four corner seats are pulled back out
  to the edges, so all six seats and the five-card board no longer
  overlap. The phone table is near-square, so the felt is drawn by a
  short full-width `::before` — a true horizontal capsule — instead of
  rounding the square box into a near-circle. The seat layout box keeps
  its full height; the corner seats overhang the felt's rounded ends,
  which is fine on a squeezed phone table.
- **Reveal-screen gap before the Lesson pill.** The reveal body sat
  flush against the hand-summary (replay table + spot-summary), so the
  💡 Lesson pill read as overlapping the last spot-summary row. The
  reveal now carries the same top-margin + hairline divider treatment
  as the decide form, clearly separating the GTO reveal from the hand
  summary above it.
- **Replay table seat positions.** The four "corner" seats were anchored
  4 px from the table edges, but the table is a capsule with a 140 px
  corner radius — the felt curves sharply away there, so the 80 px-wide
  seats overhung the rounded ends onto the page. Corner seats are now
  inset ~46 px from each edge, turning the six seats into a clean
  hexagon that sits fully on the felt.

### Added
- **Scenario INFO pane.** Scenarios that deviate from the default setup
  (100bb cash, Hero's cards shown) now display a blue heads-up pane
  above the hand summary, with one row per deviation stating *what* is
  different and *why* it matters. Detected: tournament hands, non-standard
  stack depth (e.g. 12/20/40bb effective), and spots where Hero's hole
  cards are deliberately hidden (range-vs-range decisions). Standard
  scenarios show no pane. The pane is decide-safe — it never reveals the
  GTO answer.
- **`SCHEMA.md`** — documents the Firestore `responses` / `users`
  collections and the preservation invariants (append-only, immutable
  `scenario_id`s, additive-only field changes) so development can
  continue safely while the live link collects real player data.

### Changed
- **Mobile pass 1 fixes** (from `design-audit/mobile-audit.html`).
  Five of the six audit findings, sequenced before the deeper table
  rework. **H-2** (replay-table seat overlap) is intentionally deferred
  to the table-rework pass since any CSS we'd ship would be redone.
  - **L-1.** The sign-in card no longer prints "GTO Duel" twice (the
    page header already shows it, same pattern as the landing screen).
  - **M-2.** The "Practice solo" and "Equity calculator" buttons on the
    sign-in screen are restructured as bold action label + muted
    subtext, so parenthetical disclaimers don't wrap awkwardly inside
    the click target.
  - **H-1.** The solo-practice header is now two-row: title + action
    buttons (Share / Exit) on row 1, running stats on row 2. At &lt;480 px
    the action buttons collapse to icon-only (🔗 / ←) so the row never
    overflows and the Exit label can't clip.
  - ~~**H-3** / **M-1**~~ (grid horizontal scroll + bigger cells) —
    initially shipped, then reverted. On the audience's actual phones
    (iPhone 15 / iPhone 17 Pro Max), the original cells were tight but
    tappable, and the horizontal-scroll workaround was a worse user
    experience than the problem it solved. Reverted in
    `2026-05-19.12-mobile-relax`. The original fluid grids stay on
    mobile.

### Added
- **🔗 Copy share link** button in the solo-practice header. Click to
  copy the current scenario's deep-link URL to the clipboard ("✓ Link
  copied!" briefly confirms). Send the link to a friend (or paste it
  into a chat for analysis) and they land directly on the same spot.
  Falls back to a read-only input field if the Clipboard API is blocked
  (insecure context, etc.).
- **Accumulating Run + trials-per-click selector** on every equity
  surface (per-scenario panel + standalone calculator). The Run button
  now accumulates: each click adds the selected trial count (5,000 /
  25,000 / 100,000) to the running totals, so the user can dial in
  precision with extra clicks. Result shows total trials (with commas)
  + W/T/L + a "reset" link. Any input change (hero / board / villain
  range) resets the accumulator automatically.
- **Standalone equity calculator** — a third main-menu button below
  "Practice solo" opens a freestanding Monte Carlo tool: pick 2 hero
  cards from a 52-card grid (hero ring blue), pick 0–5 board cards from
  the same grid (board ring amber), pick a villain range on the 13×13,
  Run. No Firebase, no scenario context. Useful for ad-hoc equity
  questions outside of any specific scenario.
- **`?scenario=<id>` deep-link** routes straight into solo mode pinned
  on that scenario — useful for sharing spots by URL and for inspecting
  any single scenario without depending on the random shuffle.
- **Hero-hand picker for the two range-perspective scenarios.** The
  scenarios where `replay.hero_cards` is null (BTN vs BB 3-bet pot c-bet
  decision, SB vs BTN turn overbet) now mount a compact 4-suit × 13-rank
  card-select grid in the equity panel. Click two cards to set your
  sample hero hand — the Run button enables and the rest of the panel
  works identically to the pinned-hero scenarios. Board cards are
  disabled in the grid; FIFO replacement when both slots are taken.
- **App version stamp** in the header (`v2026-05-19.4-...`) so you can
  tell at a glance which build you're on. If GitHub Pages serves a
  stale cache (~10 min TTL) the version will still read the old build —
  that's the cue to hard-refresh (Ctrl+Shift+R / Cmd+Shift+R). Bumped
  every commit in `src/version.js`.
- **Solo practice mode** — a "🃏 Practice solo (no sign-in, no
  opponent)" button below the Google sign-in button on the gate screen.
  No Firebase, no opponent, no progress saved across sessions: one
  random scenario at a time, the full decide → reveal flow with the GTO
  explanation, range chips, and Monte Carlo equity panel all working
  identically to multiplayer. Running stats show "Hands N · GTO
  accuracy X%" at the top, and an Exit button returns to the sign-in
  screen. The scenario picker avoids immediate repeats (sliding window
  of ~10 recent hands).
- **Inline range chips in GTO prose**. Whenever a scenario's GTO
  explanation calls out a named villain range ("BB's 3-bet range", "BTN's
  c-bet range", "CO's polar c-betting range" …), that phrase is now an
  underlined 🎲 chip you can click — the Monte Carlo equity panel opens
  below the explanation with that range pre-selected on the 13×13 grid.
  Hit Run to see the equity. Click another chip and the panel switches
  to that range without remounting. **40 of the 45 scenarios** carry
  range annotations (45 named ranges total); the remaining 5 scenarios
  are pure hero-side strategy spots with no explicit villain-range
  reference.
- The equity engine now also understands fully-specified 2-card combos
  like `AcKc` / `Th9h` (not just hand-class labels), so range
  annotations can pin down specific suited holdings on a textured board
  (the heart-flush combos, etc.).
- **Monte Carlo equity tool (the "Test it" button)**. On the per-hand reveal,
  the previously-stubbed "🎲 Test it — equity vs a range" button now opens a
  full equity calculator. The user picks a villain range on a 13×13 hand
  grid (with `Any two` / `Pairs` / `Broadways` / `Clear` presets), and the
  app runs a 5000-trial Monte Carlo against the scenario's hero hand + the
  current board, displaying hero equity with a hero/villain split bar,
  win/tie/loss counts, and timing. Engine (`src/equity.js`) verified
  against full enumeration (1.7M boards) and against eight known
  benchmark matchups. Scenarios without a pinned `hero_cards` show a
  friendly notice (a hand-picker for those is coming next).
- Every one of the 45 GTO scenarios now has structured `replay` data — the
  visual poker-table replay is no longer limited to the first 5. Each scenario
  plays out the full six-handed table and complete betting line up to the
  decision point. (Also corrected a card clash in scenario 043, where the
  hero's hand collided with a board card.)
- Local development server (`scripts/dev-server.mjs`) — a zero-dependency Node
  static file server so the app can be run and tested locally over
  `http://localhost` before pushing to GitHub Pages. Run with `npm start` or
  `node scripts/dev-server.mjs`.
- `package.json` with `start` / `dev` scripts (no dependencies).
- "Local development" section in the README.
- 25 new GTO scenarios in `data/scenarios.json` (the library now holds 45),
  covering 4-bet pots, probe/delayed c-bets, ICM, blocker-driven river spots,
  rematch-relevant turn decisions, and more.
- Local game history (`src/history.js`): completed games are saved to the
  browser, and the landing screen shows a "Past games" list with a running
  tally (games played, your GTO accuracy, agreement rate). Each past game can
  be reopened from the landing screen.
- Rematch: the wrap-up screen now has a "Rematch — same settings" button that
  spins up a fresh game with the same round/handful configuration. The
  finished game is stamped with a pointer to the rematch so the other player
  sees a "Join the rematch" button on their wrap-up.
- A "Back to home" button on the wrap-up screen.
- A remove (✕) control on each row of the landing-screen "Past games" list.
  History is device-local and kept indefinitely — this is the only thing that
  clears it. Removing the last game hides the panel.
- Visual hand replay (`src/replay.js`): scenarios with structured `replay`
  data render as a poker table — felt, seated players with stacks, CSS-drawn
  cards (no image assets), board, pot, and a prev/next/autoplay stepper with a
  clickable action history. Wired into the in-game decision screen; scenarios
  without `replay` data still show the text description. The first 5 scenarios
  carry replay data (see the Replay schema). `scripts/replay-dev.html` renders
  every replay-enabled scenario standalone for visual review.

### Changed
- **Hero/Villain visual identity.** The hero (blue) and the live opponent(s)
  (amber) now share one colour identity across the whole game. On the replay
  table the villain seat(s) get an amber ring and amber position label;
  in the GTO prose the matching position chips are tinted to match, and the
  words "Hero"/"Villain" pick up the same colours.
- **Iconified GTO prose.** Scenario descriptions and GTO explanations now
  render card codes (`Kh 7d 2s`) as inline mini-cards and position names
  (`BTN`, `BB`, …) as chips, instead of as plain text.
- Playing-card rank/suit now sit in fixed flex-centred boxes, so the differing
  metrics of the Unicode suit glyphs (♣♦♥♠) no longer nudge them off-centre.
- Sign-in is now **Google sign-in** instead of silent anonymous auth. On first
  open the app shows a "Continue with Google" gate; once signed in, the session
  persists and follows the account across devices. This is stage one of the
  pairing rework — it gives each player a stable identity so games and history
  are no longer tied to a single browser. (Requires the Google provider to be
  enabled in the Firebase Console, and the serving domain added to the
  Authorized domains list.) A leftover anonymous session from before this
  change is treated as "not signed in" so the Google gate still appears.
- Pairing is now a **lobby model** instead of share codes. Pressing **Start**
  opens a lobby; pressing **Join** shows a live list of open lobbies, each
  identified by the owner's Google name and photo — tap one to join,
  first-come-first-served. Share codes, the join link, and the `?join=` URL
  parameter are gone. The waiting screen drops the code/link UI and gains a
  "Cancel this game" button. Player display names and photos now come straight
  from the Google profile (the manual name field is removed).
  **Requires republishing `firestore.rules`** — listing open lobbies needs the
  new `allow list` rule for waiting games.
- Sign out is now a clean reset — it clears the active-game pointer in
  addition to ending the Firebase session, so nothing stale carries into the
  next session. Local "Past games" history is intentionally kept.
- The poker-hand replay now renders the **full six-handed table** and the
  **complete preflop betting round** — posted blinds and every fold around to
  the action, with folded players shown mucked. Blinds are modelled as posts
  so pot sizes are exact. (Applies to the 5 scenarios with replay data.)
- The in-game **decision screen is recomposed** (per the design audit): one
  hand at a time with a "Hand X of N" progress indicator and Back / Next
  navigation, instead of the whole handful stacked into one scroll. The replay
  table is the visual hero; the prose description is demoted to a collapsible
  ("The spot in words"); the action choice is the primary full-width control
  and confidence a lighter secondary strip; the note collapses until wanted.
- **Per-hand feedback.** Each hand now plays in two beats: decide (pick your
  action + confidence, then "Lock in & see GTO"), then reveal — the GTO line,
  whether you matched it, and the GTO defence, immediately, hand by hand,
  instead of only at the end of the game. When your opponent has already
  played a hand, the reveal also shows their call, the agreement, and the
  confidence gap. A "Test it" button stubs the upcoming Monte Carlo equity
  tool. Opponent-answer gating moved from document-level redaction to
  per-hand in the UI (an answer is shown only after you have locked yours).

### Removed
- The turn-notification subsystem (Web Push). Reliable browser-to-browser push
  delivery needs server-side infrastructure that doesn't fit this app's
  GitHub-Pages-only model. Removed `src/push.js`, `sw.js`, all service-worker
  registration, and the in-game notification controls.
- The `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` values from
  `src/config.js`. With notifications gone the key pair is unused; it is also
  no longer present in the current source. (The Firebase config remains — a
  Firebase web `apiKey` is public by design.)

### Fixed
- The app could hang on the boot screen ("Checking sign-in…") when the
  remembered active-game pointer in `localStorage` referred to a game the
  signed-in user can no longer read (a stale pointer left over from earlier
  testing / the anonymous-auth era). `readGame()` now reports listener errors
  and a missing document instead of silently dying, and the router treats an
  unreadable or missing remembered game as "no active game" — it drops the
  pointer and falls through to the home screen. A 9-second boot watchdog
  guarantees the app can never hang on the boot screen again.
