// dictionary.js — poker term dictionary.
//
// Two roles:
//   1. Owns the loaded dictionary data and the index used by the tooltip
//      tokenizer (terms + aliases → entry).
//   2. Mounts the browseable Dictionary View — searchable, alphabetical,
//      with cross-links between entries.

let LOADED = null;     // { version, entries: [...] }
let INDEX  = null;     // Map<lowercased term/alias, entry>

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
 */
export function buildTermRegex() {
  if (!INDEX || INDEX.size === 0) return null;
  const variants = [...INDEX.keys()].sort((a, b) => b.length - a.length);
  // Escape regex metacharacters in each variant.
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

  const counter = h("span", { class: "dict-count muted" }, entries.length + " terms");
  const header = h("div", { class: "dict-header" },
    h("h2", null, "Poker dictionary"),
    counter,
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
