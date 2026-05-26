#!/usr/bin/env node
// gto-socket-probe-v2.mjs — like gto-socket-probe.mjs but truncates long
// replies so the output stays under one screen even when probing 80+
// commands. Use this for the post-registration sweep.
//
// Usage:
//   node scripts/gto-socket-probe-v2.mjs --file scripts/_probe-batch-a.txt
//   node scripts/gto-socket-probe-v2.mjs "Some command"
//
// Replies are truncated to TRUNC_BYTES (default 160).  Pass --raw to disable.

import net from "node:net";
import { readFileSync } from "node:fs";

const PORT = 55143;
const HOST = "localhost";
const PROBE_TIMEOUT_MS = 1500;       // shorter — most replies arrive in <100ms
const INIT_TIMEOUT_MS = 5000;
const TRUNC_BYTES = 160;

function frame(msg) { return Buffer.from("~" + msg + "~", "utf8"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function drain(sock, timeoutMs) {
  return new Promise((resolve) => {
    let buf = "";
    let last = Date.now();
    const to = setInterval(() => {
      if (Date.now() - last >= timeoutMs) {
        clearInterval(to);
        sock.removeListener("data", onData);
        resolve(buf);
      }
    }, 100);
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      last = Date.now();
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
  let resp = await drain(sock, INIT_TIMEOUT_MS);
  for (let i = 0; i < 3 && !resp.includes("You are connected to GTO+"); i++) {
    resp += await drain(sock, INIT_TIMEOUT_MS);
  }
  if (!resp.includes("You are connected to GTO+")) {
    throw new Error("GTO+ refused connection: " + resp.slice(0, 200));
  }
  return resp;
}

function classify(reply) {
  if (!reply) return "SILENT";
  if (reply.includes("Instruction unknown")) return "UNKNOWN";
  if (reply.includes("Action does not exist")) return "ACT-ERR";
  if (reply.includes("successfully loaded") || reply.includes("File successfully loaded")) return "LOAD-OK";
  if (reply.includes("Solver still running")) return "BUSY";
  return "NOVEL";
}

async function probe(sock, cmd, raw) {
  sock.write(frame(cmd));
  const resp = await drain(sock, PROBE_TIMEOUT_MS);
  const cls = classify(resp);
  let shown = resp.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  if (!raw && shown.length > TRUNC_BYTES) {
    shown = shown.slice(0, TRUNC_BYTES) + `…[+${resp.length - TRUNC_BYTES}]`;
  }
  const tag = cls.padEnd(8);
  console.log(`[${tag}] ${cmd}`);
  if (cls !== "UNKNOWN" && cls !== "SILENT") {
    console.log(`           >> ${shown}`);
  }
  return { cmd, cls, resp };
}

const args = process.argv.slice(2);
const raw = args.includes("--raw");
const fileIdx = args.indexOf("--file");
let commands = [];
if (fileIdx >= 0) {
  commands = readFileSync(args[fileIdx + 1], "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
} else {
  const filtered = args.filter((a) => a !== "--raw");
  if (!filtered.length) { console.error("Usage: probe-v2 <cmd> | --file f"); process.exit(1); }
  commands = [filtered.join(" ")];
}

console.log(`Connecting to GTO+ at ${HOST}:${PORT}...`);
const sock = await connect();
await init(sock);
console.log(`Authenticated. Probing ${commands.length} commands.\n`);

const results = [];
for (const cmd of commands) {
  results.push(await probe(sock, cmd, raw));
  await sleep(100);
}

sock.end();

// Summary
console.log("\n=== SUMMARY ===");
const byClass = {};
for (const r of results) byClass[r.cls] = (byClass[r.cls] || 0) + 1;
for (const [k, v] of Object.entries(byClass).sort()) console.log(`  ${k}: ${v}`);
console.log("\nNOVEL/non-UNKNOWN replies:");
for (const r of results) {
  if (r.cls === "NOVEL" || r.cls === "LOAD-OK" || r.cls === "BUSY" || r.cls === "ACT-ERR") {
    let shown = r.resp.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    if (shown.length > 100) shown = shown.slice(0, 100) + "…";
    console.log(`  [${r.cls}] ${r.cmd}`);
    console.log(`           >> ${shown}`);
  }
}
