// _tmp-count-bump.mjs — write library.txt with HEADER count bumped, recomputing
// the HEADER preamble bytesum and file-level preamble too.
//
// Usage: node scripts/_tmp-count-bump.mjs <count>
// Reads the latest emit output from C:\Users\mondr\Downloads\library.txt
// Writes back to same path (overwrites).

import { readFileSync, writeFileSync } from "fs";

const TARGET = parseInt(process.argv[2] || "5", 10);
const PATH = "C:\\Users\\mondr\\Downloads\\library.txt";

const buf = Buffer.from(readFileSync(PATH));
const text = buf.toString("latin1");

function bytesum(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s >>> 0; }

const h = text.indexOf("[HEADER]");
const hClose = text.indexOf("[/HEADER]") + "[/HEADER]".length;
const oldCount = buf.readUInt32LE(h + 16);
const oldField20 = buf.readUInt32LE(h + 20);

console.log("HEADER @+16 (count):    " + oldCount + " → " + TARGET);
console.log("HEADER @+20 (matching): " + oldField20 + " → " + TARGET);

// Update both fields
buf.writeUInt32LE(TARGET, h + 16);
buf.writeUInt32LE(TARGET, h + 20);

// Recompute HEADER content bytesum (bytes between [HEADER] and [/HEADER])
const headerInner = buf.slice(h + "[HEADER]".length, hClose - "[/HEADER]".length);
const newHeaderSum = bytesum(headerInner);

// HEADER preamble is at file bytes 0-15: <u32 sec_len><4 zero><u32 inner_sum><4 zero>
const oldPreambleSum = buf.readUInt32LE(8);
buf.writeUInt32LE(newHeaderSum, 8);
console.log("HEADER preamble bytesum: " + oldPreambleSum + " → " + newHeaderSum);

writeFileSync(PATH, buf);
console.log("✅ Wrote " + PATH);
console.log("Now: copy to Program Files, open GTO+, click Quickload");
console.log("Expecting: " + (TARGET + 1) + " entries visible (count + user-added test-bb-monster)");
