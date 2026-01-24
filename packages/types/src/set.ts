/**
 * Set Types
 *
 * AWSet (Add-Wins Set) - the standard CRDT set implementation
 */

import type {
  HybridTimestamp,
  ReplicaId,
  PrimitiveValue,
  Path,
  AddToSetOp,
  RemoveFromSetOp,
} from '@syncforge/core';
import { HybridVectorClock, TimestampOrder } from '@syncforge/core';

/**
 * Metadata for a set element
 */
export interface SetElementMeta {
  /** Unique ID for this add operation */
  addId: string;
  /** When the element was added */
  timestamp: HybridTimestamp;
  /** Which replica added this element */
  origin: ReplicaId;
}

/**
 * AWSet: Add-Wins Set
 *
 * A set where concurrent add and remove of the same element
 * resolves in favor of the add (the element remains in the set).
 *
 * This is implemented using a map from values to their add operation IDs.
 * Remove operations specify which add operations they tombstone.
 */
export class AWSet<T extends PrimitiveValue = PrimitiveValue> {
  /** Map from value to its add operation metadata */
  private elements: Map<T, Map<string, SetElementMeta>> = new Map();
  /** Set of tombstoned add operation IDs */
  private tombstones: Set<string> = new Set();
  private readonly path: Path;

  constructor(path: Path = []) {
    this.path = path;
  }

  /**
   * Get all elements in the set
   */
  values(): T[] {
    const result: T[] = [];
    for (const [value, addOps] of this.elements) {
      // Value is present if it has any non-tombstoned adds
      for (const [addId] of addOps) {
        if (!this.tombstones.has(addId)) {
          result.push(value);
          break;
        }
      }
    }
    return result;
  }

  /**
   * Get the number of elements
   */
  get size(): number {
    return this.values().length;
  }

  /**
   * Check if the set is empty
   */
  get isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Check if a value is in the set
   */
  has(value: T): boolean {
    const addOps = this.elements.get(value);
    if (!addOps) return false;

    for (const [addId] of addOps) {
      if (!this.tombstones.has(addId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Add a value to the set
   */
  add(
    value: T,
    addId: string,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): void {
    if (!this.elements.has(value)) {
      this.elements.set(value, new Map());
    }
    this.elements.get(value)!.set(addId, { addId, timestamp, origin });
  }

  /**
   * Remove a value from the set
   * Returns the tombstoned add IDs
   */
  remove(value: T): string[] {
    const addOps = this.elements.get(value);
    if (!addOps) return [];

    const tombstoned: string[] = [];
    for (const [addId] of addOps) {
      if (!this.tombstones.has(addId)) {
        this.tombstones.add(addId);
        tombstoned.push(addId);
      }
    }
    return tombstoned;
  }

  /**
   * Apply tombstones from a remove operation
   */
  applyTombstones(tombstones: readonly string[]): void {
    for (const addId of tombstones) {
      this.tombstones.add(addId);
    }
  }

  /**
   * Apply an AddToSet operation
   */
  applyAdd(op: AddToSetOp): void {
    this.add(op.value as T, op.id, op.timestamp, op.origin);
  }

  /**
   * Apply a RemoveFromSet operation
   */
  applyRemove(op: RemoveFromSetOp): void {
    this.applyTombstones(op.tombstones);
  }

  /**
   * Merge with another AWSet
   */
  merge(other: AWSet<T>): void {
    // Merge elements
    for (const [value, addOps] of other.elements) {
      if (!this.elements.has(value)) {
        this.elements.set(value, new Map());
      }
      const ourAddOps = this.elements.get(value)!;

      for (const [addId, meta] of addOps) {
        if (!ourAddOps.has(addId)) {
          ourAddOps.set(addId, meta);
        }
      }
    }

    // Merge tombstones
    for (const tombstone of other.tombstones) {
      this.tombstones.add(tombstone);
    }
  }

  /**
   * Get metadata for a value
   */
  getMeta(value: T): SetElementMeta[] {
    const addOps = this.elements.get(value);
    if (!addOps) return [];

    const metas: SetElementMeta[] = [];
    for (const [addId, meta] of addOps) {
      if (!this.tombstones.has(addId)) {
        metas.push(meta);
      }
    }
    return metas;
  }

  /**
   * Get all add IDs for a value (including tombstoned)
   */
  getAddIds(value: T): string[] {
    const addOps = this.elements.get(value);
    return addOps ? Array.from(addOps.keys()) : [];
  }

  /**
   * Get active (non-tombstoned) add IDs for a value
   */
  getActiveAddIds(value: T): string[] {
    const addOps = this.elements.get(value);
    if (!addOps) return [];

    const active: string[] = [];
    for (const addId of addOps.keys()) {
      if (!this.tombstones.has(addId)) {
        active.push(addId);
      }
    }
    return active;
  }

  /**
   * Clear all elements
   */
  clear(): string[] {
    const allTombstones: string[] = [];
    for (const addOps of this.elements.values()) {
      for (const addId of addOps.keys()) {
        if (!this.tombstones.has(addId)) {
          this.tombstones.add(addId);
          allTombstones.push(addId);
        }
      }
    }
    return allTombstones;
  }

  /**
   * Iterate over elements
   */
  [Symbol.iterator](): Iterator<T> {
    return this.values()[Symbol.iterator]();
  }

  /**
   * Apply a function to each element
   */
  forEach(callback: (value: T) => void): void {
    for (const value of this.values()) {
      callback(value);
    }
  }

  /**
   * Map elements to a new array
   */
  map<U>(callback: (value: T) => U): U[] {
    return this.values().map(callback);
  }

  /**
   * Filter elements
   */
  filter(predicate: (value: T) => boolean): T[] {
    return this.values().filter(predicate);
  }

  /**
   * Convert to a native Set
   */
  toSet(): Set<T> {
    return new Set(this.values());
  }

  /**
   * Convert to JSON
   */
  toJSON(): T[] {
    return this.values();
  }

  /**
   * Get the internal state for serialization
   */
  getState(): {
    elements: Array<[T, Array<[string, SetElementMeta]>]>;
    tombstones: string[];
  } {
    return {
      elements: Array.from(this.elements.entries()).map(([value, addOps]) => [
        value,
        Array.from(addOps.entries()),
      ]),
      tombstones: Array.from(this.tombstones),
    };
  }

  /**
   * Restore from state
   */
  setState(state: {
    elements: Array<[T, Array<[string, SetElementMeta]>]>;
    tombstones: string[];
  }): void {
    this.elements = new Map(
      state.elements.map(([value, addOps]) => [value, new Map(addOps)])
    );
    this.tombstones = new Set(state.tombstones);
  }
}

/**
 * ORSet: Observed-Remove Set (alias for AWSet)
 *
 * The ORSet is functionally equivalent to AWSet for most purposes.
 */
export { AWSet as ORSet };

/**
 * Factory functions for creating sets
 */
export const CRDTSet = {
  /**
   * Create an add-wins set
   */
  awSet<T extends PrimitiveValue>(path: Path = []): AWSet<T> {
    return new AWSet(path);
  },

  /**
   * Create from initial values
   */
  from<T extends PrimitiveValue>(
    values: T[],
    path: Path = [],
    replicaId: ReplicaId = 'initial',
    baseTimestamp?: HybridTimestamp
  ): AWSet<T> {
    const set = new AWSet<T>(path);
    values.forEach((value, index) => {
      const ts = baseTimestamp ?? {
        hlc: {
          physical: Date.now(),
          logical: index,
          replica: replicaId,
        },
      };
      set.add(value, `init-${index}`, ts, replicaId);
    });
    return set;
  },
};
