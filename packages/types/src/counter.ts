/**
 * Counter Types
 *
 * G-Counter (Grow-only) and PN-Counter (Positive-Negative)
 */

import type {
  ReplicaId,
  Path,
  IncrementOp,
  DecrementOp,
} from '@syncforge/core';

/**
 * G-Counter: Grow-only Counter
 *
 * A counter that can only be incremented.
 * Uses a map of replica -> count for conflict-free merging.
 */
export class GCounter {
  private counts: Map<ReplicaId, number> = new Map();
  private readonly _path: Path;

  constructor(path: Path = []) {
    this._path = path;
  }

  /**
   * Get the current value (sum of all replica counts)
   */
  get value(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get the count for a specific replica
   */
  getReplicaCount(replicaId: ReplicaId): number {
    return this.counts.get(replicaId) ?? 0;
  }

  /**
   * Increment the counter for a replica
   */
  increment(replicaId: ReplicaId, amount: number = 1): void {
    if (amount < 0) {
      throw new Error('G-Counter can only be incremented with positive values');
    }
    const current = this.counts.get(replicaId) ?? 0;
    this.counts.set(replicaId, current + amount);
  }

  /**
   * Apply an increment operation
   */
  apply(op: IncrementOp): void {
    this.increment(op.origin, op.amount);
  }

  /**
   * Merge with another G-Counter
   */
  merge(other: GCounter): void {
    for (const [replicaId, count] of other.counts) {
      const current = this.counts.get(replicaId) ?? 0;
      this.counts.set(replicaId, Math.max(current, count));
    }
  }

  /**
   * Compare with another G-Counter
   * Returns true if this counter is <= other
   */
  isLessThanOrEqual(other: GCounter): boolean {
    for (const [replicaId, count] of this.counts) {
      const otherCount = other.counts.get(replicaId) ?? 0;
      if (count > otherCount) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the state as a plain object
   */
  getState(): Record<ReplicaId, number> {
    return Object.fromEntries(this.counts);
  }

  /**
   * Restore from state
   */
  setState(state: Record<ReplicaId, number>): void {
    this.counts = new Map(Object.entries(state));
  }

  /**
   * Convert to JSON
   */
  toJSON(): { value: number; counts: Record<ReplicaId, number> } {
    return {
      value: this.value,
      counts: this.getState(),
    };
  }
}

/**
 * PN-Counter: Positive-Negative Counter
 *
 * A counter that can be both incremented and decremented.
 * Implemented as two G-Counters: one for increments, one for decrements.
 */
export class PNCounter {
  private readonly increments: GCounter;
  private readonly decrements: GCounter;
  private readonly _path: Path;

  constructor(path: Path = []) {
    this._path = path;
    this.increments = new GCounter(path);
    this.decrements = new GCounter(path);
  }

  /**
   * Get the current value (increments - decrements)
   */
  get value(): number {
    return this.increments.value - this.decrements.value;
  }

  /**
   * Get the total number of increments
   */
  get totalIncrements(): number {
    return this.increments.value;
  }

  /**
   * Get the total number of decrements
   */
  get totalDecrements(): number {
    return this.decrements.value;
  }

  /**
   * Increment the counter
   */
  increment(replicaId: ReplicaId, amount: number = 1): void {
    if (amount < 0) {
      this.decrements.increment(replicaId, -amount);
    } else {
      this.increments.increment(replicaId, amount);
    }
  }

  /**
   * Decrement the counter
   */
  decrement(replicaId: ReplicaId, amount: number = 1): void {
    if (amount < 0) {
      this.increments.increment(replicaId, -amount);
    } else {
      this.decrements.increment(replicaId, amount);
    }
  }

  /**
   * Apply an increment operation
   */
  applyIncrement(op: IncrementOp): void {
    this.increment(op.origin, op.amount);
  }

  /**
   * Apply a decrement operation
   */
  applyDecrement(op: DecrementOp): void {
    this.decrement(op.origin, op.amount);
  }

  /**
   * Merge with another PN-Counter
   */
  merge(other: PNCounter): void {
    this.increments.merge(other.increments);
    this.decrements.merge(other.decrements);
  }

  /**
   * Compare with another PN-Counter
   */
  isLessThanOrEqual(other: PNCounter): boolean {
    return (
      this.increments.isLessThanOrEqual(other.increments) &&
      this.decrements.isLessThanOrEqual(other.decrements)
    );
  }

  /**
   * Get the state as a plain object
   */
  getState(): {
    increments: Record<ReplicaId, number>;
    decrements: Record<ReplicaId, number>;
  } {
    return {
      increments: this.increments.getState(),
      decrements: this.decrements.getState(),
    };
  }

  /**
   * Restore from state
   */
  setState(state: {
    increments: Record<ReplicaId, number>;
    decrements: Record<ReplicaId, number>;
  }): void {
    this.increments.setState(state.increments);
    this.decrements.setState(state.decrements);
  }

  /**
   * Convert to JSON
   */
  toJSON(): {
    value: number;
    increments: Record<ReplicaId, number>;
    decrements: Record<ReplicaId, number>;
  } {
    return {
      value: this.value,
      increments: this.increments.getState(),
      decrements: this.decrements.getState(),
    };
  }
}

/**
 * Bounded Counter
 *
 * A counter with optional min/max bounds.
 * Uses PN-Counter internally but enforces bounds on reads.
 */
export class BoundedCounter {
  private readonly counter: PNCounter;
  private readonly min: number | undefined;
  private readonly max: number | undefined;
  private readonly _path: Path;

  constructor(
    path: Path = [],
    options: { min?: number; max?: number } = {}
  ) {
    this._path = path;
    this.counter = new PNCounter(path);
    this.min = options.min;
    this.max = options.max;
  }

  /**
   * Get the current value (bounded)
   */
  get value(): number {
    let val = this.counter.value;
    if (this.min !== undefined) {
      val = Math.max(val, this.min);
    }
    if (this.max !== undefined) {
      val = Math.min(val, this.max);
    }
    return val;
  }

  /**
   * Get the raw (unbounded) value
   */
  get rawValue(): number {
    return this.counter.value;
  }

  /**
   * Check if at minimum bound
   */
  get isAtMin(): boolean {
    return this.min !== undefined && this.counter.value <= this.min;
  }

  /**
   * Check if at maximum bound
   */
  get isAtMax(): boolean {
    return this.max !== undefined && this.counter.value >= this.max;
  }

  /**
   * Increment (respecting max bound if set)
   */
  increment(replicaId: ReplicaId, amount: number = 1): boolean {
    if (this.max !== undefined && this.counter.value + amount > this.max) {
      return false;
    }
    this.counter.increment(replicaId, amount);
    return true;
  }

  /**
   * Decrement (respecting min bound if set)
   */
  decrement(replicaId: ReplicaId, amount: number = 1): boolean {
    if (this.min !== undefined && this.counter.value - amount < this.min) {
      return false;
    }
    this.counter.decrement(replicaId, amount);
    return true;
  }

  /**
   * Merge with another bounded counter
   */
  merge(other: BoundedCounter): void {
    this.counter.merge(other.counter);
  }

  /**
   * Convert to JSON
   */
  toJSON(): {
    value: number;
    rawValue: number;
    min: number | undefined;
    max: number | undefined;
  } {
    return {
      value: this.value,
      rawValue: this.rawValue,
      min: this.min,
      max: this.max,
    };
  }
}

/**
 * Factory functions for creating counters
 */
export const Counter = {
  /**
   * Create a grow-only counter
   */
  gCounter(path: Path = []): GCounter {
    return new GCounter(path);
  },

  /**
   * Create a positive-negative counter
   */
  pnCounter(path: Path = []): PNCounter {
    return new PNCounter(path);
  },

  /**
   * Create a bounded counter
   */
  bounded(
    path: Path = [],
    options: { min?: number; max?: number } = {}
  ): BoundedCounter {
    return new BoundedCounter(path, options);
  },
};
