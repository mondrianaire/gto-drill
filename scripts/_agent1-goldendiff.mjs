#!/usr/bin/env node
// _agent1-goldendiff.mjs — diff the SAME entry name across two library files
// where GTO+ has changed the pot. Tells us EXACTLY which bytes shift.

import { readFileSync } from "fs";

const fileA = process.argv[2];
const fileB = process.argv[3];
const entryName = process.argv[4] || "test-bb-monster";
if (!fileA || !fileB) {
  console.error("usage: node _agent1-goldendiff.mjs <fileA> <fileB> [entryName]");
  process.exit(1);
}

const bufA = readFileSync(fileA);
const bufB = readFileSync(fileB);

function findEntry(buf, name) {
  const text = buf.toString("latin1");
  const nameIdx = text.indexOf(name);
  if (nameIdx < 0) return null;
  const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
  const closes = [...text.matchAll(/\[\/TREE\]/g)].map(m => m.index);
  const start = opens.filter(o => o < nameIdx).pop();
  const close = closes.find(c => c > start);
  const end = close + "[/TREE]".length;
  return { start, end, buf: buf.slice(start, end), preStart: start - 16 };
}

const eA = findEntry(bufA, entryName);
const eB = findEntry(bufB, entryName);
if (!eA || !eB) { console.error("entry not found in one of the files"); process.exit(1); }

console.log("File A: " + fileA + "  entry @" + eA.start + "  len " + eA.buf.length);
console.log("File B: " + fileB + "  entry @" + eB.start + "  len " + eB.buf.length);
console.log("Delta: " + (eB.buf.length - eA.buf.length) + " bytes");
console.log("");

// Print preamble diff
const preA = bufA.slice(eA.preStart, eA.start);
const preB = bufB.slice(eB.preStart, eB.start);
console.log("Preamble diff:");
console.log("  A: " + preA.toString("hex"));
console.log("  B: " + preB.toString("hex"));
console.log("  A: u32@0=" + preA.readUInt32LE(0) + " u32@8=" + preA.readUInt32LE(8));
console.log("  B: u32@0=" + preB.readUInt32LE(0) + " u32@8=" + preB.readUInt32LE(8));
console.log("");

// Find all u32-LE fields that scale with the entry-length delta
// Approach: compare every byte position. Print runs of differences.
const lenDelta = eB.buf.length - eA.buf.length;
console.log("Entry-internal byte diffs:");
let run = null;
const diffRanges = [];
for (let i = 0; i < Math.max(eA.buf.length, eB.buf.length); i++) {
  const ba = i < eA.buf.length ? eA.buf[i] : null;
  const bb = i < eB.buf.length ? eB.buf[i] : null;
  if (ba !== bb) {
    if (!run) run = { start: i, bytes: [] };
    run.bytes.push({ i, a: ba, b: bb });
  } else {
    if (run) {
      diffRanges.push(run);
      run = null;
    }
  }
}
if (run) diffRanges.push(run);

// Print compact summary
for (const r of diffRanges) {
  if (r.bytes.length <= 12) {
    console.log("  @" + r.start + " (" + r.bytes.length + " bytes):");
    for (const b of r.bytes) {
      console.log("    @" + b.i + ": A=" + (b.a === null ? "--" : "0x" + b.a.toString(16).padStart(2, "0")) +
                  "  B=" + (b.b === null ? "--" : "0x" + b.b.toString(16).padStart(2, "0")));
    }
  } else {
    console.log("  @" + r.start + " - @" + (r.start + r.bytes.length - 1) + " (" + r.bytes.length + " bytes diff) — long run, likely shift due to lp-string growth");
  }
}

// Check what u32-LE values changed by exactly the length delta
console.log("");
console.log("u32 fields that changed by exactly +" + lenDelta + " (likely size pointers):");
const limit = Math.min(eA.buf.length, eB.buf.length) - 4;
for (let off = 0; off < Math.min(100, limit); off++) {
  const vA = eA.buf.readUInt32LE(off);
  const vB = eB.buf.readUInt32LE(off);
  const delta = vB - vA;
  if (delta === lenDelta && vA > 0 && vA < 100000) {
    console.log("  @" + off + ": A=" + vA + " B=" + vB + "  delta=+" + delta);
  }
}

// Also: u32 fields that ARE the entry length or close to it
console.log("");
console.log("u32 fields in header (0..100) that are >0 and < 200000:");
for (let off = 0; off < Math.min(100, limit); off++) {
  const vA = eA.buf.readUInt32LE(off);
  const vB = eB.buf.readUInt32LE(off);
  if (vA > 0 && vA < 200000 && vB > 0 && vB < 200000) {
    const dlt = vB - vA;
    const tag = dlt === lenDelta ? "  ✓ +lenDelta" : (dlt === 0 ? "  =" : "  Δ" + dlt);
    console.log("  @" + String(off).padStart(3) + ": A=" + String(vA).padStart(8) + " B=" + String(vB).padStart(8) + tag);
  }
}
