#!/usr/bin/env node
// _agent1-lib-fields.mjs — focused field analysis per entry
//
// For each entry, find ALL u32 fields that scale with entry length, name,
// or content. The goal: identify the SECONDARY length field hypothesized by
// the agent-1 mission.
//
// Approach: scan u32-LE at every offset 0..50 within the entry. Compare
// against entry.length, sizeField18, name.length, etc. Print which values
// match.

import { readFileSync } from "fs";

const path = process.argv[2];
if (!path) { console.error("usage: node _agent1-lib-fields.mjs <library.txt>"); process.exit(1); }

const buf = readFileSync(path);

// Find every [TREE]...[/TREE]
const entries = [];
let cur = 0;
while (true) {
  const idx = buf.indexOf("[TREE]", cur);
  if (idx < 0) break;
  const closeIdx = buf.indexOf("[/TREE]", idx);
  if (closeIdx < 0) break;
  const end = closeIdx + "[/TREE]".length;
  entries.push({ start: idx, end });
  cur = end;
}

console.log("Entries: " + entries.length);
console.log("");

// Header is everything between [TREE] (6 bytes) and the first lp-string,
// which is the name. Print every u32 LE in that header.
function findFirstLp(entry, startSearch = 6) {
  for (let i = startSearch; i < entry.length - 5; i++) {
    if (entry[i] !== 0x02) continue;
    const len = entry.readUInt32LE(i + 1);
    if (len < 1 || len > 100) continue;
    if (i + 5 + len > entry.length) continue;
    let ok = true;
    for (let k = 0; k < len; k++) {
      const c = entry[i + 5 + k];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (ok) return { off: i, len };
  }
  return null;
}

console.log("Per-entry: name-lpstring offset, name length, entry.length,");
console.log("           every u32 in entry @0..50, and relationship to length/name");
console.log("");

const analyzed = [];

for (let i = 0; i < entries.length; i++) {
  const { start, end } = entries[i];
  const entry = buf.slice(start, end);
  const elen = entry.length;
  const nameLp = findFirstLp(entry, 6);
  if (!nameLp) { console.log("Entry " + i + ": no name lp found"); continue; }
  const name = entry.slice(nameLp.off + 5, nameLp.off + 5 + nameLp.len).toString("utf8");
  const nameEnd = nameLp.off + 5 + nameLp.len;

  console.log("=".repeat(80));
  console.log("Entry " + i + ": '" + name + "' (entry.length=" + elen + ", name@" + nameLp.off + ", nameEnd=" + nameEnd + ")");
  console.log("");
  console.log("  every u32 LE in header bytes [0..min(nameLp.off, 80)]:");
  const limit = Math.min(nameLp.off + 4, 80);
  const fields = [];
  for (let off = 0; off <= limit - 4; off++) {
    const v = entry.readUInt32LE(off);
    fields.push({ off, v });
  }

  // For each field, check if it equals or correlates with:
  //   - elen
  //   - elen - 7 (without [/TREE])
  //   - elen - 13 (without both tags)
  //   - elen - nameLp.off
  //   - elen - nameLp.off - 5
  //   - elen - nameEnd
  //   - elen + N for small N
  //   - nameLp.len
  for (const f of fields) {
    const tags = [];
    const checks = [
      [elen, "elen"],
      [elen - 7, "elen-7 [no /TREE]"],
      [elen - 13, "elen-13 [no tags]"],
      [elen - nameLp.off, "elen-nameLp.off"],
      [elen - nameLp.off + 6, "elen-nameLp.off+6"],
      [elen - nameEnd, "elen-nameEnd"],
      [elen - nameEnd + 7, "elen-nameEnd+7"],
      [nameLp.len, "name.len"],
      [nameLp.len + 5, "name.len+5"],
    ];
    for (const [val, label] of checks) {
      if (f.v === val) tags.push(label);
      else if (Math.abs(f.v - val) < 10 && f.v < 100000) tags.push(label + "?(" + (f.v - val) + ")");
    }
    if (tags.length || (f.v > 0 && f.v < 100000)) {
      console.log("    @" + String(f.off).padStart(3) + ": " + String(f.v).padStart(10) + (tags.length ? "   ✓ " + tags.join("  ") : ""));
    }
  }

  analyzed.push({ name, elen, nameOff: nameLp.off, nameLen: nameLp.len, nameEnd, header: entry.slice(0, nameLp.off) });
}

// Print correlation table
console.log("");
console.log("=".repeat(80));
console.log("CORRELATION TABLE");
console.log("=".repeat(80));
console.log("Off | " + analyzed.map(a => a.name.slice(0, 15).padEnd(16)).join("| "));
console.log("    | " + analyzed.map(a => ("elen=" + a.elen).padEnd(16)).join("| "));
console.log("    | " + analyzed.map(a => ("name=" + a.nameLen + " @ " + a.nameOff).padEnd(16)).join("| "));
console.log("-".repeat(80));
const maxOff = Math.min(...analyzed.map(a => a.header.length)) - 4;
for (let off = 0; off <= maxOff; off += 1) {
  const row = analyzed.map(a => {
    const v = a.header.readUInt32LE(off);
    return String(v).padStart(16);
  });
  console.log(String(off).padStart(3) + " | " + row.join("| "));
}
