#!/usr/bin/env node
// gto-mt-analyze.mjs — passive structural analyzer for MAIN TREE.
//
// Given a .gto2 file, dump:
//   - All sections + their lengths/bytesums
//   - MAIN TREE 16-byte sub-header field-by-field
//   - Block A (bytecode) hex preview + structural scan
//   - Block B (config) atom walk
//
// Goal: characterize what MAIN TREE actually contains without needing to
// run GTO+. We can pairwise-diff outputs across multiple .gto2 samples
// to identify which bytes are scenario-config and which are
// solve-strategy data.

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/gto-mt-analyze.mjs <file.gto2>");
  process.exit(1);
}

const buf = readFileSync(path);
console.log(`File: ${path}  total=${buf.length} bytes`);
console.log("");

// === Section walker ===

function bytesum(b, s, e) {
  let x = 0;
  for (let i = s; i < e; i++) x += b[i];
  return x >>> 0;
}

const sections = [];
let cursor = 0;
while (cursor < buf.length) {
  if (buf.length - cursor < 16) break;
  const secLen = buf.readUInt32LE(cursor);
  const preambleSum = buf.readUInt32LE(cursor + 8);
  const tagStart = cursor + 16;
  if (tagStart >= buf.length || buf[tagStart] !== 0x5b) break;  // [
  // Find tag name
  let tagEnd = tagStart + 1;
  while (tagEnd < buf.length && buf[tagEnd] !== 0x5d) tagEnd++;
  const tagName = buf.slice(tagStart + 1, tagEnd).toString("ascii");
  const closeTag = `[/${tagName}]`;
  const closeTagBytes = Buffer.from(closeTag, "ascii");
  const sectionEnd = tagStart + secLen;
  const closeAt = buf.indexOf(closeTagBytes, tagEnd);
  if (closeAt < 0 || closeAt + closeTagBytes.length !== sectionEnd) {
    console.log(`  ⚠ Section ${tagName} end mismatch: secLen=${secLen} closeAt=${closeAt}`);
    break;
  }
  const contentStart = tagEnd + 1;
  const contentEnd = closeAt;
  const innerSum = bytesum(buf, contentStart, contentEnd);
  sections.push({
    name: tagName,
    cursor,
    preambleSum,
    innerSum,
    secLen,
    tagStart,
    contentStart,
    contentEnd,
    sectionEnd,
    sumOK: preambleSum === innerSum,
  });
  cursor = sectionEnd;
}

console.log("Sections:");
console.log("name              file@pre   tagStart  contLen  content[..content]  sum check");
for (const s of sections) {
  const contLen = s.contentEnd - s.contentStart;
  console.log(`  ${s.name.padEnd(16)}  ${String(s.cursor).padStart(8)}  ${String(s.tagStart).padStart(8)}  ${String(contLen).padStart(7)}  [${s.contentStart}..${s.contentEnd}]  ${s.sumOK ? "OK" : "MISMATCH (pre=" + s.preambleSum + " actual=" + s.innerSum + ")"}`);
}
console.log("");

// === Focus on MAIN TREE ===

const mt = sections.find(s => s.name === "MAIN TREE");
if (!mt) {
  console.log("No MAIN TREE section");
  process.exit(0);
}

console.log(`=== MAIN TREE deep-dive (content offset 0 = file@${mt.contentStart}) ===`);
console.log("");

// Sub-header (16 bytes)
console.log("Sub-header (first 16 content bytes):");
for (let i = 0; i < 16; i += 4) {
  const v = mt.contentStart + i + 4 <= mt.contentEnd ? buf.readUInt32LE(mt.contentStart + i) : null;
  const hex = buf.slice(mt.contentStart + i, mt.contentStart + i + 4).toString("hex");
  console.log(`  +${String(i).padStart(2)}  ${hex}  u32=${v}`);
}
console.log("");

// Block A length is sub-header +8, block B length is sub-header +12
const blockAlen = buf.readUInt32LE(mt.contentStart + 8);
const blockBlen = buf.readUInt32LE(mt.contentStart + 12);
const blockAStart = mt.contentStart + 16;
const blockAEnd = blockAStart + blockAlen;
const blockBStart = blockAEnd;
const blockBEnd = blockBStart + blockBlen;
console.log(`Block A (bytecode): ${blockAlen} bytes @ [${blockAStart}..${blockAEnd}]`);
console.log(`Block B (config):   ${blockBlen} bytes @ [${blockBStart}..${blockBEnd}]`);
const trailing = mt.contentEnd - blockBEnd;
console.log(`Trailing: ${trailing} bytes`);
console.log("");

// === Block A characterization ===

const blockA = buf.slice(blockAStart, blockAEnd);

console.log(`=== Block A first 64 bytes (hex) ===`);
for (let i = 0; i < Math.min(64, blockA.length); i += 16) {
  const slice = blockA.slice(i, i + 16);
  const hex = slice.toString("hex").match(/../g).join(" ");
  const ascii = Array.from(slice).map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("");
  console.log(`  ${String(i).padStart(4)}  ${hex.padEnd(48)}  ${ascii}`);
}
console.log("");

if (blockA.length > 64) {
  console.log(`=== Block A last 32 bytes (hex) ===`);
  const start = Math.max(0, blockA.length - 32);
  for (let i = start; i < blockA.length; i += 16) {
    const slice = blockA.slice(i, i + 16);
    const hex = slice.toString("hex").match(/../g).join(" ");
    const ascii = Array.from(slice).map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("");
    console.log(`  ${String(i).padStart(4)}  ${hex.padEnd(48)}  ${ascii}`);
  }
  console.log("");
}

// === Walk lp-strings in Block A (any?) ===
function walkLpStrings(content, start, end) {
  const out = [];
  let i = start;
  while (i < end - 4) {
    if (content[i] === 0x02) {
      const len = content.readUInt32LE(i + 1);
      if (len >= 0 && len < 250 && i + 5 + len <= end) {
        let printable = true;
        for (let k = 0; k < len; k++) {
          const b = content[i + 5 + k];
          if (b < 0x20 || b > 0x7E) { printable = false; break; }
        }
        if (printable && len >= 2) {
          out.push({ off: i, len, str: content.slice(i + 5, i + 5 + len).toString("utf8") });
          i += 5 + len;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

const blockAStrs = walkLpStrings(buf, blockAStart, blockAEnd);
console.log(`Block A lp-strings (${blockAStrs.length}):`);
for (const s of blockAStrs.slice(0, 20)) {
  const relOff = s.off - blockAStart;
  console.log(`  +${String(relOff).padStart(5)}  len=${s.len}  '${s.str.slice(0, 60)}'`);
}
if (blockAStrs.length > 20) console.log(`  ... (${blockAStrs.length - 20} more)`);
console.log("");

// === Walk lp-strings in Block B ===
const blockBStrs = walkLpStrings(buf, blockBStart, blockBEnd);
console.log(`Block B lp-strings (${blockBStrs.length}):`);
for (const s of blockBStrs.slice(0, 30)) {
  const relOff = s.off - blockBStart;
  console.log(`  +${String(relOff).padStart(5)}  len=${s.len}  '${s.str.slice(0, 60)}'`);
}
if (blockBStrs.length > 30) console.log(`  ... (${blockBStrs.length - 30} more)`);
console.log("");

// === Doubles scan in Block A ===
console.log(`Block A: scan for poker-shaped doubles (0.5..10000, half-bb-aligned):`);
let dblCount = 0;
for (let i = 0; i + 8 <= blockA.length; i++) {
  const v = buf.readDoubleLE(blockAStart + i);
  if (Number.isFinite(v) && v > 0.4 && v < 10000 && Math.abs(v - Math.round(v * 2) / 2) < 1e-9) {
    console.log(`  +${String(i).padStart(5)}  ${v}`);
    dblCount++;
    if (dblCount >= 20) { console.log("  ... (truncated)"); break; }
  }
}
console.log("");

// === uint32 histogram for Block A (small ints likely structural) ===
console.log(`Block A: small uint32 values (≤256) sampled every 1 byte (likely opcodes / counts):`);
const u32hist = new Map();
for (let i = 0; i + 4 <= blockA.length; i++) {
  const v = buf.readUInt32LE(blockAStart + i);
  if (v <= 256) {
    u32hist.set(v, (u32hist.get(v) || 0) + 1);
  }
}
const top = [...u32hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [v, c] of top) {
  console.log(`  u32=${String(v).padStart(4)}  count=${c}`);
}
console.log("");

// === Summary ===
console.log("=== Summary ===");
console.log(`MAIN TREE total: ${mt.contentEnd - mt.contentStart} bytes`);
console.log(`  sub-header: 16`);
console.log(`  block A (bytecode): ${blockAlen}`);
console.log(`  block B (config):   ${blockBlen}`);
console.log(`  trailing: ${trailing}`);
