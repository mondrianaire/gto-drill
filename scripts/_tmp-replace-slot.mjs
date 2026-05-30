// _tmp-replace-slot.mjs — replace test-bb-monster's lp-strings with bb-monster
// scenario data IN PLACE (same slot, different content). Tests whether GTO+'s
// visibility registry is slot-based (entry's position in file) or content-based.
//
// If GTO+ shows the slot with scenario data → registry is slot-based, we can
// cycle scenarios through the 5 visible slots in batches of 5.
// If GTO+ hides it → registry is content-keyed (probably name hash), and even
// replacing won't work — we're truly blocked.

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRanges } from "../src/preflop-ranges.js";
import { canonicalize } from "../src/range-canonicalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));

const SOURCE = "C:\\Users\\mondr\\Downloads\\library.txt.backup-1779759231891";
const OUT = "C:\\Users\\mondr\\Downloads\\library.txt";

function decisionState(replay) {
  const seats = {};
  for (const s of replay.seats) seats[s.pos] = { stack: s.stack_bb, street: 0 };
  let pot = replay.starting_pot_bb || 0; let cur = "preflop";
  for (const a of replay.actions || []) {
    if (a.street !== cur) { for (const p of Object.values(seats)) { pot += p.street; p.street = 0; } cur = a.street; }
    const seat = seats[a.actor]; if (!seat) continue;
    if (a.type === "bet" || a.type === "raise" || a.type === "call") {
      const add = (a.amount_bb || 0) - seat.street; seat.street += add; seat.stack -= add;
    } else if (a.type === "post") { seat.street += a.amount_bb || 0; seat.stack -= a.amount_bb || 0; }
  }
  const heroPos = replay.hero_seat;
  const heroStack = seats[heroPos]?.stack || 0;
  const villPos = (replay.seats || []).map(s => s.pos).find(p => p !== heroPos);
  const villStack = seats[villPos]?.stack || 0;
  const livePot = pot + Object.values(seats).reduce((s, p) => s + p.street, 0);
  return { potBb: Math.max(1, livePot), effStackBb: Math.max(1, Math.min(heroStack, villStack)) };
}

function bytesum(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s >>> 0; }

const scen = SCENARIOS.find(s => s.scenario_id === "bb-monster-draw-check-raise-023");
const replay = scen.replay;
const board = [].concat(replay.board.flop || []).concat(replay.board.turn || []).concat(replay.board.river || []).join("");
const derived = deriveRanges(scen);
const heroVerbose = derived.hero_range?.classes?.join(",") || "";
const villVerbose = scen.villain_ranges?.[0]?.classes?.join(",") || derived.villain_range?.classes?.join(",") || "";
const heroIsIp = replay.hero_seat && /BTN|CO|HJ|MP|LJ/.test(replay.hero_seat);
const range1 = canonicalize(heroIsIp ? villVerbose : heroVerbose);
const range2 = canonicalize(heroIsIp ? heroVerbose : villVerbose);
const ds = decisionState(replay);
const pot = ds.potBb.toFixed(2);
const stack = ds.effStackBb.toFixed(1);
const newName = "REPLACED-bb-monster"; // 19 chars (different from test-bb-monster's 15 to confirm rename worked)

console.log("Patching test-bb-monster slot with bb-monster scenario data:");
console.log("  name:   test-bb-monster (15) → " + newName + " (" + newName.length + ")");
console.log("  range1: 189 chars → " + range1.length + " chars");
console.log("  range2: 189 chars → " + range2.length + " chars");
console.log("  board:  AdAcAh → " + board);
console.log("  pot:    10 → " + pot);
console.log("  stack:  90 → " + stack);
console.log();

const buf = Buffer.from(readFileSync(SOURCE));
const text = buf.toString("latin1");
const nameAt = text.indexOf("test-bb-monster");
const opens = [...text.matchAll(/\[TREE\]/g)].map(m => m.index);
const closes = [...text.matchAll(/\[\/TREE\]/g)].map(m => m.index);
const entryStart = opens.filter(o => o < nameAt).pop();
const entryEnd = closes.find(c => c > entryStart) + 7;
let entry = Buffer.from(buf.slice(entryStart, entryEnd));

function findLp(b, str) {
  const t = Buffer.from(str, "utf8");
  for (let i = 0; i < b.length - t.length - 5; i++) {
    if (b[i] === 0x02 && b.readUInt32LE(i + 1) === t.length &&
        b.slice(i + 5, i + 5 + t.length).equals(t)) return { off: i, len: t.length };
  }
  return null;
}

function makeLp(s) {
  const bytes = Buffer.from(s, "utf8");
  const out = Buffer.alloc(5 + bytes.length);
  out[0] = 0x02; out.writeUInt32LE(bytes.length, 1); bytes.copy(out, 5);
  return out;
}

// Find slots in entry (offsets within entry, before patching)
const slots = {
  name: findLp(entry, "test-bb-monster"),
  range1: findLp(entry, "AA-22,AKs-A2s,KQs-K2s,QJs-Q2s,JTs-J2s,T9s-T2s,98s-92s,87s-82s,76s-72s,65s-62s,54s-52s,43s-42s,32s,AKo-A2o,KQo-K2o,QJo-Q2o,JTo-J2o,T9o-T2o,98o-92o,87o-82o,76o-72o,65o-62o,54o-52o,43o-42o,32o"),
};
// Range 2 is the next occurrence
let r2start = slots.range1.off + 5 + slots.range1.len;
slots.range2 = findLp(entry.slice(r2start), "AA-22,AKs-A2s,KQs-K2s,QJs-Q2s,JTs-J2s,T9s-T2s,98s-92s,87s-82s,76s-72s,65s-62s,54s-52s,43s-42s,32s,AKo-A2o,KQo-K2o,QJo-Q2o,JTo-J2o,T9o-T2o,98o-92o,87o-82o,76o-72o,65o-62o,54o-52o,43o-42o,32o");
if (slots.range2) slots.range2.off += r2start;
slots.board = findLp(entry, "AdAcAh");
slots.pot = findLp(entry, "10");
slots.stack = findLp(entry.slice(slots.pot.off + 5 + 2), "90");
if (slots.stack) slots.stack.off += slots.pot.off + 5 + 2;

console.log("Slots in entry:");
for (const [k, v] of Object.entries(slots)) console.log("  " + k.padEnd(8) + " @" + v.off + " len=" + v.len);

// Apply patches in reverse offset order so prior offsets stay valid
const patches = [
  { slot: slots.name, val: newName },
  { slot: slots.range1, val: range1 },
  { slot: slots.range2, val: range2 },
  { slot: slots.board, val: board },
  { slot: slots.pot, val: pot },
  { slot: slots.stack, val: stack },
].sort((a, b) => b.slot.off - a.slot.off);

for (const p of patches) {
  const lp = makeLp(p.val);
  entry = Buffer.concat([
    entry.slice(0, p.slot.off),
    lp,
    entry.slice(p.slot.off + 5 + p.slot.len),
  ]);
}

console.log();
console.log("New entry size: " + entry.length + " (was " + (entryEnd - entryStart) + ")");

// Build preamble (don't touch @+18 per Agent 1)
const inner = entry.slice(6, entry.length - 7);
const preamble = Buffer.alloc(16);
preamble.writeUInt32LE(entry.length, 0);
preamble.writeUInt32LE(bytesum(inner), 8);

// Splice into library (replace original test-bb-monster entry + its preamble)
const newLib = Buffer.concat([
  buf.slice(0, entryStart - 16),
  preamble,
  entry,
  buf.slice(entryEnd),
]);

writeFileSync(OUT, newLib);
console.log("✅ Wrote " + OUT + " (" + newLib.length + " bytes)");
console.log();
console.log("This REPLACED test-bb-monster's content in-place with bb-monster scenario data.");
console.log("Expected outcomes:");
console.log("  ✅ GTO+ shows 5 entries with 'REPLACED-bb-monster' at top → registry is SLOT-BASED");
console.log("  💥 GTO+ shows 5 entries with old 'test-bb-monster' name → registry uses name hash");
console.log("  🟡 GTO+ shows 4 entries (only Examples) → replacing invalidates the slot");
