#!/usr/bin/env node
// _agent1-lib-dump.mjs — dump library.txt structure for comparison
//
// For each [TREE] entry, show:
//   - preamble length + bytesum
//   - entry name
//   - all lp-strings inside (with offsets)
//   - the @+18 internal size field
//   - 32 bytes of hex around each lp-string for context

import { readFileSync } from "fs";

const path = process.argv[2];
if (!path) { console.error("usage: node _agent1-lib-dump.mjs <library.txt>"); process.exit(1); }

const buf = readFileSync(path);
console.log("File: " + path + " (" + buf.length + " bytes)");
console.log("");

function bytesum(b, s = 0, e = b.length) {
  let x = 0;
  for (let i = s; i < e; i++) x += b[i];
  return x >>> 0;
}

// Walk file: find each [TREE] tag, dump its preamble + entry
const tag = "[TREE]";
const close = "[/TREE]";

let cursor = 0;
const entries = [];
while (cursor < buf.length) {
  const idx = buf.indexOf(tag, cursor);
  if (idx < 0) break;
  const closeIdx = buf.indexOf(close, idx + tag.length);
  if (closeIdx < 0) break;
  const entryEnd = closeIdx + close.length;
  const preambleStart = idx - 16;
  entries.push({ preambleStart, entryStart: idx, entryEnd });
  cursor = entryEnd;
}

console.log("Found " + entries.length + " [TREE] entries");
console.log("");

for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  const pre = buf.slice(e.preambleStart, e.entryStart);
  const preLen = pre.readUInt32LE(0);
  const preSum = pre.readUInt32LE(8);
  const entry = buf.slice(e.entryStart, e.entryEnd);
  const actualLen = entry.length;
  const actualSum = bytesum(buf, e.entryStart + tag.length, e.entryEnd - close.length);

  // Locate all lp-strings (02 <u32-le-len> <bytes>) inside the entry
  const strs = [];
  for (let j = 0; j < entry.length - 5; j++) {
    if (entry[j] !== 0x02) continue;
    const len = entry.readUInt32LE(j + 1);
    if (len < 1 || len > 500) continue;
    if (j + 5 + len > entry.length) continue;
    // Check ASCII-likeness
    let ok = true;
    for (let k = 0; k < len; k++) {
      const c = entry[j + 5 + k];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    strs.push({ off: j, len, str: entry.slice(j + 5, j + 5 + len).toString("utf8") });
  }

  // Header u32 @+18
  const sizeField18 = entry.readUInt32LE(18);

  // Scan for additional u32 fields that could be size-related: dump u32s
  // at @0, @4, @8, @12, @16, @18, @20, @22, @24 — but skip the [TREE] tag bytes
  const u32s = [];
  for (let off of [0, 4, 8, 12, 16, 18, 20, 22, 24, 28, 32]) {
    if (off + 4 > entry.length) break;
    u32s.push({ off, v: entry.readUInt32LE(off) });
  }

  console.log("=".repeat(80));
  console.log("[" + i + "] entry @" + e.entryStart + "-" + e.entryEnd + " (" + actualLen + " bytes)");
  console.log("  preamble: len=" + preLen + " (actual " + actualLen + ", match=" + (preLen === actualLen) + ") sum=" + preSum + " (actual " + actualSum + ", match=" + (preSum === actualSum) + ")");
  console.log("  u32 dump:");
  for (const { off, v } of u32s) {
    console.log("    @" + String(off).padStart(3) + ": " + String(v).padStart(10) + "  (0x" + v.toString(16).padStart(8, "0") + ")");
  }
  console.log("  size field @+18: " + sizeField18 + " (entry.len - sizeField = " + (actualLen - sizeField18) + ")");
  console.log("  lp-strings (" + strs.length + "):");
  for (const s of strs) {
    const display = s.str.length > 60 ? s.str.slice(0, 57) + "..." : s.str;
    console.log("    @" + String(s.off).padStart(5) + " len=" + String(s.len).padStart(3) + "  '" + display + "'");
  }
  // Find name (the first short ASCII string near the start, typically)
  const nameStr = strs.find(s => s.len < 50);
  if (nameStr) console.log("  name: " + nameStr.str);
}
