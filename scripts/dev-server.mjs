// dev-server.mjs — zero-dependency local development server for GTO Duel.
//
// GTO Duel is a static ES-module app that cannot be opened as file://
// (browsers block module imports + fetch() of data/scenarios.json, and
// service workers / Notifications need an http origin). This serves the repo
// over http://localhost so the app runs exactly as it does on GitHub Pages.
//
// Run:  node scripts/dev-server.mjs  [port]
//   or:  npm start
// Port: defaults to 8000; override with the PORT env var or the first CLI arg.
//
// No npm dependencies — Node's built-in modules only.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The repo root is the parent of this scripts/ directory.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

// ES modules MUST be served with a JavaScript MIME type or the browser
// refuses them — hence an explicit map rather than a guess.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    // Strip the query string, decode, and default a directory request to
    // index.html.
    let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
    if (pathname.endsWith("/")) pathname += "index.html";

    // Path-traversal guard: resolve against ROOT and reject anything that
    // escapes it.
    const filePath = normalize(join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + (process.platform === "win32" ? "\\" : "/"))) {
      console.log(`403 ${req.method} ${req.url}`);
      return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      console.log(`404 ${req.method} ${req.url}`);
      return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    }

    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    console.log(`200 ${req.method} ${req.url}`);
    return send(res, 200, body, { "Content-Type": type });
  } catch (err) {
    console.error(`500 ${req.method} ${req.url} —`, err.message);
    return send(res, 500, "Server error", { "Content-Type": "text/plain" });
  }
});

server.listen(PORT, () => {
  console.log(`GTO Duel dev server running at http://localhost:${PORT}/`);
  console.log(`Serving ${ROOT}`);
  console.log("Press Ctrl+C to stop.");
});
