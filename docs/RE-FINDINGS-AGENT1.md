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

## Status: STARTING

### Inputs available
- 5 library.txt backups in `C:/Users/mondr/Downloads/` (sizes 68285-75001)
- `C:/Program Files/GTO/config/library.txt` (68287 bytes) — current live
- `C:/Program Files/GTO/config/library.txt.bak` (75001 bytes)
- 31 solved .gto2 files in `solver-output/` (range of bet trees + boards)
- `template-max-15k.gto2` for empty-MAIN-TREE comparison

### First step
Diff the two library.txt files (68287 live vs 75001 .bak) to see what fields
change between them. If they have the same trees with different metadata,
that's free signal on which bytes are size-related.

(Updated incrementally — see commits.)
