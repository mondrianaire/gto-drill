// src/config.js
// ---------------------------------------------------------------
// PASTE YOUR FIREBASE + VAPID CONFIG VALUES BELOW.
//
// 1) Create a free Firebase project at https://console.firebase.google.com/
//
// 2) In that project: enable Firestore (Native mode) and Anonymous
//    Authentication (Authentication > Sign-in method > Anonymous > Enable).
//
// 3) Open Project settings (gear icon) > General > Your apps > Add app >
//    Web. Register the app, then copy the "firebaseConfig" object that
//    Firebase shows you. Paste each value below into FIREBASE_CONFIG.
//
// 4) In Project settings > Cloud Messaging > "Web configuration":
//    click "Generate key pair" under Web Push certificates. Copy the
//    public key into VAPID_PUBLIC_KEY. Then in the Firebase Console URL
//    you'll see a "..." menu under the generated key — Firebase shows
//    only the public key. To get the private key, the simplest path
//    is to use a third-party VAPID key-pair generator that gives you
//    both halves (e.g., the web-push npm CLI: `npx web-push generate-vapid-keys`).
//    Whatever pair you generate, paste BOTH halves below — they must
//    correspond to the same key pair, and the public key here must match
//    what you uploaded into Firebase's Web Push certificates panel.
//
// 5) Paste your contact email or URL into VAPID_SUBJECT — push services
//    require this for abuse contact (it doesn't get displayed to users).
//
// 6) Paste the Firestore Security Rules from /firestore.rules into
//    Firebase Console > Firestore > Rules and click Publish.
//
// 7) Commit this whole directory to a GitHub repo and enable GitHub Pages.
//    See the README for the full step-by-step.
// ---------------------------------------------------------------

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCxc5ICHwz4Fp_2kRwHogeLdgUeCGKgHss",
  authDomain: "gto-poker-qui.firebaseapp.com",
  projectId: "gto-poker-qui",
  storageBucket: "gto-poker-qui.firebasestorage.app",
  messagingSenderId: "607915389446",
  appId: "1:607915389446:web:5b1c777bf4fad0bc1c0987"
};

// VAPID keys for Web Push. Public key goes to PushManager.subscribe;
// private key signs the JWT used to authenticate push requests.
// Both must be the same key pair, encoded in URL-safe base64.
export const VAPID_PUBLIC_KEY = "BEHU9oilRa5R2UrNhIgSNaAPRK26AQ30jf3qZOviea5x7cP0Jbji3OzKkRkAYk4_FQZAgzHN42B2-PskswEIvbM";
export const VAPID_PRIVATE_KEY = "k8u_VKqBStBjK1kvj7D4KjxeBKaXKYB9rS_C4RsOVyk";

// Contact identifier the push service uses for abuse outreach.
// Use a mailto: URL with an email you check.
export const VAPID_SUBJECT = "mailto:mondrianaire@gmail.com";
