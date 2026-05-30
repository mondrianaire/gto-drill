#!/usr/bin/env node
// gto-mt-blockA-decode.mjs — annotated hex dump of Block A trying to identify
// recurring patterns / opcodes.
//
// Hypothesis from passive observation:
//   - Block A is a bytecode for the BET TREE structure (decision tree of
//     check/bet/raise/fold/call nodes per street).
//   - The fresh template's 855 bytes is the "skeleton" version emitted right
//     after configuring tree settings; built template's 2687 is fully expanded.
//
// Strategy here: dump Block A in 16-byte rows with annotations for known
// signal bytes (0x0c, 0x02, 0xff, etc) and for the trailing magic sequence
// `1a 02 0a 18 02 09 16 02 08 ...`.

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/gto-mt-blockA-decode.mjs <file.gto2>");
  process.exit(1);
}

const buf = readFileSync(path);
const tag = "[MAIN TREE]";
const openAt = buf.indexOf(tag);
const contentStart = openAt + tag.length;
const lenA = buf.readUInt32LE(contentStart + 8);
const blockAStart = contentStart + 16;
const blockA = buf.slice(blockAStart, blockAStart + lenA);

console.log(`File: ${path}`);
console.log(`Block A: ${lenA} bytes`);
console.log("");

// Annotated dump
console.log("offset  hex                                              ascii            notes");
console.log("------  -----------------------------------------------  ---------------- ----------");

const annotations = new Map();

// Pattern 1: 0x02 followed by uint32 LE that looks like a small length
// (the lp-string marker used elsewhere) - but Block A has no lp-strings
// per our scan. So 0x02 here may mean something else.

// Pattern 2: 0xff as a sentinel byte
// Pattern 3: tail magic
const tailMagic = Buffer.from([0x1a, 0x02, 0x0a, 0x18, 0x02, 0x09, 0x16, 0x02, 0x08, 0x14, 0x02, 0x07, 0x12, 0x02, 0x06, 0x10, 0x02, 0x05, 0x0e]);
const tailAt = blockA.indexOf(tailMagic);
if (tailAt >= 0) annotations.set(tailAt, `START tail magic (hand-class ladder, 19 bytes)`);

// Print
for (let i = 0; i < blockA.length; i += 16) {
  const slice = blockA.slice(i, Math.min(i + 16, blockA.length));
  const hex = slice.toString("hex").match(/../g).join(" ").padEnd(48);
  const ascii = Array.from(slice).map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("").padEnd(16);
  // Detect annotations for any byte in this row
  const rowNotes = [];
  for (const [off, note] of annotations.entries()) {
    if (off >= i && off < i + 16) rowNotes.push(`@+${off}: ${note}`);
  }
  console.log(`${String(i).padStart(6)}  ${hex}  ${ascii} ${rowNotes.join(" | ")}`);
}
console.log("");

// Histogram
console.log("Byte histogram (top 20):");
const hist = new Map();
for (const b of blockA) hist.set(b, (hist.get(b) || 0) + 1);
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [v, c] of top) {
  const pct = (c / blockA.length * 100).toFixed(1);
  console.log(`  0x${v.toString(16).padStart(2,"0")}=${String(v).padStart(3)} : ${String(c).padStart(4)} (${pct}%)`);
}
console.log("");

// Find runs of common patterns
console.log("Occurrences of structural markers:");
const markers = [
  { name: "0x02 <u32 LE>", pattern: (i) => blockA[i] === 0x02 },
  { name: "0xff sentinel", pattern: (i) => blockA[i] === 0xff },
  { name: "0x0c marker", pattern: (i) => blockA[i] === 0x0c },
  { name: "0x0a marker", pattern: (i) => blockA[i] === 0x0a },
  { name: "0x01 marker", pattern: (i) => blockA[i] === 0x01 },
];
for (const m of markers) {
  let count = 0;
  for (let i = 0; i < blockA.length; i++) if (m.pattern(i)) count++;
  console.log(`  ${m.name.padEnd(20)} ${count} occurrences (${(count / blockA.length * 100).toFixed(1)}%)`);
}
