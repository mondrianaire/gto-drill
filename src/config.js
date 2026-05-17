// src/config.js
// ---------------------------------------------------------------
// PASTE YOUR FIREBASE CONFIG VALUES BELOW.
//
// 1) Create a free Firebase project at https://console.firebase.google.com/
//
// 2) In that project: enable Firestore (Native mode) and Google
//    Authentication (Authentication > Sign-in method > Google > Enable).
//    Then add the domain you serve the app from (e.g. your GitHub Pages
//    domain) under Authentication > Settings > Authorized domains.
//
// 3) Open Project settings (gear icon) > General > Your apps > Add app >
//    Web. Register the app, then copy the "firebaseConfig" object that
//    Firebase shows you. Paste each value below into FIREBASE_CONFIG.
//
// 4) Paste the Firestore Security Rules from /firestore.rules into
//    Firebase Console > Firestore > Rules and click Publish.
//
// 5) Commit this whole directory to a GitHub repo and enable GitHub Pages.
//    See the README for the full step-by-step.
//
// Note: the Firebase apiKey below is NOT a secret. Firebase web API keys
// are designed to be public — access is governed by the Firestore Security
// Rules and anonymous auth, not by keeping this value hidden.
// ---------------------------------------------------------------

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCxc5ICHwz4Fp_2kRwHogeLdgUeCGKgHss",
  authDomain: "gto-poker-qui.firebaseapp.com",
  projectId: "gto-poker-qui",
  storageBucket: "gto-poker-qui.firebasestorage.app",
  messagingSenderId: "607915389446",
  appId: "1:607915389446:web:5b1c777bf4fad0bc1c0987"
};
