# Firestore Rules

Annotated reference for GTO Drill's Firestore security rules. The source of truth is `firestore.rules` in the repo root.

---

## Publishing rules

1. Edit `firestore.rules` in the repo
2. Open [Firebase Console](https://console.firebase.google.com/) → Firestore Database → Rules
3. Paste the full file contents
4. Click **Publish**

The Console is what's live; the repo file is what's versioned. **Always keep them in sync.**

---

## Rule summary

### `responses/{responseId}`

The crowd answer pool — one document per (scenario, player) pair.

```
read:    any signed-in user (the crowd aggregation reads all responses)
create:  signed-in user, uid in doc must match caller
update:  signed-in user, uid in doc must match caller
delete:  NEVER (if false) — responses are permanent data points
```

**Why wide read access:** the reveal screen aggregates every response for a scenario into a crowd breakdown. Every signed-in player needs to read every response.

**Why strict delete:** player responses are the irreplaceable asset. Once collected, they stay forever. See [[Data Schema and Preservation]].

### `users/{userId}`

Per-user profile (poker knowledge level, future account settings).

```
read:    own doc only (uid == userId)
create:  own doc only
update:  own doc only
delete:  NEVER (if false)
```

### `games/{gameId}` (legacy)

The retired async-duel mode. Rules are kept so old documents remain accessible.

```
get:     participants, or docs with an open slot
list:    open lobbies (status == 'waiting_for_opponent')
         OR games where caller is a participant
create:  signed-in, 1 participant (the creator), status waiting
update:  participants, or a second player joining
delete:  waiting lobbies only, or docs with no participants (safety net)
```

No new code writes to this collection.

---

## Critical invariant

**Never weaken `allow delete: if false` on `responses` or `users`.** This is the data-preservation guarantee. If a future feature needs to "delete" a response, implement it as a soft delete (add a `deleted: true` field) rather than removing the document.

---

## Index requirements

Current queries are all whole-collection scans or equality filters (`scenario_id`, `uid`). No custom Firestore indexes are needed.

If you add a **range** or **compound** query, you'll need to create a matching Firestore index in the Console (or via `firebase.json`).
