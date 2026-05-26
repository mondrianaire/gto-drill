#!/usr/bin/env node
// gto-mt-diff.mjs — diff MAIN TREE between two .gto2 files.
//
// Usage: node scripts/gto-mt-diff.mjs <a.gto2> <b.gto2>
//
// Outputs every byte position in MAIN TREE that differs, structurally
// labelled (sub-header / Block A offset / Block B offset).

import { readFileSync } from "node:fs";

const [, , pathA, pathB] = process.argv;
if (!pathA || !pathB) {
  console.error("Usage: node scripts/gto-mt-diff.mjs <a.gto2> <b.gto2>");
  process.exit(1);
}

function loadMT(path) {
  const buf = readFileSync(path);
  const tag = "[MAIN TREE]";
  const closeTag = "[/MAIN TREE]";
  const openAt = buf.indexOf(tag);
  const closeAt = buf.indexOf(closeTag);
  const contentStart = openAt + tag.length;
  const contentEnd = closeAt;
  const lenA = buf.readUInt32LE(contentStart + 8);
  const lenB = buf.readUInt32LE(contentStart + 12);
  return {
    path,
    buf,
    contentStart,
    contentEnd,
    lenA,
    lenB,
    subHeader: buf.slice(contentStart, contentStart + 16),
    blockA: buf.slice(contentStart + 16, contentStart + 16 + lenA),
    blockB: buf.slice(contentStart + 16 + lenA, contentEnd),
  };
}

const A = loadMT(pathA);
const B = loadMT(pathB);

console.log(`A: ${pathA}  MT content=${A.contentEnd - A.contentStart}  lenA=${A.lenA}  lenB=${A.lenB}`);
console.log(`B: ${pathB}  MT content=${B.contentEnd - B.contentStart}  lenA=${B.lenA}  lenB=${B.lenB}`);
console.log("");

// === Sub-header diff ===
console.log("Sub-header diff:");
let shDiff = 0;
for (let i = 0; i < 16; i++) {
  if (A.subHeader[i] !== B.subHeader[i]) {
    console.log(`  +${String(i).padStart(2)}  A=0x${A.subHeader[i].toString(16).padStart(2,"0")}  B=0x${B.subHeader[i].toString(16).padStart(2,"0")}`);
    shDiff++;
  }
}
if (shDiff === 0) console.log("  (identical)");
console.log("");

// === Block A diff ===
console.log(`Block A diff (lenA: A=${A.lenA}, B=${B.lenA}):`);
let aDiffs = 0;
const maxA = Math.min(A.blockA.length, B.blockA.length);
const aDiffOffsets = [];
for (let i = 0; i < maxA; i++) {
  if (A.blockA[i] !== B.blockA[i]) {
    aDiffOffsets.push(i);
    aDiffs++;
  }
}
console.log(`  Length: A=${A.blockA.length}  B=${B.blockA.length}  delta=${B.blockA.length - A.blockA.length}`);
console.log(`  Bytes differing in overlap: ${aDiffs}/${maxA}`);
if (aDiffs > 0 && aDiffs <= 40) {
  for (const o of aDiffOffsets) {
    console.log(`    +${String(o).padStart(5)}  A=0x${A.blockA[o].toString(16).padStart(2,"0")}  B=0x${B.blockA[o].toString(16).padStart(2,"0")}`);
  }
} else if (aDiffs > 40) {
  // Show ranges of consecutive diffs
  console.log(`  First 20 diff offsets: ${aDiffOffsets.slice(0, 20).join(", ")}`);
  console.log(`  Last 5 diff offsets: ${aDiffOffsets.slice(-5).join(", ")}`);
}
console.log("");

// === Block B diff ===
console.log(`Block B diff (lenB: A=${A.lenB}, B=${B.lenB}):`);
let bDiffs = 0;
const maxB = Math.min(A.blockB.length, B.blockB.length);
const bDiffOffsets = [];
for (let i = 0; i < maxB; i++) {
  if (A.blockB[i] !== B.blockB[i]) {
    bDiffOffsets.push(i);
    bDiffs++;
  }
}
console.log(`  Length: A=${A.blockB.length}  B=${B.blockB.length}  delta=${B.blockB.length - A.blockB.length}`);
console.log(`  Bytes differing in overlap: ${bDiffs}/${maxB}`);

// Cluster diffs into runs
if (bDiffOffsets.length > 0) {
  const runs = [];
  let runStart = bDiffOffsets[0];
  let runEnd = bDiffOffsets[0];
  for (let i = 1; i < bDiffOffsets.length; i++) {
    if (bDiffOffsets[i] === runEnd + 1) {
      runEnd = bDiffOffsets[i];
    } else {
      runs.push([runStart, runEnd]);
      runStart = bDiffOffsets[i];
      runEnd = bDiffOffsets[i];
    }
  }
  runs.push([runStart, runEnd]);
  console.log(`  Diff runs: ${runs.length}`);
  for (const [s, e] of runs.slice(0, 30)) {
    const len = e - s + 1;
    const aPreview = A.blockB.slice(s, Math.min(e + 1, s + 16)).toString("hex").match(/../g).join(" ");
    const bPreview = B.blockB.slice(s, Math.min(e + 1, s + 16)).toString("hex").match(/../g).join(" ");
    // Try ASCII
    const aAscii = Array.from(A.blockB.slice(s, Math.min(e + 1, s + 32))).map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("");
    const bAscii = Array.from(B.blockB.slice(s, Math.min(e + 1, s + 32))).map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("");
    console.log(`    +${String(s).padStart(5)}..${String(e).padStart(5)} (${len}b)`);
    console.log(`       A: ${aPreview}  '${aAscii}'`);
    console.log(`       B: ${bPreview}  '${bAscii}'`);
  }
  if (runs.length > 30) console.log(`    ... and ${runs.length - 30} more runs`);
}

console.log("");
console.log("=== Summary ===");
console.log(`Block A diffs:   ${aDiffs}  (delta=${B.blockA.length - A.blockA.length})`);
console.log(`Block B diffs:   ${bDiffs}  (delta=${B.blockB.length - A.blockB.length})`);
