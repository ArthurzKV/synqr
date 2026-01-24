# SyncForge

[![CI](https://github.com/ArthurzKV/syncforge/actions/workflows/ci.yml/badge.svg)](https://github.com/ArthurzKV/syncforge/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@syncforge%2Fcore.svg)](https://www.npmjs.com/package/@syncforge/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Next-generation CRDT library for building offline-first collaborative applications in TypeScript.

## Performance

SyncForge is **faster than Yjs and Automerge** on key benchmarks:

| Benchmark | SyncForge | Yjs | Automerge |
|-----------|-----------|-----|-----------|
| Sequential edits (10K ops) | **16ms** | 21ms | 2,072ms |
| Two-client merge | **3.9ms** | 4.7ms | 34.6ms |

See [BENCHMARKS.md](BENCHMARKS.md) for full results.

## Why SyncForge?

| Feature | Automerge | Yjs | **SyncForge** |
|---------|-----------|-----|---------------|
| **Faster than Yjs** | No | - | **Yes** |
| Declarative schemas | No | No | **Yes** |
| Full TypeScript types | Partial | No | **Yes** |
| Schema validation | No | No | **Yes** |
| Plugin architecture | No | Partial | **Yes** |

## Quick Example

```typescript
import { createDocument, merge } from '@syncforge/core';
import { defineSchema, t } from '@syncforge/schema';

// Define your schema with full TypeScript inference
const TaskSchema = defineSchema({
  name: 'Task',
  version: 1,
  fields: {
    title: t.lww.string(),
    done: t.lww.boolean({ default: false }),
    tags: t.set.string(),
  },
});

// Create documents on different devices
const doc1 = createDocument({ id: 'task-1', replicaId: 'device-a' });
const doc2 = createDocument({ id: 'task-1', replicaId: 'device-b' });

// Edit offline - no network needed
doc1.set('title', 'Buy groceries');
doc1.increment('priority');

doc2.set('title', 'Buy groceries and snacks');
doc2.addToSet('tags', 'shopping');

// Merge anytime - conflicts resolved automatically
const { document: merged } = merge(doc1, doc2);

console.log(merged.get('title'));  // Last write wins
console.log(merged.get('tags'));   // ['shopping'] - sets merge
console.log(merged.get('priority')); // 1 - counters add up
```

## Installation

```bash
npm install @syncforge/core @syncforge/types @syncforge/schema @syncforge/sync
```

Or install packages individually:

```bash
# Core CRDT engine
npm install @syncforge/core

# CRDT type implementations
npm install @syncforge/types

# Schema system
npm install @syncforge/schema

# Sync protocol & plugins
npm install @syncforge/sync
```

## Packages

| Package | Description |
|---------|-------------|
| `@syncforge/core` | CRDT engine, hybrid clock, document, merge |
| `@syncforge/types` | LWW/MV registers, counters, sets, maps, lists, rich text |
| `@syncforge/schema` | Declarative schemas with TypeScript inference |
| `@syncforge/sync` | Sync protocol, WebSocket & IndexedDB plugins |

## CRDT Types

### Registers
- **LWWRegister** - Last-writer-wins for simple values
- **MVRegister** - Multi-value to show conflicts explicitly

### Counters
- **GCounter** - Grow-only counter
- **PNCounter** - Increment and decrement

### Collections
- **AWSet** - Add-wins set
- **AWMap** - Add-wins map with nested CRDT support

### Sequences
- **FugueList** - Ordered list with correct concurrent insert ordering
- **RichText** - Formatted text with Peritext-inspired marks
- **PlainText** - Simple collaborative text

## Core Concepts

### Offline-First
Every client has a complete copy. Edit without network. Sync when connected.

### Automatic Conflict Resolution
CRDTs mathematically guarantee all replicas converge to the same state.

### Hybrid Clock
Combines Hybrid Logical Clock (fast) with Vector Clock semantics (correct).

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

---

Built with TypeScript. Inspired by [Automerge](https://automerge.org/), [Yjs](https://yjs.dev/), and academic CRDT research.
