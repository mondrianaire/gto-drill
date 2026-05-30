#!/usr/bin/env node
// gto-socket-navigate.mjs — safe tree navigation using the newly-discovered
// `Take action: N` success form (`~Next decision has been set.~`).
//
// What's new here vs gto-extract.mjs:
//   gto-extract reads only the root node of each loaded file. This script
//   demonstrates moving deeper into the tree by sending `Take action: N`
//   and refusing to send out-of-range indices (which HANG GTO+ — see
//   docs/RE-FINDINGS-AGENT4.md).
//
// Safety:
//   - Before sending `Take action: N`, the script asks `Request action data`
//     and counts the available actions. If N >= count, it refuses to send.
//   - This is the only known way to avoid the bkushigian issue #2 hang
//     reproducer that Agent 4 confirmed reproduces in v185 REGISTERED.
//
// Usage:
//   node scripts/gto-socket-navigate.mjs <abs-gto2-path> [action0 action1 ...]
//
//   Each "actionN" is a 0-indexed action choice at that depth. Example:
//   node scripts/gto-socket-navigate.mjs C:\file.gto2 0 1
//     → loads file
//     → at root, takes action 0
//     → at that next node, takes action 1
//     → dumps node data at the final position
//
// Returns:
//   The terminal node's `Request node data` response, full untruncated.

import net from "node:net";

const PORT = 55143;
const HOST = "localhost";
const TIMEOUT_MS = 5000;

function frame(msg) { return Buffer.from("~" + msg + "~", "utf8"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function drain(sock, timeoutMs) {
  return new Promise((resolve) => {
    let buf = "";
    let last = Date.now();
    const tick = setInterval(() => {
      if (Date.now() - last >= timeoutMs) {
        clearInterval(tick);
        sock.removeListener("data", onData);
        resolve(buf);
      }
    }, 50);
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
    s.setTimeout(180000);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}

async function init(sock) {
  sock.write(frame("init"));
  let resp = await drain(sock, TIMEOUT_MS);
  if (!resp.includes("You are connected to GTO+")) {
    throw new Error("Connect failed: " + resp.slice(0, 200));
  }
}

async function send(sock, cmd, timeout = TIMEOUT_MS) {
  sock.write(frame(cmd));
  return await drain(sock, timeout);
}

// Parse `Request action data` reply into a count of available actions.
// Reply looks like: ~[Action data][Action: <name>][Action: <name>]...~
function countActions(reply) {
  const matches = reply.match(/\[Action:/g);
  return matches ? matches.length : 0;
}

async function main() {
  const [, , filePath, ...pathStrs] = process.argv;
  if (!filePath) {
    console.error("Usage: gto-socket-navigate.mjs <abs-gto2-path> [action0 action1 ...]");
    process.exit(1);
  }
  const path = pathStrs.map((s) => parseInt(s, 10));
  if (path.some((n) => !Number.isInteger(n) || n < 0)) {
    console.error("Action indices must be non-negative integers.");
    process.exit(1);
  }

  console.error(`Connecting to GTO+ at ${HOST}:${PORT}...`);
  const sock = await connect();
  await init(sock);

  console.error(`Loading: ${filePath}`);
  const loadResp = await send(sock, "Load file: " + filePath);
  if (!loadResp.includes("successfully loaded")) {
    console.error("Load failed: " + loadResp.slice(0, 200));
    sock.end();
    process.exit(2);
  }

  for (let depth = 0; depth < path.length; depth++) {
    const idx = path[depth];
    console.error(`\n[depth ${depth}] Checking available actions before sending Take action: ${idx}...`);
    const actData = await send(sock, "Request action data");
    const n = countActions(actData);
    console.error(`  Node has ${n} action(s). Action data: ${actData.slice(0, 200)}...`);
    if (idx >= n) {
      console.error(`  REFUSING to send Take action: ${idx} (would hang GTO+; node only has ${n} actions).`);
      sock.end();
      process.exit(3);
    }
    const takeResp = await send(sock, "Take action: " + idx);
    console.error(`  Reply: ${takeResp}`);
    if (!takeResp.includes("Next decision has been set") && !takeResp.includes("set")) {
      console.error("  Unexpected reply — bailing to avoid corrupting state.");
      sock.end();
      process.exit(4);
    }
    await sleep(150);
  }

  console.error(`\nFinal node reached. Dumping node data...`);
  const nodeData = await send(sock, "Request node data", 15000);
  process.stdout.write(nodeData);

  sock.end();
}

main().catch((e) => { console.error(e); process.exit(99); });
