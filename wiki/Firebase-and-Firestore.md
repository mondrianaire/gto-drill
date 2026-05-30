# Firebase and Firestore

GTO Drill uses Firebase for authentication and data persistence. The Firebase project is `gto-poker-qui`.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Browser    │────▶│  Firebase    │────▶│  Firestore    │
│  (static)   │     │  Auth        │     │  Database     │
│             │◀────│  (Google)    │◀────│               │
└─────────────┘     └──────────────┘     └───────────────┘
       │
       ▼
┌─────────────┐
│  GitHub     │
│  Pages      │
│  (hosting)  │
└─────────────┘
```

- **Firebase Auth** handles Google sign-in. No passwords, no custom auth.
- **Firestore** stores all crowd data (responses, user profiles, legacy game docs).
- **GitHub Pages** serves the static app. No server-side code.

The Firebase SDK is loaded from the Google CDN in `src/state.js` — it's the **only** file that imports Firebase. Every other module calls `state.js` functions.

---

## Authentication

Players sign in with Google via Firebase Auth. The auth flow:

1. Player clicks "Sign in with Google" on the onboarding screen
2. Firebase Auth opens the Google OAuth popup
3. On success, `state.js` receives the `user` object with `uid`, `displayName`, `photoURL`
4. The `uid` is used as the key for all per-user data

No anonymous auth, no email/password, no other providers.

---

## Security rules

The full rules are in `firestore.rules` at the repo root. See [[Firestore Rules]] for the annotated reference.

**Key principles:**

| Collection | Read | Write | Delete |
|-----------|------|-------|--------|
| `responses` | Any signed-in user | Own responses only (`uid` must match) | **Never** (`if false`) |
| `users` | Own doc only | Own doc only | **Never** (`if false`) |
| `games` | Participants + open lobbies | Participants + joining players | Waiting lobbies only |

---

## Firestore configuration

| Setting | Value |
|---------|-------|
| Firebase project | `gto-poker-qui` |
| Database | Default Firestore instance |
| Location | (set at project creation, immutable) |

Firebase config values (API key, auth domain, project ID) live in `src/config.js`. These are **not secrets** — they're client-side identifiers that the browser needs to connect. Security is enforced by Firestore rules, not by hiding the config.

---

## Publishing rule changes

The repo's `firestore.rules` is the **source of truth**. To deploy rule changes:

1. Edit `firestore.rules` in the repo
2. Open the [Firebase Console](https://console.firebase.google.com/) → Firestore Database → Rules
3. Paste the full file contents
4. Click **Publish**

The Console is what's live; the repo file is what's versioned. Keep them in sync. Never publish a rule that weakens `allow delete: if false` on `responses` or `users`.

---

## No staging environment

There is no separate staging Firebase project. Development and production share the same database. This is intentional — see [[Data Schema and Preservation]] for why this works and the safe-development checklist.
