# Data Schema and Preservation

GTO Drill records every player's answers into **Firebase Firestore** (project `gto-poker-qui`). This page documents what is stored and the **preservation invariants** that keep collected data intact across every code update.

> **Why this matters.** The live app is being shared with players while development continues. Player responses are the irreplaceable asset — they cannot be re-collected. Every rule below exists to prevent ongoing development from silently destroying or orphaning that data.

---

## Collections

### `responses/{scenario_id}__{uid}` — the crowd answer pool

One document per (scenario, player) pair. The document ID is `${scenario_id}__${uid}` — re-answering a scenario **overwrites** the previous answer (one data point per player per scenario).

| Field | Type | Written by | Notes |
|-------|------|-----------|-------|
| `scenario_id` | string | `recordResponse` | Matches a `scenario_id` in `data/scenarios.json` |
| `uid` | string | `recordResponse` | Firebase Auth uid |
| `displayName` | string | `recordResponse` | Google display name / email, capped 60 chars |
| `photoURL` | string \| null | `recordResponse` | Google avatar URL |
| `action` | string | `recordResponse` | The action label the player picked |
| `confidence` | number \| null | `recordResponse` | 1–5 |
| `note` | string | `saveResponseComment` | Optional post-reveal hand comment, capped 280 chars |
| `noteAction` | string \| null | `saveResponseComment` | The `action` selected when `note` was written |
| `noteConfidence` | number \| null | `saveResponseComment` | The `confidence` at the moment the comment was written |
| `updatedAt` | string (ISO 8601) | both writers | Last write time |

Both writers use `setDoc` with `{ merge: true }`:
- `recordResponse()` updates `action` / `confidence` and **preserves** any existing `note`
- `saveResponseComment()` writes `note` plus the `noteAction` / `noteConfidence` snapshot

### `users/{uid}` — per-user profile

One document per player. Holds account-level settings. A player may only read/write their own doc.

| Field | Type | Written by | Notes |
|-------|------|-----------|-------|
| `uid` | string | `saveKnowledgeLevel` | The player's uid |
| `knowledgeLevel` | string | `saveKnowledgeLevel` | One of the `KNOWLEDGE_LEVELS` ids |
| `updatedAt` | string (ISO 8601) | `saveKnowledgeLevel` | Last write time |

### `games/{gameId}` — legacy (retired)

The retired async-duel mode. No new code writes here. Left in security rules so old documents stay readable/deletable by participants. Do not build new features on this collection.

---

## Preservation invariants

These rules keep already-collected player data valid. Treat them as **immutable** unless you have a deliberate, tested migration plan.

### 1. Never delete responses or users
The security rules enforce `allow delete: if false` for both collections. There is no UI and no code path that deletes a response.

### 2. Scenario IDs are permanent
A response is tied to its scenario by `scenario_id`. **Never rename or recycle a `scenario_id`** — doing so orphans every response collected for that scenario.

| Action | Safety |
|--------|--------|
| Add new scenarios with new IDs | Safe |
| Edit a scenario's prose, board, `gto_action`, tags, etc. | Safe |
| Change `available_actions` or `gto_action` on a scenario with existing responses | Careful — re-interprets old answers against new options |
| Rename, delete, or reuse an existing `scenario_id` | **Never** |

**Retiring a broken scenario** is the one exception. The retired ID is never reused; its responses stay in Firestore, orphaned deliberately.

### 3. Document ID format is fixed
`${scenario_id}__${uid}` — the `__` separator and this exact shape are assumed by the overwrite semantics.

### 4. Never narrow a field's meaning
Adding a new optional field is safe (readers must tolerate `undefined`). Removing or repurposing an existing field is a breaking change.

### 5. Reads are whole-collection or equality-filtered
Aggregations read all of `responses` or filter by `scenario_id` / `uid` equality. Adding fields doesn't require new indexes; adding range or compound queries does.

---

## Developing while the live app collects data

Development and live data collection run against the **same** production Firebase project — there is no separate staging database.

This is safe because:
- Code deploys never touch stored data (static files on GitHub Pages)
- Old and new clients coexist (as long as invariants hold)

**Safe-development checklist:**
- Adding scenarios, UI, reveal components, profile metrics → **safe**
- Adding a new optional field → **safe** (make readers tolerate its absence)
- Renaming/removing a field or `scenario_id` → **breaking** (needs a migration plan)
- Changing `firestore.rules` → edit the repo file, then **publish manually** in the Firebase Console
