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
  // The first range-shaped string is hero range, the second is villain range.
  // Range-shape gate matches gto-batch-generate.mjs's locator (≥10 chars,
  // ≥2 commas, valid hand-class chars including suit letters c|d|h).
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
  const isRangeStr = (s) =>
    s.len >= 10 &&
    (s.str.match(/,/g) || []).length >= 2 &&
    /^[AKQJT2-9,+\-shdco]+$/.test(s.str);
  const candidates = strings.filter(isRangeStr);
  const heroRange = candidates[0]?.str || "(none)";
  const villRange = candidates[1]?.str || "(none)";
  return { heroRange, villRange, contentLen: content.length };
}

// Byte-18 / byte-23 are uint8 sibling pointers in HEADER region B:
//   byte 18 = template_hero_string_len + 17 + scenario_hero_delta
//   byte 23 = template_vill_string_len + 4  + scenario_vill_delta
// Both fields are single byte (verified — no adjacent high-byte field), so the
// final value must fit in [0, 255]. The cap is on the post-substitution
// scenario string length, not the template's:
//   scenario_hero_string_len must satisfy (len + 17) <= 255  →  len <= 238
//   scenario_vill_string_len must satisfy (len + 4)  <= 255  →  len <= 251
// gto-batch-generate.mjs wraps overflow with `& 0xff` so a too-long string
// silently produces a corrupted pointer rather than a hard error.
const HERO_LEN_CAP = 238;
const VILL_LEN_CAP = 251;

// === Scenario combo demands ===

function scenarioRanges(scen) {
  const d = deriveRanges(scen);
  const hero = d.hero_range?.classes?.join(",") || "";
  const auth = scen.villain_ranges?.[0]?.classes?.join(",") || "";
  const vill = auth || d.villain_range?.classes?.join(",") || "";
  return {
    hero,
    vill,
    heroCombos: countCombos(hero),
    villCombos: countCombos(vill),
    heroLen: hero.length,
    villLen: vill.length,
  };
}

// === Main ===

const buf = readFileSync(templatePath);
const tmpl = parseTemplate(buf);
const tmplHeroCombos = countCombos(tmpl.heroRange);
const tmplVillCombos = countCombos(tmpl.villRange);

console.log(`## Template: ${templatePath}\n`);
console.log(`  Hero range:    ${tmpl.heroRange.slice(0, 80)}${tmpl.heroRange.length > 80 ? "..." : ""}`);
console.log(`  Hero combos:   ${tmplHeroCombos}`);
console.log(`  Hero str len:  ${tmpl.heroRange.length} chars`);
console.log(`  Vill range:    ${tmpl.villRange.slice(0, 80)}${tmpl.villRange.length > 80 ? "..." : ""}`);
console.log(`  Vill combos:   ${tmplVillCombos}`);
console.log(`  Vill str len:  ${tmpl.villRange.length} chars`);
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

// === Byte-18 / byte-23 single-byte pointer cap ===
//
// Independent of combo budget: the scenario's range STRING LENGTH (not combo
// count) determines whether bytes 18/23 stay in [0,255]. See parseTemplate()
// for the formula. Long ranges with specific suited combos (e.g. AcKc, KhQh)
// can blow this cap on widely-substituted scenarios even when the combo
// budget is fine.

const overHeroLen = demands.filter((d) => d.heroLen > HERO_LEN_CAP);
const overVillLen = demands.filter((d) => d.villLen > VILL_LEN_CAP);
const heroLenCapOK = overHeroLen.length === 0;
const villLenCapOK = overVillLen.length === 0;

console.log("## Byte-pointer cap (independent of combo budget)\n");
console.log(`  Max hero string length demanded:  ${Math.max(...demands.map((d) => d.heroLen))} chars  (cap ${HERO_LEN_CAP})  ${heroLenCapOK ? "✅" : "❌"}`);
console.log(`  Max vill string length demanded:  ${Math.max(...demands.map((d) => d.villLen))} chars  (cap ${VILL_LEN_CAP})  ${villLenCapOK ? "✅" : "❌"}`);
console.log("");

if (overHeroLen.length) {
  console.log(`  ${overHeroLen.length} scenarios exceed hero string-length cap (would corrupt byte 18):`);
  for (const d of overHeroLen.slice(0, 10)) console.log(`    ${d.id.padEnd(45)} hero string = ${d.heroLen} chars > ${HERO_LEN_CAP}`);
  if (overHeroLen.length > 10) console.log(`    ...+${overHeroLen.length - 10} more`);
}
if (overVillLen.length) {
  console.log(`  ${overVillLen.length} scenarios exceed vill string-length cap (would corrupt byte 23):`);
  for (const d of overVillLen.slice(0, 10)) console.log(`    ${d.id.padEnd(45)} vill string = ${d.villLen} chars > ${VILL_LEN_CAP}`);
  if (overVillLen.length > 10) console.log(`    ...+${overVillLen.length - 10} more`);
}

console.log("");
const comboOK = maxHero <= tmplHeroCombos && maxVill <= tmplVillCombos;
const lenCapOK = heroLenCapOK && villLenCapOK;
if (comboOK && lenCapOK) {
  console.log("✅ Template covers all 45 scenarios — safe for batch generation.");
} else {
  if (!comboOK) {
    console.log("⚠ Template is too narrow for some scenarios — see combo-budget lists above.");
    console.log("  Re-save the template in GTO+ with wider hero+villain ranges:");
    if (maxHero > tmplHeroCombos) console.log(`    hero  ≥ ${maxHero} combos`);
    if (maxVill > tmplVillCombos) console.log(`    vill  ≥ ${maxVill} combos`);
  }
  if (!lenCapOK) {
    console.log("⚠ Some scenarios exceed the byte-18 / byte-23 single-byte pointer cap.");
    console.log("  These scenarios cannot be batch-generated cleanly with the current substitution scheme.");
    console.log("  Workarounds: shorten the affected scenarios' range definitions in data/scenarios.json");
    console.log("  (e.g. consolidate specific combos into broader hand classes), or rerun the");
    console.log("  controlled-corpus experiment (tpl-C series) to find a multi-byte length field.");
  }
  process.exit(1);
}
