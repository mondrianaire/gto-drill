#!/usr/bin/env node
// Look at the byte region around @+18 across all entries to see what it's
// part of. Is it standalone, or part of a structure?

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

function findName(e) {
  for (let i = 6; i < e.length - 5; i++) {
    if (e[i] !== 0x02) continue;
    const len = e.readUInt32LE(i + 1);
    if (len < 1 || len > 100) continue;
    let ok = true;
    for (let k = 0; k < len; k++) {
      const c = e[i + 5 + k];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (ok) return { off: i, len, str: e.slice(i + 5, i + 5 + len).toString("utf8") };
  }
  return null;
}

console.log("Entry  | name (truncated)         | @+0..@+10 | @+10..@+25 | @+18 val | entry.len | name@");
for (let i = 0; i < entries.length; i++) {
  const e = entries[i].buf;
  const name = findName(e);
  const nameDisplay = (name?.str || "?").slice(0, 25).padEnd(25);
  const h0 = e.slice(0, 10).toString("hex");
  const h1 = e.slice(10, 25).toString("hex");
  const at18 = e.readUInt32LE(18);
  console.log(String(i).padStart(2) + "     | " + nameDisplay + " | " + h0 + " | " + h1 + " | " + String(at18).padStart(8) + " | " + String(e.length).padStart(8) + " | " + String(name.off).padStart(4));
}

// Specifically look at bytes @14..@28 for each entry — this is around the @+18 field
console.log("");
console.log("Bytes @14..@28 (raw) for each entry — to see context around @+18:");
for (let i = 0; i < entries.length; i++) {
  const e = entries[i].buf;
  const name = findName(e);
  console.log("  " + String(i).padStart(2) + " '" + (name?.str || "?").slice(0, 30) + "': " + e.slice(14, 30).toString("hex"));
}
