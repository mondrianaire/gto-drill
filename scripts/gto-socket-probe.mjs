#!/usr/bin/env node
// gto-socket-probe.mjs — fire one or more experimental socket commands at the
// running GTO+ instance and print whatever comes back. Used to reverse-engineer
// the configuration / build / solve commands that are not in the public
// bkushigian wrapper.
//
// Usage:
//   node scripts/gto-socket-probe.mjs "Set OOP range: AA,KK"
//   node scripts/gto-socket-probe.mjs --file probes.txt
//   node scripts/gto-socket-probe.mjs --no-init "Some follow-up"   (reuses session? no — each invocation reconnects)
//
// Notes:
//   - Each command sent wrapped in `~...~` framing per the documented protocol.
//   - Reply collection waits for any data up to PROBE_TIMEOUT, accumulating
//     multiple `~...~` chunks (GTO+ sometimes replies with several frames per
//     command — handshake is two).
//   - Silence is meaningful too: an unknown command often produces no reply,
//     and the next request will get a delayed answer or a stale one.

import net from "node:net";
import { readFileSync } from "node:fs";

const PORT = 55143;
const HOST = "localhost";
const PROBE_TIMEOUT_MS = 4000;     // generous — most replies are < 200ms
const INIT_TIMEOUT_MS = 5000;

function frame(msg) { return Buffer.from("~" + msg + "~", "utf8"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Collect every byte that arrives within timeoutMs. Doesn't stop on first `~`
// because we want to see all replies (some commands trigger multi-frame
// notifications + a final ack).
function drain(sock, timeoutMs) {
  return new Promise((resolve) => {
    let buf = "";
    const to = setTimeout(() => {
      sock.removeListener("data", onData);
      resolve(buf);
    }, timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      // Extend the timer slightly when data is still arriving
      to.refresh?.();
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
  // Handshake replies in two framed chunks (~C::id~ then ~You are connected~);
  // GTO+ can be slow when busy — give it up to 3 retries of the second read.
  let resp = await drain(sock, INIT_TIMEOUT_MS);
  for (let i = 0; i < 3 && !resp.includes("You are connected to GTO+"); i++) {
    resp += await drain(sock, INIT_TIMEOUT_MS);
  }
  if (!resp.includes("You are connected to GTO+")) {
    throw new Error("GTO+ refused connection: " + resp.slice(0, 200));
  }
  return resp;
}

async function probe(sock, cmd) {
  process.stdout.write(`\n>>> ${cmd}\n`);
  sock.write(frame(cmd));
  const resp = await drain(sock, PROBE_TIMEOUT_MS);
  if (!resp) {
    process.stdout.write("    <no reply within " + PROBE_TIMEOUT_MS + "ms>\n");
  } else {
    // Show reply as-is plus quoted form for non-printable detection
    const escaped = resp
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
    process.stdout.write(`    <<< ${escaped}\n`);
  }
  return resp;
}

// ===== MAIN =====
const args = process.argv.slice(2);
let commands = [];
if (args[0] === "--file") {
  const lines = readFileSync(args[1], "utf8").split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  commands = lines;
} else if (args.length) {
  commands = [args.join(" ")];
} else {
  console.error("Usage: gto-socket-probe.mjs <command>");
  console.error("       gto-socket-probe.mjs --file probes.txt");
  process.exit(1);
}

console.log(`Connecting to GTO+ at ${HOST}:${PORT}...`);
const sock = await connect();
const handshake = await init(sock);
console.log(`Authenticated. Handshake reply: ${handshake.slice(0, 80)}...`);

for (const cmd of commands) {
  await probe(sock, cmd);
  await sleep(200);    // courtesy gap between commands
}

sock.end();
console.log("\nDone.");
