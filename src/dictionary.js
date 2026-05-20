// dictionary.js — poker term dictionary.
//
// Two roles:
//   1. Owns the loaded dictionary data and the index used by the tooltip
//      tokenizer (terms + aliases → entry).
//   2. Mounts the browseable Dictionary View — searchable, alphabetical,
//      with cross-links between entries.

let LOADED = null;     // { version, entries: [...] }
let INDEX  = null;     // Map<lowercased term/alias, entry>

// -----------------------------------------------------------------------
// Tooltip-complexity threshold
// -----------------------------------------------------------------------
// Each dictionary entry carries a `complexity` field (1/2/3):
//   1 = common (any rec player knows it — gutshot, set, shove)
//   2 = intermediate (rec-study territory — c-bet, polarized, blocker)
//   3 = advanced (solver-era / math — SPR, MDF, alpha, EV calculation)
//
// The threshold controls what gets a tooltip in tokenized prose. A
// threshold of N means: only entries with complexity >= N tokenize.
// Default = 3 (advanced only) — the app's audience is intimately
// familiar with basic and intermediate poker vocabulary, so showing
// tooltips for "fold" / "gutshot" / "c-bet" is noise. We let the
// solver-era terms (SPR, MDF, alpha, EV, blocker effects, etc.)
// surface tooltips by default and let users opt INTO showing more if
// they want a denser experience.
// User-configurable from the dictionary view; persisted in localStorage.

const TOOLTIP_THRESHOLD_KEY = "gto-duel.tooltipThreshold";
const TOOLTIP_THRESHOLD_DEFAULT = 3;

export function getTooltipThreshold() {
  try {
    const raw = localStorage.getItem(TOOLTIP_THRESHOLD_KEY);
    if (raw == null) return TOOLTIP_THRESHOLD_DEFAULT;
    const n = parseInt(raw, 10);
    return n >= 1 && n <= 3 ? n : TOOLTIP_THRESHOLD_DEFAULT;
  } catch { return TOOLTIP_THRESHOLD_DEFAULT; }
}

export function setTooltipThreshold(n) {
  const clamped = Math.max(1, Math.min(3, parseInt(n, 10) || TOOLTIP_THRESHOLD_DEFAULT));
  try { localStorage.setItem(TOOLTIP_THRESHOLD_KEY, String(clamped)); } catch {}
  return clamped;
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

// -----------------------------------------------------------------------
// Data loading
// -----------------------------------------------------------------------

export async function loadDictionary() {
  if (LOADED) return LOADED;
  try {
    const res = await fetch(new URL("../data/dictionary.json", import.meta.url));
    if (!res.ok) throw new Error("dictionary fetch failed: " + res.status);
    LOADED = await res.json();
  } catch (err) {
    console.warn("Dictionary load failed; tooltips disabled.", err);
    LOADED = { version: 0, entries: [] };
  }
  buildIndex();
  return LOADED;
}

function buildIndex() {
  INDEX = new Map();
  for (const entry of LOADED.entries) {
    const variants = [entry.term, ...(entry.aliases || [])];
    for (const v of variants) {
      INDEX.set(v.toLowerCase(), entry);
    }
  }
}

/** Look up an entry by term or alias (case-insensitive). */
export function lookupTerm(text) {
  if (!INDEX) return null;
  return INDEX.get(String(text).toLowerCase()) || null;
}

/** Return all entries sorted alphabetically by display term. */
export function listEntries() {
  if (!LOADED) return [];
  return LOADED.entries.slice().sort((a, b) =>
    a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

/** Return an entry by id. */
export function getEntry(id) {
  if (!LOADED) return null;
  return LOADED.entries.find((e) => e.id === id) || null;
}

/**
 * Returns a regex matching any known term/alias, with capture group 1 = the
 * matched substring. Word-boundary aware; case-insensitive. Longest variants
 * first so "polar c-bet range" wins over the individual words.
 *
 * @param {Object} [opts]
 * @param {number} [opts.minComplexity] — exclude any entry whose `complexity`
 *   is below this value. Lets callers hide tooltips for terms the audience
 *   already knows (e.g. minComplexity=2 drops basic terms like "shove" /
 *   "set" / "gutshot" so only intermediate+ terms still tokenize).
 *   The dictionary VIEW itself ignores this and shows everything — the
 *   filter only affects inline tokenization.
 */
export function buildTermRegex(opts) {
  if (!INDEX || INDEX.size === 0) return null;
  const minComplexity = opts && Number.isFinite(opts.minComplexity) ? opts.minComplexity : 1;
  // Collect variant strings, skipping any whose entry is below threshold.
  // INDEX maps lowercased variant → entry, so the same entry shows up under
  // each of its variants. We dedupe by walking the map and keeping variants
  // whose entry passes the threshold.
  const kept = [];
  for (const [variant, entry] of INDEX.entries()) {
    const c = (entry && entry.complexity) || 1;
    if (c >= minComplexity) kept.push(variant);
  }
  if (kept.length === 0) return null;
  const variants = kept.sort((a, b) => b.length - a.length);
  const escaped = variants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // \b doesn't play nice with characters like "-" (3-bet), so we use
  // lookaheads/lookbehinds to enforce non-letter boundaries on either side.
  return new RegExp("(?<![A-Za-z0-9])(" + escaped.join("|") + ")(?![A-Za-z0-9])", "gi");
}

// -----------------------------------------------------------------------
// mountDictionaryView — the browseable dictionary screen
// -----------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {() => void} onExit
 * @param {(termId:string) => void} [opts.openTerm]  Optional: scroll to a specific entry on mount.
 * @param {string} [opts.initialTermId]
 */
export function mountDictionaryView(container, onExit, opts = {}) {
  clear(container);
  const entries = listEntries();

  const exitBtn = h("button", { type: "button", class: "link-btn solo-exit", title: "Exit dictionary" }, "← Exit");
  exitBtn.addEventListener("click", () => { if (onExit) onExit(); });

  const searchInput = h("input", {
    type: "search", placeholder: "Search terms…",
    class: "dict-search", "aria-label": "Search dictionary",
  });

  // Tooltip-threshold selector. Lives in the dictionary header because that's
  // where the user is already thinking about which terms get explained.
  // Changing it persists immediately; the change takes effect on the next
  // tokenized render (i.e. when you navigate to solo/duel and prose
  // re-tokenizes). This is intentional — re-tokenizing every mounted view
  // live would be more complexity than it earns.
  const currentT = getTooltipThreshold();
  const thresholdSel = h("select", {
    class: "dict-threshold",
    "aria-label": "Show tooltips for terms at or above this level",
    title: "Which terms get tooltips in prose elsewhere in the app",
  });
  const opts2 = [
    { v: 1, label: "Common+", hint: "all terms get tooltips" },
    { v: 2, label: "Intermediate+", hint: "skip basics like fold, set, gutshot" },
    { v: 3, label: "Advanced only", hint: "only solver-era terms (SPR, MDF, alpha)" },
  ];
  for (const o of opts2) {
    const optEl = h("option", { value: String(o.v) }, "Tooltips: " + o.label);
    if (o.v === currentT) optEl.setAttribute("selected", "");
    thresholdSel.appendChild(optEl);
  }
  thresholdSel.addEventListener("change", (e) => {
    setTooltipThreshold(parseInt(e.target.value, 10));
  });

  const counter = h("span", { class: "dict-count muted" }, entries.length + " terms");
  const header = h("div", { class: "dict-header" },
    h("h2", null, "Poker dictionary"),
    counter,
    thresholdSel,
    exitBtn);

  const listEl = h("div", { class: "dict-list" });

  function termLink(label, targetId) {
    const a = h("button", { type: "button", class: "dict-term-link" }, label);
    a.addEventListener("click", () => scrollToEntry(targetId));
    return a;
  }

  function renderTermContent(text) {
    // Tokenize for inline cross-links to other dictionary entries.
    // Uses the same term-regex as the tooltip layer, but here we render
    // them as proper links (no tooltips needed in this view).
    const frag = document.createDocumentFragment();
    if (!text) return frag;
    const re = buildTermRegex();
    if (!re) { frag.appendChild(document.createTextNode(text)); return frag; }
    let last = 0; let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const matched = m[1];
      const entry = lookupTerm(matched);
      if (entry) frag.appendChild(termLink(matched, entry.id));
      else frag.appendChild(document.createTextNode(matched));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function renderEntries(filter) {
    clear(listEl);
    const q = (filter || "").trim().toLowerCase();
    const visible = entries.filter((e) => {
      if (!q) return true;
      if (e.term.toLowerCase().includes(q)) return true;
      if (e.id.toLowerCase().includes(q)) return true;
      if ((e.aliases || []).some((a) => a.toLowerCase().includes(q))) return true;
      if ((e.short_def || "").toLowerCase().includes(q)) return true;
      return false;
    });
    counter.textContent = q
      ? visible.length + " of " + entries.length + " terms"
      : entries.length + " terms";
    if (visible.length === 0) {
      listEl.appendChild(h("p", { class: "muted" }, "No terms match \"" + filter + "\"."));
      return;
    }
    for (const entry of visible) {
      const aliasLine = (entry.aliases && entry.aliases.length)
        ? h("p", { class: "dict-aliases muted" }, "Also: " + entry.aliases.join(", "))
        : null;
      const seeAlso = (entry.see_also && entry.see_also.length)
        ? h("p", { class: "dict-see-also" },
            h("span", { class: "muted" }, "See also: "),
            entry.see_also.map((id, idx) => {
              const tgt = getEntry(id);
              if (!tgt) return idx === 0 ? id : ", " + id;
              const link = termLink(tgt.term, id);
              if (idx === 0) return link;
              const wrap = document.createDocumentFragment();
              wrap.appendChild(document.createTextNode(", "));
              wrap.appendChild(link);
              return wrap;
            }))
        : null;
      const card = h("article", { class: "dict-entry", id: "dict-" + entry.id },
        h("h3", { class: "dict-term" }, entry.term),
        aliasLine,
        h("p", { class: "dict-short" }, entry.short_def || ""),
        entry.long_def ? h("p", { class: "dict-long" }, renderTermContent(entry.long_def)) : null,
        seeAlso);
      listEl.appendChild(card);
    }
  }

  function scrollToEntry(id) {
    const el = document.getElementById("dict-" + id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("dict-entry-flash");
      setTimeout(() => el.classList.remove("dict-entry-flash"), 1400);
    }
  }

  searchInput.addEventListener("input", () => renderEntries(searchInput.value));

  const root = h("section", { class: "dict-view" }, header, searchInput, listEl);
  container.appendChild(root);

  renderEntries("");

  // Optional: scroll to a specific entry on mount (deep-link support).
  if (opts.initialTermId) {
    setTimeout(() => scrollToEntry(opts.initialTermId), 100);
  }

  return { unmount: () => clear(container) };
}
