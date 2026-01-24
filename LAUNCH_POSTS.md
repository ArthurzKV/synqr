# Synqr Launch Posts

Copy-paste these to share Synqr with the world.

---

## Hacker News (Show HN)

**Title:** Show HN: Synqr – CRDT library faster than Yjs with full TypeScript support

**Text:**
```
I built Synqr, a CRDT library for offline-first collaborative apps.

Benchmarks (10K operations):
- Synqr: 16ms
- Yjs: 21ms
- Automerge: 2,072ms

Key features:
- 1.3x faster than Yjs on sequential edits
- Full TypeScript with schema inference
- Declarative schemas (like Zod for CRDTs)
- Plugin architecture for sync/storage

Example:
  const doc1 = createDocument({ id: 'doc', replicaId: 'device-a' });
  const doc2 = createDocument({ id: 'doc', replicaId: 'device-b' });

  doc1.set('title', 'Hello');
  doc2.increment('views');

  const { document: merged } = merge(doc1, doc2);
  // Both changes preserved!

GitHub: https://github.com/ArthurzKV/synqr

Would love feedback on the API design and what features you'd need.
```

---

## Reddit r/typescript

**Title:** I built a CRDT library that's faster than Yjs with full TypeScript inference

**Text:**
```
After being frustrated with the TypeScript experience in Yjs (no native types) and Automerge (slow), I built Synqr.

**Performance:**
- 1.3x faster than Yjs
- 128x faster than Automerge

**TypeScript Features:**
- Schema inference (define schema, get types automatically)
- Type-safe document API
- No manual type annotations needed

```typescript
import { defineSchema, t } from '@synqr-schema';

const TaskSchema = defineSchema({
  name: 'Task',
  version: 1,
  fields: {
    title: t.lww.string(),
    done: t.lww.boolean({ default: false }),
    tags: t.set.string(),
  },
});

// TypeScript knows the shape automatically!
```

GitHub: https://github.com/ArthurzKV/synqr

What features would make this useful for your projects?
```

---

## Reddit r/javascript

**Title:** Synqr: A new CRDT library that beats Yjs on performance benchmarks

**Text:**
```
Just released Synqr v0.1.0 - a CRDT library for building apps like Notion, Google Docs, or Figma.

**What's a CRDT?**
Data structures that automatically merge without conflicts. Edit offline, sync later, never lose data.

**Why Synqr?**
| Benchmark | Synqr | Yjs | Automerge |
|-----------|-----------|-----|-----------|
| 10K operations | 16ms | 21ms | 2,072ms |

**Features:**
- Registers (LWW, multi-value)
- Counters (grow-only, positive-negative)
- Sets & Maps (add-wins)
- Lists (Fugue algorithm)
- Rich text

**Example:**
```javascript
const doc1 = createDocument({ id: 'doc', replicaId: 'phone' });
const doc2 = createDocument({ id: 'doc', replicaId: 'laptop' });

// Edit on phone (offline)
doc1.listPush('todos', 'Buy milk');

// Edit on laptop (offline)
doc2.listPush('todos', 'Call mom');

// Sync later - both items preserved!
const { document } = merge(doc1, doc2);
doc.get('todos'); // ['Buy milk', 'Call mom']
```

GitHub: https://github.com/ArthurzKV/synqr
```

---

## Twitter/X Thread

```
🚀 Just released Synqr - a CRDT library that's faster than Yjs

Benchmarks:
- Synqr: 16ms
- Yjs: 21ms
- Automerge: 2,072ms

Full TypeScript support with schema inference.

Thread 🧵

---

1/ What's a CRDT?

Data structures that automatically merge without conflicts.

Edit offline on your phone ✈️
Edit on your laptop 💻
Sync later - nothing lost ✅

Powers apps like Notion, Figma, Linear.

---

2/ Why I built Synqr:

❌ Yjs has no native TypeScript types
❌ Automerge is slow (2 seconds for 10K ops!)
❌ No declarative schema system

✅ Synqr fixes all of this

---

3/ The API is simple:

const doc = createDocument({ id: 'doc' });

doc.set('title', 'Hello');
doc.increment('views');
doc.addToSet('tags', 'typescript');
doc.listPush('items', 'first');

All operations are conflict-free.

---

4/ Schema inference:

const Schema = defineSchema({
  fields: {
    title: t.lww.string(),
    count: t.counter(),
  }
});

TypeScript knows your document shape automatically. No manual types!

---

5/ Try it:

npm install @synqr-core

GitHub: github.com/ArthurzKV/synqr

Star ⭐ if you find it useful!

What features would you need? Reply below 👇
```

---

## Dev.to Article

**Title:** I Built a CRDT Library That's Faster Than Yjs - Here's How

**Tags:** typescript, javascript, opensource, webdev

```markdown
# I Built a CRDT Library That's Faster Than Yjs

Last week I released [Synqr](https://github.com/ArthurzKV/synqr), a CRDT library for building collaborative apps. It's faster than Yjs and has full TypeScript support.

## What Are CRDTs?

CRDTs (Conflict-free Replicated Data Types) are data structures that can be edited on multiple devices and merged without conflicts.

Think about Google Docs - multiple people typing at once, and it just works. That's CRDTs.

## The Problem with Existing Libraries

**Yjs** - Fast, but no native TypeScript types. You're on your own.

**Automerge** - Nice API, but slow. 2 seconds for 10,000 operations.

## Synqr Benchmarks

| Library | 10K Operations |
|---------|---------------|
| Synqr | 16ms |
| Yjs | 21ms |
| Automerge | 2,072ms |

## How It Works

```typescript
import { createDocument, merge } from '@synqr-core';

// Create documents on different devices
const phone = createDocument({ id: 'todo', replicaId: 'phone' });
const laptop = createDocument({ id: 'todo', replicaId: 'laptop' });

// Edit offline on phone
phone.listPush('items', 'Buy milk');
phone.set('lastEdited', 'phone');

// Edit offline on laptop
laptop.listPush('items', 'Call mom');
laptop.set('lastEdited', 'laptop');

// Merge when back online
const { document } = merge(phone, laptop);

document.get('items');      // ['Buy milk', 'Call mom'] - both preserved!
document.get('lastEdited'); // One wins (last-writer-wins)
```

## TypeScript Integration

```typescript
import { defineSchema, t } from '@synqr-schema';

const TaskSchema = defineSchema({
  name: 'Task',
  version: 1,
  fields: {
    title: t.lww.string(),
    done: t.lww.boolean({ default: false }),
    priority: t.counter(),
    tags: t.set.string(),
  },
});

// TypeScript infers the type automatically!
```

## Try It

```bash
npm install @synqr-core
```

GitHub: https://github.com/ArthurzKV/synqr

Would love your feedback!
```

---

## LinkedIn Post

```
🚀 Excited to announce Synqr v0.1.0!

I built a CRDT library that's faster than Yjs (the current standard) with full TypeScript support.

What are CRDTs? They power real-time collaboration in apps like:
• Notion
• Figma
• Linear
• Google Docs

The key insight: data structures that merge automatically without conflicts.

Performance benchmarks:
• Synqr: 16ms (10K operations)
• Yjs: 21ms
• Automerge: 2,072ms

Key features:
✅ 1.3x faster than Yjs
✅ Full TypeScript with schema inference
✅ Declarative schemas
✅ Plugin architecture

GitHub: https://github.com/ArthurzKV/synqr

If you're building collaborative software, I'd love your feedback!

#opensource #typescript #javascript #webdev #collaboration
```
