#!/usr/bin/env node
// gto-mt-blockA-aligned-diff.mjs — diff two Block A buffers aligning the
// common tail magic so the per-byte differences reflect tree-structure
// insertions, not naive index slippage.

import { readFileSync } from "node:fs";

const [, , pathA, pathB] = process.argv;
if (!pathA || !pathB) {
  console.error("Usage: node scripts/gto-mt-blockA-aligned-diff.mjs <a.gto2> <b.gto2>");
  process.exit(1);
}

function loadBlockA(path) {
  const buf = readFileSync(path);
  const tag = "[MAIN TREE]";
  const openAt = buf.indexOf(tag);
  const contentStart = openAt + tag.length;
  const lenA = buf.readUInt32LE(contentStart + 8);
  const blockAStart = contentStart + 16;
  return { path, blockA: buf.slice(blockAStart, blockAStart + lenA) };
}

const A = loadBlockA(pathA);
const B = loadBlockA(pathB);

const TAIL_MAGIC = Buffer.from([0x1a, 0x02, 0x0a, 0x18, 0x02, 0x09, 0x16, 0x02, 0x08, 0x14, 0x02, 0x07, 0x12, 0x02, 0x06, 0x10, 0x02, 0x05, 0x0e]);

const aTail = A.blockA.indexOf(TAIL_MAGIC);
const bTail = B.blockA.indexOf(TAIL_MAGIC);
console.log(`Tail magic location: A=${aTail} (of ${A.blockA.length}), B=${bTail} (of ${B.blockA.length})`);

// Try aligning header (first 16 bytes), then comparing trailing block-by-block
console.log(`\nFirst 13 bytes (Block A header):`);
console.log(`  A: ${A.blockA.slice(0, 13).toString("hex").match(/../g).join(" ")}`);
console.log(`  B: ${B.blockA.slice(0, 13).toString("hex").match(/../g).join(" ")}`);

console.log(`\nByte @+12 (last header field):  A=0x${A.blockA[12].toString(16)}=${A.blockA[12]}  B=0x${B.blockA[12].toString(16)}=${B.blockA[12]}`);
console.log(`  Interpretation: probably a u8 "tree depth indicator" or similar`);

// Find next tail magic occurrence (the duplicated ladder)
const aTail2 = A.blockA.indexOf(TAIL_MAGIC, aTail + 1);
const bTail2 = B.blockA.indexOf(TAIL_MAGIC, bTail + 1);
console.log(`\nSecond tail magic occurrence: A=${aTail2}, B=${bTail2}`);
console.log(`  Delta to first occurrence:    A=${aTail2 - aTail}, B=${bTail2 - bTail}`);

// Look at the bytes between the two ladders
console.log(`\nBytes between the two ladders:`);
if (aTail > 0 && aTail2 > 0) {
  const between = A.blockA.slice(aTail + TAIL_MAGIC.length, aTail2);
  console.log(`  A: ${between.length} bytes: ${between.toString("hex").match(/../g).slice(0, 20).join(" ")}${between.length > 20 ? "..." : ""}`);
}
if (bTail > 0 && bTail2 > 0) {
  const between = B.blockA.slice(bTail + TAIL_MAGIC.length, bTail2);
  console.log(`  B: ${between.length} bytes: ${between.toString("hex").match(/../g).slice(0, 20).join(" ")}${between.length > 20 ? "..." : ""}`);
}

// Tail past the second ladder
console.log(`\nTail past second ladder:`);
if (aTail2 > 0) {
  const tail = A.blockA.slice(aTail2 + TAIL_MAGIC.length);
  console.log(`  A: ${tail.length} bytes: ${tail.toString("hex").match(/../g).join(" ")}`);
}
if (bTail2 > 0) {
  const tail = B.blockA.slice(bTail2 + TAIL_MAGIC.length);
  console.log(`  B: ${tail.length} bytes: ${tail.toString("hex").match(/../g).join(" ")}`);
}

// Body (after header, before first ladder) is the actual bet tree
console.log(`\n=== Body sizes ===`);
console.log(`  A: header=13, body=${aTail - 13}, ladder=${TAIL_MAGIC.length}, repeated-ladder=${TAIL_MAGIC.length}, tail=${A.blockA.length - aTail2 - TAIL_MAGIC.length}`);
console.log(`  B: header=13, body=${bTail - 13}, ladder=${TAIL_MAGIC.length}, repeated-ladder=${TAIL_MAGIC.length}, tail=${B.blockA.length - bTail2 - TAIL_MAGIC.length}`);
console.log(`  Body delta: ${(bTail - 13) - (aTail - 13)}`);
console.log(`  Total Block A delta: ${B.blockA.length - A.blockA.length}`);
