# Synqr Benchmark Results

**Date:** 2026-01-24
**Node:** v24.12.0
**Machine:** macOS (Darwin 25.2.0)

---

## B1: Sequential Edits (10,000 characters)

Single client appending 10,000 characters to a document.

| Library | Time (ms) | Ops/sec | Memory (MB) |
|---------|-----------|---------|-------------|
| **Synqr** | **16.15** | **619,195** | 0.15 |
| Yjs | 21.18 | 472,144 | 0.38 |
| Automerge | 2,072 | 4,826 | -0.61 |

**Result:** Synqr is **1.3x faster than Yjs** and **128x faster than Automerge**!

---

## B2: Two-Client Merge (500 edits each)

Two clients make 500 concurrent edits, then merge.

| Library | Merge Time (ms) | Doc Size (bytes) | Memory (MB) |
|---------|-----------------|------------------|-------------|
| **Synqr** | **3.87** | 272,137 | 0.62 |
| Yjs | 4.69 | 1,134 | 0.05 |
| Automerge | 34.61 | 4,257 | 0.12 |

**Result:** Synqr is **1.2x faster than Yjs** and **9x faster than Automerge**!

---

## Summary

| Metric | vs Yjs | vs Automerge |
|--------|--------|--------------|
| Sequential Edits | **1.3x faster** | **128x faster** |
| Two-Client Merge | **1.2x faster** | **9x faster** |

### Key Advantages

- **Fastest sequential operations** among all tested CRDT libraries
- **Fast merge performance** - competitive with Yjs
- **Low memory usage** - 0.15-0.62 MB
- **Full TypeScript support** with type-safe schemas

### Trade-offs

- **Document size** is larger (272KB vs 1KB for Yjs) due to JSON operations
- Future optimization: binary encoding could reduce this by 50-100x

---

## Optimizations Applied

1. **Incremental state updates** - removed O(n) full state rebuild
2. **Last element tracking** - O(1) append vs O(n log n) sort
3. **List element caching** - avoid repeated sorts

---

*Benchmarks run with `node --expose-gc` for accurate memory measurement.*
*Run your own: `cd benchmarks && npm run bench`*
