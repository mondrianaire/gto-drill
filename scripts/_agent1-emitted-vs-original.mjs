#!/usr/bin/env node
// Compare entry 0 in library-repaired.txt (which is "test-bb-monster",
// re-emitted by gto-library-emit.mjs) against the original test-bb-monster
// from the live library. They should be byte-identical if the emit script
// is doing things right.

import { readFileSync } from "fs";

const bufLive = readFileSync("C:/Program Files/GTO/config/library.txt");
const bufRepaired = readFileSync("C:/Users/mondr/Downloads/library-repaired.txt");

function findEntry(buf, name) {
  const text = buf.toString("latin1");
  const nameIdx = text.indexOf(name);
  if (nameIdx < 0) return null;
  const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
  const closes = [...text.matchAll(/\[\/TREE\]/g)].map(m => m.index);
  const start = opens.filter(o => o < nameIdx).pop();
  const close = closes.find(c => c > start);
  return { preStart: start - 16, start, end: close + "[/TREE]".length };
}

const live = findEntry(bufLive, "test-bb-monster");
const repaired = findEntry(bufRepaired, "test-bb-monster");

const liveEntry = bufLive.slice(live.start, live.end);
const repEntry = bufRepaired.slice(repaired.start, repaired.end);
console.log("LIVE test-bb-monster entry: " + liveEntry.length + " bytes");
console.log("REPAIRED test-bb-monster entry: " + repEntry.length + " bytes");

// Compare
const min = Math.min(liveEntry.length, repEntry.length);
const max = Math.max(liveEntry.length, repEntry.length);

console.log("");
console.log("Byte diffs:");
const diffs = [];
for (let i = 0; i < max; i++) {
  const a = i < liveEntry.length ? liveEntry[i] : null;
  const b = i < repEntry.length ? repEntry[i] : null;
  if (a !== b) diffs.push({ i, a, b });
}
console.log("  Total diff bytes: " + diffs.length);
if (diffs.length < 50) {
  for (const d of diffs) {
    console.log("    @" + d.i + ": LIVE=" + (d.a === null ? "--" : "0x" + d.a.toString(16).padStart(2, "0")) +
                "  REPAIRED=" + (d.b === null ? "--" : "0x" + d.b.toString(16).padStart(2, "0")));
  }
} else {
  console.log("  (too many to list)");
  // Show first 20 and last 20
  console.log("  First 20:");
  for (const d of diffs.slice(0, 20)) {
    console.log("    @" + d.i + ": LIVE=" + (d.a === null ? "--" : "0x" + d.a.toString(16).padStart(2, "0")) +
                "  REPAIRED=" + (d.b === null ? "--" : "0x" + d.b.toString(16).padStart(2, "0")));
  }
  console.log("  ...");
  console.log("  Last 20:");
  for (const d of diffs.slice(-20)) {
    console.log("    @" + d.i + ": LIVE=" + (d.a === null ? "--" : "0x" + d.a.toString(16).padStart(2, "0")) +
                "  REPAIRED=" + (d.b === null ? "--" : "0x" + d.b.toString(16).padStart(2, "0")));
  }
}

// Compare preambles
console.log("");
const livePre = bufLive.slice(live.preStart, live.start);
const repPre = bufRepaired.slice(repaired.preStart, repaired.start);
console.log("Preamble LIVE:     " + livePre.toString("hex"));
console.log("Preamble REPAIRED: " + repPre.toString("hex"));
