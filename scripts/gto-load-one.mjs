#!/usr/bin/env node
// gto-load-one.mjs — load one .gto2 file in GTO+ and report status
// Plus: request node data / pot+stack to verify what GTO+ actually believes the file says.
//
// Usage: node scripts/gto-load-one.mjs <abs-path-to-gto2>

import net from "node:net";

const PORT = 55143;
const HOST = "localhost";
const INIT_TIMEOUT = 5000;
const LOAD_TIMEOUT = 20000;
const QUERY_TIMEOUT = 5000;

function frame(s) { return Buffer.from("~" + s + "~", "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function receive(sock, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    const settle = (fn, val) => {
      if (settled) return; settled = true;
      clearTimeout(to);
      sock.removeListener("data", onData);
      sock.removeListener("close", onClose);
      sock.removeListener("error", onError);
      fn(val);
    };
    const to = setTimeout(() => { if (buf) settle(resolve, buf); else settle(reject, new Error("timeout")); }, timeoutMs);
    const onData = (chunk) => { buf += chunk.toString("utf8"); if (buf.endsWith("~") && buf.length > 1) settle(resolve, buf); };
    const onClose = () => settle(reject, new Error("socket-closed"));
    const onError = (err) => settle(reject, err);
    sock.on("data", onData);
    sock.once("close", onClose);
    sock.once("error", onError);
  });
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/gto-load-one.mjs <abs-path>");
  process.exit(1);
}

const sock = net.connect(PORT, HOST);
sock.setTimeout(60000);

await new Promise((res, rej) => { sock.once("connect", res); sock.once("error", rej); });
console.log("Connected.");

sock.write(frame("init"));
let resp = await receive(sock, INIT_TIMEOUT);
if (!resp.includes("You are connected to GTO+")) {
  try { resp += await receive(sock, INIT_TIMEOUT); } catch {}
}
if (!resp.includes("You are connected to GTO+")) {
  console.error("Init failed:", resp.slice(0, 200));
  sock.destroy();
  process.exit(2);
}
console.log("Initialized.");

const absPath = filePath.replace(/\\/g, "/");
console.log(`\nLoading: ${absPath}`);
const t0 = Date.now();
sock.write(frame("Load file: " + absPath));
try {
  const lresp = await receive(sock, LOAD_TIMEOUT);
  const ms = Date.now() - t0;
  console.log(`Load reply (${ms} ms):`, lresp.trim().slice(0, 250));
  if (!/successfully loaded/i.test(lresp)) {
    console.error("!! Not a success reply.");
  } else {
    console.log("\n=== Successful load! Querying state ===\n");
    await sleep(250);

    // Query pot/stacks
    sock.write(frame("Request pot/stacks"));
    try {
      const r = await receive(sock, QUERY_TIMEOUT);
      console.log("pot/stacks:", r.trim().slice(0, 400));
    } catch (e) { console.log("pot/stacks query failed:", e.message); }

    // Query current line
    sock.write(frame("Request current line"));
    try {
      const r = await receive(sock, QUERY_TIMEOUT);
      console.log("current line:", r.trim().slice(0, 400));
    } catch (e) { console.log("current line query failed:", e.message); }

    // Query action data
    sock.write(frame("Request action data"));
    try {
      const r = await receive(sock, QUERY_TIMEOUT);
      console.log("action data:", r.trim().slice(0, 600));
    } catch (e) { console.log("action data query failed:", e.message); }

    // Query node data (first 500 chars only — could be huge)
    sock.write(frame("Request node data"));
    try {
      const r = await receive(sock, QUERY_TIMEOUT);
      console.log("node data (first 800 chars):", r.trim().slice(0, 800));
    } catch (e) { console.log("node data query failed:", e.message); }
  }
} catch (e) {
  const ms = Date.now() - t0;
  console.error(`Load FAILED after ${ms} ms:`, e.message, e.code || "");
}

sock.end();
