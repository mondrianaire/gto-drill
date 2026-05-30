#!/usr/bin/env node
// Pairwise compare MAIN TREE block A across many .gto2 files.
//
// For each pair: print block A length, hash, and identify where they diverge.

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = process.argv[2] || "solver-output";
const files = readdirSync(dir).filter(f => f.endsWith(".gto2")).map(f => join(dir, f));

console.log("Found " + files.length + " .gto2 files");

function parseMt(buf) {
  // Walk sections — sectionLen includes [TAG] and [/TAG] tags
  let cur = 0;
  while (cur < buf.length) {
    if (buf.length - cur < 16) break;
    const len = buf.readUInt32LE(cur);
    const tagStart = cur + 16;
    if (buf[tagStart] !== 0x5b) break;
    let tagEnd = tagStart + 1;
    while (tagEnd < buf.length && buf[tagEnd] !== 0x5d) tagEnd++;
    const tagName = buf.slice(tagStart + 1, tagEnd).toString();
    const sectionEnd = tagStart + len;
    if (tagName === "MAIN TREE") {
      const contentStart = tagEnd + 1;
      const blockAlen = buf.readUInt32LE(contentStart + 8);
      const blockBlen = buf.readUInt32LE(contentStart + 12);
      const blockAStart = contentStart + 16;
      const blockBStart = blockAStart + blockAlen;
      return {
        contentStart,
        blockA: buf.slice(blockAStart, blockAStart + blockAlen),
        blockB: buf.slice(blockBStart, blockBStart + blockBlen),
      };
    }
    cur = sectionEnd;
  }
  return null;
}

const samples = [];
for (const f of files) {
  try {
    const buf = readFileSync(f);
    const mt = parseMt(buf);
    if (!mt) continue;
    samples.push({ name: f.split(/[\\\/]/).pop(), blockA: mt.blockA, blockB: mt.blockB });
  } catch (e) {
    console.log("err: " + f + ": " + e.message);
  }
}

console.log("Parsed " + samples.length + " files");
console.log("");

// Group by blockA length
const byBlockALen = new Map();
for (const s of samples) {
  const k = s.blockA.length;
  if (!byBlockALen.has(k)) byBlockALen.set(k, []);
  byBlockALen.get(k).push(s);
}
console.log("Block A length distribution:");
const sorted = [...byBlockALen.entries()].sort((a, b) => a[0] - b[0]);
for (const [len, items] of sorted) {
  console.log("  " + String(len).padStart(6) + " bytes: " + items.length + " files (" + items.map(i => i.name.slice(0, 30)).slice(0, 3).join(", ") + ")");
}
console.log("");

// Find pairs with same blockA length — compare byte-by-byte to identify common bytes
console.log("=== Pairs with same Block A length: identify common-byte regions ===");
for (const [len, items] of sorted) {
  if (items.length < 2) continue;
  console.log("");
  console.log("Length=" + len + ": " + items.length + " files");
  // Compare ALL pairs, find bytes that are CONSTANT across all
  const allSame = Buffer.alloc(len, 0xff);  // mark bytes that differ
  const reference = items[0].blockA;
  for (let i = 0; i < len; i++) {
    let allEqual = true;
    for (let j = 1; j < items.length; j++) {
      if (items[j].blockA[i] !== reference[i]) { allEqual = false; break; }
    }
    if (allEqual) allSame[i] = 0x00;  // 0x00 = same, 0xff = differs somewhere
  }
  let sameCount = 0;
  for (let i = 0; i < len; i++) if (allSame[i] === 0) sameCount++;
  console.log("  Common bytes: " + sameCount + "/" + len + " (" + Math.round(100 * sameCount / len) + "%)");

  // Show first 5 differing-byte ranges
  let inRun = false;
  let runStart = 0;
  let runs = 0;
  for (let i = 0; i <= len; i++) {
    const diff = i < len && allSame[i] === 0xff;
    if (diff && !inRun) { runStart = i; inRun = true; }
    if (!diff && inRun) {
      if (runs < 5) console.log("    diff range @" + runStart + ".." + (i - 1) + " (" + (i - runStart) + " bytes)");
      runs++;
      inRun = false;
    }
  }
  if (runs > 5) console.log("    ... (" + (runs - 5) + " more diff runs)");

  // Show the file names so we understand the grouping
  console.log("  files in this group:");
  for (const it of items.slice(0, 6)) console.log("    " + it.name);
  if (items.length > 6) console.log("    ... (+" + (items.length - 6) + " more)");
}
