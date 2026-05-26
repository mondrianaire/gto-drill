#!/usr/bin/env node
// scan-gto-strings.mjs — pull ASCII + UTF-16LE strings out of GTO.exe and
// print every one that looks protocol-relevant. Used to test whether
// Winlicense actually strips ALL strings (prior assumption) or whether
// the dispatcher string table survives in some section.

import { readFileSync } from "node:fs";

const EXE = process.argv[2] || "C:/Program Files/GTO/GTO.exe";
const buf = readFileSync(EXE);
console.error(`Loaded ${EXE} (${buf.length} bytes)`);

// Pull ASCII printable runs of length >= MIN
function extractAscii(buf, min = 6) {
  const out = [];
  let cur = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7f) {
      cur.push(b);
    } else {
      if (cur.length >= min) out.push(Buffer.from(cur).toString("ascii"));
      cur = [];
    }
  }
  if (cur.length >= min) out.push(Buffer.from(cur).toString("ascii"));
  return out;
}

// Pull UTF-16LE printable runs (every 2nd byte is 0 for ASCII range)
function extractUtf16(buf, min = 6) {
  const out = [];
  let cur = [];
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const lo = buf[i], hi = buf[i + 1];
    if (hi === 0 && lo >= 0x20 && lo < 0x7f) {
      cur.push(lo);
    } else {
      if (cur.length >= min) out.push(Buffer.from(cur).toString("ascii"));
      cur = [];
    }
  }
  if (cur.length >= min) out.push(Buffer.from(cur).toString("ascii"));
  return out;
}

const ascii = extractAscii(buf, 6);
const utf16 = extractUtf16(buf, 6);
console.error(`ASCII strings: ${ascii.length}, UTF-16LE strings: ${utf16.length}`);

const PATTERNS = [
  /instruction/i,
  /connected/i,
  /hand is at/i,
  /node data/i,
  /action data/i,
  /pot.{0,3}stack/i,
  /take action/i,
  /still processing/i,
  /load file/i,
  /customconnect/i,
  /\bcustom connect\b/i,
  /\binit\b/i,
  /build.{0,3}tree/i,
  /run solver/i,
  /save file/i,
  /set range/i,
  /set board/i,
  /set pot/i,
  /set stack/i,
  /GTO\+ export/i,
  /successfully loaded/i,
  /solver still/i,
  /request /i,
  /\bsolve\b/i,
  /\biterate?\b/i,
  /\bnodelock/i,
  /\bnode-?lock/i,
  /^Set /,
  /^Get /,
  /^Build /,
  /^Run /,
  /^Save /,
  /^Load /,
  /^Request /,
  /^Take /,
  /^Send /,
  /^Apply /,
  /^Update /,
  /^Configure /,
];

function isInteresting(s) {
  return PATTERNS.some((p) => p.test(s));
}

const seen = new Set();
const hits = [];
for (const arr of [ascii, utf16]) {
  for (const s of arr) {
    if (s.length > 200) continue;
    if (seen.has(s)) continue;
    if (isInteresting(s)) {
      seen.add(s);
      hits.push(s);
    }
  }
}

hits.sort();
for (const h of hits) {
  console.log(h);
}

console.error(`\nTotal interesting hits: ${hits.length}`);
