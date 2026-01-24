/**
 * synqr-core
 *
 * Core CRDT engine with Hybrid Vector Clock
 */

// Clock exports
export {
  HybridVectorClock,
  TimestampOrder,
  generateReplicaId,
  serializeTimestamp,
  deserializeTimestamp,
  type ReplicaId,
  type PhysicalTime,
  type LogicalCounter,
  type HLCTimestamp,
  type VectorClock,
  type HybridTimestamp,
  type SerializedClock,
} from './clock/hybrid-vector-clock.js';

// Operation exports
export {
  OperationType,
  OperationFactory,
  generateOperationId,
  serializeOperation,
  deserializeOperation,
  sortOperations,
  type Path,
  type PrimitiveValue,
  type CRDTValue,
  type BaseOperation,
  type SetRegisterOp,
  type IncrementOp,
  type DecrementOp,
  type AddToSetOp,
  type RemoveFromSetOp,
  type SetMapValueOp,
  type DeleteMapKeyOp,
  type ListInsertOp,
  type ListDeleteOp,
  type ListMoveOp,
  type TextInsertOp,
  type TextDeleteOp,
  type TextFormatOp,
  type TextFormat,
  type CreateDocumentOp,
  type DeleteDocumentOp,
  type Operation,
  type SerializedOperation,
} from './operations/operation.js';

// Document exports
export {
  Document,
  createDocument,
  type DocumentOptions,
  type DocumentSnapshot,
  type Subscriber,
  type Unsubscribe,
} from './document/document.js';

// Merge exports
export {
  merge,
  threeWayMerge,
  computeDelta,
  areDocumentsEqual,
  getVersionVector,
  isSubset,
  needsSync,
  ConflictResolution,
  type MergeResult,
  type MergeOptions,
  type ConflictInfo,
  type ConflictResolver,
} from './merge/merge-engine.js';
