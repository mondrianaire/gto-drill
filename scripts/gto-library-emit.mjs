#!/usr/bin/env node
// gto-library-emit.mjs — emit scenario entries into GTO+'s library.txt
//
// The library file is a binary-prefixed text format that GTO+ exposes via its
// "Quickload" dialog. Each entry stores ranges + board + pot + stack + bet
// tree config, and clicking "LOAD SELECTED TREE" on an entry populates the
// whole UI from those values — including the parts the .gto2 binary
// substitution couldn't reach (MAIN TREE bet tree). So writing 31 entries (one
// per scenario) gives the user a 30-second-per-scenario click-Load-Build-Solve-
// Save workflow vs the 3-4-min/scenario manual pastepack alternative.
//
// Approach: take the user's "test-bb-monster" library entry (created via Store
// current tree in GTO+) as a TEMPLATE. For each scenario, copy it byte-for-
// byte and patch the lp-strings (name, ranges, board, pot, stack) with that
// scenario's data. The header field @+18 (size-related) gets updated for the
// new entry size.
//
// Constraints:
//   - GTO+ must be CLOSED before this script runs (library.txt is exclusively
//     locked by GTO+ while it's running)
//   - The script needs admin privileges to write to C:\Program Files\GTO\config\
//     — invoke via Windows-MCP PowerShell or an elevated shell
//   - Bet sizing tree is inherited verbatim from the template entry (basic mode
//     5.5/16.75/40.5/90.0 + advanced mode 50%/75% pot defaults)
//
// Usage:
//   node scripts/gto-library-emit.mjs              # writes 31 entries
//   node scripts/gto-library-emit.mjs --dry-run    # preview without writing
//   node scripts/gto-library-emit.mjs <scenario_id>  # one scenario
//
// Expected workflow after writing:
//   1. Open GTO+
//   2. Open Quickload dialog (folder icon in left panel)
//   3. For each entry "scenario-<scenario_id>":
//      a. Click entry → LOAD SELECTED TREE → ranges/board/pot/stack populate
//      b. Close dialog → click Build Tree → click Run solver
//      c. When solver done: File → Save As → scenario_id.gto2 in solver-output/
//   4. node scripts/gto-extract.mjs && node scripts/gto-merge.mjs

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRanges } from "../src/preflop-ranges.js";
import { canonicalize } from "../src/range-canonicalize.js";

// =============================================================================
// library.txt FORMAT (reverse-engineered 2026-05-25)
// =============================================================================
// Top-level structure:
//
//   <16-byte preamble for [HEADER]> [HEADER] ...inner... [/HEADER]
//   <16-byte preamble for [TREE]>   [TREE]   ...inner... [/TREE]
//   <16-byte preamble for [TREE]>   [TREE]   ...inner... [/TREE]
//   ... (one per quickload entry)
//   [optional] <preamble> [CATEGORY] ...inner... [/CATEGORY]
//
// Each 16-byte preamble = <u32 LE section_length_incl_tags> <4 zero>
//                         <u32 LE inner_content_bytesum>   <4 zero>
// where section_length_incl_tags includes both the [TAG] open and [/TAG] close,
// and inner_content_bytesum is sum(bytes between the tags) & 0xffffffff.
// This is the SAME preamble pattern as .gto2 sections.
//
// HEADER inner content is exactly 24 bytes:
//   @+0  u32 = 3                  format version
//   @+4  u32 = 16                 sub-header size (= 16)
//   @+8  u32 = N                  "count" — varies (NOT tree count: see below)
//   @+12 u32 = 4                  unknown — usually 4
//   @+16 8 bytes: 01 0a 03 00 b9 00 05 00   unknown constant
//
// The @+8 "count" field's meaning is fuzzy: a clean 4-example install has
// count=4 with 4 trees; after the user added one tree via Store current
// tree (no CATEGORY in file), count became 4 with 5 trees; with CATEGORY
// present it was 1. What we KNOW: GTO+ accepted count=6 with 6 trees when it
// wrote one itself. We mirror GTO+: emit count = (current count + entries added)
// or just (number of TREE markers) — empirically either works, but we MUST
// recompute the HEADER inner bytesum after touching @+8 because the file
// preamble's bytesum field WILL otherwise mismatch and the file fails parse.
//
// EACH [TREE] entry has the same 16-byte preamble (length + bytesum).
// GTO+ validates these preambles strictly and rejects the file on mismatch.
// Our previous emitter just concatenated entry bytes without preambles → silent
// rejection at the Quickload dialog.
//
// =============================================================================

// Mirror of decisionState from gto-batch-generate.mjs — walks the replay
// actions to compute pot + effective stack at the decision point.
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
  const heroPos = replay.hero_seat;
  const heroStack = seats[heroPos]?.stack || 0;
  const villPos = (replay.seats || []).map(s => s.pos).find(p => p !== heroPos);
  const villStack = seats[villPos]?.stack || 0;
  const livePot = pot + Object.values(seats).reduce((s, p) => s + p.street, 0);
  return { potBb: Math.max(1, livePot), effStackBb: Math.max(1, Math.min(heroStack, villStack)) };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
// Read from Program Files (works), write to Downloads (admin-free).
// User then copies the written file back to Program Files via Explorer
// (UAC prompts once on the copy). Direct write to Program Files needs
// elevated PowerShell which Windows-MCP can't always provide.
const LIB_PATH = "C:\\Program Files\\GTO\\config\\library.txt";
const OUT_PATH = "C:\\Users\\mondr\\Downloads\\library.txt";
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const sourceArg = args.find(a => a.startsWith("--source="));
const SOURCE_PATH = sourceArg ? sourceArg.slice("--source=".length) : null;
const filter = args.find(a => !a.startsWith("--") && !a.includes("=")) || null;

// Bytesum: 32-bit sum of bytes, used in all section preambles
function bytesum(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i];
  return s >>> 0;
}

// Build a 16-byte preamble for a section.
//   length = full section bytes including [TAG] and [/TAG]
//   innerBytesum = bytesum of bytes between the tags (exclusive)
function buildPreamble(length, innerBytesum) {
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(length >>> 0, 0);
  pre.writeUInt32LE(innerBytesum >>> 0, 8);
  return pre;
}

// ============================================================
// 1. Read the existing library and find the test-bb-monster template entry
// ============================================================
// Source: --source=<path> overrides default. Useful for working from a known
// clean backup when the Program Files copy is in a broken state.
const sourcePath = SOURCE_PATH || LIB_PATH;
if (!existsSync(sourcePath)) {
  console.error("❌ library.txt not found at " + sourcePath);
  process.exit(1);
}
const libBuf = readFileSync(sourcePath);
console.log("Source library: " + sourcePath + " (" + libBuf.length + " bytes)");

const libText = libBuf.toString("latin1");
const templateName = "test-bb-monster";
const templateNameIdx = libText.indexOf(templateName);
if (templateNameIdx < 0) {
  console.error("❌ '" + templateName + "' template entry not found in library.txt");
  console.error("   In GTO+: Quickload → Store current tree → name it 'test-bb-monster' → Save changes");
  process.exit(1);
}

// Find this entry's [TREE]/[/TREE] bounds
const treeOpens = [...libText.matchAll(/\[TREE\]/g)].map(m => m.index);
const treeCloses = [...libText.matchAll(/\[\/TREE\]/g)].map(m => m.index);
const templateEntryStart = treeOpens.filter(o => o < templateNameIdx).pop();
const templateEntryEndIdx = treeCloses.findIndex(c => c > templateEntryStart);
const templateEntryEnd = treeCloses[templateEntryEndIdx] + "[/TREE]".length;
const templateBuf = libBuf.slice(templateEntryStart, templateEntryEnd);
console.log("Template entry @ " + templateEntryStart + "-" + templateEntryEnd + " (" + templateBuf.length + " bytes)");

// ============================================================
// 2. Parse the template entry: identify lp-string offsets within the entry
// ============================================================
// LP-string format: 02 <len:u32-LE> <bytes>
function findLpString(buf, startSearch, expected) {
  const target = Buffer.from(expected, "utf8");
  for (let i = startSearch; i < buf.length - target.length - 5; i++) {
    if (buf[i] === 0x02 &&
        buf.readUInt32LE(i + 1) === target.length &&
        buf.slice(i + 5, i + 5 + target.length).equals(target)) {
      return { off: i, len: target.length };
    }
  }
  return null;
}

const slots = {};
slots.name = findLpString(templateBuf, 0, "test-bb-monster");
slots.range1 = findLpString(templateBuf, slots.name.off + slots.name.len, "AA-22,AKs-A2s,KQs-K2s,QJs-Q2s,JTs-J2s,T9s-T2s,98s-92s,87s-82s,76s-72s,65s-62s,54s-52s,43s-42s,32s,AKo-A2o,KQo-K2o,QJo-Q2o,JTo-J2o,T9o-T2o,98o-92o,87o-82o,76o-72o,65o-62o,54o-52o,43o-42o,32o");
slots.range2 = findLpString(templateBuf, slots.range1.off + slots.range1.len, "AA-22,AKs-A2s,KQs-K2s,QJs-Q2s,JTs-J2s,T9s-T2s,98s-92s,87s-82s,76s-72s,65s-62s,54s-52s,43s-42s,32s,AKo-A2o,KQo-K2o,QJo-Q2o,JTo-J2o,T9o-T2o,98o-92o,87o-82o,76o-72o,65o-62o,54o-52o,43o-42o,32o");
slots.board = findLpString(templateBuf, slots.range2.off + slots.range2.len, "AdAcAh");
slots.pot = findLpString(templateBuf, slots.board.off, "10");
slots.stack = findLpString(templateBuf, slots.pot.off + 5 + 2, "90");

for (const [name, slot] of Object.entries(slots)) {
  if (!slot) { console.error("❌ Couldn't locate " + name + " in template"); process.exit(1); }
  console.log("  " + name.padEnd(8) + " @" + String(slot.off).padStart(5) + "  len=" + slot.len);
}

// Header u32 field @+18 (size-related — varies with content)
const HEADER_SIZE_FIELD_OFF = 18;
const templateSizeField = templateBuf.readUInt32LE(HEADER_SIZE_FIELD_OFF);
console.log("  Template header size field @+18: " + templateSizeField + " (entry size " + templateBuf.length + ")");
const SIZE_FIELD_OFFSET_FROM_ENTRY_SIZE = templateBuf.length - templateSizeField; // 64

// ============================================================
// 3. Per-scenario emitter
// ============================================================
function emitScenarioEntry(scen) {
  const replay = scen.replay || {};
  if (!replay.board) return { skip: "no board (preflop scenario)" };

  // Board: concatenate flop+turn+river cards into a single string
  const board = [].concat(replay.board.flop || []).concat(replay.board.turn || []).concat(replay.board.river || []).join("");
  if (board.length < 6) return { skip: "no flop" };

  // Hero/villain ranges — same shape gto-batch-generate.mjs uses:
  //   derived.hero_range.classes (array of hand-class strings)
  //   scen.villain_ranges[0].classes (authored) OR derived.villain_range.classes
  const derived = deriveRanges(scen);
  const heroVerbose = derived.hero_range?.classes?.join(",") || "";
  const authoredVill = scen.villain_ranges?.[0]?.classes?.join(",") || "";
  const villVerbose = authoredVill || derived.villain_range?.classes?.join(",") || "";
  if (!heroVerbose || !villVerbose) return { skip: "missing range — hero=" + heroVerbose.length + " vill=" + villVerbose.length };

  // Hero seat determines OOP/IP slot mapping. GTO+ Range 1 = OOP, Range 2 = IP.
  const heroIsIp = replay.hero_seat && /BTN|CO|HJ|MP|LJ/.test(replay.hero_seat);
  const range1 = canonicalize(heroIsIp ? villVerbose : heroVerbose);
  const range2 = canonicalize(heroIsIp ? heroVerbose : villVerbose);
  if (!range1 || !range2) return { skip: "range canonicalization failed" };

  // Pot + stack from replay walk
  const ds = decisionState(replay);
  const pot = ds.potBb.toFixed(2);
  const stack = ds.effStackBb.toFixed(1);

  const entryName = "scenario-" + scen.scenario_id;

  // Build new entry by patching the template buffer
  // Apply substitutions in offset order so we can track cumulative shifts
  const subs = [
    { slot: slots.name, newStr: entryName },
    { slot: slots.range1, newStr: range1 },
    { slot: slots.range2, newStr: range2 },
    { slot: slots.board, newStr: board },
    { slot: slots.pot, newStr: pot },
    { slot: slots.stack, newStr: stack },
  ].sort((a, b) => a.slot.off - b.slot.off);

  // Splice all subs at once
  const pieces = [];
  let cursor = 0;
  let netDelta = 0;
  for (const sub of subs) {
    if (sub.slot.off > cursor) pieces.push(templateBuf.slice(cursor, sub.slot.off));
    // Write the new lp-string: 02 <len:u32-LE> <bytes>
    const newBytes = Buffer.from(sub.newStr, "utf8");
    const lp = Buffer.alloc(5 + newBytes.length);
    lp[0] = 0x02;
    lp.writeUInt32LE(newBytes.length, 1);
    newBytes.copy(lp, 5);
    pieces.push(lp);
    cursor = sub.slot.off + 5 + sub.slot.len;
    netDelta += newBytes.length - sub.slot.len;
  }
  if (cursor < templateBuf.length) pieces.push(templateBuf.slice(cursor));

  const newEntry = Buffer.concat(pieces);
  // @+18: AGENT 1 (2026-05-26) verified that GTO+ does NOT update this field
  // when it itself saves an entry after the user changes pot/stack via the UI.
  // Golden-diff proof: backup-1779759231891 (pot="10") vs live library
  // (pot="7.50") have identical @+18=6764 even though entry length differs by
  // +2 bytes. Patching with @+18 LEFT UNTOUCHED produces a byte-identical
  // file to GTO+'s own save (zero-diff with cmp). So @+18 is part of a
  // bet-tree config snapshot — it is NOT a length pointer. Inherit verbatim
  // from the template; do not derive.
  // (Prior behavior: newEntry.writeUInt32LE(templateSizeField + netDelta, 18))

  // Build the 16-byte preamble that GOES BEFORE the [TREE] tag. Inner bytesum
  // is computed over bytes between [TREE] (6 bytes) and [/TREE] (7 bytes),
  // exclusive of both tags. The length field is the full section length
  // INCLUDING both tags.
  const inner = newEntry.slice(6, newEntry.length - 7);
  const preamble = buildPreamble(newEntry.length, bytesum(inner));
  const wrapped = Buffer.concat([preamble, newEntry]);

  return {
    entry: wrapped,          // preamble + [TREE] ... [/TREE]
    rawEntry: newEntry,      // without preamble (for diagnostics)
    name: entryName,
    range1Len: range1.length,
    range2Len: range2.length,
    board,
    pot,
    stack,
    netDelta,
    sectionLen: newEntry.length,
    innerSum: bytesum(inner),
  };
}

// ============================================================
// 4. Main
// ============================================================
const targets = filter
  ? SCENARIOS.filter(s => s.scenario_id === filter)
  : SCENARIOS;

const emitted = [];
const skipped = [];

for (const scen of targets) {
  const r = emitScenarioEntry(scen);
  if (r.skip) {
    skipped.push({ id: scen.scenario_id, reason: r.skip });
    continue;
  }
  emitted.push(r);
  console.log("  ✅ " + r.name.padEnd(60) + " board=" + r.board + " pot=" + r.pot + " stack=" + r.stack + " (Δ" + (r.netDelta > 0 ? "+" : "") + r.netDelta + ")");
}

console.log("");
console.log("Emitted: " + emitted.length + ", Skipped: " + skipped.length);
if (skipped.length) {
  console.log("Skipped:");
  for (const s of skipped) console.log("  " + s.id.padEnd(50) + " " + s.reason);
}

if (DRY_RUN) {
  console.log("\n(dry-run — library.txt not modified)");
  process.exit(0);
}

if (emitted.length === 0) {
  console.error("\nNothing to emit, exiting");
  process.exit(1);
}

// ============================================================
// 5. Insert entries at the right position in library.txt
// ============================================================
// Layouts seen in practice:
//   Layout A (4-example default install):
//     [HEADER] ... [/HEADER]
//     [TREE] ... [/TREE]  × N
//     [CATEGORY] ... [/CATEGORY]   ← entries index, AFTER all [TREE]s
//   Layout B (after GTO+'s RESTORE from internal backup):
//     [HEADER] ... [/HEADER]
//     [TREE] ... [/TREE]  × N      ← no CATEGORY at all
//
// New entries always go between the last [/TREE] and either [CATEGORY] (A)
// or EOF (B). Inserting INSIDE [CATEGORY] corrupts the index — that's the
// bug we just hit. Inserting at EOF works for both layouts because B has
// no [CATEGORY] and A's [CATEGORY] sits at the end anyway.
const openCat = libText.indexOf("[CATEGORY]");
let insertOffset;
if (openCat >= 0) {
  insertOffset = openCat;
  console.log("\nInserting " + emitted.length + " entries before [CATEGORY] (offset " + insertOffset + ")");
} else {
  // No CATEGORY — insert after the last [/TREE] (= effectively at end of file)
  const closes = [...libText.matchAll(/\[\/TREE\]/g)];
  if (closes.length === 0) {
    console.error("❌ No [TREE] entries in library.txt — can't determine insert position");
    process.exit(1);
  }
  insertOffset = closes[closes.length - 1].index + "[/TREE]".length;
  console.log("\nNo [CATEGORY] in this library — inserting " + emitted.length + " entries after the last [/TREE] (offset " + insertOffset + ")");
}

const beforeInsert = libBuf.slice(0, insertOffset);
const afterInsert = libBuf.slice(insertOffset);
const insertBlock = Buffer.concat(emitted.map(e => e.entry));
const newLib = Buffer.concat([beforeInsert, insertBlock, afterInsert]);

console.log("New library size: " + newLib.length + " bytes (was " + libBuf.length + ", added " + (newLib.length - libBuf.length) + ")");

// =============================================================================
// HEADER count update + bytesum recompute
// =============================================================================
// HEADER section layout:
//   @+0:   "[HEADER]"  (8 bytes)
//   @+8:   u32 = 3                     format version
//   @+12:  u32 = 16                    sub-header size
//   @+16:  u32 = N                     "count" (see below)
//   @+20:  u32 = 4                     unknown, usually 4
//   @+24:  8 bytes 01 0a 03 00 b9 00 05 00   constant
//   @+32:  "[/HEADER]" (9 bytes)
//
// The @+16 "count" field's meaning is unclear. Empirically:
//   - Default 4-example install: count=4
//   - After GTO+ added 1 user tree via Store current tree: count=4 (untouched)
//   - After GTO+ added 1 more user tree on top of that: count=6 (jumped)
//   - With [CATEGORY] present: count=1
// GTO+ silently tolerates a stale count value; what it does NOT tolerate is a
// mismatch between the HEADER inner bytesum and the FILE preamble bytesum
// (file bytes @8-11). So we bump count to (current tree count) to be safe,
// then ALWAYS recompute the HEADER preamble's bytesum.
const hdrTagStart = newLib.indexOf("[HEADER]");
const hdrCloseStart = newLib.indexOf("[/HEADER]");
if (hdrTagStart >= 0 && hdrCloseStart > hdrTagStart) {
  // HEADER @+16 — fuzzy "count" field. Empirical OOM from setting it to
  // actual tree count (37): GTO+'s Quickload dialog crashes with "out of
  // memory" because it apparently pre-allocates per-entry buffers based
  // on this value. The original 4-example library has count=4 and GTO+
  // tolerates count<actual just fine (verified: count=4 with 5 actual
  // trees loads cleanly after the user's Store action). So we LEAVE THIS
  // FIELD UNTOUCHED — let it inherit the source's value.
  const countFieldOff = hdrTagStart + 16;
  const inheritedCount = newLib.readUInt32LE(countFieldOff);
  let treeCount = 0;
  for (let i = 0; i < newLib.length - 6; i++) {
    if (newLib[i] === 0x5b && newLib[i+1] === 0x54 && newLib[i+2] === 0x52 &&
        newLib[i+3] === 0x45 && newLib[i+4] === 0x45 && newLib[i+5] === 0x5d) {
      treeCount++;
    }
  }
  console.log("HEADER count: inherited=" + inheritedCount + " (NOT bumped to actual " + treeCount + " — OOM risk)");

  // Recompute the HEADER section's preamble bytesum. The HEADER preamble lives
  // in the FIRST 16 bytes of the file: <u32 sec_len><4 zero><u32 inner_sum><4 zero>
  const hdrInner = newLib.slice(hdrTagStart + 8, hdrCloseStart);
  const hdrInnerSum = bytesum(hdrInner);
  const hdrSectionLen = (hdrCloseStart + "[/HEADER]".length) - hdrTagStart;
  const oldPreambleLen = newLib.readUInt32LE(0);
  const oldPreambleSum = newLib.readUInt32LE(8);
  newLib.writeUInt32LE(hdrSectionLen, 0);
  newLib.writeUInt32LE(hdrInnerSum, 8);
  console.log("HEADER preamble: len " + oldPreambleLen + "→" + hdrSectionLen +
              "  bytesum " + oldPreambleSum + "→" + hdrInnerSum);
}

// =============================================================================
// Per-TREE preamble sanity check
// =============================================================================
// At this point we've inserted preamble+TREE blocks for our new entries, and
// the existing entries already have valid preambles. Walk the file and verify
// every TREE preamble's length/bytesum agree with the actual content.
function verifyTreePreambles(buf) {
  let cursor = 0;
  const issues = [];
  // Find each [TREE] tag and check the preceding 16-byte preamble
  for (let i = 0; i < buf.length - 6; i++) {
    if (buf[i] === 0x5b && buf[i+1] === 0x54 && buf[i+2] === 0x52 &&
        buf[i+3] === 0x45 && buf[i+4] === 0x45 && buf[i+5] === 0x5d) {
      if (i < 16) continue;
      const pre = buf.slice(i - 16, i);
      const preLen = pre.readUInt32LE(0);
      const preSum = pre.readUInt32LE(8);
      // Find matching [/TREE]
      const closeAbs = buf.indexOf("[/TREE]", i + 6);
      if (closeAbs < 0) { issues.push({ at: i, msg: "no closing [/TREE]" }); continue; }
      const sectionLen = (closeAbs + "[/TREE]".length) - i;
      const innerSum = bytesum(buf.slice(i + 6, closeAbs));
      if (preLen !== sectionLen) issues.push({ at: i, msg: `length mismatch: pre=${preLen} actual=${sectionLen}` });
      if (preSum !== innerSum) issues.push({ at: i, msg: `bytesum mismatch: pre=${preSum} actual=${innerSum}` });
    }
  }
  return issues;
}
const treeIssues = verifyTreePreambles(newLib);
if (treeIssues.length) {
  console.error("⚠ TREE preamble issues detected:");
  for (const ix of treeIssues) console.error(`  @${ix.at}: ${ix.msg}`);
} else {
  console.log("✅ All TREE preambles verified");
}

// Backup the SOURCE before writing — useful when working from Program Files
// directly. Skipped if --source was used (we're already reading from a backup).
if (!SOURCE_PATH) {
  const BACKUP_PATH = "C:\\Users\\mondr\\Downloads\\library.txt.backup-" + Date.now();
  copyFileSync(sourcePath, BACKUP_PATH);
  console.log("Backup of source library: " + BACKUP_PATH);
}
writeFileSync(OUT_PATH, newLib);
console.log("✅ Wrote new library to " + OUT_PATH);
console.log("");
console.log("⚠ NEXT STEP — copy this file to GTO+'s config dir (requires UAC):");
console.log("");
console.log("   Open File Explorer to C:\\Users\\mondr\\Downloads\\");
console.log("   Right-click library.txt → Copy");
console.log("   Navigate to C:\\Program Files\\GTO\\config\\");
console.log("   Paste → Windows prompts for admin → Yes → Replace");
console.log("");
console.log("Then open GTO+, click Quickload, you should see " + emitted.length + " new 'scenario-*' entries.");
