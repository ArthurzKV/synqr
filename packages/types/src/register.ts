/**
 * Register Types
 *
 * LWW-Register (Last-Writer-Wins) and MV-Register (Multi-Value)
 */

import type {
  HybridTimestamp,
  ReplicaId,
  PrimitiveValue,
  SetRegisterOp,
  Path,
} from 'synqr-core';
import { HybridVectorClock, TimestampOrder } from 'synqr-core';

/**
 * LWW-Register: Last-Writer-Wins Register
 *
 * Simple register that keeps the value with the most recent timestamp.
 * Concurrent writes are resolved by timestamp comparison.
 */
export class LWWRegister<T = PrimitiveValue> {
  private value: T | undefined;
  private timestamp: HybridTimestamp | undefined;
  private readonly _path: Path;

  constructor(path: Path = [], initialValue?: T) {
    this._path = path;
    this.value = initialValue;
  }

  /**
   * Get the current value
   */
  get(): T | undefined {
    return this.value;
  }

  /**
   * Get the timestamp of the current value
   */
  getTimestamp(): HybridTimestamp | undefined {
    return this.timestamp;
  }

  /**
   * Set the value with a timestamp
   */
  set(value: T, timestamp: HybridTimestamp): boolean {
    if (
      !this.timestamp ||
      this.shouldReplace(timestamp, this.timestamp)
    ) {
      this.value = value;
      this.timestamp = timestamp;
      return true;
    }
    return false;
  }

  /**
   * Apply a SetRegister operation
   */
  apply(op: SetRegisterOp): boolean {
    return this.set(op.value as T, op.timestamp);
  }

  /**
   * Merge with another register
   */
  merge(other: LWWRegister<T>): void {
    const otherTs = other.getTimestamp();
    if (otherTs) {
      this.set(other.get() as T, otherTs);
    }
  }

  /**
   * Check if the current value is defined
   */
  isDefined(): boolean {
    return this.value !== undefined;
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON(): { value: T | undefined; timestamp: HybridTimestamp | undefined } {
    return {
      value: this.value,
      timestamp: this.timestamp,
    };
  }

  private shouldReplace(newTs: HybridTimestamp, oldTs: HybridTimestamp): boolean {
    const order = HybridVectorClock.compare(newTs, oldTs);
    if (order === TimestampOrder.After) return true;
    if (order === TimestampOrder.Before) return false;

    // For concurrent or equal, use deterministic tie-breaking
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
 * Value entry for MV-Register
 */
export interface MVValue<T> {
  value: T;
  timestamp: HybridTimestamp;
  origin: ReplicaId;
}

/**
 * MV-Register: Multi-Value Register
 *
 * Keeps all concurrent values visible until explicitly resolved.
 * Useful when you want to show users that a conflict exists.
 */
export class MVRegister<T = PrimitiveValue> {
  private values: Map<string, MVValue<T>> = new Map();
  private readonly _path: Path;

  constructor(path: Path = []) {
    this._path = path;
  }

  /**
   * Get all current values (may be multiple if concurrent)
   */
  getAll(): MVValue<T>[] {
    return Array.from(this.values.values());
  }

  /**
   * Get a single value (the most recent by timestamp)
   */
  get(): T | undefined {
    const values = this.getAll();
    if (values.length === 0) return undefined;

    return values.reduce((latest, current) => {
      const order = HybridVectorClock.compare(current.timestamp, latest.timestamp);
      return order === TimestampOrder.After ? current : latest;
    }).value;
  }

  /**
   * Check if there are concurrent values (conflict)
   */
  hasConflict(): boolean {
    return this.values.size > 1;
  }

  /**
   * Get the number of concurrent values
   */
  conflictCount(): number {
    return this.values.size;
  }

  /**
   * Set a new value with timestamp
   */
  set(value: T, timestamp: HybridTimestamp, origin: ReplicaId): void {
    const key = `${timestamp.hlc.physical}-${timestamp.hlc.logical}-${timestamp.hlc.replica}`;

    // Remove values that are causally dominated by this new value
    const toRemove: string[] = [];
    for (const [k, v] of this.values) {
      const order = HybridVectorClock.compare(timestamp, v.timestamp);
      if (order === TimestampOrder.After) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      this.values.delete(k);
    }

    // Only add if not dominated by existing values
    let dominated = false;
    for (const v of this.values.values()) {
      const order = HybridVectorClock.compare(v.timestamp, timestamp);
      if (order === TimestampOrder.After) {
        dominated = true;
        break;
      }
    }

    if (!dominated) {
      this.values.set(key, { value, timestamp, origin });
    }
  }

  /**
   * Apply a SetRegister operation
   */
  apply(op: SetRegisterOp): void {
    this.set(op.value as T, op.timestamp, op.origin);
  }

  /**
   * Merge with another MV-Register
   */
  merge(other: MVRegister<T>): void {
    for (const v of other.getAll()) {
      this.set(v.value, v.timestamp, v.origin);
    }
  }

  /**
   * Resolve conflict by choosing a specific value
   */
  resolve(timestamp: HybridTimestamp, newTimestamp: HybridTimestamp, origin: ReplicaId): void {
    const key = `${timestamp.hlc.physical}-${timestamp.hlc.logical}-${timestamp.hlc.replica}`;
    const chosen = this.values.get(key);

    if (chosen) {
      this.values.clear();
      this.set(chosen.value, newTimestamp, origin);
    }
  }

  /**
   * Clear all values
   */
  clear(): void {
    this.values.clear();
  }

  /**
   * Convert to JSON
   */
  toJSON(): MVValue<T>[] {
    return this.getAll();
  }
}

/**
 * Factory functions for creating registers
 */
export const Register = {
  /**
   * Create a new LWW Register
   */
  lww<T extends PrimitiveValue>(path: Path = [], initialValue?: T): LWWRegister<T> {
    return new LWWRegister(path, initialValue);
  },

  /**
   * Create a new MV Register
   */
  mv<T extends PrimitiveValue>(path: Path = []): MVRegister<T> {
    return new MVRegister(path);
  },
};
