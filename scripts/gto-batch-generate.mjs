#!/usr/bin/env node
// gto-batch-generate.mjs — generate one .gto2 per scenario for GTO+ batch solving.
//
// Reads a max-budget template .gto2 + scenarios.json, substitutes per-scenario
// hero range / villain range / board / pot / stack into each, and writes the
// resulting files to solver-output/ ready to be batch-solved via GTO+'s
// PROCESS FILES feature.
//
// Binary format protocol (reverse-engineered earlier; see CHANGELOG v.137):
//   - .gto2 is 7 sections, each preceded by a 16-byte preamble:
//       <uint32 section_length><4 zero><uint32 content_bytesum><4 zero>
//   - "Bytesum" is the literal arithmetic sum of all content bytes between the
//     [NAME] and [/NAME] markers. That's GTO+'s integrity check — confirmed by
//     round-trip experiments. No cryptographic hashes.
//   - HEADER content has a 16-byte sub-header carrying two forward pointers
//     @8 and @12; @12 points to the post-tree config region and shifts when we
//     change atom-stream lengths upstream.
//   - Strings inside HEADER are length-prefixed: 02 <uint32 LE length> <bytes>.
//   - Pot/stack are IEEE 754 LE doubles (8 bytes) embedded inline.
//
// Substitution slots in test.gto2 baseline (HEADER content offsets):
//    62: hero range string  (length-prefixed)
//   112: villain range string  (length-prefixed)
//   177: board string  (length-prefixed, 6/8/10 chars)
//   215: pot double (8 bytes IEEE 754 LE)
//   223: stack double (8 bytes IEEE 754 LE)
//   231: pot display string (length-prefixed)
//   241: stack display string (length-prefixed)
//
// CRITICAL: scenario combo counts MUST be ≤ template combo counts, else GTO+
// OOM-crashes during solve (bet-tree was pre-allocated for narrower ranges).
// Run gto-template-check.mjs first.
//
// Usage:
//   node scripts/gto-batch-generate.mjs <template.gto2> [scenario_id]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRanges } from "../src/preflop-ranges.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));
const OUT_DIR = join(REPO_ROOT, "solver-output");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

if (process.argv.length < 3) {
  console.error("Usage: node scripts/gto-batch-generate.mjs <template.gto2> [scenario_id]");
  process.exit(1);
}
const templatePath = process.argv[2];
const filter = process.argv[3] || null;

// === Utilities ===

function bytesum(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i];
  return s;
}

function decisionState(replay) {
  const seats = {};
  for (const s of replay.seats) seats[s.pos] = { stack: s.stack_bb, street: 0 };
  let pot = replay.starting_pot_bb || 0;
  let cur = "preflop";
  for (const a of replay.actions || []) {
    if (a.street !== cur) {
      for (const p of Object.values(seats)) { pot += p.street; p.street = 0; }
      cur = a.street;
    }
    const seat = seats[a.actor]; if (!seat) continue;
    if (a.type === "bet" || a.type === "raise" || a.type === "call") {
      const add = (a.amount_bb || 0) - seat.street;
      seat.street += add; seat.stack -= add;
    } else if (a.type === "post") {
      seat.street += a.amount_bb || 0; seat.stack -= a.amount_bb || 0;
    }
  }
  const livePot = pot + Object.values(seats).reduce((s, p) => s + p.street, 0);
  const heroStack = (seats[replay.hero_seat] && seats[replay.hero_seat].stack) || 100;
  let villStack = heroStack;
  for (const [pos, s] of Object.entries(seats)) {
    if (pos !== replay.hero_seat && s.stack > 0) villStack = Math.min(villStack, s.stack);
  }
  return { potBb: Math.max(1, livePot), effStackBb: Math.max(1, Math.min(heroStack, villStack)) };
}

// === Template parsing ===

const TEMPLATE = readFileSync(templatePath);
const TEMPLATE_HDR_SEC_LEN = TEMPLATE.readUInt32LE(0);
const TEMPLATE_HDR_CONTENT = TEMPLATE.slice(24, 24 + TEMPLATE_HDR_SEC_LEN - 17);

// Empty MAIN TREE section + preamble (62 bytes total) — captured from an
// unsolved template (test.gto2). We use this in place of the user's template's
// MAIN TREE so GTO+ will re-solve from scratch for each scenario. Otherwise the
// generated files inherit the template's solved-for-wide-ranges strategy data
// and PROCESS FILES either skips them (sees them as solved) or uses stale
// solve data inconsistent with the per-scenario substituted ranges.
const EMPTY_MAIN_TREE = Buffer.from([
  // preamble: section_length=46 (uint32 LE), padding, bytesum=211 (uint32 LE), padding
  0x2e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xd3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  // [MAIN TREE]
  0x5b, 0x4d, 0x41, 0x49, 0x4e, 0x20, 0x54, 0x52, 0x45, 0x45, 0x5d,
  // 23 bytes of "empty tree" content
  0x03, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
  0x00, 0xb9, 0x00, 0x00, 0x00, 0x00, 0x00,
  // [/MAIN TREE]
  0x5b, 0x2f, 0x4d, 0x41, 0x49, 0x4e, 0x20, 0x54, 0x52, 0x45, 0x45, 0x5d,
]);

// Locate the template's MAIN TREE section so we can replace it.
function locateMainTree() {
  const tag = Buffer.from("[MAIN TREE]");
  const closeTag = Buffer.from("[/MAIN TREE]");
  const tagAt = TEMPLATE.indexOf(tag);
  const closeAt = TEMPLATE.indexOf(closeTag);
  if (tagAt < 0 || closeAt < 0) throw new Error("Template missing MAIN TREE section");
  // Preamble is 16 bytes before the open tag
  const preambleStart = tagAt - 16;
  const sectionEnd = closeAt + closeTag.length;
  return { preambleStart, sectionEnd, sectionLen: TEMPLATE.readUInt32LE(preambleStart) };
}
const TEMPLATE_MAIN_TREE = locateMainTree();

// Locate the two length-prefixed range strings + board + pot/stack atoms in the
// template by scanning the HEADER content for `02 <len>` atoms in order.
function locateSlots() {
  const strs = [];
  let i = 16;
  while (i < TEMPLATE_HDR_CONTENT.length) {
    if (TEMPLATE_HDR_CONTENT[i] === 0x02 && i + 5 <= TEMPLATE_HDR_CONTENT.length) {
      const len = TEMPLATE_HDR_CONTENT.readUInt32LE(i + 1);
      if (i + 5 + len <= TEMPLATE_HDR_CONTENT.length && len < 500) {
        const str = TEMPLATE_HDR_CONTENT.slice(i + 5, i + 5 + len).toString("utf8");
        strs.push({ off: i, len, str });
        i += 5 + len;
        continue;
      }
    }
    i += 1;
  }
  // Atom ordering (per binary analysis):
  //   1. hero range  (typically 4-200 chars, hand-class notation)
  //   2. villain range  (same)
  //   3. board  (6/8/10 chars: cards concatenated)
  //   4. rake string ("0.5%" etc)
  //   5. pot display text ("29.00" etc)
  //   6. stack display text ("100.0" etc)
  //   ... then various small ints, bet sizes, etc.
  const isRangeStr = (s) => /^[AKQJT2-9,+\-so]+$/.test(s.str) && s.len >= 2;
  const isBoardStr = (s) => /^([2-9TJQKA][shdc]){3,5}$/.test(s.str);
  const isNumericText = (s) => /^[0-9.]+$/.test(s.str);

  const hero = strs.find(isRangeStr);
  const vill = strs.find((s) => isRangeStr(s) && s.off > hero.off);
  const board = strs.find(isBoardStr);
  const numerics = strs.filter(isNumericText).filter((s) => s.off > board.off);
  // Skip rake ("0.5%" — has % so not pure numeric), then take first two numerics
  const potTxt = numerics[0];
  const stackTxt = numerics[1];

  // Pot/stack doubles sit between rake string and pot text — find as 8-byte
  // sequences that decode to reasonable poker numbers
  let potDouble = -1, stackDouble = -1;
  for (let off = board.off + 5 + board.len; off + 8 <= potTxt.off; off++) {
    const v = TEMPLATE_HDR_CONTENT.readDoubleLE(off);
    if (Number.isFinite(v) && v > 0.4 && v < 1e6 && Math.abs(v - Math.round(v * 2) / 2) < 1e-9) {
      if (potDouble < 0) potDouble = off;
      else if (stackDouble < 0) { stackDouble = off; break; }
    }
  }

  return { hero, vill, board, potTxt, stackTxt, potDouble, stackDouble };
}

const SLOTS = locateSlots();

// === Per-scenario substitution ===

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

function generateForScenario(scen) {
  const replay = scen.replay;
  if (!replay) return null;

  const derived = deriveRanges(scen);
  const heroRange = derived.hero_range?.classes?.join(",") || "";
  const authoredVill = scen.villain_ranges?.[0]?.classes?.join(",") || "";
  const villRange = authoredVill || derived.villain_range?.classes?.join(",") || "";

  if (!heroRange || !villRange) {
    return { error: `missing range — hero=${heroRange.length} vill=${villRange.length}` };
  }

  const board = []
    .concat(replay.board?.flop || [])
    .concat(replay.board?.turn || [])
    .concat(replay.board?.river || [])
    .join("");
  if (board.length < 6) {
    return { error: `no flop — board=${board}` };
  }

  const ds = decisionState(replay);

  // Build new HEADER content by splicing the substitutions in order
  // (offsets MUST be processed in order so we can track cumulative shift)
  const substitutions = [
    { slot: SLOTS.hero, repl: lpString(heroRange) },
    { slot: SLOTS.vill, repl: lpString(villRange) },
    { slot: SLOTS.board, repl: lpString(board) },
    { slot: { off: SLOTS.potDouble, atomLen: 8 }, repl: doubleBytes(ds.potBb) },
    { slot: { off: SLOTS.stackDouble, atomLen: 8 }, repl: doubleBytes(ds.effStackBb) },
    { slot: SLOTS.potTxt, repl: lpString(ds.potBb.toFixed(2)) },
    { slot: SLOTS.stackTxt, repl: lpString(ds.effStackBb.toFixed(1)) },
  ];
  // Annotate each slot with its full byte-span in the template
  for (const s of substitutions) {
    if (s.slot.len !== undefined) {
      s.spanStart = s.slot.off;
      s.spanEnd = s.slot.off + 5 + s.slot.len;
    } else {
      s.spanStart = s.slot.off;
      s.spanEnd = s.slot.off + s.slot.atomLen;
    }
  }
  substitutions.sort((a, b) => a.spanStart - b.spanStart);

  // Splice
  const pieces = [];
  let cursor = 0;
  for (const sub of substitutions) {
    if (sub.spanStart > cursor) pieces.push(TEMPLATE_HDR_CONTENT.slice(cursor, sub.spanStart));
    pieces.push(sub.repl);
    cursor = sub.spanEnd;
  }
  if (cursor < TEMPLATE_HDR_CONTENT.length) pieces.push(TEMPLATE_HDR_CONTENT.slice(cursor));
  let newContent = Buffer.concat(pieces);

  // Update @12 forward pointer (offset to post-tree config) by total shift
  const delta = newContent.length - TEMPLATE_HDR_CONTENT.length;
  const oldAt12 = TEMPLATE_HDR_CONTENT.readUInt32LE(12);
  newContent.writeUInt32LE(oldAt12 + delta, 12);

  // Update HEADER content byte 18 — second forward pointer inside region B's
  // bet-tree spec. Discovered empirically: this single byte tracks the hero
  // range length (or net atom shift). When we substitute a longer range, this
  // byte must += the same delta as @12, or GTO+ reads garbage from a stale
  // length value and either OOMs or freezes during tree validation.
  // See PR analysis: tpl-A1/A2/A3 controlled diff showed byte 18 going
  // 19 → 25 → 35 as hero range went 2 → 8 → 18 chars (deltas +6, +16 match).
  const oldByte18 = TEMPLATE_HDR_CONTENT[18];
  newContent[18] = (oldByte18 + delta) & 0xff;
  // (If delta exceeds what fits in a byte, this overflow needs handling — but
  // our deltas are typically < 256 so single-byte arithmetic is safe.)

  // Build full HEADER section + preamble
  const newSection = Buffer.concat([
    Buffer.from("[HEADER]", "utf8"),
    newContent,
    Buffer.from("[/HEADER]", "utf8"),
  ]);
  const newPreamble = Buffer.alloc(16);
  newPreamble.writeUInt32LE(newSection.length, 0);
  newPreamble.writeUInt32LE(bytesum(newContent), 8);

  // Assemble file:
  //   new preamble + new HEADER         (substituted scenario data)
  //   + bytes from end-of-template-HEADER up to template's MAIN TREE preamble
  //                                       (any sections between HEADER and MAIN TREE — currently none, but defensive)
  //   + EMPTY_MAIN_TREE                  (62 bytes — forces GTO+ to re-solve)
  //   + bytes from end of template's MAIN TREE to end of file
  //                                       (the 5 static sections after MAIN TREE)
  const hdrEnd = 16 + TEMPLATE_HDR_SEC_LEN;
  const preMainTree = TEMPLATE.slice(hdrEnd, TEMPLATE_MAIN_TREE.preambleStart);
  const postMainTree = TEMPLATE.slice(TEMPLATE_MAIN_TREE.sectionEnd);
  const outFile = Buffer.concat([newPreamble, newSection, preMainTree, EMPTY_MAIN_TREE, postMainTree]);

  return {
    file: outFile,
    summary: {
      heroRange: heroRange.length + " chars",
      villRange: villRange.length + " chars",
      board,
      pot: ds.potBb,
      stack: ds.effStackBb,
      headerDelta: delta,
      newSize: outFile.length,
    },
  };
}

// === Main ===

const targets = filter ? SCENARIOS.filter((s) => s.scenario_id === filter) : SCENARIOS;
if (filter && !targets.length) {
  console.error(`Scenario not found: ${filter}`);
  process.exit(1);
}

console.log(`Template: ${templatePath} (${TEMPLATE.length} bytes)`);
console.log(`Template slot layout:`);
console.log(`  hero @${SLOTS.hero.off} (${SLOTS.hero.len} chars: "${SLOTS.hero.str.slice(0, 40)}${SLOTS.hero.str.length > 40 ? "..." : ""}")`);
console.log(`  vill @${SLOTS.vill.off} (${SLOTS.vill.len} chars)`);
console.log(`  board @${SLOTS.board.off} ("${SLOTS.board.str}")`);
console.log(`  pot double @${SLOTS.potDouble} (${TEMPLATE_HDR_CONTENT.readDoubleLE(SLOTS.potDouble)})`);
console.log(`  stack double @${SLOTS.stackDouble} (${TEMPLATE_HDR_CONTENT.readDoubleLE(SLOTS.stackDouble)})`);
console.log(`  pot text @${SLOTS.potTxt.off} ("${SLOTS.potTxt.str}")`);
console.log(`  stack text @${SLOTS.stackTxt.off} ("${SLOTS.stackTxt.str}")`);
console.log("");
console.log(`Generating ${targets.length} scenario file(s) → ${OUT_DIR}/\n`);

let written = 0, failed = 0;
const failures = [];
for (const scen of targets) {
  const result = generateForScenario(scen);
  if (result?.error) {
    failed++; failures.push({ id: scen.scenario_id, error: result.error });
    console.log(`  ❌ ${scen.scenario_id.padEnd(45)} ${result.error}`);
    continue;
  }
  if (!result) { failed++; continue; }
  const outPath = join(OUT_DIR, `${scen.scenario_id}.gto2`);
  try {
    writeFileSync(outPath, result.file);
    written++;
    console.log(`  ✅ ${scen.scenario_id.padEnd(45)} board=${result.summary.board} pot=${result.summary.pot}bb stack=${result.summary.stack}bb hero=${result.summary.heroRange} vill=${result.summary.villRange} delta=${result.summary.headerDelta >= 0 ? "+" : ""}${result.summary.headerDelta}`);
  } catch (err) {
    failed++;
    const reason = err.code === "EBUSY"
      ? "file locked by another process (likely GTO+ — close it first)"
      : err.code === "EACCES"
      ? "permission denied"
      : err.message;
    failures.push({ id: scen.scenario_id, error: reason });
    console.log(`  ⚠  ${scen.scenario_id.padEnd(45)} write failed: ${reason}`);
  }
}

console.log("");
console.log(`✅ Wrote ${written} .gto2 files`);
if (failed) console.log(`⚠  ${failed} skipped:`);
for (const f of failures) console.log(`   - ${f.id}: ${f.error}`);
console.log("");
console.log("Next steps:");
console.log("  1. Open GTO+");
console.log("  2. Folder icon → select " + OUT_DIR);
console.log("  3. Click PROCESS FILES → wait for batch solve (potentially hours)");
console.log("  4. When done: node scripts/gto-extract.mjs");
