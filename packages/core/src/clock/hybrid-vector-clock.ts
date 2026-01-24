/**
 * Hybrid Vector Clock System
 *
 * Combines HLC (Hybrid Logical Clock) for O(1) common case ordering
 * with partial Vector Clocks for detecting true concurrency.
 *
 * The key insight: most operations in a collaborative session are not
 * truly concurrent - HLC handles these efficiently. Only when we detect
 * potential concurrency do we fall back to vector clock semantics.
 */

/** Unique identifier for a replica/node in the distributed system */
export type ReplicaId = string;

/** Timestamp in milliseconds since Unix epoch */
export type PhysicalTime = number;

/** Logical counter to ensure monotonicity within the same physical time */
export type LogicalCounter = number;

/**
 * HLC Timestamp - the primary timestamp for most operations
 * Format: { physical, logical, replica }
 */
export interface HLCTimestamp {
  /** Physical wall clock time (ms since epoch) */
  physical: PhysicalTime;
  /** Logical counter for same-ms ordering */
  logical: LogicalCounter;
  /** ID of the replica that generated this timestamp */
  replica: ReplicaId;
}

/**
 * Vector Clock entry for tracking causality between replicas
 */
export type VectorClock = Map<ReplicaId, LogicalCounter>;

/**
 * Hybrid timestamp that can represent both HLC and partial VC
 */
export interface HybridTimestamp {
  /** The HLC component (always present) */
  hlc: HLCTimestamp;
  /** Partial vector clock (only present when concurrency detected) */
  vector?: VectorClock;
}

/**
 * Comparison result for timestamps
 */
export enum TimestampOrder {
  Before = -1,
  Equal = 0,
  After = 1,
  Concurrent = 2,
}

/**
 * Hybrid Vector Clock implementation
 *
 * Provides causality tracking with O(1) performance for the common case
 * (sequential or clearly ordered operations) while correctly handling
 * concurrent operations through partial vector clocks.
 */
export class HybridVectorClock {
  private readonly replicaId: ReplicaId;
  private physical: PhysicalTime;
  private logical: LogicalCounter;
  private vector: VectorClock;
  private lastSeen: Map<ReplicaId, HLCTimestamp>;

  constructor(replicaId: ReplicaId) {
    this.replicaId = replicaId;
    this.physical = 0;
    this.logical = 0;
    this.vector = new Map([[replicaId, 0]]);
    this.lastSeen = new Map();
  }

  /**
   * Get the current replica ID
   */
  getReplicaId(): ReplicaId {
    return this.replicaId;
  }

  /**
   * Generate a new timestamp for a local operation
   */
  tick(): HybridTimestamp {
    const now = Date.now();

    if (now > this.physical) {
      this.physical = now;
      this.logical = 0;
    } else {
      this.logical++;
    }

    // Update our position in the vector clock
    const currentCounter = this.vector.get(this.replicaId) ?? 0;
    this.vector.set(this.replicaId, currentCounter + 1);

    const hlc: HLCTimestamp = {
      physical: this.physical,
      logical: this.logical,
      replica: this.replicaId,
    };

    // Check if we need to include vector clock info
    // (when we've seen concurrent operations from other replicas)
    const needsVector = this.detectPotentialConcurrency();

    return needsVector
      ? { hlc, vector: new Map(this.vector) }
      : { hlc };
  }

  /**
   * Receive and merge a timestamp from another replica
   */
  receive(remote: HybridTimestamp): void {
    const now = Date.now();
    const remotePhysical = remote.hlc.physical;

    // Update HLC
    if (now > this.physical && now > remotePhysical) {
      this.physical = now;
      this.logical = 0;
    } else if (remotePhysical > this.physical) {
      this.physical = remotePhysical;
      this.logical = remote.hlc.logical + 1;
    } else if (this.physical > remotePhysical) {
      this.logical++;
    } else {
      // Same physical time
      this.logical = Math.max(this.logical, remote.hlc.logical) + 1;
    }

    // Track what we've seen from this replica
    this.lastSeen.set(remote.hlc.replica, remote.hlc);

    // Merge vector clocks if present
    if (remote.vector) {
      for (const [replica, counter] of remote.vector) {
        const current = this.vector.get(replica) ?? 0;
        this.vector.set(replica, Math.max(current, counter));
      }
    } else {
      // At minimum, track the remote replica's position
      const remoteCounter = this.vector.get(remote.hlc.replica) ?? 0;
      this.vector.set(remote.hlc.replica, remoteCounter + 1);
    }
  }

  /**
   * Compare two timestamps
   */
  static compare(a: HybridTimestamp, b: HybridTimestamp): TimestampOrder {
    // Fast path: compare HLC first
    const hlcOrder = HybridVectorClock.compareHLC(a.hlc, b.hlc);

    // If we have clear HLC ordering and no vector clocks, use HLC result
    if (!a.vector && !b.vector) {
      return hlcOrder === 0 ? TimestampOrder.Equal :
        hlcOrder < 0 ? TimestampOrder.Before : TimestampOrder.After;
    }

    // If both have vector clocks, use them for accurate concurrency detection
    if (a.vector && b.vector) {
      return HybridVectorClock.compareVectors(a.vector, b.vector);
    }

    // Mixed case: one has vector, one doesn't
    // Fall back to HLC with tie-breaking
    return hlcOrder < 0 ? TimestampOrder.Before :
      hlcOrder > 0 ? TimestampOrder.After :
        TimestampOrder.Equal;
  }

  /**
   * Compare two HLC timestamps
   * Returns negative if a < b, positive if a > b, zero if equal
   */
  private static compareHLC(a: HLCTimestamp, b: HLCTimestamp): number {
    if (a.physical !== b.physical) {
      return a.physical - b.physical;
    }
    if (a.logical !== b.logical) {
      return a.logical - b.logical;
    }
    // Tie-break by replica ID for determinism
    return a.replica.localeCompare(b.replica);
  }

  /**
   * Compare two vector clocks for causality
   */
  private static compareVectors(a: VectorClock, b: VectorClock): TimestampOrder {
    let aBeforeB = true;
    let bBeforeA = true;

    // Get all replicas from both clocks
    const allReplicas = new Set([...a.keys(), ...b.keys()]);

    for (const replica of allReplicas) {
      const aCounter = a.get(replica) ?? 0;
      const bCounter = b.get(replica) ?? 0;

      if (aCounter > bCounter) {
        bBeforeA = false;
      }
      if (bCounter > aCounter) {
        aBeforeB = false;
      }
    }

    if (aBeforeB && bBeforeA) {
      return TimestampOrder.Equal;
    }
    if (aBeforeB) {
      return TimestampOrder.Before;
    }
    if (bBeforeA) {
      return TimestampOrder.After;
    }
    return TimestampOrder.Concurrent;
  }

  /**
   * Check if two timestamps are concurrent
   */
  static areConcurrent(a: HybridTimestamp, b: HybridTimestamp): boolean {
    return HybridVectorClock.compare(a, b) === TimestampOrder.Concurrent;
  }

  /**
   * Detect if there's potential concurrency with other replicas
   * (used to decide whether to include vector clock in timestamp)
   */
  private detectPotentialConcurrency(): boolean {
    // If we've seen operations from multiple replicas recently,
    // there's potential for concurrent operations
    if (this.lastSeen.size === 0) {
      return false;
    }

    const now = Date.now();
    const recentThreshold = 5000; // 5 seconds

    for (const [, timestamp] of this.lastSeen) {
      if (now - timestamp.physical < recentThreshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * Serialize the clock state
   */
  serialize(): SerializedClock {
    return {
      replicaId: this.replicaId,
      physical: this.physical,
      logical: this.logical,
      vector: Object.fromEntries(this.vector),
      lastSeen: Object.fromEntries(
        Array.from(this.lastSeen.entries()).map(([k, v]) => [k, v])
      ),
    };
  }

  /**
   * Deserialize clock state
   */
  static deserialize(data: SerializedClock): HybridVectorClock {
    const clock = new HybridVectorClock(data.replicaId);
    clock.physical = data.physical;
    clock.logical = data.logical;
    clock.vector = new Map(Object.entries(data.vector));
    clock.lastSeen = new Map(
      Object.entries(data.lastSeen).map(([k, v]) => [k, v as HLCTimestamp])
    );
    return clock;
  }
}

/**
 * Serialized clock state for persistence
 */
export interface SerializedClock {
  replicaId: ReplicaId;
  physical: PhysicalTime;
  logical: LogicalCounter;
  vector: Record<ReplicaId, LogicalCounter>;
  lastSeen: Record<ReplicaId, HLCTimestamp>;
}

/**
 * Serialize a HybridTimestamp to a string for storage/comparison
 */
export function serializeTimestamp(ts: HybridTimestamp): string {
  const hlcPart = `${ts.hlc.physical.toString(36)}.${ts.hlc.logical.toString(36)}.${ts.hlc.replica}`;
  if (!ts.vector) {
    return hlcPart;
  }
  const vectorPart = Array.from(ts.vector.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v.toString(36)}`)
    .join(',');
  return `${hlcPart}|${vectorPart}`;
}

/**
 * Deserialize a timestamp string
 */
export function deserializeTimestamp(str: string): HybridTimestamp {
  const [hlcPart, vectorPart] = str.split('|');
  const [physical, logical, replica] = hlcPart!.split('.');

  const hlc: HLCTimestamp = {
    physical: parseInt(physical!, 36),
    logical: parseInt(logical!, 36),
    replica: replica!,
  };

  if (!vectorPart) {
    return { hlc };
  }

  const vector = new Map<ReplicaId, LogicalCounter>();
  for (const entry of vectorPart.split(',')) {
    const [k, v] = entry.split(':');
    vector.set(k!, parseInt(v!, 36));
  }

  return { hlc, vector };
}

/**
 * Generate a unique replica ID
 */
export function generateReplicaId(): ReplicaId {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}
