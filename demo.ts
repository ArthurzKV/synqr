/**
 * SyncForge Demo
 *
 * This demo shows the key features of SyncForge:
 * 1. Schema-based document creation
 * 2. Offline-first operations
 * 3. Conflict-free merging
 * 4. Real-time sync
 */

import { Document, createDocument, merge } from '@syncforge/core';
import { defineSchema, t, type InferSchemaType } from '@syncforge/schema';
import {
  SyncForge,
  createSyncForge,
  createInMemoryPlugin,
} from '@syncforge/sync';

// ============================================
// 1. Define your schema
// ============================================

const ProjectSchema = defineSchema({
  name: 'Project',
  version: 1,
  types: {
    title: t.lww.string(),
    description: t.lww.string(),
    tasks: t.list(t.object({
      id: t.lww.string(),
      title: t.lww.string(),
      done: t.lww.boolean(),
    })),
    members: t.set.string(),
    viewCount: t.pnCounter(),
  },
});

// TypeScript automatically infers the type from the schema
type Project = InferSchemaType<typeof ProjectSchema>;

// ============================================
// 2. Basic usage with SyncForge
// ============================================

async function basicUsageDemo() {
  console.log('=== Basic Usage Demo ===\n');

  // Create SyncForge instance with in-memory persistence
  const forge = createSyncForge({
    schemas: [ProjectSchema],
    plugins: [createInMemoryPlugin()],
    autoConnect: false, // No network for this demo
  });

  // Create a new document
  const project = await forge.create(ProjectSchema, {
    data: {
      title: 'My Awesome Project',
      description: 'A collaborative project',
    },
  });

  console.log('Created project:', project.id);
  console.log('Title:', project.get('title'));

  // Modify the document
  project.set('title', 'Updated Project Title');
  project.increment('viewCount', 1);

  // Work with lists
  project.at('tasks').push({
    id: '1',
    title: 'First task',
    done: false,
  });

  project.at('tasks').push({
    id: '2',
    title: 'Second task',
    done: false,
  });

  // Work with sets
  project.addToSet('members', 'alice@example.com');
  project.addToSet('members', 'bob@example.com');

  console.log('\nFinal state:');
  console.log(JSON.stringify(project.getData(), null, 2));

  // Subscribe to changes
  const unsubscribe = project.subscribe('title', (value) => {
    console.log('Title changed to:', value);
  });

  project.set('title', 'Another update');

  unsubscribe();

  await forge.destroy();
}

// ============================================
// 3. Offline-first & Merge Demo
// ============================================

async function offlineMergeDemo() {
  console.log('\n=== Offline Merge Demo ===\n');

  // Simulate two users working offline
  const doc1 = createDocument({ id: 'project-1', replicaId: 'user-alice' });
  const doc2 = createDocument({ id: 'project-1', replicaId: 'user-bob' });

  // Alice makes changes offline
  console.log('Alice working offline...');
  doc1.set('title', 'Alice\'s title');
  doc1.increment('viewCount', 1);
  doc1.addToSet('members', 'alice@example.com');

  // Bob makes changes offline
  console.log('Bob working offline...');
  doc2.set('title', 'Bob\'s title');
  doc2.increment('viewCount', 1);
  doc2.addToSet('members', 'bob@example.com');

  // They come back online and merge
  console.log('\nMerging changes...');
  const { document: merged, conflicts } = merge(doc1, doc2, { trackConflicts: true });

  console.log('\nMerged result:');
  console.log('- Title:', merged.get('title'), '(LWW: one wins)');
  console.log('- View count:', merged.get('viewCount'), '(Counter: both add up!)');
  console.log('- Members:', merged.get('members'), '(Set: both included)');

  if (conflicts.length > 0) {
    console.log('\nDetected conflicts:', conflicts.length);
  }
}

// ============================================
// 4. Counter Demo (CRDT magic)
// ============================================

async function counterDemo() {
  console.log('\n=== Counter Demo ===\n');
  console.log('Demonstrating why CRDTs matter for counters:\n');

  // Without CRDTs (naive approach would lose increments)
  console.log('Scenario: Alice and Bob both increment a counter offline');

  const aliceDoc = createDocument({ id: 'counter-test', replicaId: 'alice' });
  const bobDoc = createDocument({ id: 'counter-test', replicaId: 'bob' });

  // Both start at 0 and increment
  aliceDoc.increment('likes');
  console.log('Alice increments: 0 -> 1');

  bobDoc.increment('likes');
  console.log('Bob increments: 0 -> 1');

  // Merge
  const { document: merged } = merge(aliceDoc, bobDoc);

  console.log('\nAfter merge:');
  console.log('Counter value:', merged.get('likes'));
  console.log('Expected: 2 (not 1!)');
  console.log('Result:', merged.get('likes') === 2 ? 'CORRECT!' : 'ERROR');
}

// ============================================
// 5. List Operations Demo
// ============================================

async function listDemo() {
  console.log('\n=== List Operations Demo ===\n');

  const doc = createDocument({ id: 'list-test', replicaId: 'user-1' });

  // Add items to list
  doc.listPush('items', 'First');
  doc.listPush('items', 'Second');
  doc.listPush('items', 'Third');

  console.log('Initial list:', doc.get('items'));

  // Insert in the middle
  doc.listInsert('items', 'Inserted', 1);
  console.log('After insert at index 1:', doc.get('items'));

  // Delete an item
  doc.listDelete('items', 2);
  console.log('After delete at index 2:', doc.get('items'));
}

// ============================================
// 6. Schema Type Inference Demo
// ============================================

function typeInferenceDemo() {
  console.log('\n=== Type Inference Demo ===\n');
  console.log('The schema system provides full TypeScript type safety:\n');

  const UserSchema = defineSchema({
    name: 'User',
    version: 1,
    types: {
      email: t.lww.string(),
      age: t.lww.number(),
      preferences: t.object({
        theme: t.lww.string(),
        notifications: t.lww.boolean(),
      }),
      roles: t.set.string(),
    },
  });

  // TypeScript knows the exact shape
  type User = InferSchemaType<typeof UserSchema>;

  // This is type-safe!
  const userData: User = {
    email: 'user@example.com',
    age: 25,
    preferences: {
      theme: 'dark',
      notifications: true,
    },
    roles: ['admin', 'user'],
  };

  console.log('User data:', JSON.stringify(userData, null, 2));
  console.log('\nTypeScript prevents invalid data at compile time!');
}

// ============================================
// Run all demos
// ============================================

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║        SyncForge Demo                     ║');
  console.log('║   Next-Generation CRDT Library            ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  await basicUsageDemo();
  await offlineMergeDemo();
  await counterDemo();
  await listDemo();
  typeInferenceDemo();

  console.log('\n=== Demo Complete ===');
  console.log('\nKey takeaways:');
  console.log('1. Schema-first design with full TypeScript inference');
  console.log('2. Automatic conflict resolution (LWW, Counters, Sets)');
  console.log('3. Offline-first: changes merge correctly when reconnecting');
  console.log('4. No data loss: concurrent operations are preserved');
}

main().catch(console.error);
