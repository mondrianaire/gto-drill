#!/usr/bin/env node
// gto-library-repair.mjs — detect and repair corrupt TREE preambles in
// GTO+'s library.txt.
//
// Findings (May 2026 RE):
//   - library.txt is a sequence of [HEADER] + N×([16-byte preamble][TREE]...[/TREE])
//   - Each 16-byte preamble = <u32 LE total_section_length><4 zero><u32 LE inner_bytesum><4 zero>
//     where total_section_length includes both [TREE] and [/TREE] tag bytes.
//   - A pre-existing user library shipped to us has the LAST entry missing its
//     16-byte preamble — the [TREE] tag follows directly after the previous
//     entry's [/TREE]. GTO+ apparently tolerates this for the last entry
//     (probably because it walks to EOF) but the emitter's verifier flags it.
//   - When that library is fed to gto-library-emit.mjs, the bad preamble is
//     PRESERVED and shows up as the only mismatch in an otherwise-clean
//     emit. There's no way to repair from inside the emitter without
//     SHIFTING the rest of the file (we'd have to INSERT 16 bytes), and the
//     emitter's design assumes append-only edits.
//
// This helper reads a library.txt, finds every TREE entry, and writes a
// repaired copy with all preambles regenerated from actual entry bytes.
// Entries with no preamble (offset = previous_end) get 16 fresh bytes inserted.
//
// Usage:
//   node scripts/gto-library-repair.mjs <input-library> <output-library>
//
// Side-effect: any TREE entry can be relocated (offsets change), but every
// entry's preamble will be byte-correct on output.

import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/gto-library-repair.mjs <input-library> <output-library>");
  process.exit(1);
}

const buf = readFileSync(inputPath);
console.log(`Read ${inputPath} (${buf.length} bytes)`);

function bytesum(b, s, e) {
  let x = 0;
  for (let i = s; i < e; i++) x += b[i];
  return x >>> 0;
}

// Find the HEADER section
const hdrTag = "[HEADER]";
const hdrClose = "[/HEADER]";
const hdrAt = buf.indexOf(hdrTag);
const hdrCloseAt = buf.indexOf(hdrClose);
if (hdrAt < 0 || hdrCloseAt < 0) {
  console.error("No HEADER section found");
  process.exit(1);
}
const hdrEnd = hdrCloseAt + hdrClose.length;
console.log(`HEADER: ${hdrAt}..${hdrEnd}`);

// HEADER preamble — keep as is or regenerate
const hdrPreambleAt = hdrAt - 16;
if (hdrPreambleAt < 0) {
  console.error("HEADER has no preamble (file starts at [HEADER]?)");
  process.exit(1);
}

// Walk TREE entries. Each entry starts at the offset of its [TREE] tag;
// we then look for the matching [/TREE] for the section bound.
const treeTag = Buffer.from("[TREE]");
const treeClose = Buffer.from("[/TREE]");
const entries = [];
let cursor = hdrEnd;
while (cursor < buf.length) {
  const treeAt = buf.indexOf(treeTag, cursor);
  if (treeAt < 0) break;
  const closeAt = buf.indexOf(treeClose, treeAt);
  if (closeAt < 0) {
    console.error(`Unbalanced [TREE] at ${treeAt}`);
    process.exit(1);
  }
  const sectionEnd = closeAt + treeClose.length;
  entries.push({ treeAt, sectionEnd });
  cursor = sectionEnd;
}
console.log(`Found ${entries.length} TREE entries`);

// === Look for CATEGORY (preserved as-is at end) ===
const catTag = "[CATEGORY]";
const catAt = buf.indexOf(catTag);
let catBlob = null;
if (catAt > 0) {
  // CATEGORY preamble is 16 bytes before
  catBlob = buf.slice(catAt - 16);
  console.log(`Found CATEGORY @${catAt} — preserving ${catBlob.length} bytes verbatim`);
}

// === Rebuild output ===

const pieces = [];

// HEADER (preamble + section) — verbatim
const headerSecLen = (hdrEnd - hdrAt);
const headerSecBytesum = bytesum(buf, hdrAt + hdrTag.length, hdrCloseAt);
const headerPreamble = Buffer.alloc(16);
headerPreamble.writeUInt32LE(headerSecLen, 0);
headerPreamble.writeUInt32LE(headerSecBytesum, 8);
pieces.push(headerPreamble);
pieces.push(buf.slice(hdrAt, hdrEnd));

console.log(`HEADER: secLen=${headerSecLen} bytesum=${headerSecBytesum}`);

// Each TREE entry: write a fresh preamble + the entry bytes verbatim
let fixed = 0;
for (let i = 0; i < entries.length; i++) {
  const { treeAt, sectionEnd } = entries[i];
  const secLen = sectionEnd - treeAt;
  const innerBytesum = bytesum(buf, treeAt + treeTag.length, sectionEnd - treeClose.length);

  // Compare with the OLD preamble (if it exists at treeAt-16)
  const oldPreambleAt = treeAt - 16;
  // Old preamble overlaps with previous entry's last 16 bytes IF entries are
  // packed back-to-back. We can detect this by checking whether the previous
  // entry's sectionEnd equals (treeAt) — if so, no clean preamble exists.
  let preexisting = false;
  if (i === 0) {
    // First entry: preamble lives between hdrEnd and treeAt. If treeAt - hdrEnd >= 16, preamble exists.
    preexisting = (treeAt - hdrEnd) >= 16;
  } else {
    // Subsequent entries: preamble exists only if there's a 16-byte gap
    preexisting = (treeAt - entries[i - 1].sectionEnd) >= 16;
  }

  if (preexisting) {
    const oldLen = buf.readUInt32LE(oldPreambleAt);
    const oldSum = buf.readUInt32LE(oldPreambleAt + 8);
    if (oldLen !== secLen || oldSum !== innerBytesum) {
      console.log(`  Entry ${i + 1}: REPAIR preamble (was len=${oldLen} sum=${oldSum}; now len=${secLen} sum=${innerBytesum})`);
      fixed++;
    }
  } else {
    console.log(`  Entry ${i + 1}: INSERT missing preamble (len=${secLen} sum=${innerBytesum})`);
    fixed++;
  }

  const newPreamble = Buffer.alloc(16);
  newPreamble.writeUInt32LE(secLen, 0);
  newPreamble.writeUInt32LE(innerBytesum, 8);
  pieces.push(newPreamble);
  pieces.push(buf.slice(treeAt, sectionEnd));
}

// CATEGORY (if present) — verbatim
if (catBlob) pieces.push(catBlob);

const out = Buffer.concat(pieces);
console.log(`\nRepaired library size: ${out.length} bytes (was ${buf.length}, ${out.length > buf.length ? "added " + (out.length - buf.length) : out.length < buf.length ? "removed " + (buf.length - out.length) : "no change in"} bytes)`);
console.log(`Preambles repaired/inserted: ${fixed}`);

writeFileSync(outputPath, out);
console.log(`Wrote ${outputPath}`);
