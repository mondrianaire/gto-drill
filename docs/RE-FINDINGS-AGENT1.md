# Agent 1 (REVIVAL) — RE Findings

**Mission**: Solve binary structures for GTO+ batch generation.
**Started**: 2026-05-26 ~02:00. **Cap**: 2 hours.

---

## TL;DR

| Target | Status | Action |
|---|---|---|
| A: secondary length field in library.txt | ✅ CRACKED | Field doesn't exist. Removed harmful `@+18` write from emit script. |
| B: Block A range-index encoding | ❌ BLOCKED on samples | Cannot research from `solver-output/` — all those files share an identical template MAIN TREE. Need ≥2 actually-solved files with same bet tree + different ranges. |

---

## Target A: SOLVED ✅

### The fix (1 line, already applied)

`scripts/gto-library-emit.mjs` previously called:
```js
newEntry.writeUInt32LE(templateSizeField + netDelta, 18);
```
on every emitted entry. **This call was the bug.** I removed it (with a long
comment explaining why). Inherit `@+18` verbatim from the template instead.

### Why agent 2's hypothesis was wrong

Agent 2 saw "out of memory" on Quickload after a length-changing patch and
concluded there must be a secondary length field somewhere that needed to be
synced. There isn't. The OOM was caused by the **primary** `@+18` field
update being structurally wrong.

`@+18` is part of a **bet-tree config snapshot** that GTO+ takes at "Store
current tree" time. It is NOT a length pointer to anything inside the entry.
GTO+ never updates it during normal saves either — even when entry length
changes.

### How I verified

Two test-bb-monster snapshots from the user's machine:
- `C:/Users/mondr/Downloads/library.txt.backup-1779759231891` — saved with
  pot="10" (entry length 6828, `@+18` = 6764)
- `C:/Program Files/GTO/config/library.txt` — saved by GTO+ later after the
  user changed pot to "7.50" (entry length 6830, `@+18` = **still 6764**)

GTO+ itself did NOT update `@+18` when entry length grew. The script that
DID update it was making the entry diverge from what GTO+ would consider
"its own format".

I then ran `scripts/_tmp-lib-bisect.mjs --test=pot --skip-at18` to patch the
old backup with pot="7.50" without touching `@+18`. Result file:
`C:/Users/mondr/Downloads/library.txt`. Compared to GTO+'s live library:

```
diff <(xxd /c/Users/mondr/Downloads/library.txt) \
     <(xxd "/c/Program Files/GTO/config/library.txt")
# (empty — files are byte-for-byte identical)
```

Zero diff. This is the gold-standard proof that the patch is correct when
`@+18` is **NOT** touched.

### Tools shipped this session

| Path | Purpose |
|---|---|
| `scripts/_agent1-lib-dump.mjs` | Dump every entry's preamble, lp-strings, `@+18` |
| `scripts/_agent1-goldendiff.mjs` | Byte-diff same-name entry across two libraries |
| `scripts/_agent1-lib-fields.mjs` | Tabulate every u32 header field across all entries |
| `scripts/_agent1-lib-headerdiff.mjs` | Pairwise header diff between entries |
| `scripts/_agent1-at18-region.mjs` | Look at the byte region around `@+18` to find its real structural role |
| `scripts/_agent1-emit-noat18.mjs` | Build a two-entry test library to A/B test the fix |
| `scripts/_agent1-emitted-vs-original.mjs` | Compare emit-script output vs GTO+ save |
| `scripts/_agent1-test-at18.mjs` | Single-entry `@+18` mutation harness for direct testing |

### What's in Downloads right now for the user to test

Both files have two synthetic entries appended to GTO+'s current 5-entry library:

- `C:/Users/mondr/Downloads/library-noat18.txt` — `@+18` inherited (my proposed fix)
- `C:/Users/mondr/Downloads/library-update18.txt` — `@+18` updated (current broken behavior)

To validate the fix end-to-end:

1. Close GTO+
2. Copy `library-noat18.txt` → `C:\Program Files\GTO\config\library.txt`
   (rename to `library.txt` and accept UAC)
3. Open GTO+ → Quickload → look for `agent1-test-same-pot` and
   `agent1-test-grow-pot`
4. Click each → LOAD SELECTED TREE → confirm ranges/board/pot load cleanly

If both load → fix confirmed. If they OOM, the issue is something else and
my Target A finding needs revisiting. (But the byte-identical diff to
GTO+'s own save strongly predicts they will load fine.)

Note: the live library was modified at 01:23 by another agent. The
"library.txt" currently in `C:/Users/mondr/Downloads/` was overwritten by
my final `_agent1-emit-noat18.mjs` run. Use the explicitly-named
`library-noat18.txt` / `library-update18.txt` for the A/B test.

### Secondary discoveries while investigating

- **HEADER `count` field at file offset 32**: empirically GTO+ tolerates
  `count < actual tree count` (proven: count=4 with 5 trees loads fine,
  count=4 with 36 trees loads fine in `library-repaired.txt`). What it does
  NOT tolerate is the HEADER preamble bytesum mismatching the actual inner
  bytesum. The emit script already handles this correctly.
- **`entry.len - @+18`** is a consistent value per bet-tree mode:
  - test-bb-monster bet tree: 64 (Basic mode with custom raises)
  - Example 1 / Example 3 (Basic mode, default): 75
  - Example 2 / Example 4 (Advanced menu mode): 71
  - GTO+'s "5.5/16.75/40.5/90.0" Basic mode: 64
  This is consistent with `@+18` being a tree-mode-keyed marker, not a length.

---

## Target B: BLOCKED on samples ❌

### Why I can't research it from `solver-output/`

I built `scripts/_agent1-mt-pair-diff.mjs` to compare Block A bytes across
all 31 `.gto2` files in `solver-output/`. Finding:

```
Block A length distribution:
     536 bytes: 10 files  ← all river boards
    1094 bytes: 7 files   ← all turn boards
    2687 bytes: 14 files  ← all flop boards

Within each Block-A-length bucket: 100% common bytes (Block A IDENTICAL).
Within each Block-A-length bucket: 100% common bytes (Block B IDENTICAL too).
```

Every file in `solver-output/` with the same board street has a
**byte-identical MAIN TREE**. This confirms the
`gto-batch-generate.mjs` script bolts on the template's MAIN TREE
unchanged — these files are NOT actually solved against per-scenario
ranges. Only the HEADER section (ranges/board/pot/stack) differs.

So you can't learn anything about range encoding in Block A from these
samples, because Block A is the same in all of them.

### What we have for real GTO+-saved files

Three files at the repo root that ARE actually solved by GTO+:
- `data/test32.gto2` — 45931 bytes, Block A 432 B, hero range 116-char
  string, vill 102-char string, board Td9d6h, pot 33.00
- `data/test332.gto2` — 21838 bytes, Block A 1317 B, hero 10-char range
  (`KK,QTo,JTo`), vill 21-char range (`AA,JJ,JTs-J9s,KJo,QJo`), board
  Td9d6h, 3-bet tree
- `data/processed/test32.gto2` — byte-identical to `data/test32.gto2`

Three samples is not enough, and the bet tree varies between them (432 vs
1317 byte Block A means different action tree), so I can't isolate the
range-encoding bytes.

### Concrete unblock for Target B

To make progress, the user needs to manually save **2 controlled samples**
in GTO+:

**Sample 1**: bb-monster setup → solve → File→Save As → `tpl-B-fullrange.gto2`
- Use the test-bb-monster ranges (full deck)
- Solve to ~1% accuracy
- Save

**Sample 2**: Same setup, change ONLY Range 1 to a SUBSET:
- Click Range 1 → clear → enter just `AA,KK,QQ` (3 hands instead of 169)
- Leave Range 2 unchanged
- Click Build Tree → solve
- Save as `tpl-B-narrowrange.gto2`

These two samples have **identical bet tree** (so identical Block A length?)
and **identical Range 2** but **wildly different Range 1**. Diffing their
Block A bytes will reveal whether Block A is range-dependent (agent 5's
claim) or board/bet-tree-only (my partial evidence).

If Block A IS identical (or differs only by predictable boundary bytes),
then a tree-rewriter is feasible — patching ranges in Block B (where they
live as lp-strings) plus a tiny Block A adjustment would let us synthesize
solved-ish files programmatically.

If Block A differs unpredictably, the tree-compiler path is the only one,
and the user should plan for the 5-20 hr implementation.

### Recommendation for Target B

**Do not pursue inside this session.** Two manual GTO+ saves (5 min of user
time) would unblock it, but the user is at hour 11 and needs to sleep.
File a deferred task: "Save two controlled samples for Block A range-encoding
research", then a follow-up agent runs the diff in 15 min.

---

## Field map (revised, library.txt entries)

```
Preamble (16 bytes, OUTSIDE [TREE]):
  @0:  u32 LE — section length INCLUDING [TREE] + content + [/TREE]
  @8:  u32 LE — bytesum of content between tags (exclusive)

[TREE]                              6 bytes (literal tag)
  @+6:  u32 = 3                     format version
  @+10: u32 = 16                    sub-header size
  @+14: byte  (=35 / 42 / 46)       tree-mode flag (low byte of next u32)
  @+18: u32 — bet-tree config snapshot
        ★ NOT a length pointer. Inherit from template.
        Constant per tree-mode (test-bb-monster: 6764, Example 1: 6133, etc.)
  @+22-26: more bet-tree settings (vary by mode)
  ...
  @+57+: lp-string: entry name      (length-prefixed: 02 <u32 len> <bytes>)
  ...   lp-string: range 1
  ...   lp-string: range 2
  ...   lp-string: board
  ...   lp-strings: bet-tree sizings (5.500, 16.75, 40.50, 90.00, ...)
  ...   lp-strings: pot, stack, etc.
[/TREE]                             7 bytes (literal tag)
```

---

## Inputs available

- 5 library.txt backups in `C:/Users/mondr/Downloads/` (sizes 68285-75001)
- `C:/Program Files/GTO/config/library.txt` (68287 bytes) — current live
- `C:/Program Files/GTO/config/library.txt.bak` (75001 bytes)
- 31 synthesized `.gto2` files in `solver-output/` — useless for Block A
  research, only HEADER substitution
- 3 real GTO+-saved `.gto2` files in `data/` — insufficient sample for
  Block A research
- `template-max-15k.gto2` (root) — for empty-MAIN-TREE comparison

---

## Commits in this session

```
835977d Agent1 revival: starting state — TODO targets A and B
f3b9b7a Target A: @+18 is NOT a length field; golden diff proves emit script bug
        + _agent1-lib-dump, _agent1-goldendiff, _agent1-lib-fields,
          _agent1-lib-headerdiff
[next]  Agent1: pair-diff confirms solver-output MAIN TREEs are template-stubs
        + _agent1-mt-pair-diff
[next]  Agent1: remove harmful @+18 update from gto-library-emit.mjs
[next]  Agent1: final findings — Target A done, Target B blocked on samples
```
