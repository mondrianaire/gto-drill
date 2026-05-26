#!/usr/bin/env node
// Diff the headers of two library entries that have the same bet-tree
// settings but different name lengths.
//
// Example 1 (entry 1, name 49 chars) and Example 3 (entry 3, name 19 chars)
// should have similar bet-tree config but different name → any byte that
// changes between them is either name-length-driven or content-driven.

import { readFileSync } from "fs";

const buf = readFileSync(process.argv[2] || "C:/Program Files/GTO/config/library.txt");

const entries = [];
let cur = 0;
while (true) {
  const idx = buf.indexOf("[TREE]", cur);
  if (idx < 0) break;
  const closeIdx = buf.indexOf("[/TREE]", idx);
  if (closeIdx < 0) break;
  const end = closeIdx + "[/TREE]".length;
  entries.push({ start: idx, end, buf: buf.slice(idx, end) });
  cur = end;
}

console.log("Have " + entries.length + " entries");
console.log("");

function findName(e) {
  for (let i = 6; i < e.length - 5; i++) {
    if (e[i] !== 0x02) continue;
    const len = e.readUInt32LE(i + 1);
    if (len < 1 || len > 100) continue;
    if (i + 5 + len > e.length) continue;
    let ok = true;
    for (let k = 0; k < len; k++) {
      const c = e[i + 5 + k];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (ok) return { off: i, len, str: e.slice(i + 5, i + 5 + len).toString("utf8") };
  }
  return null;
}

// Compare every pair of entries: print bytes that differ in the
// header region (0..first lp-string offset).
function diffEntries(a, b, labelA, labelB) {
  const nameA = findName(a);
  const nameB = findName(b);
  const minOff = Math.min(nameA.off, nameB.off);
  console.log("=== " + labelA + " (name@" + nameA.off + "=" + nameA.len + " '" + nameA.str.slice(0, 20) + "...') vs " +
              labelB + " (name@" + nameB.off + "=" + nameB.len + " '" + nameB.str.slice(0, 20) + "...') ===");
  console.log("  entry A len=" + a.length + "  entry B len=" + b.length);
  console.log("  Diffs in header region [0.." + minOff + "]:");
  for (let i = 0; i < minOff; i++) {
    if (a[i] !== b[i]) {
      console.log("    @" + String(i).padStart(3) +
                  ": A=0x" + a[i].toString(16).padStart(2, "0") +
                  " B=0x" + b[i].toString(16).padStart(2, "0") +
                  "  (A=" + a[i] + ", B=" + b[i] + ")");
    }
  }
  console.log("");
}

// Diff entry 1 (Example 1 cash basic) vs entry 3 (Example 3 SitAndGo)
// Both have same bet-tree mode supposedly
if (entries.length >= 4) {
  diffEntries(entries[1].buf, entries[3].buf, "entry1[Example1]", "entry3[Example3]");
}
// Also diff entry 0 (test-bb-monster) vs entry 1 (Example 1) — both have similar setup but different ranges
if (entries.length >= 2) {
  diffEntries(entries[0].buf, entries[1].buf, "entry0[test-bb-monster]", "entry1[Example1]");
}
// Also diff entry 2 vs entry 4
if (entries.length >= 5) {
  diffEntries(entries[2].buf, entries[4].buf, "entry2[Example2]", "entry4[Example4]");
}
