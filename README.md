# GTO Duel

A small two-person GTO poker quiz you and one specific friend play
asynchronously. Same gotcha hands, your confidence on each, and at the
end we surface the spots where you both felt sure and disagreed —
those are the conversations worth having.

This is a static web app you host on GitHub Pages. The two players'
state lives in your own free Firebase project. There's no server you
need to run.

## What you need

- A free Google account (for Firebase).
- A free GitHub account (for hosting).
- About 15 minutes for the one-time setup.

## Setup (one time, ~15 minutes)

### 1. Create a free Firebase project

1. Go to **<https://console.firebase.google.com/>** and sign in.
2. Click **Add project**, give it a name like `gto-duel-mom-and-me`,
   and accept the defaults. Disable Google Analytics if you don't
   want it — not required.

### 2. Enable Firestore

1. In your new project, in the left sidebar choose **Build → Firestore Database**.
2. Click **Create database**, choose **Native mode**, and pick a region close to you.
3. When asked about rules, accept the default test rules for now — you'll
   replace them in step 5.

### 3. Enable Anonymous Authentication

1. In the left sidebar choose **Build → Authentication**.
2. Click **Get started**, then under **Sign-in method**, find
   **Anonymous** in the list and click it.
3. Toggle **Enable** to on and save.

### 4. Get your Firebase web config

1. In Project settings (the gear icon, top-left) → **General** tab,
   scroll to **Your apps**.
2. Click the web icon **`</>`** to register a new web app. Name it
   anything ("duel-web" is fine). You do **not** need Firebase Hosting.
3. Firebase will show you a `firebaseConfig` object that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "gto-duel-mom-and-me.firebaseapp.com",
     projectId: "gto-duel-mom-and-me",
     storageBucket: "gto-duel-mom-and-me.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef…"
   };
   ```
   Keep this open in a tab — you'll paste it in step 6.

### 5. Paste the security rules

1. In the Firebase console: **Firestore Database → Rules**.
2. Open the file `firestore.rules` from this directory in a text editor,
   copy the entire contents, and paste it into the Rules editor in
   Firebase (replacing what's there).
3. Click **Publish**.

### 6. Generate a VAPID key pair (for turn notifications)

Web Push needs a pair of "VAPID" keys. The simplest way to generate them:

- In a terminal with Node.js installed, run:
  ```
  npx web-push generate-vapid-keys
  ```
  This prints a public key and a private key. Keep both.

- (Alternative: any online "VAPID key generator" will produce a P-256
  pair in URL-safe base64.)

### 7. Paste your config values

Open `src/config.js` in this directory in a text editor. Replace the
`PASTE_…` placeholders with:

- The six values from your `firebaseConfig` object (step 4) — into
  `FIREBASE_CONFIG`.
- Your VAPID public key (step 6) — into `VAPID_PUBLIC_KEY`.
- Your VAPID private key (step 6) — into `VAPID_PRIVATE_KEY`.
- Your contact email — into `VAPID_SUBJECT` (`mailto:you@example.com`).

> **A small security note.** This is a fully static web app, so the VAPID
> private key ships inside the JavaScript that gets sent to every visitor.
> Anyone who reads the published source can read the private key and
> use it to sign push notifications to your push subscribers. For a
> two-person friends-and-family game this is fine — the realistic
> "attacker" is only able to send you and your friend extra push
> notifications, nothing more. If this ever stops being friends-and-family,
> move the push send into a Cloud Function and remove the private key
> from `config.js`.

### 8. Push this directory to a GitHub repo

1. Create a new GitHub repo (it can be public — none of the contents are
   secret in a way that matters for the friends-and-family use case).
2. Push the contents of this directory (the same directory that contains
   `index.html`, `manifest.json`, `sw.js`, `src/`, etc.) to the repo root.

### 9. Enable GitHub Pages

1. In the repo on GitHub: **Settings → Pages**.
2. Under **Build and deployment**, **Source**: choose **Deploy from a branch**.
3. **Branch**: choose your default branch (e.g., `main`) and folder `/ (root)`.
4. Click **Save**. After about a minute GitHub Pages will publish the app
   at `https://<your-username>.github.io/<repo-name>/`.

### 10. Try it

1. Open the published URL on your phone or laptop.
2. Tap **Create a new game**. Pick a display name and round/handful counts.
3. Copy the share link and send it to your friend (text, email, anywhere).
4. They open the link, pick their own display name, and join.
5. You each play your handfuls when you have time. The app remembers
   where you left off.

### On iPhone / iPad

iOS Safari only sends Web Push notifications to a site you've added to
your Home Screen. Once you open the published URL on iPhone:

1. Tap the **Share** icon at the bottom of Safari.
2. Tap **Add to Home Screen**.
3. Open GTO Duel from the new icon (not from Safari).
4. Now the **Enable turn notifications** button will work.

Without Add-to-Home-Screen on iOS, the game still works perfectly — you
just won't get push alerts; you'll see your turn next time you open the app.

## Files in this directory

- `index.html` — the entry point.
- `manifest.json` — Web App Manifest (display:standalone for iOS PWA).
- `sw.js` — the service worker that receives push events.
- `src/config.js` — **your** Firebase config and VAPID keys go here.
- `src/app.js`, `src/state.js`, `src/onboarding.js`, `src/ui.js`,
  `src/flow.js`, `src/stats.js`, `src/scenarios.js`, `src/push.js` —
  the app's modules.
- `data/scenarios.json` — the 20-scenario GTO gotcha library.
- `styles/app.css` — styles.
- `firestore.rules` — the Firestore Security Rules to paste in step 5.
- `icons/` — app icons.

## When something goes wrong

- **The boot screen says "Setup needed"** — `src/config.js` still has
  the placeholder values. Go back to step 7.
- **"Could not create the game"** — Either Firestore isn't enabled
  (step 2), Anonymous Authentication isn't enabled (step 3), or the
  security rules aren't published (step 5).
- **Push notifications never fire on iOS** — Did you Add-to-Home-Screen
  and open from the home screen icon? (Required by Apple.)
- **Push notifications never fire on Android/desktop either** — Check
  that you ran step 6 and pasted both VAPID keys in step 7.

Have fun. — and tell your mom hi for me.
