/**
 * Merge Engine
 *
 * Provides utilities for merging operations from multiple replicas
 * and resolving conflicts according to CRDT semantics.
 */

import {
  HybridVectorClock,
  TimestampOrder,
  type HybridTimestamp,
} from '../clock/hybrid-vector-clock.js';
import {
  sortOperations,
  type Operation,
  OperationType,
} from '../operations/operation.js';
import { Document } from '../document/document.js';

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** The merged document */
  document: Document;
  /** Operations that were new to the first document */
  newToFirst: Operation[];
  /** Operations that were new to the second document */
  newToSecond: Operation[];
  /** Operations that had conflicts (were concurrent) */
  conflicts: ConflictInfo[];
}

/**
 * Information about a detected conflict
 */
export interface ConflictInfo {
  /** The path where the conflict occurred */
  path: readonly (string | number)[];
  /** The operations that were concurrent */
  operations: Operation[];
  /** How the conflict was resolved */
  resolution: ConflictResolution;
  /** The winning operation (if applicable) */
  winner?: Operation | undefined;
}

/**
 * How a conflict was resolved
 */
export enum ConflictResolution {
  /** Last-writer-wins based on timestamp */
  LastWriterWins = 'lww',
  /** All values kept (multi-value register) */
  MultiValue = 'multi_value',
  /** Values merged (counter, set) */
  Merged = 'merged',
  /** Custom resolution applied */
  Custom = 'custom',
}

/**
 * Merge two documents
 */
export function merge(
  doc1: Document,
  doc2: Document,
  options?: MergeOptions
): MergeResult {
  const ops1 = doc1.getOperations();
  const ops2 = doc2.getOperations();

  const ids1 = new Set(ops1.map(op => op.id));
  const ids2 = new Set(ops2.map(op => op.id));

  const newToFirst = ops2.filter(op => !ids1.has(op.id));
  const newToSecond = ops1.filter(op => !ids2.has(op.id));

  // Combine and sort all operations
  const allOps = sortOperations([...ops1, ...ops2.filter(op => !ids1.has(op.id))]);

  // Detect conflicts
  const conflicts = detectConflicts(newToFirst, newToSecond, options);

  // Create merged document
  const merged = new Document({
    id: doc1.id,
    replicaId: doc1.replicaId,
    operations: allOps,
  });

  return {
    document: merged,
    newToFirst,
    newToSecond,
    conflicts,
  };
}

/**
 * Options for merge operation
 */
export interface MergeOptions {
  /** Custom conflict resolver */
  conflictResolver?: ConflictResolver;
  /** Whether to track conflicts */
  trackConflicts?: boolean;
}

/**
 * Custom conflict resolver function
 */
export type ConflictResolver = (
  ops: Operation[],
  path: readonly (string | number)[]
) => Operation;

/**
 * Detect conflicts between two sets of operations
 */
function detectConflicts(
  ops1: Operation[],
  ops2: Operation[],
  options?: MergeOptions
): ConflictInfo[] {
  if (!options?.trackConflicts) {
    return [];
  }

  const conflicts: ConflictInfo[] = [];

  // Group operations by path
  const byPath1 = groupByPath(ops1);
  const byPath2 = groupByPath(ops2);

  // Find paths with concurrent operations
  for (const [pathKey, pathOps1] of byPath1) {
    const pathOps2 = byPath2.get(pathKey);
    if (!pathOps2) continue;

    // Check if any operations are concurrent
    for (const op1 of pathOps1) {
      for (const op2 of pathOps2) {
        if (HybridVectorClock.areConcurrent(op1.timestamp, op2.timestamp)) {
          const resolution = determineResolution(op1, op2);
          const winner = resolution === ConflictResolution.LastWriterWins
            ? getWinner(op1, op2)
            : undefined;

          conflicts.push({
            path: op1.path,
            operations: [op1, op2],
            resolution,
            winner,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Group operations by their path
 */
function groupByPath(ops: Operation[]): Map<string, Operation[]> {
  const groups = new Map<string, Operation[]>();

  for (const op of ops) {
    const pathKey = op.path.join('.');
    if (!groups.has(pathKey)) {
      groups.set(pathKey, []);
    }
    groups.get(pathKey)!.push(op);
  }

  return groups;
}

/**
 * Determine how a conflict should be resolved based on operation types
 */
function determineResolution(op1: Operation, op2: Operation): ConflictResolution {
  // Counters always merge
  if (
    (op1.type === OperationType.Increment || op1.type === OperationType.Decrement) &&
    (op2.type === OperationType.Increment || op2.type === OperationType.Decrement)
  ) {
    return ConflictResolution.Merged;
  }

  // Sets merge (add-wins)
  if (
    (op1.type === OperationType.AddToSet || op1.type === OperationType.RemoveFromSet) &&
    (op2.type === OperationType.AddToSet || op2.type === OperationType.RemoveFromSet)
  ) {
    return ConflictResolution.Merged;
  }

  // Registers use LWW
  if (op1.type === OperationType.SetRegister && op2.type === OperationType.SetRegister) {
    return ConflictResolution.LastWriterWins;
  }

  // Default to LWW
  return ConflictResolution.LastWriterWins;
}

/**
 * Get the winning operation for LWW resolution
 */
function getWinner(op1: Operation, op2: Operation): Operation {
  const order = HybridVectorClock.compare(op1.timestamp, op2.timestamp);

  if (order === TimestampOrder.After || order === TimestampOrder.Equal) {
    return op1;
  }
  if (order === TimestampOrder.Before) {
    return op2;
  }

  // For concurrent operations, use deterministic tie-breaking
  if (op1.timestamp.hlc.physical !== op2.timestamp.hlc.physical) {
    return op1.timestamp.hlc.physical > op2.timestamp.hlc.physical ? op1 : op2;
  }
  if (op1.timestamp.hlc.logical !== op2.timestamp.hlc.logical) {
    return op1.timestamp.hlc.logical > op2.timestamp.hlc.logical ? op1 : op2;
  }
  return op1.timestamp.hlc.replica > op2.timestamp.hlc.replica ? op1 : op2;
}

/**
 * Three-way merge using a common ancestor
 */
export function threeWayMerge(
  ancestor: Document,
  ours: Document,
  theirs: Document,
  options?: MergeOptions
): MergeResult {
  const ancestorOps = new Set(ancestor.getOperations().map(op => op.id));

  // Get operations added since the ancestor
  const ourNew = ours.getOperations().filter(op => !ancestorOps.has(op.id));
  const theirNew = theirs.getOperations().filter(op => !ancestorOps.has(op.id));

  // Combine all operations
  const allOps = [
    ...ancestor.getOperations(),
    ...ourNew,
    ...theirNew.filter(op => !new Set(ourNew.map(o => o.id)).has(op.id)),
  ];

  const sorted = sortOperations(allOps);
  const conflicts = detectConflicts(ourNew, theirNew, options);

  const merged = new Document({
    id: ancestor.id,
    replicaId: ours.replicaId,
    operations: sorted,
  });

  return {
    document: merged,
    newToFirst: theirNew,
    newToSecond: ourNew,
    conflicts,
  };
}

/**
 * Compute the delta (difference) between two documents
 */
export function computeDelta(
  fromDoc: Document,
  toDoc: Document
): Operation[] {
  const fromIds = new Set(fromDoc.getOperations().map(op => op.id));
  return toDoc.getOperations().filter(op => !fromIds.has(op.id));
}

/**
 * Check if two documents are equal (have the same operations)
 */
export function areDocumentsEqual(doc1: Document, doc2: Document): boolean {
  const ops1 = doc1.getOperations();
  const ops2 = doc2.getOperations();

  if (ops1.length !== ops2.length) {
    return false;
  }

  const ids1 = new Set(ops1.map(op => op.id));
  return ops2.every(op => ids1.has(op.id));
}

/**
 * Get the version vector for a document
 * (maps each replica to its latest operation)
 */
export function getVersionVector(doc: Document): Map<string, HybridTimestamp> {
  const vector = new Map<string, HybridTimestamp>();

  for (const op of doc.getOperations()) {
    const current = vector.get(op.origin);
    if (
      !current ||
      op.timestamp.hlc.physical > current.hlc.physical ||
      (op.timestamp.hlc.physical === current.hlc.physical &&
        op.timestamp.hlc.logical > current.hlc.logical)
    ) {
      vector.set(op.origin, op.timestamp);
    }
  }

  return vector;
}

/**
 * Check if doc1 is a subset of doc2 (all ops in doc1 are in doc2)
 */
export function isSubset(doc1: Document, doc2: Document): boolean {
  const ids2 = new Set(doc2.getOperations().map(op => op.id));
  return doc1.getOperations().every(op => ids2.has(op.id));
}

/**
 * Check if a document needs syncing with another
 */
export function needsSync(local: Document, remote: Document): boolean {
  const localIds = new Set(local.getOperations().map(op => op.id));
  const remoteIds = new Set(remote.getOperations().map(op => op.id));

  // Check if remote has ops we don't have
  for (const id of remoteIds) {
    if (!localIds.has(id)) {
      return true;
    }
  }

  // Check if we have ops remote doesn't have
  for (const id of localIds) {
    if (!remoteIds.has(id)) {
      return true;
    }
  }

  return false;
}
