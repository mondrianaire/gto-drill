// _tmp-insert-front.mjs — emit ONE scenario entry inserted BEFORE test-bb-monster
// instead of at the end. Tests whether entry POSITION drives visibility.

import { readFileSync, writeFileSync } from "fs";

const SOURCE = "C:\\Users\\mondr\\Downloads\\library.txt.backup-1779759231891";
const OUT = "C:\\Users\\mondr\\Downloads\\library.txt";

const buf = readFileSync(SOURCE);
const text = buf.toString("latin1");

function bytesum(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s >>> 0; }

// Find test-bb-monster entry
const testNameAt = text.indexOf("test-bb-monster");
const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
const closes = [...text.matchAll(/\[\/TREE\]/g)].map(m => m.index);
const testEntryStart = opens.filter(o => o < testNameAt).pop();
const testEntryEnd = closes.find(c => c > testEntryStart) + 7;
const testEntry = buf.slice(testEntryStart, testEntryEnd);
const testPreamble = buf.slice(testEntryStart - 16, testEntryStart);
console.log("test-bb-monster entry @ " + testEntryStart + "-" + testEntryEnd + " (" + testEntry.length + " bytes)");

// Patch test-bb-monster: rename to "front-test-scenario", same length-changing fix
// Just rename the name lp-string in place (no other changes — minimal test)
const newName = "front-test-scenario"; // 19 chars vs test-bb-monster's 15
const newNameBytes = Buffer.from(newName, "utf8");
const newLp = Buffer.alloc(5 + newNameBytes.length);
newLp[0] = 0x02;
newLp.writeUInt32LE(newNameBytes.length, 1);
newNameBytes.copy(newLp, 5);

// Find name lp-string position within the entry
function findLp(b, name) {
  const t = Buffer.from(name, "utf8");
  for (let i = 0; i < b.length - t.length - 5; i++) {
    if (b[i] === 0x02 && b.readUInt32LE(i + 1) === t.length &&
        b.slice(i + 5, i + 5 + t.length).equals(t)) return i;
  }
  return -1;
}
const nameOff = findLp(testEntry, "test-bb-monster");
console.log("name lp at @" + nameOff + " in entry");

const newEntry = Buffer.concat([
  testEntry.slice(0, nameOff),
  newLp,
  testEntry.slice(nameOff + 5 + "test-bb-monster".length),
]);
// Do NOT touch @+18 (per agent 1's finding)
const newInner = newEntry.slice(6, newEntry.length - 7);
const newPreamble = Buffer.alloc(16);
newPreamble.writeUInt32LE(newEntry.length, 0);
newPreamble.writeUInt32LE(bytesum(newInner), 8);

// Insert position: BEFORE the [HEADER]-trailing preamble (i.e. before test-bb-monster's preamble)
// File layout: [HEADER][/HEADER] <test-pre> [TREE]test-bb-monster[/TREE] <ex1-pre> [TREE]Ex1[/TREE] ...
// We want: [HEADER][/HEADER] <our-pre> [TREE]front-test[/TREE] <test-pre> [TREE]test-bb-monster[/TREE] <ex1-pre> ...

const insertAt = testEntryStart - 16;  // where test-bb-monster's preamble starts
const newLib = Buffer.concat([
  buf.slice(0, insertAt),
  newPreamble,
  newEntry,
  buf.slice(insertAt),
]);

console.log("New library size: " + newLib.length + " (was " + buf.length + ", +" + (newLib.length - buf.length) + ")");
writeFileSync(OUT, newLib);
console.log("✅ Wrote " + OUT);
console.log();
console.log("This puts 'front-test-scenario' BEFORE 'test-bb-monster' in the file.");
console.log("If GTO+'s Quickload shows BOTH user entries (6 total), front-insert is the key.");
console.log("If GTO+ shows only test-bb-monster (5 total), entry position doesn't matter.");
