#!/usr/bin/env node
// gto-extract.mjs — drive GTO+ over its socket interface to extract solver data
// from solved .gto2 files.
//
// Prerequisites:
//   1. GTO+ running with socket auth enabled (tmp/customconnect.txt → "override").
//   2. solver-output/ contains one solved <scenario_id>.gto2 per scenario.
//
// Protocol (reverse-engineered from bkushigian/gto- + live probe):
//   - TCP localhost:55143
//   - All messages framed as `~<msg>~` UTF-8
//   - Handshake:  send `~init~`, expect `~C::<id>~~You are connected to GTO+~`
//   - Load file:  send `~Load file: <abs path>~`, expect `~File successfully loaded.~`
//   - Node data:  send `~Request node data~`, get per-combo COMBOS/EQUITY/WEIGHTS
//   - Action data:`~Request action data~` → `~[N actions: A,B,C]~`
//
// Output: solver-output/solver-data.json — { [scenario_id]: { board, actions,
// oop_per_hand, ip_per_hand, hero_hand_freq, hero_hand_ev, hero_hand_combos } }

import net from "node:net";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "solver-output");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));

const PORT = 55143;
const HOST = "localhost";
const LONG_SLEEP = 500;
const SHORT_SLEEP = 150;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function frame(msg) { return Buffer.from("~" + msg + "~", "utf8"); }

// Receive one or more framed responses. Resolves when the buffer ends with `~`
// AND is non-empty, OR when the timeout expires.
function receive(sock, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const to = setTimeout(() => {
      sock.removeListener("data", onData);
      if (buf) resolve(buf); else reject(new Error("timeout"));
    }, timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.endsWith("~") && buf.length > 1) {
        clearTimeout(to);
        sock.removeListener("data", onData);
        resolve(buf);
      }
    };
    sock.on("data", onData);
  });
}

async function connect() {
  return new Promise((resolve, reject) => {
    const s = net.connect(PORT, HOST);
    s.setTimeout(120000);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}

async function init(sock) {
  sock.write(frame("init"));
  const resp = await receive(sock, 5000);
  if (!resp.includes("You are connected to GTO+")) {
    throw new Error("GTO+ refused connection: " + resp);
  }
  await sleep(SHORT_SLEEP);
}

async function loadFile(sock, path) {
  sock.write(frame("Load file: " + path));
  const resp = await receive(sock, 15000);
  if (!resp.includes("successfully loaded")) {
    throw new Error("Load failed: " + resp);
  }
  await sleep(LONG_SLEEP);
}

async function requestNodeData(sock) {
  sock.write(frame("Request node data"));
  await sleep(LONG_SLEEP);
  return receive(sock, 15000);
}

async function requestActionData(sock) {
  sock.write(frame("Request action data"));
  await sleep(SHORT_SLEEP);
  return receive(sock, 5000);
}

// Parser for the node-data response:
//   ~[GTO+ export][Board: Td9d6h][OOP, 30 hands, 2 actions\r\nHAND, COMBOS, ...]
//   [IP, ...]~
// Returns { board: ['Td','9d','6h'], oop_raw, ip_raw }
function parseNodeData(text) {
  const stripped = text.replace(/^~+|~+$/g, "").replace(/^\[|\]$/g, "");
  const parts = stripped.split("][");
  // Drop "GTO+ export"
  const [, boardSec, oopSec, ipSec] = parts;
  const boardStr = boardSec.split(": ")[1].trim();
  const board = [];
  for (let i = 0; i < boardStr.length; i += 2) board.push(boardStr.slice(i, i + 2));
  return { board, oop_raw: oopSec, ip_raw: ipSec };
}

// Parse one player block. Returns { is_next_to_act, hands: {hand: { COMBOS, EQUITY, [action]: { FREQ, EV } }}}
function parsePlayerBlock(raw, actions) {
  const rows = raw.split("\r\n");
  const meta = rows[0].trim().split(", ");      // e.g. "OOP, 30 hands, 2 actions" or "IP, 30 hands"
  const isNext = meta.length === 3;
  const dataRows = rows.slice(2).map((line) => line.trim().split(/\s+/)).filter((r) => r.length >= 3);
  const hands = {};
  for (const row of dataRows) {
    const hand = row[0];
    const vals = row.slice(1).map(Number);
    const entry = { COMBOS: vals[0], EQUITY: vals[1] };
    if (isNext) {
      for (let i = 0; i < actions.length; i++) {
        entry[actions[i]] = { FREQ: vals[2 + i], EV: vals[2 + i + actions.length] };
      }
    }
    hands[hand] = entry;
  }
  return { is_next_to_act: isNext, hands };
}

function parseActions(text) {
  const stripped = text.replace(/^~+\[?|\]?~+$/g, "");
  // "N actions: Bet 9.25,Check"
  const parts = stripped.split(": ");
  if (parts.length < 2) return [];
  return parts.slice(1).join(": ").split(",").map((s) => s.trim());
}

// Aggregate per-action OVERALL frequency (combo-weighted across all hands).
// Returns { 'Bet 9.25': 0.78, 'Check': 0.22 } summing to 1.
function aggregateFrequencies(playerHands, actions) {
  const total = Object.values(playerHands).reduce((s, h) => s + (h.COMBOS || 0), 0);
  if (!total) return {};
  const out = {};
  for (const act of actions) {
    let weighted = 0;
    for (const h of Object.values(playerHands)) {
      const freq = (h[act] && h[act].FREQ) || 0;
      weighted += (h.COMBOS || 0) * freq;
    }
    out[act] = Math.round((weighted / total) * 10) / 1000;     // sum to ~1.000
  }
  return out;
}

async function extractOne(sock, path) {
  await loadFile(sock, path);
  const actionResp = await requestActionData(sock);
  const actions = parseActions(actionResp);
  const nodeResp = await requestNodeData(sock);
  const { board, oop_raw, ip_raw } = parseNodeData(nodeResp);
  const oop = parsePlayerBlock(oop_raw, actions);
  const ip = parsePlayerBlock(ip_raw, actions);
  const nextToAct = ip.is_next_to_act ? "ip" : "oop";
  const actor = nextToAct === "ip" ? ip : oop;
  return {
    board,
    actions,
    next_to_act: nextToAct,
    overall_freq: aggregateFrequencies(actor.hands, actions),
    oop_per_hand: oop.hands,
    ip_per_hand: ip.hands,
  };
}

// Pick hero's dealt-hand strategy from the player blocks.
function pickHeroHandStrategy(extracted, scen) {
  const dealt = (scen.replay?.hero_cards || []).join("");
  if (!dealt) return null;
  // Try both player blocks — whichever side has hero's combo.
  const candidates = ["oop_per_hand", "ip_per_hand"];
  for (const side of candidates) {
    const block = extracted[side];
    if (block[dealt]) return { hand: dealt, side, ...block[dealt] };
  }
  return null;
}

// ===== MAIN =====
const filter = process.argv[2];
const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".gto2") && !f.startsWith("test"));
const targets = filter ? files.filter((f) => f.includes(filter)) : files;
if (!targets.length) {
  console.error(`No .gto2 files in ${OUT_DIR}${filter ? " matching " + filter : ""}.`);
  process.exit(1);
}

console.log(`Connecting to GTO+ at ${HOST}:${PORT}...`);
const sock = await connect();
await init(sock);
console.log("✅ Authenticated\n");

const allData = {};
for (const f of targets) {
  const id = basename(f, ".gto2");
  const scen = SCENARIOS.find((s) => s.scenario_id === id);
  const fullPath = join(OUT_DIR, f).replace(/\\/g, "/");
  process.stdout.write(`  ${id} ... `);
  try {
    const extracted = await extractOne(sock, fullPath);
    const heroStrat = scen ? pickHeroHandStrategy(extracted, scen) : null;
    allData[id] = {
      ...extracted,
      hero_hand_strategy: heroStrat,
    };
    const freqStr = Object.entries(extracted.overall_freq).map(([a, f]) => `${a}=${(f * 100).toFixed(1)}%`).join(", ");
    console.log(`OK (${extracted.actions.length} actions: ${freqStr})`);
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    allData[id] = { error: e.message };
  }
  await sleep(SHORT_SLEEP);
}

sock.end();

const outPath = join(OUT_DIR, "solver-data.json");
writeFileSync(outPath, JSON.stringify(allData, null, 2));
console.log(`\n✅ Wrote ${outPath} (${Object.keys(allData).length} scenarios)`);
