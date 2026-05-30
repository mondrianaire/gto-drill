#!/usr/bin/env node
// gto-newdefs3-decode.mjs — parse C:\Program Files\GTO\config\newdefs3.txt
// into a structured tree so we can validate our understanding of the format
// before emitting our own.
//
// FORMAT (reverse-engineered 2026-05-26):
//
//   <16-byte preamble> [CAT_HEADER1] <inner> [/CAT_HEADER1]
//   <16-byte preamble> [CAT_HEADER2] <inner> [/CAT_HEADER2]
//   <16-byte preamble> [CAT_ITEM]    <inner> [/CAT_ITEM]
//   ...
//
// Preamble (16 bytes, same pattern as library.txt):
//   @+0  u32 LE = section length INCLUDING the [TAG]/[/TAG] markers
//   @+4  u32 LE = 0
//   @+8  u32 LE = bytesum (sum of bytes between tags, exclusive of tags)
//   @+12 u32 LE = 0
//
// CAT_ITEM inner content shape (typical leaf range entry):
//   03 00 00 00            u32 = 3 (field group count?)
//   10 00 00 00            u32 = 16 (header inner size)
//   <u32>                  parent category index pointer
//   <u32>                  varies — "item_size_hint" (entry size minus tags?)
//   <4 bytes>              flag bytes (varies — 0c a8 3f 00 etc)
//   02 <len:u32> <bytes>   lp-string: NAME (ASCII)
//   <varies ~28 bytes>     field group 2 — metadata (color/group?)
//   66 00                  delimiter / type marker = 0x66
//   02 <len:u32> <bytes>   lp-string: RANGE VALUE (ASCII)
//   b9 00                  delimiter / weight marker = 0xb9
//   <varies ~17 bytes>     trailing — weight (1.0 = 00 00 f0 3f as double)

import { readFileSync } from "fs";

const path = process.argv[2] || "C:\\Program Files\\GTO\\config\\newdefs3.txt";
const buf = readFileSync(path);
console.log(`File: ${path} (${buf.length} bytes)`);

// Walk all 16-byte-preamble + [TAG]...[/TAG] sections
let cursor = 0;
const sections = [];
while (cursor < buf.length - 16) {
  const preLen = buf.readUInt32LE(cursor);
  const preSum = buf.readUInt32LE(cursor + 8);
  // Tag should start at cursor+16
  const tagStart = cursor + 16;
  if (buf[tagStart] !== 0x5b) {
    cursor++;
    continue;
  }
  // Read tag name
  const closeIdx = buf.indexOf(0x5d, tagStart + 1);
  if (closeIdx < 0) break;
  const tagName = buf.slice(tagStart + 1, closeIdx).toString("ascii");
  const openTag = `[${tagName}]`;
  const closeTag = `[/${tagName}]`;

  // The section ends at the end of closeTag
  const expectedEnd = tagStart + preLen;
  const closeAtExpected = buf.indexOf(closeTag, tagStart + openTag.length);
  if (closeAtExpected < 0) {
    console.log(`  ! No matching ${closeTag} for tag starting at ${tagStart}`);
    break;
  }
  const actualEnd = closeAtExpected + closeTag.length;
  const sectionLen = actualEnd - tagStart;

  const inner = buf.slice(tagStart + openTag.length, closeAtExpected);
  const innerSum = inner.reduce((s, b) => (s + b) >>> 0, 0);

  sections.push({
    cursor, tagStart, preLen, preSum, tagName, sectionLen, actualEnd, inner, innerSum,
    lenOk: preLen === sectionLen,
    sumOk: preSum === innerSum,
  });
  cursor = actualEnd;
}

console.log(`Sections: ${sections.length}`);
for (const s of sections) {
  console.log(`  @${String(s.tagStart).padStart(5)} [${s.tagName}] ` +
              `preLen=${s.preLen} actual=${s.sectionLen} ${s.lenOk ? "✓" : "✗"} ` +
              `preSum=${s.preSum} actual=${s.innerSum} ${s.sumOk ? "✓" : "✗"} ` +
              `inner=${s.inner.length}b`);

  if (s.tagName === "CAT_ITEM") {
    // Try to decode the lp-strings inside
    const lpStrs = [];
    for (let i = 0; i < s.inner.length - 5; i++) {
      if (s.inner[i] === 0x02) {
        const len = s.inner.readUInt32LE(i + 1);
        if (len > 0 && len < 256 && i + 5 + len <= s.inner.length) {
          const bytes = s.inner.slice(i + 5, i + 5 + len);
          // Heuristic: looks like ASCII text?
          if (bytes.every(b => b === 0 || (b >= 0x20 && b <= 0x7e))) {
            const str = bytes.toString("latin1").replace(/\0/g, "·");
            lpStrs.push({ off: i, len, str });
            i += 4 + len; // skip past
          }
        }
      }
    }
    for (const lp of lpStrs) {
      console.log(`         lpstr @${String(lp.off).padStart(4)} len=${String(lp.len).padStart(3)} "${lp.str}"`);
    }
  }
}
