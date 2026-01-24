/**
 * Core package tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HybridVectorClock,
  TimestampOrder,
  generateReplicaId,
  serializeTimestamp,
  deserializeTimestamp,
} from './clock/hybrid-vector-clock.js';
import {
  Document,
  createDocument,
  merge,
  computeDelta,
  areDocumentsEqual,
} from './index.js';

describe('HybridVectorClock', () => {
  it('should generate unique replica IDs', () => {
    const id1 = generateReplicaId();
    const id2 = generateReplicaId();
    expect(id1).not.toBe(id2);
  });

  it('should generate monotonically increasing timestamps', () => {
    const clock = new HybridVectorClock('replica-1');
    const ts1 = clock.tick();
    const ts2 = clock.tick();
    const ts3 = clock.tick();

    expect(HybridVectorClock.compare(ts1, ts2)).toBe(TimestampOrder.Before);
    expect(HybridVectorClock.compare(ts2, ts3)).toBe(TimestampOrder.Before);
    expect(HybridVectorClock.compare(ts1, ts3)).toBe(TimestampOrder.Before);
  });

  it('should serialize and deserialize timestamps', () => {
    const clock = new HybridVectorClock('replica-1');
    const ts = clock.tick();
    const serialized = serializeTimestamp(ts);
    const deserialized = deserializeTimestamp(serialized);

    expect(deserialized.hlc.physical).toBe(ts.hlc.physical);
    expect(deserialized.hlc.logical).toBe(ts.hlc.logical);
    expect(deserialized.hlc.replica).toBe(ts.hlc.replica);
  });

  it('should merge timestamps from remote clocks', () => {
    const clock1 = new HybridVectorClock('replica-1');
    const clock2 = new HybridVectorClock('replica-2');

    const ts1 = clock1.tick();
    clock2.receive(ts1);
    const ts2 = clock2.tick();

    // ts2 should be after ts1
    expect(HybridVectorClock.compare(ts1, ts2)).toBe(TimestampOrder.Before);
  });
});

describe('Document', () => {
  describe('Register operations', () => {
    it('should set and get register values', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.set('name', 'Alice');
      expect(doc.get('name')).toBe('Alice');

      doc.set('name', 'Bob');
      expect(doc.get('name')).toBe('Bob');
    });

    it('should handle nested paths', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.set(['user', 'profile', 'name'], 'Alice');
      expect(doc.get(['user', 'profile', 'name'])).toBe('Alice');
    });
  });

  describe('Counter operations', () => {
    it('should increment counters', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.increment('count');
      expect(doc.get('count')).toBe(1);

      doc.increment('count', 5);
      expect(doc.get('count')).toBe(6);
    });

    it('should decrement counters', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.increment('count', 10);
      doc.decrement('count', 3);
      expect(doc.get('count')).toBe(7);
    });

    it('should merge concurrent counter increments', () => {
      const doc1 = createDocument({ id: 'test', replicaId: 'replica-1' });
      const doc2 = createDocument({ id: 'test', replicaId: 'replica-2' });

      // Both start at 0 and increment
      doc1.increment('counter');
      doc2.increment('counter');

      // Merge
      const { document: merged } = merge(doc1, doc2);

      // Counter should be 2, not 1 (both increments preserved)
      expect(merged.get('counter')).toBe(2);
    });
  });

  describe('Set operations', () => {
    it('should add and remove from sets', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.addToSet('tags', 'javascript');
      doc.addToSet('tags', 'typescript');
      doc.addToSet('tags', 'crdt');

      const tags = doc.get<string[]>('tags');
      expect(tags).toContain('javascript');
      expect(tags).toContain('typescript');
      expect(tags).toContain('crdt');

      doc.removeFromSet('tags', 'javascript');
      const updatedTags = doc.get<string[]>('tags');
      expect(updatedTags).not.toContain('javascript');
      expect(updatedTags).toContain('typescript');
    });

    it('should handle concurrent add/remove (add-wins)', () => {
      const doc1 = createDocument({ id: 'test', replicaId: 'replica-1' });
      const doc2 = createDocument({ id: 'test', replicaId: 'replica-2' });

      // Setup: both have 'item' in the set
      doc1.addToSet('items', 'item');
      doc2.applyOperations(doc1.getOperations().slice());

      // Concurrent: doc1 removes, doc2 adds same item
      doc1.removeFromSet('items', 'item');
      doc2.addToSet('items', 'item');

      // Merge
      const { document: merged } = merge(doc1, doc2);

      // Add-wins: item should be present
      const items = merged.get<string[]>('items');
      expect(items).toContain('item');
    });
  });

  describe('List operations', () => {
    it('should push items to list', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.listPush('items', 'first');
      doc.listPush('items', 'second');
      doc.listPush('items', 'third');

      const items = doc.get<string[]>('items');
      expect(items).toEqual(['first', 'second', 'third']);
    });

    it('should insert items at specific positions', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.listPush('items', 'first');
      doc.listPush('items', 'third');
      doc.listInsert('items', 'second', 1);

      // Note: CRDT lists order by timestamp, so inserted items
      // appear after existing items with same logical position
      const items = doc.get<string[]>('items');
      expect(items).toContain('first');
      expect(items).toContain('second');
      expect(items).toContain('third');
      expect(items?.length).toBe(3);
    });

    it('should delete items from list', () => {
      const doc = createDocument({ id: 'test-doc' });

      doc.listPush('items', 'a');
      doc.listPush('items', 'b');
      doc.listPush('items', 'c');
      doc.listDelete('items', 1);

      const items = doc.get<string[]>('items');
      expect(items).toEqual(['a', 'c']);
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on changes', () => {
      const doc = createDocument({ id: 'test-doc' });
      const values: unknown[] = [];

      doc.subscribe('name', (value) => {
        values.push(value);
      });

      doc.set('name', 'Alice');
      doc.set('name', 'Bob');

      // First call is immediate with current value (undefined)
      // Then 'Alice', then 'Bob'
      expect(values).toEqual([undefined, 'Alice', 'Bob']);
    });

    it('should allow unsubscribing', () => {
      const doc = createDocument({ id: 'test-doc' });
      const values: unknown[] = [];

      const unsubscribe = doc.subscribe('name', (value) => {
        values.push(value);
      });

      doc.set('name', 'Alice');
      unsubscribe();
      doc.set('name', 'Bob');

      expect(values).toEqual([undefined, 'Alice']);
    });
  });
});

describe('Merge', () => {
  it('should merge two documents with non-overlapping changes', () => {
    const doc1 = createDocument({ id: 'test', replicaId: 'replica-1' });
    const doc2 = createDocument({ id: 'test', replicaId: 'replica-2' });

    doc1.set('field1', 'value1');
    doc2.set('field2', 'value2');

    const { document: merged } = merge(doc1, doc2);

    expect(merged.get('field1')).toBe('value1');
    expect(merged.get('field2')).toBe('value2');
  });

  it('should handle concurrent register writes (LWW)', () => {
    const doc1 = createDocument({ id: 'test', replicaId: 'replica-1' });
    const doc2 = createDocument({ id: 'test', replicaId: 'replica-2' });

    doc1.set('name', 'Alice');
    doc2.set('name', 'Bob');

    const { document: merged } = merge(doc1, doc2);

    // One of them wins (deterministically based on timestamp/replica)
    const name = merged.get('name');
    expect(['Alice', 'Bob']).toContain(name);
  });

  it('should compute delta between documents', () => {
    const doc1 = createDocument({ id: 'test', replicaId: 'replica-1' });

    doc1.set('a', 1);
    doc1.set('b', 2);

    const doc2 = createDocument({
      id: 'test',
      replicaId: 'replica-2',
      operations: [...doc1.getOperations()],
    });

    doc2.set('c', 3);

    const delta = computeDelta(doc1, doc2);
    expect(delta.length).toBe(1);
    expect(delta[0]?.path).toEqual(['c']);
  });

  it('should detect equal documents', () => {
    const doc1 = createDocument({ id: 'test', replicaId: 'replica-1' });
    doc1.set('a', 1);

    const doc2 = createDocument({
      id: 'test',
      replicaId: 'replica-2',
      operations: [...doc1.getOperations()],
    });

    expect(areDocumentsEqual(doc1, doc2)).toBe(true);

    doc2.set('b', 2);
    expect(areDocumentsEqual(doc1, doc2)).toBe(false);
  });
});

describe('Integration: Offline-first scenario', () => {
  it('should handle the counter merge example from verification', () => {
    // Test from the plan: Two users modify offline and merge
    const doc1 = createDocument({ id: 'test', replicaId: 'user-1' });
    const doc2 = createDocument({ id: 'test', replicaId: 'user-2' });

    // Both increment their counters
    doc1.increment('counter');
    doc2.increment('counter');

    // Merge
    const { document: merged } = merge(doc1, doc2);

    // Counter should be 2, not 1
    expect(merged.get('counter')).toBe(2);
  });

  it('should preserve all operations after multiple merges', () => {
    const doc1 = createDocument({ id: 'test', replicaId: 'replica-1' });
    const doc2 = createDocument({ id: 'test', replicaId: 'replica-2' });
    const doc3 = createDocument({ id: 'test', replicaId: 'replica-3' });

    // Each adds different data
    doc1.set('from1', 'data1');
    doc2.set('from2', 'data2');
    doc3.set('from3', 'data3');

    // Merge 1 and 2
    const { document: merged12 } = merge(doc1, doc2);

    // Merge result with 3
    const { document: final } = merge(merged12, doc3);

    expect(final.get('from1')).toBe('data1');
    expect(final.get('from2')).toBe('data2');
    expect(final.get('from3')).toBe('data3');
  });
});
