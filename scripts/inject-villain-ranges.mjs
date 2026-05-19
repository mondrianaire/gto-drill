#!/usr/bin/env node
// Inject `villain_ranges` into specific scenarios in data/scenarios.json.
// Usage: node scripts/inject-villain-ranges.mjs <patch.json>
//   patch.json: { "<scenario_id>": [ {label,anchor,summary,classes}, ... ], ... }
// Preserves the file's CRLF line endings.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\//, ""));
const scenPath = path.join(repoRoot, "data", "scenarios.json");
const patchPath = process.argv[2];
if (!patchPath) {
  console.error("Usage: node scripts/inject-villain-ranges.mjs <patch.json>");
  process.exit(2);
}

const raw = fs.readFileSync(scenPath, "utf8");
const NL = raw.includes("\r\n") ? "\r\n" : "\n";
const scenarios = JSON.parse(raw);
const arr = Array.isArray(scenarios) ? scenarios : scenarios.scenarios;
const patch = JSON.parse(fs.readFileSync(path.resolve(patchPath), "utf8"));

let updated = 0;
let skipped = 0;
for (const [id, ranges] of Object.entries(patch)) {
  const scen = arr.find((s) => s.scenario_id === id);
  if (!scen) { console.warn("scenario_id not found:", id); skipped++; continue; }
  // Validate anchors actually exist in gto_explanation
  const expl = scen.gto_explanation || "";
  const badAnchors = ranges.filter((r) => !expl.includes(r.anchor));
  if (badAnchors.length) {
    console.warn("anchor(s) not found in explanation for", id, "::",
      badAnchors.map((r) => JSON.stringify(r.anchor)).join(", "));
    skipped++;
    continue;
  }
  scen.villain_ranges = ranges;
  updated++;
}

const out = JSON.stringify(scenarios, null, 2).replace(/\n/g, NL) + (raw.endsWith(NL) ? NL : "");
fs.writeFileSync(scenPath, out, "utf8");
console.log("Updated", updated, "scenarios · skipped", skipped);
