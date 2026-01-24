/**
 * Delta Sync
 *
 * Efficient synchronization using operation deltas rather than
 * full state transfer. Tracks version vectors and computes
 * minimal sets of operations to exchange.
 */

import type {
  Operation,
  ReplicaId,
  SerializedOperation,
} from '@syncforge/core';
import { serializeOperation, deserializeOperation } from '@syncforge/core';
import type { VersionVector } from './protocol.js';

/**
 * Sync state for a document
 */
export interface SyncState {
  /** Document ID */
  documentId: string;
  /** Local version vector */
  localVector: VersionVector;
  /** Known remote version vectors */
  remoteVectors: Map<string, VersionVector>;
  /** Pending operations to send */
  pendingOutbound: Operation[];
  /** Operations received but not yet applied */
  pendingInbound: Operation[];
  /** Last sync time */
  lastSyncTime: number;
}

/**
 * Delta sync manager for a single document
 */
export class DeltaSync {
  private state: SyncState;

  constructor(documentId: string, replicaId: ReplicaId) {
    this.state = {
      documentId,
      localVector: { [replicaId]: 0 },
      remoteVectors: new Map(),
      pendingOutbound: [],
      pendingInbound: [],
      lastSyncTime: 0,
    };
  }

  /**
   * Get current version vector
   */
  getVersionVector(): VersionVector {
    return { ...this.state.localVector };
  }

  /**
   * Update version vector from an operation
   */
  updateFromOperation(op: Operation): void {
    const current = this.state.localVector[op.origin] ?? 0;
    this.state.localVector[op.origin] = Math.max(
      current,
      op.timestamp.hlc.logical + 1
    );
  }

  /**
   * Add an outbound operation (local change)
   */
  addOutbound(op: Operation): void {
    this.state.pendingOutbound.push(op);
    this.updateFromOperation(op);
  }

  /**
   * Get pending outbound operations
   */
  getPendingOutbound(): Operation[] {
    return [...this.state.pendingOutbound];
  }

  /**
   * Clear pending outbound operations (after successful send)
   */
  clearPendingOutbound(): void {
    this.state.pendingOutbound = [];
  }

  /**
   * Add inbound operations (from remote)
   */
  addInbound(ops: Operation[]): void {
    for (const op of ops) {
      this.state.pendingInbound.push(op);
      this.updateFromOperation(op);
    }
  }

  /**
   * Get and clear pending inbound operations
   */
  consumeInbound(): Operation[] {
    const ops = this.state.pendingInbound;
    this.state.pendingInbound = [];
    return ops;
  }

  /**
   * Update remote version vector
   */
  updateRemoteVector(remoteName: string, vector: VersionVector): void {
    this.state.remoteVectors.set(remoteName, vector);
  }

  /**
   * Compute operations needed by a remote based on their version vector
   */
  computeDelta(remoteVector: VersionVector, allOps: Operation[]): Operation[] {
    return allOps.filter(op => {
      const remoteVersion = remoteVector[op.origin] ?? 0;
      return op.timestamp.hlc.logical >= remoteVersion;
    });
  }

  /**
   * Check if we need operations from a remote
   */
  needsFromRemote(remoteVector: VersionVector): boolean {
    for (const [replica, version] of Object.entries(remoteVector)) {
      const localVersion = this.state.localVector[replica] ?? 0;
      if (version > localVersion) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if remote needs operations from us
   */
  remoteNeeds(remoteVector: VersionVector): boolean {
    for (const [replica, version] of Object.entries(this.state.localVector)) {
      const remoteVersion = remoteVector[replica] ?? 0;
      if (version > remoteVersion) {
        return true;
      }
    }
    return false;
  }

  /**
   * Mark sync as complete
   */
  markSynced(): void {
    this.state.lastSyncTime = Date.now();
  }

  /**
   * Get time since last sync
   */
  timeSinceSync(): number {
    return Date.now() - this.state.lastSyncTime;
  }

  /**
   * Serialize state for persistence
   */
  serialize(): SerializedSyncState {
    return {
      documentId: this.state.documentId,
      localVector: this.state.localVector,
      remoteVectors: Object.fromEntries(this.state.remoteVectors),
      pendingOutbound: this.state.pendingOutbound.map(serializeOperation),
      pendingInbound: this.state.pendingInbound.map(serializeOperation),
      lastSyncTime: this.state.lastSyncTime,
    };
  }

  /**
   * Restore from serialized state
   */
  static deserialize(data: SerializedSyncState): DeltaSync {
    const sync = new DeltaSync(data.documentId, 'restored');
    sync.state = {
      documentId: data.documentId,
      localVector: data.localVector,
      remoteVectors: new Map(Object.entries(data.remoteVectors)),
      pendingOutbound: data.pendingOutbound.map(deserializeOperation),
      pendingInbound: data.pendingInbound.map(deserializeOperation),
      lastSyncTime: data.lastSyncTime,
    };
    return sync;
  }
}

/**
 * Serialized sync state for persistence
 */
export interface SerializedSyncState {
  documentId: string;
  localVector: VersionVector;
  remoteVectors: Record<string, VersionVector>;
  pendingOutbound: SerializedOperation[];
  pendingInbound: SerializedOperation[];
  lastSyncTime: number;
}

/**
 * Sync manager for multiple documents
 */
export class SyncManager {
  private syncs: Map<string, DeltaSync> = new Map();
  private replicaId: ReplicaId;

  constructor(replicaId: ReplicaId) {
    this.replicaId = replicaId;
  }

  /**
   * Get or create sync state for a document
   */
  getSync(documentId: string): DeltaSync {
    if (!this.syncs.has(documentId)) {
      this.syncs.set(documentId, new DeltaSync(documentId, this.replicaId));
    }
    return this.syncs.get(documentId)!;
  }

  /**
   * Remove sync state for a document
   */
  removeSync(documentId: string): void {
    this.syncs.delete(documentId);
  }

  /**
   * Get all document IDs being synced
   */
  getDocumentIds(): string[] {
    return Array.from(this.syncs.keys());
  }

  /**
   * Record a local operation
   */
  recordLocal(documentId: string, op: Operation): void {
    this.getSync(documentId).addOutbound(op);
  }

  /**
   * Record remote operations
   */
  recordRemote(documentId: string, ops: Operation[]): void {
    this.getSync(documentId).addInbound(ops);
  }

  /**
   * Get all pending outbound operations across all documents
   */
  getAllPendingOutbound(): Map<string, Operation[]> {
    const result = new Map<string, Operation[]>();
    for (const [docId, sync] of this.syncs) {
      const pending = sync.getPendingOutbound();
      if (pending.length > 0) {
        result.set(docId, pending);
      }
    }
    return result;
  }

  /**
   * Serialize all sync states
   */
  serialize(): Record<string, SerializedSyncState> {
    const result: Record<string, SerializedSyncState> = {};
    for (const [docId, sync] of this.syncs) {
      result[docId] = sync.serialize();
    }
    return result;
  }

  /**
   * Restore from serialized states
   */
  restore(data: Record<string, SerializedSyncState>): void {
    for (const [docId, state] of Object.entries(data)) {
      this.syncs.set(docId, DeltaSync.deserialize(state));
    }
  }
}

/**
 * Compute version vector from operations
 */
export function computeVersionVector(ops: Operation[]): VersionVector {
  const vector: VersionVector = {};

  for (const op of ops) {
    const current = vector[op.origin] ?? 0;
    vector[op.origin] = Math.max(current, op.timestamp.hlc.logical + 1);
  }

  return vector;
}

/**
 * Merge two version vectors (take max of each)
 */
export function mergeVersionVectors(a: VersionVector, b: VersionVector): VersionVector {
  const result: VersionVector = { ...a };

  for (const [replica, version] of Object.entries(b)) {
    result[replica] = Math.max(result[replica] ?? 0, version);
  }

  return result;
}

/**
 * Compare two version vectors
 * Returns: -1 if a < b, 0 if equal, 1 if a > b, 2 if concurrent
 */
export function compareVersionVectors(a: VersionVector, b: VersionVector): number {
  let aLessB = false;
  let bLessA = false;

  const allReplicas = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const replica of allReplicas) {
    const aVersion = a[replica] ?? 0;
    const bVersion = b[replica] ?? 0;

    if (aVersion < bVersion) aLessB = true;
    if (bVersion < aVersion) bLessA = true;
  }

  if (aLessB && bLessA) return 2; // Concurrent
  if (aLessB) return -1;
  if (bLessA) return 1;
  return 0; // Equal
}
