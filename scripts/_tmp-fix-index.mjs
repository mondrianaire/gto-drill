// _tmp-fix-index.mjs — patch entry position-index bytes so GTO+ shows our entries.
//
// Reads the current C:\Users\mondr\Downloads\library.txt (our regenerated 36-entry
// library), finds each entry's position-index u32 field, sets it to the entry's
// file index, recomputes preamble bytesums, writes back.
//
// Index field location: in test-bb-monster-derived entries, the field is at byte
// @949 of the ORIGINAL test-bb-monster. After our lp-string patches shift bytes,
// the field's location shifts by the cumulative pre-index netDelta.
//
// Anchor pattern: just before the index field, the bytes are `01 00 00 00`
// (a u32 = 1). After the index field, `00 00 00 00 b9 00 00 00`. So the pattern
// is `01 00 00 00 <index:u32-LE> 00 00 00 00 b9 00 00 00`. We locate by pattern
// for robustness across all entry types.

import { readFileSync, writeFileSync } from "fs";

const PATH = "C:\\Users\\mondr\\Downloads\\library.txt";

function bytesum(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s >>> 0; }

const buf = Buffer.from(readFileSync(PATH));
const text = buf.toString("latin1");

const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
const closes = [...text.matchAll(/\[\/TREE\]/g)].map(m => m.index);

console.log("Library size:", buf.length);
console.log("TREE entries:", opens.length);
console.log();

// Anchor: u32(1) immediately followed by the index u32, then byte 0xb9.
// In test-bb-monster bytes @945-953: `01 00 00 00 <idx:u32-LE> b9`
// (Recheck of agent 1's hex dump confirmed b9 is byte @953, not @957.)
const ANCHOR_BEFORE = Buffer.from([0x01, 0x00, 0x00, 0x00]);

function findIndexField(entryBuf) {
  // Search for `01 00 00 00 <idx:u32> b9`
  // Multiple matches possible; the right one is the one with idx in [0, 256) for current files.
  const candidates = [];
  for (let i = 0; i < entryBuf.length - 9; i++) {
    if (entryBuf.slice(i, i + 4).equals(ANCHOR_BEFORE) && entryBuf[i + 8] === 0xb9) {
      const idx = entryBuf.readUInt32LE(i + 4);
      candidates.push({ off: i + 4, idx });
    }
  }
  // If only one candidate, return it. If multiple, return the last (latest in entry).
  if (candidates.length === 0) return { off: -1, candidates };
  return { off: candidates[candidates.length - 1].off, candidates };
}

let patched = 0;
let bytesumUpdates = 0;
for (let i = 0; i < opens.length; i++) {
  const start = opens[i];
  const end = closes[i] + 7;
  const entry = buf.slice(start, end);
  const r = findIndexField(entry);
  if (r.off < 0) {
    console.log("  Entry " + i + " @" + start + ": NO anchor pattern found");
    continue;
  }
  if (i < 3) console.log("  Entry " + i + " candidates: " + JSON.stringify(r.candidates));
  const idxOff = r.off;
  const oldIdx = entry.readUInt32LE(idxOff);
  if (oldIdx === i) {
    console.log("  Entry " + i + ": index already correct (" + oldIdx + ")");
    continue;
  }
  console.log("  Entry " + i + " @" + start + ": index " + oldIdx + " → " + i + " (anchor at @" + idxOff + ")");
  // Write the new index
  buf.writeUInt32LE(i, start + idxOff);
  patched++;
  // Recompute preamble bytesum for this entry
  const innerStart = start + 6;
  const innerEnd = end - 7;
  const newSum = bytesum(buf.slice(innerStart, innerEnd));
  const preambleStart = start - 16;
  const oldSum = buf.readUInt32LE(preambleStart + 8);
  if (newSum !== oldSum) {
    buf.writeUInt32LE(newSum, preambleStart + 8);
    bytesumUpdates++;
  }
}
console.log();
console.log("Patched " + patched + " entry indices, updated " + bytesumUpdates + " preamble bytesums");

writeFileSync(PATH, buf);
console.log("✅ Wrote " + PATH);
