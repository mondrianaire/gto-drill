#!/usr/bin/env node
// gto-mt-substitute-probe.mjs — research probe for MAIN TREE substitution feasibility.
//
// The original substituter (gto-batch-generate.mjs) substitutes HEADER atoms but
// leaves MAIN TREE verbatim. That fails because GTO+ reads ranges + board from
// MAIN TREE, not HEADER, when displaying / using the scenario configuration.
//
// This probe re-implements substitution to also touch the MAIN TREE config
// block (block B) atoms: hero range, vill range, board, pot, stack, plus the
// matching pot/stack display strings, all mirroring the HEADER substitution.
//
// Does NOT touch the MAIN TREE bytecode block (block A, 855 bytes in the fresh
// flop template). The hypothesis is that block A doesn't contain byte-offset
// pointers into block B and so its atoms are still valid after a config-block
// substitution.
//
// USAGE:
//   node scripts/gto-mt-substitute-probe.mjs <template> <hero_range> <vill_range> <board> <pot> <stack> <output_path>
//
// Example:
//   node scripts/gto-mt-substitute-probe.mjs C:/Users/mondr/Downloads/template-max-flop-fresh.gto2 "AA,KK,QQ,JJ,AKs" "22+,A2s+,A2o+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q2o+,J2o+,T2o+,92o+,82o+,72o+,62o+,52o+,42o+,32o" "8c5c2h" 5.5 97.5 C:/Users/mondr/Downloads/probe-mt-subst.gto2

import { readFileSync, writeFileSync } from "node:fs";

if (process.argv.length < 9) {
  console.error("Usage: node scripts/gto-mt-substitute-probe.mjs <template> <hero> <vill> <board> <pot> <stack> <output>");
  process.exit(1);
}

const [, , templatePath, heroRange, villRange, board, potStr, stackStr, outPath] = process.argv;
const pot = parseFloat(potStr);
const stack = parseFloat(stackStr);

// === Utilities ===

function bytesum(buf, start, end) {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i];
  return s;
}

function lpString(s) {
  const b = Buffer.from(s, "utf8");
  const out = Buffer.alloc(5 + b.length);
  out[0] = 0x02;
  out.writeUInt32LE(b.length, 1);
  b.copy(out, 5);
  return out;
}

function doubleBytes(v) {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(v);
  return b;
}

// Walk lp-strings in a buffer slice (start, end exclusive), returning offsets RELATIVE TO start.
function walkLpStrings(buf, start, end) {
  const out = [];
  let i = 0;
  while (start + i < end - 4) {
    if (buf[start + i] === 0x02) {
      const len = buf.readUInt32LE(start + i + 1);
      if (len >= 0 && len < 250 && start + i + 5 + len <= end) {
        let printable = true;
        for (let k = 0; k < len; k++) {
          const b = buf[start + i + 5 + k];
          if (b < 0x20 || b > 0x7E) { printable = false; break; }
        }
        if (printable) {
          const str = buf.slice(start + i + 5, start + i + 5 + len).toString("utf8");
          out.push({ off: i, len, str });
          i += 5 + len;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

// Find a double-LE in a byte range that matches a target poker value.
function findDouble(buf, start, end, expectVal, tol = 0.001) {
  for (let i = start; i + 8 <= end; i++) {
    const v = buf.readDoubleLE(i);
    if (Number.isFinite(v) && Math.abs(v - expectVal) < tol) return i;
  }
  return -1;
}

// Find two contiguous poker-shaped doubles (pot, stack) in a byte range.
// They live somewhere after the board atom and before the pot text.
function findPotStackDoubles(buf, searchStart, searchEnd) {
  let potOff = -1, stackOff = -1;
  for (let i = searchStart; i + 8 <= searchEnd; i++) {
    const v = buf.readDoubleLE(i);
    if (Number.isFinite(v) && v > 0.4 && v < 100000 && Math.abs(v - Math.round(v * 2) / 2) < 1e-9) {
      if (potOff < 0) potOff = i;
      else if (stackOff < 0) { stackOff = i; break; }
    }
  }
  return { potOff, stackOff };
}

// === Load template ===

const tpl = readFileSync(templatePath);
console.log(`Loaded template: ${templatePath} (${tpl.length} bytes)`);

// Locate sections by [NAME] / [/NAME] tags
function findSection(name) {
  const open = `[${name}]`;
  const close = `[/${name}]`;
  const openAt = tpl.indexOf(open);
  const closeAt = tpl.indexOf(close);
  if (openAt < 0 || closeAt < 0) throw new Error(`Missing section ${name}`);
  // Preamble is 16 bytes before [NAME]
  return {
    preambleAt: openAt - 16,
    openAt,
    contentStart: openAt + open.length,
    contentEnd: closeAt,
    closeEnd: closeAt + close.length,
  };
}

const HDR = findSection("HEADER");
const MT  = findSection("MAIN TREE");
console.log(`HEADER content: file@${HDR.contentStart}..${HDR.contentEnd} (${HDR.contentEnd - HDR.contentStart} bytes)`);
console.log(`MAIN TREE content: file@${MT.contentStart}..${MT.contentEnd} (${MT.contentEnd - MT.contentStart} bytes)`);

// === Locate config atoms in HEADER ===

const hdrStrs = walkLpStrings(tpl, HDR.contentStart + 16, HDR.contentEnd);
console.log(`\nHEADER lp-strings (${hdrStrs.length} total, first 10):`);
hdrStrs.slice(0, 10).forEach(s => {
  console.log(`  HDR_content_off+16+${s.off} len=${s.len} '${s.str.slice(0, 40)}'`);
});

// Range candidates: len >= 20 and contain commas
const hdrRanges = hdrStrs.filter(s => s.len >= 20 && s.str.includes(","));
// Board candidate: matches card pattern
const hdrBoard = hdrStrs.find(s => /^([2-9TJQKA][shdc]){3,5}$/.test(s.str));
// Pot/stack DISPLAY: first two decimal-formatted after board
const hdrDecimals = hdrStrs.filter(s => /^[0-9]+\.[0-9]+$/.test(s.str));

if (hdrRanges.length < 2) throw new Error("HEADER doesn't have 2 range-shaped lp-strings");
if (!hdrBoard) throw new Error("HEADER doesn't have a board lp-string");

console.log(`\nHEADER atom slots:`);
console.log(`  hero range  off=${hdrRanges[0].off + 16} len=${hdrRanges[0].len}`);
console.log(`  vill range  off=${hdrRanges[1].off + 16} len=${hdrRanges[1].len}`);
console.log(`  board       off=${hdrBoard.off + 16} len=${hdrBoard.len} '${hdrBoard.str}'`);
console.log(`  pot text    off=${hdrDecimals[0].off + 16} '${hdrDecimals[0].str}'`);
console.log(`  stack text  off=${hdrDecimals[1].off + 16} '${hdrDecimals[1].str}'`);

// Find pot/stack DOUBLES between board and pot text
const hdrPotStack = findPotStackDoubles(tpl,
  HDR.contentStart + 16 + hdrBoard.off + 5 + hdrBoard.len,
  HDR.contentStart + 16 + hdrDecimals[0].off);
const hdrPotDoubleOff = hdrPotStack.potOff;
const hdrStackDoubleOff = hdrPotStack.stackOff;
console.log(`  pot double  file@${hdrPotDoubleOff} val=${hdrPotDoubleOff >= 0 ? tpl.readDoubleLE(hdrPotDoubleOff) : "?"}`);
console.log(`  stack double file@${hdrStackDoubleOff} val=${hdrStackDoubleOff >= 0 ? tpl.readDoubleLE(hdrStackDoubleOff) : "?"}`);

// === Locate config atoms in MAIN TREE block B ===

// MT sub-header is 16 bytes, then block A (len_A bytes of bytecode), then block B
const mtLenA = tpl.readUInt32LE(MT.contentStart + 8);
const mtLenB = tpl.readUInt32LE(MT.contentStart + 12);
console.log(`\nMAIN TREE structure:`);
console.log(`  16-byte sub-header`);
console.log(`  block A (bytecode): ${mtLenA} bytes @ MT_content+16`);
console.log(`  block B (config):   ${mtLenB} bytes @ MT_content+${16 + mtLenA}`);

const mtBlockBStart = MT.contentStart + 16 + mtLenA;
const mtBlockBEnd = MT.contentEnd;
const mtStrs = walkLpStrings(tpl, mtBlockBStart, mtBlockBEnd);
console.log(`\nMAIN TREE block B lp-strings (first 10):`);
mtStrs.slice(0, 10).forEach(s => {
  console.log(`  MT_blockB+${s.off} len=${s.len} '${s.str.slice(0, 40)}'`);
});

const mtRanges = mtStrs.filter(s => s.len >= 20 && s.str.includes(","));
const mtBoard = mtStrs.find(s => /^([2-9TJQKA][shdc]){3,5}$/.test(s.str));
const mtDecimals = mtStrs.filter(s => /^[0-9]+\.[0-9]+$/.test(s.str));

if (mtRanges.length < 2) throw new Error("MT block B doesn't have 2 range-shaped lp-strings");
if (!mtBoard) throw new Error("MT block B doesn't have a board lp-string");

console.log(`\nMAIN TREE block B atom slots:`);
console.log(`  hero range  off=${mtRanges[0].off} len=${mtRanges[0].len}`);
console.log(`  vill range  off=${mtRanges[1].off} len=${mtRanges[1].len}`);
console.log(`  board       off=${mtBoard.off} len=${mtBoard.len} '${mtBoard.str}'`);
if (mtDecimals.length >= 2) {
  console.log(`  pot text    off=${mtDecimals[0].off} '${mtDecimals[0].str}'`);
  console.log(`  stack text  off=${mtDecimals[1].off} '${mtDecimals[1].str}'`);
}

const mtPotStack = findPotStackDoubles(tpl,
  mtBlockBStart + mtBoard.off + 5 + mtBoard.len,
  mtBlockBStart + (mtDecimals.length > 0 ? mtDecimals[0].off : 200));
const mtPotDouble = mtPotStack.potOff;
const mtStackDouble = mtPotStack.stackOff;
console.log(`  pot double  file@${mtPotDouble} val=${mtPotDouble >= 0 ? tpl.readDoubleLE(mtPotDouble) : "?"}`);
console.log(`  stack double file@${mtStackDouble} val=${mtStackDouble >= 0 ? tpl.readDoubleLE(mtStackDouble) : "?"}`);

// === Substitute ===

// Build splice ops on the full file. The order is:
// 1. HEADER atoms (in increasing file offset order)
// 2. MT block B atoms (in increasing file offset order)
//
// We'll process the file in offset order using a single pass and emit slices.

const ops = [];
// HEADER hero/vill/board
ops.push({ off: HDR.contentStart + 16 + hdrRanges[0].off, len: 5 + hdrRanges[0].len, repl: lpString(heroRange), label: "hdr_hero" });
ops.push({ off: HDR.contentStart + 16 + hdrRanges[1].off, len: 5 + hdrRanges[1].len, repl: lpString(villRange), label: "hdr_vill" });
ops.push({ off: HDR.contentStart + 16 + hdrBoard.off, len: 5 + hdrBoard.len, repl: lpString(board), label: "hdr_board" });
if (hdrPotDoubleOff >= 0) ops.push({ off: hdrPotDoubleOff, len: 8, repl: doubleBytes(pot), label: "hdr_pot_dbl" });
if (hdrStackDoubleOff >= 0) ops.push({ off: hdrStackDoubleOff, len: 8, repl: doubleBytes(stack), label: "hdr_stack_dbl" });
ops.push({ off: HDR.contentStart + 16 + hdrDecimals[0].off, len: 5 + hdrDecimals[0].len, repl: lpString(pot.toFixed(2)), label: "hdr_pot_txt" });
ops.push({ off: HDR.contentStart + 16 + hdrDecimals[1].off, len: 5 + hdrDecimals[1].len, repl: lpString(stack.toFixed(1)), label: "hdr_stack_txt" });

// MAIN TREE block B atoms — MIRROR OF HDR
ops.push({ off: mtBlockBStart + mtRanges[0].off, len: 5 + mtRanges[0].len, repl: lpString(heroRange), label: "mt_hero" });
ops.push({ off: mtBlockBStart + mtRanges[1].off, len: 5 + mtRanges[1].len, repl: lpString(villRange), label: "mt_vill" });
ops.push({ off: mtBlockBStart + mtBoard.off, len: 5 + mtBoard.len, repl: lpString(board), label: "mt_board" });
if (mtPotDouble >= 0) ops.push({ off: mtPotDouble, len: 8, repl: doubleBytes(pot), label: "mt_pot_dbl" });
if (mtStackDouble >= 0) ops.push({ off: mtStackDouble, len: 8, repl: doubleBytes(stack), label: "mt_stack_dbl" });
if (mtDecimals.length >= 2) {
  ops.push({ off: mtBlockBStart + mtDecimals[0].off, len: 5 + mtDecimals[0].len, repl: lpString(pot.toFixed(2)), label: "mt_pot_txt" });
  ops.push({ off: mtBlockBStart + mtDecimals[1].off, len: 5 + mtDecimals[1].len, repl: lpString(stack.toFixed(1)), label: "mt_stack_txt" });
}

ops.sort((a, b) => a.off - b.off);

console.log(`\nSubstitution ops (sorted by file offset):`);
for (const op of ops) console.log(`  file@${op.off}  len=${op.len}  → ${op.repl.length} bytes  (${op.label})`);

// Splice
const pieces = [];
let cursor = 0;
for (const op of ops) {
  if (op.off > cursor) pieces.push(tpl.slice(cursor, op.off));
  pieces.push(op.repl);
  cursor = op.off + op.len;
}
if (cursor < tpl.length) pieces.push(tpl.slice(cursor));
let newBuf = Buffer.concat(pieces);

// === Per-section delta tracking ===

// Compute per-section length deltas based on which ops touched which section
let hdrDelta = 0;
let mtBlockBDelta = 0;
let heroHdrDelta = 0;
let villHdrDelta = 0;
let heroMtDelta = 0;
let villMtDelta = 0;
for (const op of ops) {
  const d = op.repl.length - op.len;
  if (op.off < HDR.contentEnd) hdrDelta += d;
  else if (op.off >= mtBlockBStart && op.off < mtBlockBEnd) mtBlockBDelta += d;
  if (op.label === "hdr_hero") heroHdrDelta = d;
  if (op.label === "hdr_vill") villHdrDelta = d;
  if (op.label === "mt_hero") heroMtDelta = d;
  if (op.label === "mt_vill") villMtDelta = d;
}
console.log(`\nDeltas:`);
console.log(`  HEADER delta = ${hdrDelta}`);
console.log(`  MAIN TREE block B delta = ${mtBlockBDelta}`);
console.log(`  hero hdr delta = ${heroHdrDelta}, mt delta = ${heroMtDelta}`);
console.log(`  vill hdr delta = ${villHdrDelta}, mt delta = ${villMtDelta}`);

// === Rebuild HEADER preamble + region B pointers ===

// New HEADER section length
const newHdrSecLen = (HDR.closeEnd - HDR.openAt) + hdrDelta;
newBuf.writeUInt32LE(newHdrSecLen, HDR.preambleAt);

// HEADER region B sibling pointers (byte 18 / 23 from content start) — MUST be
// set BEFORE the bytesum, since they're part of the content that gets summed.
// Apply heroDelta to byte 18, villDelta to byte 23 — same as the production substituter
const b18Off = HDR.contentStart + 18;
const b23Off = HDR.contentStart + 23;
newBuf[b18Off] = (tpl[b18Off] + heroHdrDelta) & 0xff;
newBuf[b23Off] = (tpl[b23Off] + villHdrDelta) & 0xff;

// New HEADER bytesum (now that byte 18 / 23 are correct)
const newHdrContentStart = HDR.contentStart;
const newHdrContentEnd = HDR.contentEnd + hdrDelta;
const newHdrBytesum = bytesum(newBuf, newHdrContentStart, newHdrContentEnd);
newBuf.writeUInt32LE(newHdrBytesum, HDR.preambleAt + 8);

console.log(`\nHEADER rebuild:`);
console.log(`  section length: ${HDR.closeEnd - HDR.openAt} → ${newHdrSecLen}`);
console.log(`  bytesum: (was ${tpl.readUInt32LE(HDR.preambleAt + 8)}) → ${newHdrBytesum}`);
console.log(`  byte 18: ${tpl[b18Off]} → ${newBuf[b18Off]}`);
console.log(`  byte 23: ${tpl[b23Off]} → ${newBuf[b23Off]}`);

// === Rebuild MAIN TREE preamble + sub-header len_B ===

// MAIN TREE preamble position shifts by hdrDelta
const newMtPreambleAt = MT.preambleAt + hdrDelta;
const newMtSecLen = (MT.closeEnd - MT.openAt) + mtBlockBDelta;
newBuf.writeUInt32LE(newMtSecLen, newMtPreambleAt);

const newMtContentStart = MT.contentStart + hdrDelta;
const newMtContentEnd = MT.contentEnd + hdrDelta + mtBlockBDelta;

// Update MT sub-header len_B (block A unchanged, block B grew/shrunk) — MUST be
// done BEFORE the bytesum since it's part of the summed content.
const newMtLenB = mtLenB + mtBlockBDelta;
newBuf.writeUInt32LE(newMtLenB, newMtContentStart + 12);

const newMtBytesum = bytesum(newBuf, newMtContentStart, newMtContentEnd);
newBuf.writeUInt32LE(newMtBytesum, newMtPreambleAt + 8);

console.log(`\nMAIN TREE rebuild:`);
console.log(`  section length: ${MT.closeEnd - MT.openAt} → ${newMtSecLen}`);
console.log(`  bytesum: (was ${tpl.readUInt32LE(MT.preambleAt + 8)}) → ${newMtBytesum}`);
console.log(`  len_B: ${mtLenB} → ${newMtLenB}`);

// === Also: every section after MT has its preamble shifted by hdrDelta + mtBlockBDelta ===
// We don't need to update those preambles' contents — they're already in newBuf in the
// correct shifted positions. But verify by walking sections.

// === Write file ===

writeFileSync(outPath, newBuf);
console.log(`\nWrote ${outPath} (${newBuf.length} bytes; tpl was ${tpl.length})`);
