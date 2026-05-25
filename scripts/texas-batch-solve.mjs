#!/usr/bin/env node
// texas-batch-solve.mjs — run TexasSolver's console_solver on every .txt
// config in solver-input/texas/. Writes the per-scenario JSON dumps to
// solver-output/texas/.
//
// TexasSolver's `dump_result <name>.json` command writes the dump to the
// process's current working directory. We spawn the child with cwd set to
// solver-output/texas/ so dumps land in a predictable place.
//
// Solver path resolution (first hit wins):
//   1. --solver-path <abs path>            CLI argument
//   2. $TEXAS_SOLVER_PATH                  environment variable
//   3. Common install paths probed:
//        C:/Program Files/TexasSolver/console_solver.exe
//        C:/Program Files (x86)/TexasSolver/console_solver.exe
//        ~/Downloads/TexasSolver/console_solver.exe
//        ~/Documents/TexasSolver/console_solver.exe
//
// If none of those exist, the script prints download instructions and exits
// non-zero. The .txt configs in solver-input/texas/ are still valid — they
// can be shipped to whichever machine has the solver, or fed to the GUI by
// hand for one-off solves.
//
// Usage:
//   node scripts/texas-batch-solve.mjs                          # all configs
//   node scripts/texas-batch-solve.mjs <scenario_id>            # one scenario
//   node scripts/texas-batch-solve.mjs --solver-path <path>     # override exe path
//   node scripts/texas-batch-solve.mjs --concurrency 2          # N parallel solves (default 1)
//   node scripts/texas-batch-solve.mjs --timeout 900            # per-solve timeout sec (default 1800)

import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const IN_DIR = join(REPO_ROOT, "solver-input/texas");
const OUT_DIR = join(REPO_ROOT, "solver-output/texas");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ===== CLI parsing =====
const args = process.argv.slice(2);
let filter = null;
let solverPathArg = null;
let concurrency = 1;
let timeoutSec = 1800; // 30 min per solve — generous
let useWsl = false;
let wslDistro = "Ubuntu";
let wslLibDir = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--solver-path") solverPathArg = args[++i];
  else if (a === "--concurrency") concurrency = parseInt(args[++i], 10) || 1;
  else if (a === "--timeout") timeoutSec = parseInt(args[++i], 10) || 1800;
  else if (a === "--wsl") useWsl = true;
  else if (a === "--wsl-distro") { useWsl = true; wslDistro = args[++i]; }
  else if (a === "--wsl-lib-dir") { useWsl = true; wslLibDir = args[++i]; }
  else if (!a.startsWith("--")) filter = a;
}

// ===== Solver path resolution =====
// In native (non-WSL) mode we probe common install paths. In WSL mode the
// path is a Linux mount path (/mnt/c/...) that's not reachable from
// Windows fs, so we require an explicit --solver-path.
function probeSolverPath() {
  if (solverPathArg) return solverPathArg;
  if (process.env.TEXAS_SOLVER_PATH) return process.env.TEXAS_SOLVER_PATH;
  if (useWsl) return null;
  const home = os.homedir();
  const candidates = [
    "C:/Program Files/TexasSolver/console_solver.exe",
    "C:/Program Files (x86)/TexasSolver/console_solver.exe",
    join(home, "Downloads/TexasSolver/console_solver.exe"),
    join(home, "Documents/TexasSolver/console_solver.exe"),
    join(home, "TexasSolver/console_solver.exe"),
    // Native Linux / Mac
    "/usr/local/bin/console_solver",
    "/opt/TexasSolver/console_solver",
    join(home, "TexasSolver/console_solver"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch { /* skip */ }
  }
  return null;
}

const solverPath = probeSolverPath();
if (!solverPath) {
  console.error("❌ TexasSolver console executable not found.\n");
  console.error("Tried:");
  console.error("  - --solver-path argument");
  console.error("  - $TEXAS_SOLVER_PATH environment variable");
  if (!useWsl) {
    console.error("  - Common install paths under Program Files / Downloads / Documents / home");
  }
  console.error("");
  console.error("Download TexasSolver from:");
  console.error("  https://github.com/bupticybee/TexasSolver/releases");
  console.error("");
  console.error("Then rerun with:");
  console.error("  node scripts/texas-batch-solve.mjs --solver-path <path/to/console_solver>");
  console.error("");
  console.error("Or for the WSL Linux build (works around the v0.2.0 Windows crash):");
  console.error("  node scripts/texas-batch-solve.mjs --wsl --solver-path /mnt/c/.../console_solver --wsl-lib-dir /mnt/c/.../lib_local");
  process.exit(2);
}
// Only validate path on disk when calling directly. Under WSL the path is
// a Linux mount form not reachable from Windows existsSync().
if (!useWsl && !existsSync(solverPath)) {
  console.error("❌ Solver path does not exist: " + solverPath);
  process.exit(2);
}

console.log(`Solver: ${solverPath}${useWsl ? " (via WSL " + wslDistro + ")" : ""}`);
console.log(`Configs dir: ${IN_DIR}`);
console.log(`Dumps dir:   ${OUT_DIR}`);
console.log(`Concurrency: ${concurrency} (timeout: ${timeoutSec} s per solve)`);
console.log("");

// ===== File list =====
if (!existsSync(IN_DIR)) {
  console.error("❌ No configs to solve — run texas-batch-generate.mjs first.");
  process.exit(1);
}
const allFiles = readdirSync(IN_DIR).filter((f) => f.endsWith(".txt"));
const targets = filter
  ? allFiles.filter((f) => f === filter + ".txt" || f.includes(filter))
  : allFiles;
if (!targets.length) {
  console.error(`No configs in ${IN_DIR}${filter ? " matching '" + filter + "'" : ""}.`);
  process.exit(1);
}

console.log(`Solving ${targets.length} scenario(s)\n`);

// Convert C:\Users\…\file → /mnt/c/Users/…/file for WSL invocations.
function winToWsl(winPath) {
  return winPath
    .replace(/^([A-Za-z]):/, (_, drv) => "/mnt/" + drv.toLowerCase())
    .replace(/\\/g, "/");
}
// And the reverse, for finding the dump on the Windows side after a WSL
// invocation moves it.
function wslToWin(wslPath) {
  return wslPath.replace(/^\/mnt\/([a-z])\//, (_, drv) => drv.toUpperCase() + ":/");
}

// ===== Per-solve runner =====
function runOne(configFile) {
  return new Promise((res) => {
    const id = basename(configFile, ".txt");
    const configPath = resolve(IN_DIR, configFile);
    const t0 = Date.now();

    let exe, exeArgs, spawnOpts;
    if (useWsl) {
      // The solver loads its hand-strength dictionary + game-tree files
      // from `resources/` RELATIVE TO ITS OWN cwd. So we must cd to the
      // solver's own directory (not OUT_DIR) before invoking — else the
      // missing resource files cause an immediate segfault at "Iter: 0".
      // dump_result still writes to cwd by default, so the JSON lands in
      // the solver dir; we move it back to OUT_DIR in the close handler.
      //
      // MSYS_NO_PATHCONV=1 stops Git Bash / MSYS from translating
      // /mnt/c/foo paths into Windows-form when the script is launched
      // from a Git Bash environment. Without it, the Linux-form paths
      // get mangled before reaching wsl.exe.
      const wslCfg = winToWsl(configPath);
      const solverDir = solverPath.substring(0, solverPath.lastIndexOf("/"));
      const ldPrefix = wslLibDir ? `LD_LIBRARY_PATH="${wslLibDir}" ` : "";
      const bashCmd = `cd "${solverDir}" && ${ldPrefix}./console_solver -i "${wslCfg}"`;
      exe = "wsl.exe";
      exeArgs = ["-d", wslDistro, "--", "bash", "-lc", bashCmd];
      spawnOpts = {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" },
      };
    } else {
      // Native (no WSL): cwd=OUT_DIR so dump_result lands directly.
      exe = solverPath;
      exeArgs = ["-i", configPath];
      spawnOpts = { cwd: OUT_DIR, stdio: ["ignore", "pipe", "pipe"] };
    }
    const child = spawn(exe, exeArgs, spawnOpts);
    let stdoutTail = "", stderrTail = "";
    const cap = (where, chunk) => {
      const s = chunk.toString("utf8");
      if (where === "out") stdoutTail = (stdoutTail + s).slice(-2000);
      else stderrTail = (stderrTail + s).slice(-2000);
    };
    child.stdout.on("data", (c) => cap("out", c));
    child.stderr.on("data", (c) => cap("err", c));

    const killer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, timeoutSec * 1000);

    child.on("close", (code, signal) => {
      clearTimeout(killer);
      const ms = Date.now() - t0;
      // Under WSL we cd'd to the solver dir, so the dump landed there.
      // Move it back into OUT_DIR so the downstream extractor finds it.
      if (useWsl) {
        const winSolverPath = wslToWin(solverPath);
        const solverDirWin = winSolverPath.substring(0, winSolverPath.lastIndexOf("/"));
        const stagedDump = join(solverDirWin, id + ".json");
        const finalDump = join(OUT_DIR, id + ".json");
        if (existsSync(stagedDump)) {
          try { renameSync(stagedDump, finalDump); } catch { /* fall through */ }
        }
      }
      const dumpPath = join(OUT_DIR, id + ".json");
      const dumpExists = existsSync(dumpPath);
      const dumpSize = dumpExists ? statSync(dumpPath).size : 0;
      res({
        id,
        exitCode: code,
        signal,
        ms,
        dumpExists,
        dumpSize,
        stdoutTail,
        stderrTail,
      });
    });
    child.on("error", (err) => {
      clearTimeout(killer);
      res({
        id,
        exitCode: -1,
        ms: Date.now() - t0,
        dumpExists: false,
        dumpSize: 0,
        spawnError: err.message,
      });
    });
  });
}

function fmtResult(r) {
  if (r.spawnError) return `❌ spawn-failed: ${r.spawnError}`;
  if (r.signal === "SIGKILL") return `⏱  timeout after ${(r.ms / 1000).toFixed(1)} s (killed)`;
  if (r.exitCode !== 0) {
    const tail = (r.stderrTail || r.stdoutTail || "").split("\n").slice(-2).join(" | ").trim();
    return `❌ exit ${r.exitCode} after ${(r.ms / 1000).toFixed(1)} s — ${tail || "(no output)"}`;
  }
  if (!r.dumpExists) return `⚠  exit 0 but no dump file produced`;
  return `✅ ${(r.ms / 1000).toFixed(1)} s, dump ${(r.dumpSize / 1024).toFixed(1)} KB`;
}

// ===== Run loop (with simple concurrency pool) =====
const report = {};
let ok = 0, fail = 0, started = 0, finished = 0;

function logResult(r) {
  finished++;
  report[r.id] = r;
  const fmt = fmtResult(r);
  console.log(`  [${finished}/${targets.length}] ${r.id.padEnd(50)} ${fmt}`);
  if (r.exitCode === 0 && r.dumpExists) ok++;
  else fail++;
}

const queue = targets.slice();
const workers = Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const file = queue.shift();
    if (!file) break;
    started++;
    const r = await runOne(file);
    logResult(r);
  }
});
await Promise.all(workers);

// ===== Summary + report =====
const reportPath = join(OUT_DIR, "solve-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log("");
console.log("─".repeat(70));
console.log(`  ✅ solved:     ${ok}/${targets.length}`);
if (fail) console.log(`  ❌ failed:     ${fail}`);
console.log(`\n  Solve report: ${reportPath}`);
console.log("");
console.log("Next: node scripts/texas-extract.mjs");

process.exit(fail ? 1 : 0);
