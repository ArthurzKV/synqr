/**
 * Map Types
 *
 * AWMap (Add-Wins Map) - nested CRDT map structure
 */

import type {
  HybridTimestamp,
  ReplicaId,
  CRDTValue,
  Path,
  SetMapValueOp,
  DeleteMapKeyOp,
} from '@syncforge/core';
import { HybridVectorClock, TimestampOrder } from '@syncforge/core';
import { LWWRegister, MVRegister } from './register.js';

/**
 * Entry metadata for map values
 */
export interface MapEntryMeta {
  /** When this entry was last modified */
  timestamp: HybridTimestamp;
  /** Which replica last modified this entry */
  origin: ReplicaId;
  /** Whether this entry has been deleted */
  deleted: boolean;
  /** Tombstone operation IDs */
  tombstones: Set<string>;
}

/**
 * AWMap: Add-Wins Map
 *
 * A map where concurrent add and delete of the same key
 * resolves in favor of the add (the key remains in the map).
 *
 * Values can be any CRDT type or primitive values (stored as LWW registers).
 */
export class AWMap<V extends CRDTValue = CRDTValue> {
  /** Map from key to its value and metadata */
  private entries: Map<string, { value: V; meta: MapEntryMeta }> = new Map();
  private readonly _path: Path;

  constructor(path: Path = []) {
    this._path = path;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    const result: string[] = [];
    for (const [key, entry] of this.entries) {
      if (!entry.meta.deleted) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Get all values
   */
  values(): V[] {
    const result: V[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.meta.deleted) {
        result.push(entry.value);
      }
    }
    return result;
  }

  /**
   * Get all entries
   */
  entries_(): Array<[string, V]> {
    const result: Array<[string, V]> = [];
    for (const [key, entry] of this.entries) {
      if (!entry.meta.deleted) {
        result.push([key, entry.value]);
      }
    }
    return result;
  }

  /**
   * Get the number of entries
   */
  get size(): number {
    return this.keys().length;
  }

  /**
   * Check if the map is empty
   */
  get isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && !entry.meta.deleted;
  }

  /**
   * Get a value by key
   */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.meta.deleted) {
      return undefined;
    }
    return entry.value;
  }

  /**
   * Set a value
   */
  set(
    key: string,
    value: V,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): void {
    const existing = this.entries.get(key);

    if (!existing) {
      this.entries.set(key, {
        value,
        meta: {
          timestamp,
          origin,
          deleted: false,
          tombstones: new Set(),
        },
      });
      return;
    }

    // Check if this update should win
    if (this.shouldReplace(timestamp, existing.meta.timestamp)) {
      existing.value = value;
      existing.meta.timestamp = timestamp;
      existing.meta.origin = origin;
      existing.meta.deleted = false;
    }
  }

  /**
   * Delete a key
   * Returns tombstone IDs for the operation
   */
  delete(
    key: string,
    timestamp: HybridTimestamp,
    _origin: ReplicaId
  ): string[] {
    const existing = this.entries.get(key);
    if (!existing || existing.meta.deleted) {
      return [];
    }

    // Only delete if the delete operation is causally after the add
    if (this.shouldReplace(timestamp, existing.meta.timestamp)) {
      const tombstoneId = `${existing.meta.timestamp.hlc.physical}-${existing.meta.timestamp.hlc.replica}`;
      existing.meta.deleted = true;
      existing.meta.tombstones.add(tombstoneId);
      return [tombstoneId];
    }

    return [];
  }

  /**
   * Apply tombstones from a delete operation
   */
  applyDelete(key: string, tombstones: readonly string[]): void {
    const existing = this.entries.get(key);
    if (!existing) return;

    for (const tombstone of tombstones) {
      existing.meta.tombstones.add(tombstone);
    }

    // Check if current value is tombstoned
    const currentTombstoneId = `${existing.meta.timestamp.hlc.physical}-${existing.meta.timestamp.hlc.replica}`;
    if (existing.meta.tombstones.has(currentTombstoneId)) {
      existing.meta.deleted = true;
    }
  }

  /**
   * Apply a SetMapValue operation
   */
  applySet(op: SetMapValueOp): void {
    this.set(op.key, op.value as V, op.timestamp, op.origin);
  }

  /**
   * Apply a DeleteMapKey operation
   */
  applyDeleteOp(op: DeleteMapKeyOp): void {
    this.applyDelete(op.key, op.tombstones);
  }

  /**
   * Merge with another AWMap
   */
  merge(other: AWMap<V>): void {
    for (const [key, otherEntry] of other.entries) {
      const existing = this.entries.get(key);

      if (!existing) {
        this.entries.set(key, {
          value: otherEntry.value,
          meta: {
            ...otherEntry.meta,
            tombstones: new Set(otherEntry.meta.tombstones),
          },
        });
        continue;
      }

      // Merge tombstones
      for (const tombstone of otherEntry.meta.tombstones) {
        existing.meta.tombstones.add(tombstone);
      }

      // Take the newer value if not tombstoned
      if (this.shouldReplace(otherEntry.meta.timestamp, existing.meta.timestamp)) {
        existing.value = otherEntry.value;
        existing.meta.timestamp = otherEntry.meta.timestamp;
        existing.meta.origin = otherEntry.meta.origin;
      }

      // Update deleted status based on tombstones
      const currentTombstoneId = `${existing.meta.timestamp.hlc.physical}-${existing.meta.timestamp.hlc.replica}`;
      existing.meta.deleted = existing.meta.tombstones.has(currentTombstoneId);
    }
  }

  /**
   * Clear all entries
   */
  clear(timestamp: HybridTimestamp, origin: ReplicaId): string[] {
    const tombstones: string[] = [];
    for (const [key, entry] of this.entries) {
      if (!entry.meta.deleted) {
        const ts = this.delete(key, timestamp, origin);
        tombstones.push(...ts);
      }
    }
    return tombstones;
  }

  /**
   * Iterate over entries
   */
  [Symbol.iterator](): Iterator<[string, V]> {
    return this.entries_()[Symbol.iterator]();
  }

  /**
   * Apply a function to each entry
   */
  forEach(callback: (value: V, key: string) => void): void {
    for (const [key, value] of this.entries_()) {
      callback(value, key);
    }
  }

  /**
   * Map entries to a new array
   */
  map<U>(callback: (value: V, key: string) => U): U[] {
    return this.entries_().map(([key, value]) => callback(value, key));
  }

  /**
   * Convert to a plain object
   */
  toObject(): Record<string, V> {
    const result: Record<string, V> = {};
    for (const [key, value] of this.entries_()) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Convert to a native Map
   */
  toMap(): Map<string, V> {
    return new Map(this.entries_());
  }

  /**
   * Convert to JSON
   */
  toJSON(): Record<string, V> {
    return this.toObject();
  }

  /**
   * Get the internal state for serialization
   */
  getState(): {
    entries: Array<[string, { value: V; meta: Omit<MapEntryMeta, 'tombstones'> & { tombstones: string[] } }]>;
  } {
    return {
      entries: Array.from(this.entries.entries()).map(([key, entry]) => [
        key,
        {
          value: entry.value,
          meta: {
            ...entry.meta,
            tombstones: Array.from(entry.meta.tombstones),
          },
        },
      ]),
    };
  }

  /**
   * Restore from state
   */
  setState(state: {
    entries: Array<[string, { value: V; meta: Omit<MapEntryMeta, 'tombstones'> & { tombstones: string[] } }]>;
  }): void {
    this.entries = new Map(
      state.entries.map(([key, entry]) => [
        key,
        {
          value: entry.value,
          meta: {
            ...entry.meta,
            tombstones: new Set(entry.meta.tombstones),
          },
        },
      ])
    );
  }

  private shouldReplace(newTs: HybridTimestamp, oldTs: HybridTimestamp): boolean {
    const order = HybridVectorClock.compare(newTs, oldTs);
    if (order === TimestampOrder.After) return true;
    if (order === TimestampOrder.Before) return false;

    // Deterministic tie-breaking for concurrent
    if (newTs.hlc.physical !== oldTs.hlc.physical) {
      return newTs.hlc.physical > oldTs.hlc.physical;
    }
    if (newTs.hlc.logical !== oldTs.hlc.logical) {
      return newTs.hlc.logical > oldTs.hlc.logical;
    }
    return newTs.hlc.replica > oldTs.hlc.replica;
  }
}

/**
 * LWWMap: Last-Writer-Wins Map
 *
 * A simpler map where each key is a LWW register.
 * No add-wins semantics - concurrent delete and update are resolved by timestamp.
 */
export class LWWMap<V extends CRDTValue = CRDTValue> {
  private entries: Map<string, LWWRegister<V>> = new Map();
  private readonly _path: Path;

  constructor(path: Path = []) {
    this._path = path;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    const result: string[] = [];
    for (const [key, register] of this.entries) {
      if (register.isDefined()) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Get a value
   */
  get(key: string): V | undefined {
    return this.entries.get(key)?.get() as V | undefined;
  }

  /**
   * Set a value
   */
  set(key: string, value: V, timestamp: HybridTimestamp): void {
    if (!this.entries.has(key)) {
      this.entries.set(key, new LWWRegister([...this._path, key]));
    }
    this.entries.get(key)!.set(value, timestamp);
  }

  /**
   * Delete a key (sets to undefined)
   */
  delete(key: string, timestamp: HybridTimestamp): void {
    if (!this.entries.has(key)) {
      this.entries.set(key, new LWWRegister([...this._path, key]));
    }
    this.entries.get(key)!.set(undefined as unknown as V, timestamp);
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    const register = this.entries.get(key);
    return register !== undefined && register.isDefined();
  }

  /**
   * Get size
   */
  get size(): number {
    return this.keys().length;
  }

  /**
   * Merge with another LWWMap
   */
  merge(other: LWWMap<V>): void {
    for (const [key, register] of other.entries) {
      if (!this.entries.has(key)) {
        this.entries.set(key, new LWWRegister([...this._path, key]));
      }
      this.entries.get(key)!.merge(register as LWWRegister<V>);
    }
  }

  /**
   * Convert to object
   */
  toObject(): Record<string, V> {
    const result: Record<string, V> = {};
    for (const key of this.keys()) {
      result[key] = this.get(key) as V;
    }
    return result;
  }

  /**
   * Convert to JSON
   */
  toJSON(): Record<string, V> {
    return this.toObject();
  }
}

/**
 * Factory functions for creating maps
 */
export const CRDTMap = {
  /**
   * Create an add-wins map
   */
  awMap<V extends CRDTValue>(path: Path = []): AWMap<V> {
    return new AWMap(path);
  },

  /**
   * Create a last-writer-wins map
   */
  lwwMap<V extends CRDTValue>(path: Path = []): LWWMap<V> {
    return new LWWMap(path);
  },

  /**
   * Create from initial object
   */
  from<V extends CRDTValue>(
    obj: Record<string, V>,
    path: Path = [],
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): AWMap<V> {
    const map = new AWMap<V>(path);
    for (const [key, value] of Object.entries(obj)) {
      map.set(key, value, timestamp, origin);
    }
    return map;
  },
};
