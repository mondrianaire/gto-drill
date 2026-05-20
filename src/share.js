// share.js — clipboard helpers + a reusable share-link icon button.
//
// Used by:
//   - solo.js (share a scenario permalink — "?scenario=<id>")
//   - ui.js   (share an in-game permalink — "?game=<id>")
//
// The button itself is intentionally icon-only with a `title` tooltip,
// matching the rest of the header chrome. On click it copies the URL to
// the clipboard, flips the icon to a checkmark for ~1.8s as feedback,
// and if the clipboard write fails (no Clipboard API, blocked, insecure
// origin) it surfaces the raw URL inline so the user can copy by hand.

/**
 * Copy a string to the OS clipboard. Resolves true on success, false on
 * failure. Tries the modern Clipboard API first; falls back to a hidden
 * textarea + execCommand("copy") for older browsers and insecure contexts.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {}
  return false;
}

/** Build the deep-link URL for a given scenario id. */
export function shareUrlForScenario(scenarioId) {
  return location.origin + location.pathname + "?scenario=" + encodeURIComponent(scenarioId);
}

/** Build the deep-link URL for a given multiplayer game id. */
export function shareUrlForGame(gameId) {
  return location.origin + location.pathname + "?game=" + encodeURIComponent(gameId);
}

/**
 * Build a small icon-only share button + the inline fallback host.
 * Returns `{ button, fallback }` — append both to the DOM (the fallback
 * stays hidden until the clipboard path fails).
 *
 * @param {Object} opts
 * @param {() => string} opts.buildUrl  Re-evaluated on each click (so a
 *   live URL reflects the current scenario/game even after navigation).
 * @param {string} opts.title           Tooltip + accessible label.
 * @param {string} [opts.className]     Extra class for layout/positioning.
 */
export function buildShareLinkButton({ buildUrl, title, className }) {
  // We use a single span we mutate (not two children) so the icon's
  // horizontal slot stays stable when we swap 🔗 ↔ ✓ — no width jitter.
  const iconSpan = document.createElement("span");
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.textContent = "🔗";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "link-btn share-icon-btn" + (className ? " " + className : "");
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.appendChild(iconSpan);

  const fallback = document.createElement("div");
  fallback.className = "share-fallback";
  fallback.hidden = true;

  btn.addEventListener("click", async () => {
    const url = buildUrl();
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      btn.classList.add("is-copied");
      iconSpan.textContent = "✓";
      btn.title = "Copied!";
      setTimeout(() => {
        btn.classList.remove("is-copied");
        iconSpan.textContent = "🔗";
        btn.title = title;
      }, 1800);
    } else {
      // Surface the URL inline so the user can copy by hand.
      fallback.hidden = false;
      while (fallback.firstChild) fallback.removeChild(fallback.firstChild);
      const input = document.createElement("input");
      input.type = "text";
      input.readOnly = true;
      input.value = url;
      input.className = "share-fallback-input";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "link-btn";
      close.textContent = "✕";
      close.addEventListener("click", () => {
        fallback.hidden = true;
        while (fallback.firstChild) fallback.removeChild(fallback.firstChild);
      });
      const label = document.createElement("span");
      label.className = "muted";
      label.textContent = "Copy this link:";
      fallback.appendChild(label);
      fallback.appendChild(input);
      fallback.appendChild(close);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }
  });

  return { button: btn, fallback };
}
