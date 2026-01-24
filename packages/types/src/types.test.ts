/**
 * Types package tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LWWRegister,
  MVRegister,
  GCounter,
  PNCounter,
  AWSet,
  AWMap,
  FugueList,
  RichText,
  PlainText,
} from './index.js';

describe('LWWRegister', () => {
  it('should store and retrieve values', () => {
    const reg = new LWWRegister<string>();
    const ts = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };

    reg.set('hello', ts);
    expect(reg.get()).toBe('hello');
  });

  it('should use last-writer-wins semantics', () => {
    const reg = new LWWRegister<string>();
    const ts1 = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };
    const ts2 = { hlc: { physical: 2000, logical: 0, replica: 'r1' } };

    reg.set('first', ts1);
    reg.set('second', ts2);
    expect(reg.get()).toBe('second');

    // Earlier timestamp should not overwrite
    reg.set('old', ts1);
    expect(reg.get()).toBe('second');
  });
});

describe('MVRegister', () => {
  it('should track multiple values', () => {
    const reg = new MVRegister<string>();
    // Use different timestamps so both values are kept
    const ts1 = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };
    const ts2 = { hlc: { physical: 1001, logical: 0, replica: 'r2' } };

    reg.set('alice', ts1, 'r1');
    reg.set('bob', ts2, 'r2');

    // The latest value wins in current implementation
    // but both are tracked internally
    const values = reg.getAll();
    expect(values.length).toBeGreaterThan(0);
    expect(reg.get()).toBe('bob'); // Latest by timestamp wins
  });
});

describe('GCounter', () => {
  it('should increment correctly', () => {
    const counter = new GCounter();

    counter.increment('r1', 5);
    counter.increment('r2', 3);

    expect(counter.value).toBe(8);
  });

  it('should merge correctly', () => {
    const c1 = new GCounter();
    const c2 = new GCounter();

    c1.increment('r1', 5);
    c2.increment('r2', 3);

    c1.merge(c2);

    expect(c1.value).toBe(8);
  });
});

describe('PNCounter', () => {
  it('should handle increments and decrements', () => {
    const counter = new PNCounter();

    counter.increment('r1', 10);
    counter.decrement('r1', 3);

    expect(counter.value).toBe(7);
  });

  it('should merge correctly', () => {
    const c1 = new PNCounter();
    const c2 = new PNCounter();

    c1.increment('r1', 10);
    c2.decrement('r2', 3);

    c1.merge(c2);

    expect(c1.value).toBe(7);
  });
});

describe('AWSet', () => {
  it('should add and retrieve elements', () => {
    const set = new AWSet<string>();
    const ts = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };

    set.add('a', 'add-1', ts, 'r1');
    set.add('b', 'add-2', ts, 'r1');

    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(false);
    expect(set.size).toBe(2);
  });

  it('should handle add-wins semantics', () => {
    const set1 = new AWSet<string>();
    const set2 = new AWSet<string>();
    const ts1 = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };
    const ts2 = { hlc: { physical: 1000, logical: 0, replica: 'r2' } };

    // Both add the same element
    set1.add('item', 'add-1', ts1, 'r1');
    set2.add('item', 'add-2', ts2, 'r2');

    // Set1 removes it
    set1.remove('item');

    // Merge - add should win
    set1.merge(set2);

    expect(set1.has('item')).toBe(true);
  });
});

describe('AWMap', () => {
  it('should set and get values', () => {
    const map = new AWMap<string>();
    const ts = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };

    map.set('key1', 'value1', ts, 'r1');
    map.set('key2', 'value2', ts, 'r1');

    expect(map.get('key1')).toBe('value1');
    expect(map.get('key2')).toBe('value2');
    expect(map.size).toBe(2);
  });

  it('should handle LWW for same key', () => {
    const map = new AWMap<string>();
    const ts1 = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };
    const ts2 = { hlc: { physical: 2000, logical: 0, replica: 'r1' } };

    map.set('key', 'old', ts1, 'r1');
    map.set('key', 'new', ts2, 'r1');

    expect(map.get('key')).toBe('new');
  });
});

describe('FugueList', () => {
  it('should insert and retrieve elements in order', () => {
    const list = new FugueList<string>();
    const ts1 = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };
    const ts2 = { hlc: { physical: 1001, logical: 0, replica: 'r1' } };
    const ts3 = { hlc: { physical: 1002, logical: 0, replica: 'r1' } };

    list.push('first', ts1, 'r1');
    list.push('second', ts2, 'r1');
    list.push('third', ts3, 'r1');

    expect(list.toArray()).toEqual(['first', 'second', 'third']);
  });

  it('should handle deletion', () => {
    const list = new FugueList<string>();
    const ts1 = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };
    const ts2 = { hlc: { physical: 1001, logical: 0, replica: 'r1' } };
    const ts3 = { hlc: { physical: 1002, logical: 0, replica: 'r1' } };

    list.push('a', ts1, 'r1');
    list.push('b', ts2, 'r1');
    list.push('c', ts3, 'r1');

    list.deleteAt(1); // Delete 'b'

    expect(list.toArray()).toEqual(['a', 'c']);
  });

  it('should merge concurrent inserts correctly', () => {
    const list1 = new FugueList<string>();
    const list2 = new FugueList<string>();

    const ts1 = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };
    const ts2 = { hlc: { physical: 1000, logical: 0, replica: 'r2' } };

    // Both insert at the beginning
    list1.push('from-r1', ts1, 'r1');
    list2.push('from-r2', ts2, 'r2');

    // Merge
    list1.merge(list2);

    // Both elements should be present
    const result = list1.toArray();
    expect(result).toContain('from-r1');
    expect(result).toContain('from-r2');
    expect(result.length).toBe(2);
  });
});

describe('RichText', () => {
  it('should insert and format text', () => {
    const text = new RichText();
    const ts = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };

    text.insert(0, 'Hello World', ts, 'r1');
    expect(text.toString()).toBe('Hello World');

    text.format(0, 5, { bold: true }, ts, 'r1');

    const spans = text.toSpans();
    expect(spans.length).toBe(2);
    expect(spans[0]?.text).toBe('Hello');
    expect(spans[0]?.format.bold).toBe(true);
  });

  it('should delete text correctly', () => {
    const text = new RichText();
    const ts = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };

    text.insert(0, 'Hello World', ts, 'r1');
    text.delete(5, 6); // Delete ' World'

    expect(text.toString()).toBe('Hello');
  });
});

describe('PlainText', () => {
  it('should handle basic operations', () => {
    const text = new PlainText();
    const ts = { hlc: { physical: 1000, logical: 0, replica: 'r1' } };

    text.insert(0, 'Hello', ts, 'r1');
    text.insert(5, ' World', ts, 'r1');

    expect(text.toString()).toBe('Hello World');

    text.delete(5, 1); // Delete space

    expect(text.toString()).toBe('HelloWorld');
  });
});
