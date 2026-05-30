#!/usr/bin/env node
// Test: change @+18 of test-bb-monster entry to a deliberately wrong value
// and write to Downloads. If GTO+ loads it, @+18 doesn't matter.
//
// Three variants — pick via --mode=...
//   --mode=plus2:    +18 = old + 2 (simulating "pot grew by 2" hypothesis)
//   --mode=plus100:  +18 = old + 100 (much bigger lie)
//   --mode=zero:     +18 = 0 (extreme test)
//   --mode=control:  no change (sanity)

import { readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith("--mode=")) || "--mode=control";
const MODE = modeArg.slice("--mode=".length);

const buf = readFileSync("C:/Program Files/GTO/config/library.txt");
const text = buf.toString("latin1");

// Find test-bb-monster
const nameIdx = text.indexOf("test-bb-monster");
const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
const start = opens.filter(o => o < nameIdx).pop();
const close = text.indexOf("[/TREE]", start) + "[/TREE]".length;
const entry = Buffer.from(buf.slice(start, close));
console.log("Entry @" + start + "-" + close + " (" + entry.length + " bytes)");
console.log("@+18 currently: " + entry.readUInt32LE(18));

let newAt18;
if (MODE === "plus2") newAt18 = entry.readUInt32LE(18) + 2;
else if (MODE === "plus100") newAt18 = entry.readUInt32LE(18) + 100;
else if (MODE === "zero") newAt18 = 0;
else newAt18 = entry.readUInt32LE(18);
entry.writeUInt32LE(newAt18, 18);
console.log("@+18 now: " + entry.readUInt32LE(18) + " (mode " + MODE + ")");

// Rebuild preamble (length unchanged, bytesum unchanged for non-inner change)
// Actually @+18 IS inside the inner block — bytesum CHANGES because we
// changed a byte.
function bytesum(b, s, e) {
  let x = 0;
  for (let i = s; i < e; i++) x += b[i];
  return x >>> 0;
}
const inner = entry.slice(6, entry.length - 7);
const newSum = bytesum(entry, 6, entry.length - 7);
console.log("new inner bytesum: " + newSum);

const newPre = Buffer.alloc(16);
newPre.writeUInt32LE(entry.length, 0);
newPre.writeUInt32LE(newSum, 8);

const newLib = Buffer.concat([
  buf.slice(0, start - 16),
  newPre,
  entry,
  buf.slice(close),
]);

writeFileSync("C:/Users/mondr/Downloads/library.txt", newLib);
console.log("Wrote C:/Users/mondr/Downloads/library.txt — diff from live:");
console.log("  size: " + newLib.length + " (live: " + buf.length + ")");

// Diff
let diffs = 0;
for (let i = 0; i < buf.length; i++) {
  if (newLib[i] !== buf[i]) diffs++;
}
console.log("  byte diffs: " + diffs);
