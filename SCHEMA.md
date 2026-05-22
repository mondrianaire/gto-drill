# Data schema & preservation guarantees

GTO Duel records every player's answers into **Firebase Firestore** (project
`gto-poker-qui`). This file is the contract for that data: what is stored, and
**what must never change** so that data collected from real players is kept
intact across every future code update.

> **Why this file exists.** The live link is being shared with players to
> populate the database while development continues in parallel. Player
> responses are the irreplaceable asset — they cannot be re-collected. Every
> rule below exists to make sure ongoing development cannot silently destroy or
> orphan that data.

---

## Collections

### `responses/{scenario_id}__{uid}` — the crowd answer pool

One document per `(scenario, player)` pair. The document id is the literal
string `` `${scenario_id}__${uid}` `` so that a player re-answering a scenario
**overwrites** their previous answer instead of creating a duplicate (one data
point per player per scenario).

| Field        | Type             | Written by                | Notes |
|--------------|------------------|---------------------------|-------|
| `scenario_id`| string           | `recordResponse`          | Matches a `scenario_id` in `data/scenarios.json`. |
| `uid`        | string           | `recordResponse`          | Firebase Auth uid of the player. |
| `displayName`| string           | `recordResponse`          | Google display name / email, capped 60 chars. |
| `photoURL`   | string \| null   | `recordResponse`          | Google avatar URL. |
| `action`     | string           | `recordResponse`          | The action label the player picked. |
| `confidence` | number \| null   | `recordResponse`          | 1–5. |
| `note`          | string           | `saveResponseComment` | Optional post-reveal hand comment, capped 280 chars. |
| `noteAction`    | string \| null   | `saveResponseComment` | The `action` selected when `note` was written — keeps the comment self-describing if the answer later changes on a retest. |
| `noteConfidence`| number \| null   | `saveResponseComment` | The `confidence` (1–5) at the moment the comment was written. |
| `updatedAt`     | string (ISO8601) | both writers          | Last write time. |

Both writers use `setDoc` with `{ merge: true }`. `recordResponse()` updates
`action` / `confidence` and **preserves** any existing `note` — a re-answer on a
retest must not destroy a comment. `saveResponseComment()` writes `note` plus the
`noteAction` / `noteConfidence` snapshot of the selection the comment was about,
so the comment is self-describing regardless of later answer changes. Read by
`readScenarioResponses`, `readResponsesByUid`, `readMyResponses`,
`readAllResponses` in `src/state.js`.

### `users/{uid}` — per-user profile

One document per player, id **is** the player's `uid`. Holds account-level
settings. A player may only read and write their own doc.

| Field           | Type             | Written by          | Notes |
|-----------------|------------------|---------------------|-------|
| `uid`           | string           | `saveKnowledgeLevel`| The player's uid. |
| `knowledgeLevel`| string           | `saveKnowledgeLevel`| One of the `KNOWLEDGE_LEVELS` ids in `src/onboarding.js`. |
| `updatedAt`     | string (ISO8601) | `saveKnowledgeLevel`| Last write time. |

Written by `saveKnowledgeLevel()` (`setDoc` with `{ merge: true }`). Read by
`readUserProfile()`.

### `games/{gameId}` — legacy (retired)

The retired async-duel mode. No new code path writes here. Left in the security
rules so any old documents stay readable/deletable by their participants. Do
not build new features on this collection.

---

## Preservation invariants — do NOT break these

These are the rules that keep already-collected player data valid. Treat them
as immutable unless you have a deliberate, tested migration plan.

1. **`responses` and `users` are append-only / overwrite-only — never deleted.**
   The security rules enforce `allow delete: if false` for both. Keep it that
   way. There is no UI and no code path that deletes a response.

2. **`scenario_id` values are permanent identifiers.** A response is tied to
   its scenario by `scenario_id`. **Never rename or recycle a `scenario_id`**
   in `data/scenarios.json` once the live link has been shared — doing so
   orphans every response collected for that scenario (the crowd breakdown,
   completion %, and profile accuracy all silently lose those data points).
   - ✅ Safe: add new scenarios with new ids; edit a scenario's prose, board,
     `gto_action`, `priority`, `complexity`, `concept_tags`, etc.
   - ⚠️ Careful: changing `available_actions` or `gto_action` for a scenario
     that already has responses re-interprets old answers against new options.
     The data is kept, but accuracy/crowd math shifts. Prefer a **new**
     `scenario_id` for a materially different version of a spot.
   - ❌ Never: rename, delete, or reuse an existing `scenario_id`.

3. **The `responses` document id format is fixed:** `` `${scenario_id}__${uid}` ``.
   The `__` separator and this exact shape are assumed by the overwrite
   semantics. Don't change the key format.

4. **Never narrow a field's meaning in place.** Adding a new optional field is
   safe (old docs simply lack it — readers must tolerate `undefined`). Removing
   or repurposing an existing field is a breaking change.

5. **The reads are whole-collection / equality-filtered queries.** Aggregations
   read all of `responses` or filter by `scenario_id` / `uid` equality. If you
   add fields, you do not need new indexes. If you add a *range* or
   *compound* query, add the matching Firestore index.

---

## Developing while the live app collects data

Development and live data collection run against the **same** production
Firebase project — there is no separate staging database. This is fine because:

- **Code deploys never touch stored data.** The app is static files on GitHub
  Pages. Pushing new HTML/JS/CSS changes only what the browser runs; every
  `responses` and `users` document is untouched by a deploy.
- **Old and new clients coexist.** A player on a cached old build and a player
  on the newest build both read/write the same documents. As long as the
  invariants above hold (especially additive-only field changes and stable
  `scenario_id`s), neither corrupts the other.

Safe-development checklist:

- Adding scenarios, UI, reveal components, profile metrics → **safe**, ship freely.
- Adding a new optional field to `responses`/`users` → **safe**; make every
  reader tolerate its absence on older documents.
- Renaming/removing a field or a `scenario_id` → **breaking**; needs a
  migration plan, not a casual edit.
- Changing `firestore.rules` → edit `firestore.rules` here, then **publish it
  manually** in the Firebase Console (Firestore Database → Rules → Publish).
  The repo file is the source of truth; the Console is what's live. Keep them
  in sync. Never publish a rule that weakens `allow delete: if false` on
  `responses`/`users`.

If a future change genuinely requires reshaping stored data, do it as an
explicit, reviewed migration (read all docs, transform, write back) — never as
a silent rename that strands the old data.
