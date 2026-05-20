// version.js — single source of truth for the app version stamp.
//
// Bump this on every commit so the user can read off whether they're on
// the latest deploy. Format is YYYY-MM-DD.counter-for-the-day with an
// optional tag for what's in the build.
//
// On a stale cache (GitHub Pages caches each file for ~10 min), the user
// will see the OLD version here even after a deploy — that's the signal
// to hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).

export const APP_VERSION = "2026-05-20.46-spot-glyphs-stacked";
