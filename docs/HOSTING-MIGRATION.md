# Hosting migration runbook — GitHub Pages → Firebase Hosting + gtopokerdrill.com

**Status:** Phase 1 (auto-deploy infrastructure) in place via this PR.
**Triggered by:** Buying `gtopokerdrill.com` + decision to flip repo private.
**Why migrate:** GitHub Pages does not work on private repos at the free tier;
moving to Firebase Hosting consolidates with the Firebase Auth + Firestore the
project already uses.

Current production: https://mondrianaire.github.io/gto-drill/ (GitHub Pages)
Target production: https://gtopokerdrill.com (Firebase Hosting, same Firebase
project `gto-poker-qui` as Auth + Firestore)

---

## Phase 1 — Infrastructure (this PR)

Adds:
- `firebase.json` — hosting config (what to deploy, what to ignore, cache headers)
- `.firebaserc` — points `default` project at `gto-poker-qui`
- `.github/workflows/firebase-hosting-merge.yml` — auto-deploy on push to `main`
- `.github/workflows/firebase-hosting-pull-request.yml` — per-PR preview deploys
- `.gitignore` — exclude `.firebase/` local cache

After merge, the workflows are dormant until the **`FIREBASE_SERVICE_ACCOUNT_GTO_POKER_QUI`** GitHub secret is set. Without that secret, no deploy happens — production stays on GitHub Pages.

### One-time setup (you do this once after merge)

**1. Generate the Firebase service-account key.**
- Open https://console.firebase.google.com/project/gto-poker-qui/settings/serviceaccounts/adminsdk
- Click **Generate new private key** → **Generate key**
- A JSON file downloads (something like `gto-poker-qui-firebase-adminsdk-XXXXX.json`)

**2. Paste the JSON into GitHub as a secret.**
- Open the file in a text editor, copy the entire contents (the `{ ... }` block)
- Open https://github.com/mondrianaire/gto-drill/settings/secrets/actions
- Click **New repository secret**
- Name: `FIREBASE_SERVICE_ACCOUNT_GTO_POKER_QUI`
- Secret: paste the JSON
- Click **Add secret**

**3. Delete the downloaded JSON from your computer.** The key now lives in GitHub only.

**4. Trigger the first deploy.**
- Open https://github.com/mondrianaire/gto-drill/actions
- The "Deploy to Firebase Hosting on merge" workflow should have run automatically when this PR merged. If not, push any tiny change to `main` to trigger it.
- First deploy takes ~1-2 min. Output URL will be `https://gto-poker-qui.web.app` (Firebase's auto-assigned domain).

**5. Verify the temp URL works.**
- Open https://gto-poker-qui.web.app
- Should look identical to https://mondrianaire.github.io/gto-drill/ — same scenarios, same auth flow, same crowd data
- If yes → ready for Phase 2 (custom domain)
- If broken → check Firebase Console → Hosting → recent deploys for errors

---

## Phase 2 — Connect `gtopokerdrill.com` (DNS at HostGator)

**1. In Firebase Console, add the custom domain.**
- Open https://console.firebase.google.com/project/gto-poker-qui/hosting/sites
- Click **Add custom domain**
- Enter `gtopokerdrill.com` (no `www`, no `https://`)
- Click **Continue**
- Firebase will present **2 A records** (something like):
  ```
  Type: A   Host: @   Value: 199.36.158.100
  Type: A   Host: @   Value: 199.36.158.101
  ```
  (The actual IPs Firebase shows may differ — use the ones shown to you.)

**2. Add the A records at HostGator.**
- Log in to HostGator: https://portal.hostgator.com/
- Navigate to **cPanel** for the account holding `gtopokerdrill.com`
- Open **Zone Editor** (under the Domains section)
- Find `gtopokerdrill.com` and click **Manage**
- Delete any existing A records pointing to `@` (the apex) — there may be a default HostGator parking page A record
- Click **+ Add Record** twice, once for each A record Firebase gave you:
  - Record 1:
    - Name: `gtopokerdrill.com.` (with trailing dot — that's the apex)
    - TTL: 14400 (or default)
    - Type: A
    - Address: (first IP Firebase gave you)
  - Record 2: same as above with the second IP
- Click **+ Add Record** once more for the `www` redirect:
  - Name: `www.gtopokerdrill.com.`
  - TTL: 14400
  - Type: CNAME
  - Address: `gtopokerdrill.com.`
- Save

**3. Wait for DNS propagation.**
- Usually 15 min – 1 hr; can take up to 24 hr
- Check with: `nslookup gtopokerdrill.com` (should show the Firebase IPs)
- Firebase Console will refresh and show "Connected" once it sees the records
- SSL certificate provisions automatically via Let's Encrypt — takes a few more minutes after DNS resolves

**4. Add `www` as an additional domain in Firebase** (so both work):
- Back in Firebase Console → Hosting → click **Add custom domain** again
- Enter `www.gtopokerdrill.com`
- Firebase will detect the existing CNAME and set up redirect to apex

---

## Phase 3 — Firebase Auth allows the new domain

**Critical: without this, Google Sign-in returns "This domain is not authorized" on the new URL.**

### When to do this

Do this **the moment Phase 2 verifies green** (DNS resolves + SSL cert provisioned). The actual sign-in test in Phase 4 will fail without it.

### Quickstart — 60 seconds

1. Direct link: https://console.firebase.google.com/project/gto-poker-qui/authentication/settings
2. Scroll to the **Authorized domains** card
3. Click **Add domain** → enter `gtopokerdrill.com` → Add
4. Click **Add domain** → enter `www.gtopokerdrill.com` → Add
5. Verify these are also in the list (Firebase usually adds them by default; if missing, add them):
   - `gto-poker-qui.web.app`
   - `gto-poker-qui.firebaseapp.com`
   - `localhost`

### What "done" looks like

After saving, the Authorized domains list should include all 5:
- ✓ `localhost` (for `npm start` dev work)
- ✓ `gto-poker-qui.web.app` (Firebase's auto-domain)
- ✓ `gto-poker-qui.firebaseapp.com` (Firebase's legacy auto-domain)
- ✓ `gtopokerdrill.com` (production apex)
- ✓ `www.gtopokerdrill.com` (production www)

### Quick smoke test right after

1. Open `https://gtopokerdrill.com` in an incognito window
2. Click **Sign in with Google**
3. Google popup → select your account
4. Popup should close cleanly → you're signed in → your profile shows
5. If you see "This domain is not authorized to run this operation" → the Auth update didn't propagate or wasn't saved. Re-check Step 3-4 above.

---

## Phase 4 — Verify and retire

**Verify on new domain (~5 min smoke test):**
1. Open `https://gtopokerdrill.com` in an incognito window
2. Sign in with Google
3. Play one scenario → reveal → verify crowd data shows
4. Open Database view (owner-only) → confirm it loads
5. Open Players view → confirm leaderboard data shows
6. Sign out → sign back in
7. Test on mobile (Safari iOS, Chrome Android) if possible

**If everything works:**
- Update `README.md` to point to `https://gtopokerdrill.com`
- Update `.claude/CLAUDE.md` to point to the new live URL
- Add a redirect note on the GitHub Pages site (or simply disable Pages — once DNS is on the new URL, the GH Pages URL is just a fallback)
- Plan the private flip (Phase 5)

**If anything is broken:**
- Don't disable GitHub Pages — keep both running until everything works
- Check Firebase Console → Hosting → recent deploys for errors
- Check browser console for CORS / auth / missing-file errors
- Auth issues are almost always "domain not in authorized list" — re-check Phase 3

---

## Phase 5 — Flip the repo to private + apply LICENSE

**Only after Phase 4 fully verified on `gtopokerdrill.com`.**

1. Add a `LICENSE` file: `Copyright (c) 2026 [your name]. All rights reserved.` (codifies what's already true under default copyright law). Will be added in a separate PR — touches CODEOWNERS-listed files so requires `@llamanftstaking-glitch` approval before merge.
2. Disable GitHub Pages: https://github.com/mondrianaire/gto-drill/settings/pages → set source to "None"
3. Flip the repo to private: https://github.com/mondrianaire/gto-drill/settings → scroll to **Danger Zone** → **Change repository visibility** → **Make private**
4. Confirm warnings (GitHub will list what changes — Forks become detached, etc.)

After flip:
- The repo is invisible to anyone except you and explicit collaborators (max 3 on free tier)
- Existing forks remain public but have no claim on future work
- The deployed site at `https://gtopokerdrill.com` is unaffected — it serves files from Firebase Hosting, not GitHub Pages
- The Firebase Hosting workflow keeps working — it uses the GitHub secret you set up in Phase 1

---

## Collaboration model — branch ruleset only, no CODEOWNERS

The repo has no `CODEOWNERS` file by design. Owner explicitly stated they need to be able to ship any change — including structural / sensitive files like `firestore.rules`, `firebase.json`, `LICENSE`, and workflows — without requiring the other author's intervention. Required-reviewer gates would block that.

Roles:

| Actor | Permission | What they can do |
|---|---|---|
| `mondrianaire` (owner) | Admin | Everything. Pushes branches, opens PRs, self-merges, edits settings. |
| Claude (acting via `mondrianaire`'s gh CLI token) | Admin | Same as above. Pushes branches, opens PRs, self-merges. |
| `llamanftstaking-glitch` (co-author) | Write | Pushes branches, opens PRs, reviews, comments. Cannot bypass the branch ruleset. |

Code review by `llamanftstaking-glitch` happens **voluntarily**: they have full read access to the repo, can review any PR, leave comments, request changes. But their approval is never required for merge — the owner can ship anything solo.

If review-required gates are wanted later for specific files, re-introduce a `CODEOWNERS` file and flip the ruleset's `require_code_owner_review` back to `true`:

```bash
gh api -X PUT repos/mondrianaire/gto-drill/rulesets/17073827 \
  --input docs/ruleset-with-code-owner-review.json
```

### Branch ruleset for `main` (to apply via gh api or GitHub web UI)

Settings (live now — ruleset ID `17073827`):
- ✅ Restrict deletions
- ✅ Block force pushes
- ✅ Require pull request before merge
- ❌ Required approving review count: 0 (no required reviewers)
- ❌ Require code-owner review: false (no CODEOWNERS file — see above)
- ✅ Require status checks: `build_and_preview` (Firebase preview deploy must build)
- ✅ Require linear history
- Bypass list: empty (rules apply uniformly to admin and write collaborators)

The combination above means:
- Every change MUST go through a PR (no direct push to `main`)
- The Firebase preview deploy must succeed before merge (broken builds are blocked)
- No human approval is required — owner / Claude can self-merge any PR once CI passes
- History stays linear and auditable (no force pushes ever)
- Branch `main` can never be deleted

To inspect or modify the active ruleset:

```bash
gh api repos/mondrianaire/gto-drill/rulesets/17073827            # read
gh api -X PUT repos/mondrianaire/gto-drill/rulesets/17073827 \
  --input <updated-ruleset.json>                                  # update
gh api -X DELETE repos/mondrianaire/gto-drill/rulesets/17073827   # remove
```

### Repo settings (already applied via API in the CODEOWNERS PR)

- ✅ Auto-delete head branches after merge (cleans up `claude/...` branches)
- ✅ Allow merge commits
- ❌ Allow squash merging
- ❌ Allow rebase merging
- ✅ Allow auto-merge (lets `gh pr merge --auto` queue merges once status checks pass)

---

## Rollback

If anything goes wrong mid-migration, GitHub Pages still serves the old URL. The repo and code never change — only deploy target.

**To roll back to GitHub Pages:**
- Don't disable GitHub Pages until Phase 4 is fully verified
- DNS records can be reverted at HostGator if Firebase Hosting has problems
- The `firebase.json` file is harmless if you abandon the migration — it only affects what gets deployed via `firebase deploy`, not what GitHub Pages serves

---

## Files touched

- `firebase.json` (new)
- `.firebaserc` (new)
- `.github/workflows/firebase-hosting-merge.yml` (new)
- `.github/workflows/firebase-hosting-pull-request.yml` (new)
- `.gitignore` (added `.firebase/`, `*.log` patterns)
- `docs/HOSTING-MIGRATION.md` (this file)

No source code changes. No deploy until the GitHub secret is set.
