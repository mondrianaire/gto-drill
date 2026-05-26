# Agent 1 (REVIVAL) — RE Findings

**Mission**: Solve binary structures for GTO+ batch generation.
Two targets:
- **Target A** — secondary length field in `library.txt` entries that causes
  Quickload OOM when pot/stack length changes
- **Target B** — Block A range-index encoding inside `.gto2` MAIN TREE, to
  determine if a tree-rewriter (cheap) is feasible vs a tree-compiler
  (5-20 hr)

**Started**: 2026-05-26 02:00 (approx)
**Hard cap**: 2 hours
**Predecessor context**: See agent 5's MAIN TREE Block A/B characterization
and agent 2's library.txt OOM/load-failure observations in CLAUDE.md context.

---

## Status: TARGET A CRACKED — agent 2's premise was wrong

### TL;DR — actionable fix

**The `@+18` field in library.txt entries is NOT a length field.** Agent 2
hypothesized that variable-length lp-string patches (pot "10" → "7.50") OOM'd
Quickload because of an unfound "secondary length field". The real cause:
agent 2's `gto-library-emit.mjs` script UPDATES `@+18` on every patch, but
GTO+ itself **never updates `@+18` on lp-string changes**. Updating it
corrupts the entry.

**Concrete fix**: in `scripts/gto-library-emit.mjs`, line 280:
```js
newEntry.writeUInt32LE(newSizeField, HEADER_SIZE_FIELD_OFF);
```
**Remove this line entirely** (and the comment explaining it). The
`@+18` field is part of a bet-tree config snapshot, not an entry size
pointer. Inherit it verbatim from the template.

### How I verified — the golden diff

GTO+ wrote test-bb-monster with pot="10" (entry length 6828) on
2026-05-25 19:47. Then the user changed the pot to "7.50" in the GTO+
UI and the program saved it (live file, entry length 6830).

Diffing those two byte-by-byte (`scripts/_agent1-goldendiff.mjs`):
- Delta: +2 bytes (matches "10"→"7.50" length change exactly)
- Preamble outside [TREE]: length 6828→6830, bytesum 433550→433657 ✓
- Inside the entry header (offsets 0-100): **ZERO fields changed**.
  Specifically `@+18 = 6764` in BOTH. GTO+ did not touch it.
- Only the lp-string itself at offset 900 changed (length byte 0x02→0x04
  and the data bytes shifted) — everything else from offset 905 onwards is
  the same content, just shifted +2 positions.

Then I patched the OLD backup with `_tmp-lib-bisect.mjs --test=pot
--skip-at18` and the resulting file is **byte-for-byte identical** to
GTO+'s live library. Zero diff. `diff <(xxd patched) <(xxd live)`
returns no output. This is the gold-standard proof that the patch is
correct WITHOUT updating @+18.

### Implication for the emit script

The current `gto-library-emit.mjs` flow:
1. Find lp-strings in template (✓ correct)
2. Patch each lp-string with new content (✓ correct)
3. Update entry's `@+18` field with `templateSize + netDelta` (❌ WRONG)
4. Compute new preamble with section length + bytesum (✓ correct)

Step 3 is causing the OOM. Removing step 3 should fix length-changing
patches across the board.

### Field map for library.txt entries (revised)

```
[TREE]                                    @0   6 bytes  (literal tag)
@+6:   u32 = 3                            format version
@+10:  u32 = 16                           sub-header size
@+14:  some byte+u32                      tree-mode flags (varies: 35/42/46)
@+18:  u32 — bet-tree-config snapshot     ★ NOT an entry length pointer
       (constant value for a given tree mode; inherit verbatim)
...    additional bet-tree settings, varies by mode
@+XX:  lp-string: entry name              first 0x02-marker lp-string
...    range1 lp, range2 lp, board lp,
       bet-tree sizings (cascade of 02 NN 00 00 00 "..." lp-strings),
       pot lp, stack lp, etc.
[/TREE]                                   7 bytes  (literal tag)
```

### What I did NOT verify (yet)
- That entry 5+ (scenario-* entries) in `library-repaired.txt` are correctly
  formed — that file is from agent 2's emit script and may have @+18 wrong.
  Will check next.
- That removing @+18 update lets the **multi-entry** emit script (35 entries
  with all sorts of pot/stack lengths) load cleanly. Need to test by editing
  the script and asking user to load.

---

## Inputs available
- 5 library.txt backups in `C:/Users/mondr/Downloads/` (sizes 68285-75001)
- `C:/Program Files/GTO/config/library.txt` (68287 bytes) — current live
- `C:/Program Files/GTO/config/library.txt.bak` (75001 bytes)
- 31 solved .gto2 files in `solver-output/` (range of bet trees + boards)
- `template-max-15k.gto2` for empty-MAIN-TREE comparison

(Updated incrementally — see commits.)
