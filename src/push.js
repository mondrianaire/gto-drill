// push.js — section-3 (Notifications and Service Worker)
//
// Implements the Web Push pipeline using the W3C Push API + the
// VAPID-signed Web Push protocol. All backend reads/writes for the
// player's subscription record go through section-2's adapter — this
// module never imports Firebase directly.
//
// Key flow:
//   1. enableNotifications() (called from a click handler):
//        - Asks Notification.requestPermission()
//        - On grant: subscribes via PushManager with VAPID public key
//        - Persists the subscription via state.savePushSubscription()
//   2. sendTurnNotification(gameId, recipientUid, payload):
//        - Reads opponent's stored subscription via state.readOpponentPushSubscription()
//        - Signs a VAPID JWT in the browser using the configured private key
//        - POSTs to the recipient's push endpoint with TTL + Authorization headers
//
// The service worker (sw.js) handles the 'push' event and renders the
// notification.

import { savePushSubscription, readOpponentPushSubscription } from "./state.js";
import { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } from "./config.js";

// -----------------------------------------------------------------------
// Capabilities
// -----------------------------------------------------------------------

export function platformSupportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  return isIos;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (window.navigator && window.navigator.standalone) === true
  );
}

export function notificationStatus() {
  const supports = platformSupportsPush();
  const permission =
    typeof Notification !== "undefined" ? Notification.permission : "default";
  return {
    permission,
    subscribed: false, // set true on enable
    platform_supports_push: supports,
    ios_requires_home_screen_install: isIosSafari() && !isStandalone(),
  };
}

// -----------------------------------------------------------------------
// Service-worker registration
// -----------------------------------------------------------------------

let _swReg = null;

/**
 * Register the service worker at a relative URL so the scope equals the
 * directory of the entrypoint (and thus the GitHub Pages project subpath).
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  if (_swReg) return _swReg;
  try {
    // Use a relative URL — './sw.js' — so the worker scope equals the
    // directory of the registering script. This makes the worker scope
    // correctly bind to the GitHub Pages project subpath at runtime.
    _swReg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    return _swReg;
  } catch (err) {
    console.warn("Service worker registration failed:", err);
    return null;
  }
}

// -----------------------------------------------------------------------
// Subscription
// -----------------------------------------------------------------------

let _currentGameId = null;
export function setActiveGameForPush(gameId) {
  _currentGameId = gameId;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * MUST be invoked from a user-click handler. Asks for notification
 * permission, subscribes via PushManager, and persists the subscription
 * record on the current game document.
 *
 * @returns {Promise<{granted:boolean, reason?:'denied'|'unsupported'|'requires_pwa_install'|'no_active_game'|'error'}>}
 */
export async function enableNotifications() {
  if (!platformSupportsPush()) {
    return { granted: false, reason: "unsupported" };
  }
  if (isIosSafari() && !isStandalone()) {
    return { granted: false, reason: "requires_pwa_install" };
  }
  if (!_currentGameId) {
    return { granted: false, reason: "no_active_game" };
  }
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { granted: false, reason: "error" };
  }
  if (permission !== "granted") {
    return { granted: false, reason: "denied" };
  }
  const reg = await registerServiceWorker();
  if (!reg) return { granted: false, reason: "unsupported" };
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("PASTE_")) {
    return { granted: false, reason: "error" };
  }
  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch (err) {
    console.warn("pushManager.subscribe failed:", err);
    return { granted: false, reason: "error" };
  }
  // Serialize the subscription into the PushSubscriptionRecord shape.
  const json = sub.toJSON();
  const record = {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    subscribed_at: new Date().toISOString(),
  };
  try {
    await savePushSubscription(_currentGameId, record);
  } catch (err) {
    console.warn("savePushSubscription failed:", err);
    return { granted: false, reason: "error" };
  }
  return { granted: true };
}

// -----------------------------------------------------------------------
// VAPID signing (client-side) — see dev-001.json for rationale.
//
// We sign a JWT with the configured VAPID private key (an EC P-256 key in
// base64url-encoded raw form) and POST to the recipient's endpoint with
// the standard headers:
//   Authorization: vapid t=<jwt>, k=<vapid-public-key>
//   TTL: 86400
//
// We do NOT encrypt the payload — most push services accept empty-payload
// pushes that just trigger the SW's push event. The SW renders a generic
// notification ('It's your turn'). For richer payloads, RFC 8291 ECE
// encryption would be required; we keep the friends-and-family path simple.
// -----------------------------------------------------------------------

function b64UrlEncode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importVapidPrivateKey(b64UrlPrivate) {
  const raw = urlBase64ToUint8Array(b64UrlPrivate);
  // The VAPID private key from Firebase is a 32-byte raw EC P-256 d value.
  // SubtleCrypto needs a JWK or PKCS8. We can construct a JWK from raw d
  // plus the public x,y derived from VAPID_PUBLIC_KEY.
  const pubBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  if (pubBytes[0] !== 0x04 || pubBytes.length !== 65) {
    throw new Error("VAPID public key is not uncompressed P-256 (65 bytes 0x04|x|y)");
  }
  const x = pubBytes.slice(1, 33);
  const y = pubBytes.slice(33, 65);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: b64UrlEncode(raw),
    x: b64UrlEncode(x),
    y: b64UrlEncode(y),
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signVapidJwt(audience) {
  const header = { typ: "JWT", alg: "ES256" };
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = { aud: audience, exp, sub: VAPID_SUBJECT || "mailto:duel@example.invalid" };
  const enc = (obj) => b64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const key = await importVapidPrivateKey(VAPID_PRIVATE_KEY);
  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    new TextEncoder().encode(unsigned)
  );
  const sig = b64UrlEncode(new Uint8Array(sigBuf));
  return `${unsigned}.${sig}`;
}

/**
 * Send a turn notification to the opponent.
 * @param {string} gameId
 * @param {string} recipientUid (informational; we resolve via state.readOpponentPushSubscription)
 * @param {{title:string, body:string, url:string}} _payload (currently unused; SW renders a fixed message)
 * @returns {Promise<{sent:boolean, reason?:'no_subscription'|'permission_denied'|'send_failed'|'config_missing'}>}
 */
export async function sendTurnNotification(gameId, _recipientUid, _payload) {
  try {
    const sub = await readOpponentPushSubscription(gameId);
    if (!sub || !sub.endpoint) return { sent: false, reason: "no_subscription" };
    if (!VAPID_PRIVATE_KEY || VAPID_PRIVATE_KEY.startsWith("PASTE_")) {
      return { sent: false, reason: "config_missing" };
    }
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await signVapidJwt(audience);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        TTL: "86400",
        Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
        "Content-Length": "0",
      },
      body: "",
    });
    if (!res.ok && res.status !== 201 && res.status !== 202) {
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (err) {
    console.warn("sendTurnNotification failed:", err);
    return { sent: false, reason: "send_failed" };
  }
}
