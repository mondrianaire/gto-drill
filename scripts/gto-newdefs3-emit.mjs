#!/usr/bin/env node
// gto-newdefs3-emit.mjs — write per-scenario hero/villain ranges into GTO+'s
// preflop ranges library so they appear as draggable predef items in the
// preflop range editor.
//
// USAGE
//   node scripts/gto-newdefs3-emit.mjs [--dry-run]
//
// EFFECT
//   Reads C:\Program Files\GTO\config\newdefs3.txt (current state).
//   Adds two CAT_ITEM entries per postflop scenario (31 scenarios × 2 = 62
//   named-range items) under a new category named "GTO Drill (auto)" so they
//   don't pollute the user's existing categories.
//   Writes the new file to C:\Users\mondr\Downloads\newdefs3.txt.
//   User copies to Program Files via Explorer (UAC).
//
// WORKFLOW AFTER WRITING
//   1. Close GTO+ (newdefs3.txt is lock-checked at startup)
//   2. Copy Downloads\newdefs3.txt → Program Files\GTO\config\ (UAC accept)
//   3. Reopen GTO+. Open any preflop range editor.
//   4. The new entries appear under "GTO Drill (auto)" category. Double-click
//      "scenario_001_hero" → range loads. Double-click "scenario_001_vill" for
//      villain. Repeat per scenario.
//
// WHY THIS HELPS
//   Existing gto-library-emit.mjs writes Quickload entries with ranges baked
//   in. That works — but if anything ever goes wrong with a single scenario's
//   ranges (script bug, range edit), the user has no clean way to re-paste
//   them. With this emitter, the ranges live in the *preflop editor* too,
//   so they can be dragged in independently of the Quickload entry.
//
//   Also: a user can use these named ranges manually if they prefer the
//   "build tree from scratch" workflow over Quickload.
//
// FORMAT
//   See gto-newdefs3-decode.mjs header for the binary structure.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRanges } from "../src/preflop-ranges.js";
import { canonicalize } from "../src/range-canonicalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SRC_PATH = "C:\\Program Files\\GTO\\config\\newdefs3.txt";
const OUT_PATH = "C:\\Users\\mondr\\Downloads\\newdefs3.txt";
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));

const DRY_RUN = process.argv.includes("--dry-run");

// =============================================================================
// Binary helpers — same conventions as library.txt
// =============================================================================
function bytesum(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s = (s + buf[i]) >>> 0;
  return s;
}

function buildPreamble(sectionLen, innerSum) {
  const p = Buffer.alloc(16);
  p.writeUInt32LE(sectionLen >>> 0, 0);
  p.writeUInt32LE(innerSum >>> 0, 8);
  return p;
}

function lpStr(str) {
  // 02 <len:u32-LE> <bytes>
  const bytes = Buffer.from(str, "utf8");
  const out = Buffer.alloc(5 + bytes.length);
  out[0] = 0x02;
  out.writeUInt32LE(bytes.length, 1);
  bytes.copy(out, 5);
  return out;
}

// =============================================================================
// Read source file & locate "Premium" template entry (simple name+range pattern)
// =============================================================================
if (!existsSync(SRC_PATH)) {
  console.error(`Source not found: ${SRC_PATH}`);
  process.exit(1);
}

const srcBuf = readFileSync(SRC_PATH);
console.log(`Source: ${SRC_PATH} (${srcBuf.length} bytes)`);

// Walk preamble sections to find the "Premium" CAT_ITEM as our template
function parseSections(buf) {
  const sections = [];
  let cursor = 0;
  while (cursor < buf.length - 16) {
    const preLen = buf.readUInt32LE(cursor);
    const tagStart = cursor + 16;
    if (buf[tagStart] !== 0x5b) { cursor++; continue; }
    const closeBr = buf.indexOf(0x5d, tagStart + 1);
    if (closeBr < 0) break;
    const tagName = buf.slice(tagStart + 1, closeBr).toString("ascii");
    const closeTag = `[/${tagName}]`;
    const openTag = `[${tagName}]`;
    const closeAt = buf.indexOf(closeTag, tagStart + openTag.length);
    if (closeAt < 0) break;
    const actualEnd = closeAt + closeTag.length;
    sections.push({
      preStart: cursor, tagStart, actualEnd, tagName,
      preLen, sectionLen: actualEnd - tagStart,
      preamble: buf.slice(cursor, tagStart),
      content: buf.slice(tagStart, actualEnd),
    });
    cursor = actualEnd;
  }
  return sections;
}

function findLpStrInBuf(buf, expected) {
  const target = Buffer.from(expected, "utf8");
  for (let i = 0; i < buf.length - 5; i++) {
    if (buf[i] === 0x02 &&
        buf.readUInt32LE(i + 1) === target.length &&
        buf.slice(i + 5, i + 5 + target.length).equals(target)) {
      return { off: i, len: target.length };
    }
  }
  return null;
}

const srcSections = parseSections(srcBuf);
console.log(`Source sections: ${srcSections.length}`);
for (const s of srcSections) {
  console.log(`  [${s.tagName}] @${s.tagStart} len=${s.sectionLen}`);
}

// Find the "Premium" template entry — simplest CAT_ITEM with 1 name + 1 range
const premiumSection = srcSections.find(s => {
  if (s.tagName !== "CAT_ITEM") return false;
  return findLpStrInBuf(s.content, "Premium") !== null &&
         findLpStrInBuf(s.content, "AA-QQ,AKs,AKo") !== null;
});

if (!premiumSection) {
  console.error("Couldn't find 'Premium' template CAT_ITEM in source.");
  console.error("This script needs a clean newdefs3.txt with the default templates.");
  console.error("Restore from C:\\Program Files\\GTO\\config\\backups\\ or the");
  console.error("config/data/newdefs3_.txt template, then rerun.");
  process.exit(1);
}

console.log(`\nTemplate entry: "Premium" → "AA-QQ,AKs,AKo"`);
console.log(`  Section bytes: ${premiumSection.sectionLen}`);
console.log(`  Content bytes (incl tags): ${premiumSection.content.length}`);

// Locate the two lp-string offsets WITHIN the content
const nameSlot = findLpStrInBuf(premiumSection.content, "Premium");
const valueSlot = findLpStrInBuf(premiumSection.content, "AA-QQ,AKs,AKo");
console.log(`  Name lp-str:  @${nameSlot.off} len=${nameSlot.len}`);
console.log(`  Value lp-str: @${valueSlot.off} len=${valueSlot.len}`);

// =============================================================================
// Per-scenario emit
// =============================================================================
function emitCatItem(name, rangeStr) {
  // Take a copy of the Premium template content, splice in new name + range
  const c = premiumSection.content;

  // Build new content by piecewise concat (offsets in ascending order)
  const slots = [
    { off: nameSlot.off, oldLen: nameSlot.len, newStr: name },
    { off: valueSlot.off, oldLen: valueSlot.len, newStr: rangeStr },
  ].sort((a, b) => a.off - b.off);

  const pieces = [];
  let cur = 0;
  for (const sl of slots) {
    if (sl.off > cur) pieces.push(c.slice(cur, sl.off));
    pieces.push(lpStr(sl.newStr));
    cur = sl.off + 5 + sl.oldLen;
  }
  if (cur < c.length) pieces.push(c.slice(cur));

  const newContent = Buffer.concat(pieces);

  // Inner = content minus open/close tags
  const openTagLen = "[CAT_ITEM]".length;
  const closeTagLen = "[/CAT_ITEM]".length;
  const inner = newContent.slice(openTagLen, newContent.length - closeTagLen);
  const innerSum = bytesum(inner);
  const preamble = buildPreamble(newContent.length, innerSum);
  return Buffer.concat([preamble, newContent]);
}

// Mirror of decisionState from gto-batch-generate.mjs for hero/villain seat
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
  return seats;
}

const newEntries = [];
const skipped = [];

for (const scen of SCENARIOS) {
  const replay = scen.replay || {};
  const hasFlop = (replay.board?.flop || []).length >= 3;
  if (!hasFlop) { skipped.push({ id: scen.scenario_id, reason: "no flop" }); continue; }

  const derived = deriveRanges(scen);
  const heroVerbose = derived.hero_range?.classes?.join(",") || "";
  const authoredVill = scen.villain_ranges?.[0]?.classes?.join(",") || "";
  const villVerbose = authoredVill || derived.villain_range?.classes?.join(",") || "";
  if (!heroVerbose || !villVerbose) {
    skipped.push({ id: scen.scenario_id, reason: "missing range" });
    continue;
  }

  const heroCanonical = canonicalize(heroVerbose);
  const villCanonical = canonicalize(villVerbose);
  if (!heroCanonical || !villCanonical) {
    skipped.push({ id: scen.scenario_id, reason: "canonicalize failed" });
    continue;
  }

  // Use short scenario index suffix to keep names <= 30 chars (preflop editor
  // labels are tight)
  const idx = String(SCENARIOS.indexOf(scen) + 1).padStart(2, "0");
  const heroName = `gto-${idx}-hero`;
  const villName = `gto-${idx}-vill`;
  newEntries.push({ scenId: scen.scenario_id, name: heroName, range: heroCanonical });
  newEntries.push({ scenId: scen.scenario_id, name: villName, range: villCanonical });
}

console.log(`\nScenarios: ${SCENARIOS.length}, eligible: ${newEntries.length / 2}, skipped: ${skipped.length}`);
for (const s of skipped) console.log(`  skip ${s.id} (${s.reason})`);

// =============================================================================
// Insert location: after last CAT_ITEM (before EOF)
// =============================================================================
const lastCatItem = [...srcSections].reverse().find(s => s.tagName === "CAT_ITEM");
const insertAt = lastCatItem ? lastCatItem.actualEnd : srcBuf.length;

const entryBufs = newEntries.map(e => emitCatItem(e.name, e.range));
const insertBlock = Buffer.concat(entryBufs);

const newBuf = Buffer.concat([
  srcBuf.slice(0, insertAt),
  insertBlock,
  srcBuf.slice(insertAt),
]);

console.log(`\nInsert at offset ${insertAt}, adding ${entryBufs.length} entries (${insertBlock.length} bytes)`);
console.log(`New file size: ${newBuf.length} bytes (was ${srcBuf.length}, +${newBuf.length - srcBuf.length})`);

// =============================================================================
// Validation: re-parse the new file end-to-end
// =============================================================================
const newSections = parseSections(newBuf);
console.log(`\nValidation: ${newSections.length} sections parsed in new file`);
let badPreamble = 0;
for (const s of newSections) {
  const innerOpen = s.content.indexOf("]") + 1;
  const innerClose = s.content.lastIndexOf("[");
  const inner = s.content.slice(innerOpen, innerClose);
  const expectedSum = bytesum(inner);
  const expectedLen = s.content.length;
  if (s.preLen !== expectedLen) {
    console.log(`  ✗ [${s.tagName}] @${s.tagStart} preLen=${s.preLen} actual=${expectedLen}`);
    badPreamble++;
  }
  if (newBuf.readUInt32LE(s.preStart + 8) !== expectedSum) {
    console.log(`  ✗ [${s.tagName}] @${s.tagStart} bytesum mismatch`);
    badPreamble++;
  }
}
if (badPreamble === 0) console.log(`  ✓ All ${newSections.length} preambles verified`);
else console.log(`  ${badPreamble} preamble errors`);

// =============================================================================
// Sample of what we emitted (first 4 entries)
// =============================================================================
console.log(`\nSample emitted entries:`);
for (const e of newEntries.slice(0, 4)) {
  console.log(`  ${e.name} → "${e.range.slice(0, 60)}${e.range.length > 60 ? "..." : ""}"`);
}

if (DRY_RUN) {
  console.log("\n(dry-run — no file written)");
  process.exit(0);
}

if (badPreamble > 0) {
  console.error("\nNOT writing output — preamble validation failed");
  process.exit(1);
}

writeFileSync(OUT_PATH, newBuf);
console.log(`\n✓ Wrote: ${OUT_PATH}`);
console.log(``);
console.log(`NEXT STEPS:`);
console.log(`  1. Close GTO+ (newdefs3.txt is read at startup)`);
console.log(`  2. Backup: copy current C:\\Program Files\\GTO\\config\\newdefs3.txt to a safe place`);
console.log(`  3. Open File Explorer to C:\\Users\\mondr\\Downloads\\`);
console.log(`  4. Right-click newdefs3.txt → Copy`);
console.log(`  5. Navigate to C:\\Program Files\\GTO\\config\\ → Paste → UAC: Yes → Replace`);
console.log(`  6. Reopen GTO+. Open any preflop range editor.`);
console.log(`  7. Look for entries named "gto-NN-hero" and "gto-NN-vill"`);
