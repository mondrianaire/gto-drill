// _tmp-lib-bisect.mjs — bisection test for library entry corruption.
//
// Patches ONE field at a time on test-bb-monster, leaving others verbatim,
// to find which patch causes GTO+'s Quickload to OOM.
//
// Usage:
//   node scripts/_tmp-lib-bisect.mjs --test=name     # only rename
//   node scripts/_tmp-lib-bisect.mjs --test=board    # only board (same length)
//   node scripts/_tmp-lib-bisect.mjs --test=pot      # only pot
//   etc.

import { readFileSync, writeFileSync } from "fs";

const SOURCE = "C:\\Users\\mondr\\Downloads\\library.txt.backup-1779759231891";
const OUT = "C:\\Users\\mondr\\Downloads\\library.txt";
const args = process.argv.slice(2);
const testArg = args.find(a => a.startsWith("--test="));
const TEST = testArg ? testArg.slice("--test=".length) : "name";

const buf = readFileSync(SOURCE);
console.log("Source: " + SOURCE + " (" + buf.length + " bytes)");

function bytesum(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s >>> 0; }

// Find test-bb-monster entry
const text = buf.toString("latin1");
const nameAt = text.indexOf("test-bb-monster");
console.log("test-bb-monster name found at @" + nameAt);
// Walk backward to find [TREE]
const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
const closes = [...text.matchAll(/\[\/TREE\]/g)].map(m => m.index);
const entryStart = opens.filter(o => o < nameAt).pop();
const entryClose = closes.find(c => c > entryStart);
const entryEnd = entryClose + "[/TREE]".length;
console.log("Entry: @" + entryStart + "-" + entryEnd + " (" + (entryEnd - entryStart) + " bytes)");

const entryBuf = Buffer.from(buf.slice(entryStart, entryEnd));

function findLpString(b, startSearch, expected) {
  const target = Buffer.from(expected, "utf8");
  for (let i = startSearch; i < b.length - target.length - 5; i++) {
    if (b[i] === 0x02 && b.readUInt32LE(i + 1) === target.length &&
        b.slice(i + 5, i + 5 + target.length).equals(target)) {
      return { off: i, len: target.length };
    }
  }
  return null;
}

function patchLpString(b, slot, newStr) {
  // Returns NEW buffer with the lp-string at slot.off replaced
  const newBytes = Buffer.from(newStr, "utf8");
  const newLp = Buffer.alloc(5 + newBytes.length);
  newLp[0] = 0x02;
  newLp.writeUInt32LE(newBytes.length, 1);
  newBytes.copy(newLp, 5);
  return Buffer.concat([
    b.slice(0, slot.off),
    newLp,
    b.slice(slot.off + 5 + slot.len),
  ]);
}

// Locate every field we might patch
const slots = {
  name: findLpString(entryBuf, 0, "test-bb-monster"),
  board: findLpString(entryBuf, 400, "AdAcAh"),
  pot: findLpString(entryBuf, 800, "10"),
};
slots.stack = findLpString(entryBuf, slots.pot.off + 5 + 2, "90");

console.log("Slots:");
for (const [k, v] of Object.entries(slots)) {
  console.log("  " + k.padEnd(8) + " @" + v.off + "  len=" + v.len);
}

// Apply the requested test
const tests = {
  none: { name: "test-bb-monster" },           // verbatim — sanity check
  name: { name: "test-bb-monster-RENAMED" },   // +9 chars
  short: { name: "test-bb-monster2" },         // +1 char (similar size)
  board: { board: "9h8h4c" },                  // same length
  pot: { pot: "7.50" },                        // +2 chars
  stack: { stack: "97.5" },                    // +2 chars
};
const patches = tests[TEST];
if (!patches) { console.error("Unknown test '" + TEST + "'. Available: " + Object.keys(tests).join(", ")); process.exit(1); }

console.log();
console.log("Test '" + TEST + "': patching " + JSON.stringify(patches));

// Apply patches in REVERSE offset order so earlier slot offsets stay valid
const subs = Object.entries(patches).map(([k, v]) => ({ key: k, slot: slots[k], newStr: v }));
subs.sort((a, b) => b.slot.off - a.slot.off);

let patched = entryBuf;
let netDelta = 0;
for (const sub of subs) {
  const before = patched.length;
  patched = patchLpString(patched, sub.slot, sub.newStr);
  const delta = patched.length - before;
  netDelta += delta;
  console.log("  patched " + sub.key + ": " + sub.slot.len + " → " + sub.newStr.length + " (Δ" + (delta >= 0 ? "+" : "") + delta + ")");
}

// Update @+18 size field — OPTIONAL via --skip-at18
const SKIP_AT18 = args.includes("--skip-at18");
const HEADER_SIZE_FIELD_OFF = 18;
const oldSize = entryBuf.readUInt32LE(HEADER_SIZE_FIELD_OFF);
if (SKIP_AT18) {
  console.log("  @+18 size field: " + oldSize + " (left untouched, --skip-at18)");
} else {
  patched.writeUInt32LE(oldSize + netDelta, HEADER_SIZE_FIELD_OFF);
  console.log("  @+18 size field: " + oldSize + " → " + (oldSize + netDelta));
}

// Build the preamble that goes BEFORE [TREE]
const inner = patched.slice(6, patched.length - 7);
const sectionLen = patched.length;
const innerSum = bytesum(inner);
const preamble = Buffer.alloc(16);
preamble.writeUInt32LE(sectionLen, 0);
preamble.writeUInt32LE(innerSum, 8);
console.log("  new preamble: len=" + sectionLen + " innerSum=" + innerSum);

// Splice the patched entry+preamble into the library where test-bb-monster was
// Remove the original entry (and its preamble)
const newLib = Buffer.concat([
  buf.slice(0, entryStart - 16),           // everything before the original preamble
  preamble,                                 // new preamble
  patched,                                  // new entry
  buf.slice(entryEnd),                      // everything after the original [/TREE]
]);

console.log();
console.log("New library size: " + newLib.length + " (was " + buf.length + ", Δ" + (newLib.length - buf.length) + ")");
writeFileSync(OUT, newLib);
console.log("✅ Wrote " + OUT);
console.log();
console.log("Now: close GTO+ → copy library.txt → reopen GTO+ → Quickload");
console.log("Test '" + TEST + "' — reply 'ok' if loads, 'oom' if not");
