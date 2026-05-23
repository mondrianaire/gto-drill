#!/usr/bin/env node
// gto-verify-loads.mjs — verify every generated .gto2 opens cleanly in GTO+.
//
// What this catches (the failure modes we've actually seen):
//   1. Hard crash on load — GTO+ dies. Socket closes mid-request, no
//      successful-load reply, all subsequent files can't be tested in this
//      run (GTO+ has to be relaunched).
//   2. Soft load failure — GTO+ rejects the file but stays alive. We see a
//      non-success reply (e.g. "Load failed: ..." or an OOM dialog string)
//      and can continue testing the next file.
//   3. Slow load — GTO+ takes longer than the timeout. Recorded as
//      indeterminate rather than fail (the file may load given more time).
//
// Prereqs:
//   - GTO+ running with socket auth enabled
//     (C:\Program Files\GTO\tmp\customconnect.txt contains "override").
//   - solver-output/ contains the .gto2 files to verify.
//
// Output: a per-file ✅/❌ table on stdout plus a summary line, and a JSON
// report at solver-output/load-verify-report.json keyed by scenario id with
// { status, ms, error?, response? } per file.
//
// Usage:
//   node scripts/gto-verify-loads.mjs                # all .gto2 in solver-output
//   node scripts/gto-verify-loads.mjs <substring>    # only files matching substring

import net from "node:net";
import {
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "solver-output");

const PORT = 55143;
const HOST = "localhost";
const LOAD_TIMEOUT_MS = 20_000;      // generous — turn/river files can take a few sec
const INIT_TIMEOUT_MS = 5_000;
const POST_LOAD_DELAY_MS = 250;      // let GTO+ settle between loads

function frame(msg) {
  return Buffer.from("~" + msg + "~", "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Wait for one or more `~...~` framed replies. Resolves with the accumulated
// buffer when it ends with `~`, or rejects on socket close / timeout. The
// socket-close case is the key signal for "GTO+ crashed on this file."
function receive(sock, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      sock.removeListener("data", onData);
      sock.removeListener("close", onClose);
      sock.removeListener("error", onError);
      fn(val);
    };
    const to = setTimeout(() => {
      if (buf) settle(resolve, buf);
      else settle(reject, new Error("timeout"));
    }, timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.endsWith("~") && buf.length > 1) settle(resolve, buf);
    };
    const onClose = () => settle(reject, new Error("socket-closed"));
    const onError = (err) => settle(reject, err);
    sock.on("data", onData);
    sock.once("close", onClose);
    sock.once("error", onError);
  });
}

async function connect() {
  return new Promise((resolve, reject) => {
    const s = net.connect(PORT, HOST);
    s.setTimeout(120_000);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}

async function init(sock) {
  sock.write(frame("init"));
  // The init handshake replies in TWO framed chunks: first the assigned
  // connection ID (`~C::<id>~`), then the auth confirmation (`~You are
  // connected to GTO+~`). Wait for both — receive() resolves on the first
  // `~`-terminated buffer, so the second chunk needs a follow-up read.
  let resp = await receive(sock, INIT_TIMEOUT_MS);
  if (!resp.includes("You are connected to GTO+")) {
    try {
      const more = await receive(sock, INIT_TIMEOUT_MS);
      resp += more;
    } catch { /* timeout — fall through to the explicit error below */ }
  }
  if (!resp.includes("You are connected to GTO+")) {
    throw new Error("GTO+ refused connection: " + resp.slice(0, 160));
  }
}

// Heuristics for "the socket is no longer usable, GTO+ likely crashed."
// ECONNRESET shows up when GTO+'s process dies mid-conversation; "socket-
// closed" comes from our own onClose handler when the FIN arrives cleanly
// (GTO+ exited normally / was killed by watchdog).
function isCrashSignal(err) {
  if (!err) return false;
  if (err.message === "socket-closed") return true;
  if (err.code === "ECONNRESET" || err.code === "EPIPE") return true;
  if (/ECONNRESET|EPIPE/.test(err.message || "")) return true;
  return false;
}

// Try to load one file. Returns { status, ms, error?, response? }.
//   status: "ok"           — GTO+ confirmed successful load
//           "rejected"     — GTO+ replied with a non-success message
//           "timeout"      — no reply within LOAD_TIMEOUT_MS
//           "crashed"      — socket dropped / ECONNRESET — GTO+ likely died
async function tryLoad(sock, absPath) {
  const t0 = Date.now();
  try {
    sock.write(frame("Load file: " + absPath));
  } catch (e) {
    // write() can throw synchronously if the socket is already torn down
    return { status: "crashed", ms: 0, error: "socket dead before write: " + e.message };
  }
  try {
    const resp = await receive(sock, LOAD_TIMEOUT_MS);
    const ms = Date.now() - t0;
    if (/successfully loaded/i.test(resp)) {
      return { status: "ok", ms, response: resp.trim().slice(0, 160) };
    }
    return {
      status: "rejected",
      ms,
      error: "non-success reply",
      response: resp.trim().slice(0, 240),
    };
  } catch (e) {
    const ms = Date.now() - t0;
    if (isCrashSignal(e)) {
      return { status: "crashed", ms, error: "GTO+ socket dropped (" + (e.code || e.message) + ")" };
    }
    if (e.message === "timeout") {
      return { status: "timeout", ms, error: `no reply in ${LOAD_TIMEOUT_MS} ms` };
    }
    return { status: "error", ms, error: e.message };
  }
}

// Reopen the socket and re-handshake. Used to recover from a GTO+ crash so
// we can keep testing the remaining files. Polls for a few seconds because
// GTO+ takes a moment to relaunch + bind the socket again.
async function reconnect() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const s = await connect();
      await init(s);
      return s;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("could not reconnect to GTO+ after 30 attempts (~30 s)");
}

// ===== MAIN =====
const filter = process.argv[2];
if (!existsSync(OUT_DIR)) {
  console.error("solver-output/ does not exist. Run gto-batch-generate first.");
  process.exit(1);
}
const all = readdirSync(OUT_DIR).filter((f) => f.endsWith(".gto2"));
const files = filter ? all.filter((f) => f.includes(filter)) : all;
if (!files.length) {
  console.error(`No .gto2 files in ${OUT_DIR}${filter ? " matching '" + filter + "'" : ""}.`);
  process.exit(1);
}

console.log(`Verifying ${files.length} .gto2 file(s) in ${OUT_DIR}/\n`);
console.log(`Connecting to GTO+ at ${HOST}:${PORT} ...`);
let sock;
try {
  sock = await connect();
} catch (e) {
  console.error(
    `❌ Could not connect to GTO+ (${e.message}).\n` +
    `   Is GTO+ running, and is C:\\Program Files\\GTO\\tmp\\customconnect.txt set to "override"?`,
  );
  process.exit(2);
}
try {
  await init(sock);
} catch (e) {
  console.error(`❌ Socket auth failed: ${e.message}`);
  console.error(`   See SOLVER-PIPELINE.md "One-time setup" for the customconnect.txt step.`);
  sock.destroy();
  process.exit(2);
}
console.log(`✅ Authenticated\n`);

const report = {};
let okCount = 0, rejectedCount = 0, timeoutCount = 0, crashedCount = 0, reconnectFails = 0;
const crashedScenarios = [];

for (const file of files) {
  const id = basename(file, ".gto2");
  const absPath = join(OUT_DIR, file).replace(/\\/g, "/");
  process.stdout.write(`  ${id.padEnd(52)} `);

  const result = await tryLoad(sock, absPath);
  report[id] = result;

  if (result.status === "ok") {
    okCount++;
    console.log(`✅ ${result.ms} ms`);
  } else if (result.status === "rejected") {
    rejectedCount++;
    console.log(`❌ rejected — ${result.response}`);
  } else if (result.status === "timeout") {
    timeoutCount++;
    console.log(`⚠  timeout (${result.ms} ms) — load may still be in flight`);
  } else if (result.status === "crashed") {
    crashedCount++;
    crashedScenarios.push(id);
    console.log(`💥 CRASHED GTO+ after ${result.ms} ms — reconnecting...`);
    try {
      sock.destroy();
    } catch { /* already torn down */ }
    try {
      sock = await reconnect();
      console.log(`     ↻ reconnected to GTO+ — continuing with next file`);
    } catch (e) {
      reconnectFails++;
      console.error(`     ❌ reconnect failed: ${e.message}`);
      console.error(`     Aborting — relaunch GTO+ manually and rerun to continue.`);
      break;
    }
  } else {
    console.log(`❌ ${result.status} — ${result.error}`);
  }
  await sleep(POST_LOAD_DELAY_MS);
}

if (sock && !sock.destroyed) sock.end();

const reportPath = join(OUT_DIR, "load-verify-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

const tested = okCount + rejectedCount + timeoutCount + crashedCount;
const skipped = files.length - tested;
console.log("");
console.log("─".repeat(70));
console.log(`  ✅  loaded cleanly:   ${okCount}/${files.length}`);
if (rejectedCount) console.log(`  ❌  rejected by GTO+: ${rejectedCount}`);
if (timeoutCount)  console.log(`  ⚠   timed out:        ${timeoutCount}`);
if (crashedCount) {
  console.log(`  💥  crashed GTO+:     ${crashedCount}`);
  for (const id of crashedScenarios) console.log(`        - ${id}`);
}
if (skipped > 0) {
  console.log(`  ⏭   not tested:       ${skipped} (reconnect failed — run again to cover)`);
}
console.log(`\n  Full report: ${reportPath}`);

if (rejectedCount || crashedCount || skipped) process.exit(1);
process.exit(0);
