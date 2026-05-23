#!/usr/bin/env node
// gto-template-check.mjs — validate a .gto2 template against our scenario set.
//
// A "max-budget" template is one whose hero+villain ranges are at least as wide
// (in combo count) as the widest scenario we'd inject. GTO+ allocates the bet-
// tree memory at solve-time based on the saved ranges; substituting a narrower
// range into a wide template fits cleanly. Substituting a wider range than the
// template was sized for → OOM crash at solve time (we hit this empirically).
//
// This script reports the template's hero+vill combo counts and the max combo
// counts across all 45 scenarios, with a clear pass/fail verdict.
//
// Usage:
//   node scripts/gto-template-check.mjs <template.gto2>

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRanges } from "../src/preflop-ranges.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIOS = JSON.parse(readFileSync(join(REPO_ROOT, "data/scenarios.json"), "utf8"));

if (process.argv.length < 3) {
  console.error("Usage: node scripts/gto-template-check.mjs <template.gto2>");
  process.exit(1);
}
const templatePath = process.argv[2];

// === Range parsing ===

const RANKS = "23456789TJQKA";

function expandToken(t) {
  if (/^[A-Z2-9]{2}\+$/.test(t)) {
    // Pair-plus: '99+' → 99, TT, JJ, QQ, KK, AA
    if (t[0] === t[1]) {
      const start = RANKS.indexOf(t[0]);
      const out = [];
      for (let i = start; i < 13; i++) out.push(RANKS[i] + RANKS[i]);
      return out;
    }
    return [t.slice(0, -1)];
  }
  if (/^[A-Z2-9][A-Z2-9][so]\+$/.test(t)) {
    // 'AKs+' = AKs only here (highest suited or off variant)
    return [t.slice(0, -1)];
  }
  const m = t.match(/^([A-Z2-9])([A-Z2-9])([so]?)-([A-Z2-9])([A-Z2-9])([so]?)$/);
  if (m) {
    const [, r1a, r2a, sa, r1b, r2b, sb] = m;
    const suf = sa || sb;
    const out = [];
    if (r1a === r2a && r1b === r2b) {
      const lo = Math.min(RANKS.indexOf(r1a), RANKS.indexOf(r1b));
      const hi = Math.max(RANKS.indexOf(r1a), RANKS.indexOf(r1b));
      for (let i = lo; i <= hi; i++) out.push(RANKS[i] + RANKS[i]);
    } else if (r1a === r1b) {
      const lo = Math.min(RANKS.indexOf(r2a), RANKS.indexOf(r2b));
      const hi = Math.max(RANKS.indexOf(r2a), RANKS.indexOf(r2b));
      for (let i = lo; i <= hi; i++) out.push(r1a + RANKS[i] + suf);
    } else {
      const startGap = RANKS.indexOf(r1a) - RANKS.indexOf(r2a);
      const endGap = RANKS.indexOf(r1b) - RANKS.indexOf(r2b);
      if (startGap === endGap) {
        const start = Math.min(RANKS.indexOf(r1a), RANKS.indexOf(r1b));
        const end = Math.max(RANKS.indexOf(r1a), RANKS.indexOf(r1b));
        for (let i = start; i <= end; i++) out.push(RANKS[i] + RANKS[i - startGap] + suf);
      }
    }
    return out.length ? out : [t];
  }
  return [t];
}

function combosOne(h) {
  if (h.length === 2 && h[0] === h[1]) return 6;
  if (h.endsWith("s")) return 4;
  if (h.endsWith("o")) return 12;
  return 0;
}

export function countCombos(rangeStr) {
  let n = 0;
  for (const t of rangeStr.split(",").map((s) => s.trim()).filter(Boolean)) {
    for (const e of expandToken(t)) n += combosOne(e);
  }
  return n;
}

// === Template parsing ===

function parseTemplate(buf) {
  const hdrSecLen = buf.readUInt32LE(0);
  const content = buf.slice(24, 24 + hdrSecLen - 17);  // HEADER content between markers

  // Walk atoms: find the two length-prefixed range strings
  // Strings of the form `02 <uint32 LE length> <bytes>`
  // The first long string after the 16-byte sub-header is hero range,
  // the second long string is villain range.
  const strings = [];
  let i = 16;       // skip sub-header
  while (i < content.length) {
    if (content[i] === 0x02 && i + 5 <= content.length) {
      const len = content.readUInt32LE(i + 1);
      if (i + 5 + len <= content.length && len < 500) {
        const str = content.slice(i + 5, i + 5 + len).toString("utf8");
        strings.push({ off: i, len, str });
        i += 5 + len;
        continue;
      }
    }
    i += 1;
  }
  // Hero range is typically the first string >= 4 chars, villain the second
  const candidates = strings.filter((s) => s.len >= 2);
  const heroRange = candidates[0]?.str || "(none)";
  const villRange = candidates[1]?.str || "(none)";
  return { heroRange, villRange, contentLen: content.length };
}

// === Scenario combo demands ===

function scenarioRanges(scen) {
  const d = deriveRanges(scen);
  const hero = d.hero_range?.classes?.join(",") || "";
  const auth = scen.villain_ranges?.[0]?.classes?.join(",") || "";
  const vill = auth || d.villain_range?.classes?.join(",") || "";
  return { hero, vill, heroCombos: countCombos(hero), villCombos: countCombos(vill) };
}

// === Main ===

const buf = readFileSync(templatePath);
const tmpl = parseTemplate(buf);
const tmplHeroCombos = countCombos(tmpl.heroRange);
const tmplVillCombos = countCombos(tmpl.villRange);

console.log(`## Template: ${templatePath}\n`);
console.log(`  Hero range:    ${tmpl.heroRange.slice(0, 80)}${tmpl.heroRange.length > 80 ? "..." : ""}`);
console.log(`  Hero combos:   ${tmplHeroCombos}`);
console.log(`  Vill range:    ${tmpl.villRange.slice(0, 80)}${tmpl.villRange.length > 80 ? "..." : ""}`);
console.log(`  Vill combos:   ${tmplVillCombos}`);
console.log(`  HEADER content: ${tmpl.contentLen} bytes`);
console.log("");

console.log("## Scenario demand profile\n");

const demands = SCENARIOS.map((s) => ({ id: s.scenario_id, ...scenarioRanges(s) }))
  .filter((d) => d.heroCombos > 0 || d.villCombos > 0);

const maxHero = Math.max(...demands.map((d) => d.heroCombos));
const maxVill = Math.max(...demands.map((d) => d.villCombos));
const overHero = demands.filter((d) => d.heroCombos > tmplHeroCombos);
const overVill = demands.filter((d) => d.villCombos > tmplVillCombos);

console.log(`  Max hero combos demanded by any scenario:  ${maxHero}`);
console.log(`  Max vill combos demanded by any scenario:  ${maxVill}`);
console.log(`  Template hero budget:  ${tmplHeroCombos}  ${maxHero <= tmplHeroCombos ? "✅" : "❌ too narrow"}`);
console.log(`  Template vill budget:  ${tmplVillCombos}  ${maxVill <= tmplVillCombos ? "✅" : "❌ too narrow"}`);
console.log("");

if (overHero.length) {
  console.log(`  ${overHero.length} scenarios exceed template hero budget:`);
  for (const d of overHero.slice(0, 10)) console.log(`    ${d.id.padEnd(45)} hero=${d.heroCombos} > ${tmplHeroCombos}`);
  if (overHero.length > 10) console.log(`    ...+${overHero.length - 10} more`);
}
if (overVill.length) {
  console.log(`  ${overVill.length} scenarios exceed template vill budget:`);
  for (const d of overVill.slice(0, 10)) console.log(`    ${d.id.padEnd(45)} vill=${d.villCombos} > ${tmplVillCombos}`);
  if (overVill.length > 10) console.log(`    ...+${overVill.length - 10} more`);
}

console.log("");
if (maxHero <= tmplHeroCombos && maxVill <= tmplVillCombos) {
  console.log("✅ Template covers all 45 scenarios — safe for batch generation.");
} else {
  console.log("⚠ Template is too narrow for some scenarios — see lists above.");
  console.log("  Re-save the template in GTO+ with wider hero+villain ranges:");
  if (maxHero > tmplHeroCombos) console.log(`    hero  ≥ ${maxHero} combos`);
  if (maxVill > tmplVillCombos) console.log(`    vill  ≥ ${maxVill} combos`);
  process.exit(1);
}
