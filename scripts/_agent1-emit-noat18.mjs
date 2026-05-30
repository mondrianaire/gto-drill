#!/usr/bin/env node
// _agent1-emit-noat18.mjs — write 2 scenarios to test the @+18-untouched fix.
//
// Produces a library.txt that's identical to the live library PLUS two
// scenario-* entries inserted at end. The two entries have pot/stack with
// DIFFERENT lengths than the template (test-bb-monster pot=7.50, stack=97.5).
// One scenario: pot="22.50" (5 chars vs 4 in template), stack="89.0" (4 vs 4)
// One scenario: pot="5.50" (4 chars matches), stack="97.5" (4 chars matches)
//
// If GTO+ loads both cleanly, the @+18-untouched approach works.
// Compare to the current emit script which DOES update @+18.

import { readFileSync, writeFileSync, copyFileSync } from "fs";

const SOURCE = "C:/Program Files/GTO/config/library.txt";
const OUT = "C:/Users/mondr/Downloads/library.txt";
const buf = readFileSync(SOURCE);

function bytesum(b, s = 0, e = b.length) {
  let x = 0;
  for (let i = s; i < e; i++) x += b[i];
  return x >>> 0;
}

// Find test-bb-monster
const text = buf.toString("latin1");
const nameIdx = text.indexOf("test-bb-monster");
const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
const closes = [...text.matchAll(/\[\/TREE\]/g)].map(m => m.index);
const tStart = opens.filter(o => o < nameIdx).pop();
const tCloseIdx = closes.find(c => c > tStart);
const tEnd = tCloseIdx + "[/TREE]".length;
const tmpl = buf.slice(tStart, tEnd);
console.log("Template @" + tStart + "-" + tEnd + " (" + tmpl.length + " bytes)");

function findLp(b, start, expected) {
  const tgt = Buffer.from(expected, "utf8");
  for (let i = start; i < b.length - tgt.length - 5; i++) {
    if (b[i] === 0x02 && b.readUInt32LE(i + 1) === tgt.length &&
        b.slice(i + 5, i + 5 + tgt.length).equals(tgt)) {
      return { off: i, len: tgt.length };
    }
  }
  return null;
}

const slots = {};
slots.name = findLp(tmpl, 0, "test-bb-monster");
slots.range1 = findLp(tmpl, slots.name.off + slots.name.len, "AA-22,AKs-A2s,KQs-K2s,QJs-Q2s,JTs-J2s,T9s-T2s,98s-92s,87s-82s,76s-72s,65s-62s,54s-52s,43s-42s,32s,AKo-A2o,KQo-K2o,QJo-Q2o,JTo-J2o,T9o-T2o,98o-92o,87o-82o,76o-72o,65o-62o,54o-52o,43o-42o,32o");
slots.range2 = findLp(tmpl, slots.range1.off + slots.range1.len, slots.range1.len > 100 ? tmpl.slice(slots.range1.off + 5, slots.range1.off + 5 + slots.range1.len).toString("utf8") : "");
slots.board = findLp(tmpl, slots.range2.off + slots.range2.len, "AdAcAh");
// Pot in CURRENT live library is "7.50" not "10"
slots.pot = findLp(tmpl, 800, "7.50");
slots.stack = findLp(tmpl, slots.pot.off + 5 + 4, "90");

for (const [k, v] of Object.entries(slots)) {
  console.log("  " + k.padEnd(8) + " @" + v.off + " len=" + v.len);
}

function buildEntry(name, range1, range2, board, pot, stack, updateAt18) {
  const subs = [
    { slot: slots.name, newStr: name },
    { slot: slots.range1, newStr: range1 },
    { slot: slots.range2, newStr: range2 },
    { slot: slots.board, newStr: board },
    { slot: slots.pot, newStr: pot },
    { slot: slots.stack, newStr: stack },
  ].sort((a, b) => a.slot.off - b.slot.off);

  const pieces = [];
  let cursor = 0;
  let netDelta = 0;
  for (const s of subs) {
    if (s.slot.off > cursor) pieces.push(tmpl.slice(cursor, s.slot.off));
    const b = Buffer.from(s.newStr, "utf8");
    const lp = Buffer.alloc(5 + b.length);
    lp[0] = 0x02;
    lp.writeUInt32LE(b.length, 1);
    b.copy(lp, 5);
    pieces.push(lp);
    cursor = s.slot.off + 5 + s.slot.len;
    netDelta += b.length - s.slot.len;
  }
  if (cursor < tmpl.length) pieces.push(tmpl.slice(cursor));
  const newEntry = Buffer.concat(pieces);

  if (updateAt18) {
    const oldAt18 = tmpl.readUInt32LE(18);
    newEntry.writeUInt32LE(oldAt18 + netDelta, 18);
  }
  // else: leave @+18 inherited from template (the GTO+-faithful approach)

  const inner = newEntry.slice(6, newEntry.length - 7);
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(newEntry.length, 0);
  pre.writeUInt32LE(bytesum(inner), 8);
  return Buffer.concat([pre, newEntry]);
}

// Build TWO scenario-* entries with different pots (one same length, one longer)
const ranges = "AA-22,AKs-A2s,KQs-K2s,QJs-Q2s,JTs-J2s,T9s-T2s,98s-92s,87s-82s,76s-72s,65s-62s,54s-52s,43s-42s,32s,AKo-A2o,KQo-K2o,QJo-Q2o,JTo-J2o,T9o-T2o,98o-92o,87o-82o,76o-72o,65o-62o,54o-52o,43o-42o,32o";

// Read CLI arg for whether to update @+18 (control test)
const UPDATE_AT18 = process.argv.includes("--update-at18");
console.log("Mode: " + (UPDATE_AT18 ? "UPDATE @+18 (control: matches current emit script)" : "INHERIT @+18 (proposed fix)"));

const entry1 = buildEntry(
  "agent1-test-same-pot",  // 20 chars (vs 15 template) +5
  ranges,
  ranges,
  "9h8h4c",  // 6 chars same
  "7.50",    // 4 chars same as template
  "97.5",    // 4 chars same as template
  UPDATE_AT18,
);
console.log("Entry 1 (agent1-test-same-pot): " + entry1.length + " bytes (preamble + entry)");

const entry2 = buildEntry(
  "agent1-test-grow-pot",  // 20 chars +5
  ranges,
  ranges,
  "Td9d6h",  // 6 chars same
  "22.50",   // 5 chars +1
  "89.0",    // 4 chars same
  UPDATE_AT18,
);
console.log("Entry 2 (agent1-test-grow-pot): " + entry2.length + " bytes (preamble + entry)");

// Insert before EOF (after all existing TREEs)
const insertOff = buf.length;  // append at end
const newLib = Buffer.concat([buf, entry1, entry2]);

// Recompute HEADER preamble (since file grew, HEADER inner bytes are unchanged
// but we're still inserting AFTER /HEADER so HEADER section is untouched).
// Actually the HEADER section is bytes @16..@(hdrCloseEnd). The preamble is @0..15.
// Adding TREE entries at end doesn't change the HEADER section's bytes — its
// bytesum stays the same. But let's verify by recomputing.
const hdrTagStart = newLib.indexOf("[HEADER]");
const hdrCloseStart = newLib.indexOf("[/HEADER]");
const hdrInner = newLib.slice(hdrTagStart + 8, hdrCloseStart);
const hdrInnerSum = bytesum(hdrInner);
const oldPreSum = newLib.readUInt32LE(8);
console.log("HEADER inner bytesum: was " + oldPreSum + " now " + hdrInnerSum + (oldPreSum === hdrInnerSum ? " (unchanged ✓)" : " (CHANGED ❌)"));
// Don't write — should be unchanged anyway

writeFileSync(OUT, newLib);
console.log("Wrote " + OUT + " (" + newLib.length + " bytes)");
console.log("");
console.log("Verify integrity:");
console.log("  node scripts/_agent1-lib-dump.mjs " + OUT + " | grep -E 'name:|preamble.*match=false|size field'");
console.log("");
console.log("Then in GTO+: close → File Explorer Replace → reopen → Quickload");
console.log("  Look for 'agent1-test-same-pot' and 'agent1-test-grow-pot'");
console.log("  Try LOAD SELECTED TREE on each");
