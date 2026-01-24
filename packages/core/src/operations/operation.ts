/**
 * Operation System
 *
 * Defines the immutable operation types that form the foundation of CRDT state.
 * All state changes are represented as operations that can be:
 * - Serialized for sync/persistence
 * - Ordered using timestamps
 * - Merged deterministically
 */

import type { HybridTimestamp, ReplicaId } from '../clock/hybrid-vector-clock.js';

/**
 * Path to a value within a document
 * e.g., ['users', 'alice', 'profile', 'name']
 */
export type Path = readonly (string | number)[];

/**
 * Supported primitive values in CRDT operations
 */
export type PrimitiveValue =
  | string
  | number
  | boolean
  | null;

/**
 * All possible values including nested structures
 */
export type CRDTValue =
  | PrimitiveValue
  | CRDTValue[]
  | { readonly [key: string]: CRDTValue };

/**
 * Operation types supported by the system
 */
export enum OperationType {
  // Register operations
  SetRegister = 'set_register',

  // Counter operations
  Increment = 'increment',
  Decrement = 'decrement',

  // Set operations
  AddToSet = 'add_to_set',
  RemoveFromSet = 'remove_from_set',

  // Map operations
  SetMapValue = 'set_map_value',
  DeleteMapKey = 'delete_map_key',

  // List operations
  ListInsert = 'list_insert',
  ListDelete = 'list_delete',
  ListMove = 'list_move',

  // Text operations
  TextInsert = 'text_insert',
  TextDelete = 'text_delete',
  TextFormat = 'text_format',

  // Document operations
  CreateDocument = 'create_document',
  DeleteDocument = 'delete_document',
}

/**
 * Base operation interface
 */
export interface BaseOperation<T extends OperationType = OperationType> {
  /** Unique operation ID (timestamp + random suffix) */
  readonly id: string;
  /** Operation type discriminator */
  readonly type: T;
  /** When this operation was created */
  readonly timestamp: HybridTimestamp;
  /** Which replica created this operation */
  readonly origin: ReplicaId;
  /** Path to the target within the document */
  readonly path: Path;
}

// ============================================
// Register Operations
// ============================================

export interface SetRegisterOp extends BaseOperation<OperationType.SetRegister> {
  readonly value: PrimitiveValue;
}

// ============================================
// Counter Operations
// ============================================

export interface IncrementOp extends BaseOperation<OperationType.Increment> {
  readonly amount: number;
}

export interface DecrementOp extends BaseOperation<OperationType.Decrement> {
  readonly amount: number;
}

// ============================================
// Set Operations
// ============================================

export interface AddToSetOp extends BaseOperation<OperationType.AddToSet> {
  readonly value: PrimitiveValue;
}

export interface RemoveFromSetOp extends BaseOperation<OperationType.RemoveFromSet> {
  readonly value: PrimitiveValue;
  /** Tombstone IDs - the add operations this remove supersedes */
  readonly tombstones: readonly string[];
}

// ============================================
// Map Operations
// ============================================

export interface SetMapValueOp extends BaseOperation<OperationType.SetMapValue> {
  readonly key: string;
  readonly value: CRDTValue;
}

export interface DeleteMapKeyOp extends BaseOperation<OperationType.DeleteMapKey> {
  readonly key: string;
  /** Tombstone IDs for concurrent add wins */
  readonly tombstones: readonly string[];
}

// ============================================
// List Operations (Fugue-based)
// ============================================

export interface ListInsertOp extends BaseOperation<OperationType.ListInsert> {
  /** The value to insert */
  readonly value: CRDTValue;
  /** ID of the element to insert after (null = beginning) */
  readonly after: string | null;
  /** ID of the element to insert before (null = end) */
  readonly before: string | null;
  /** Unique ID for this list element */
  readonly elementId: string;
}

export interface ListDeleteOp extends BaseOperation<OperationType.ListDelete> {
  /** ID of the element to delete */
  readonly elementId: string;
}

export interface ListMoveOp extends BaseOperation<OperationType.ListMove> {
  /** ID of the element to move */
  readonly elementId: string;
  /** New position: after this element (null = beginning) */
  readonly after: string | null;
  /** New position: before this element (null = end) */
  readonly before: string | null;
}

// ============================================
// Text Operations (Peritext-inspired)
// ============================================

export interface TextInsertOp extends BaseOperation<OperationType.TextInsert> {
  /** Characters to insert */
  readonly text: string;
  /** Position ID to insert after */
  readonly after: string | null;
  /** Unique ID for this text segment */
  readonly segmentId: string;
}

export interface TextDeleteOp extends BaseOperation<OperationType.TextDelete> {
  /** Segment ID to delete from */
  readonly segmentId: string;
  /** Start offset within segment */
  readonly start: number;
  /** Number of characters to delete */
  readonly length: number;
}

export interface TextFormatOp extends BaseOperation<OperationType.TextFormat> {
  /** Starting segment ID */
  readonly startSegment: string;
  /** Start offset */
  readonly startOffset: number;
  /** Ending segment ID */
  readonly endSegment: string;
  /** End offset */
  readonly endOffset: number;
  /** Format to apply */
  readonly format: TextFormat;
}

export interface TextFormat {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly link?: string | null;
  readonly [key: string]: PrimitiveValue | undefined;
}

// ============================================
// Document Operations
// ============================================

export interface CreateDocumentOp extends BaseOperation<OperationType.CreateDocument> {
  readonly documentId: string;
  readonly schema: string;
  readonly schemaVersion: number;
}

export interface DeleteDocumentOp extends BaseOperation<OperationType.DeleteDocument> {
  readonly documentId: string;
}

// ============================================
// Union Type
// ============================================

export type Operation =
  | SetRegisterOp
  | IncrementOp
  | DecrementOp
  | AddToSetOp
  | RemoveFromSetOp
  | SetMapValueOp
  | DeleteMapKeyOp
  | ListInsertOp
  | ListDeleteOp
  | ListMoveOp
  | TextInsertOp
  | TextDeleteOp
  | TextFormatOp
  | CreateDocumentOp
  | DeleteDocumentOp;

// ============================================
// Operation Factory
// ============================================

let operationCounter = 0;

/**
 * Generate a unique operation ID
 */
export function generateOperationId(timestamp: HybridTimestamp): string {
  const counter = (operationCounter++).toString(36);
  return `${timestamp.hlc.physical.toString(36)}-${timestamp.hlc.logical.toString(36)}-${timestamp.hlc.replica}-${counter}`;
}

/**
 * Factory for creating operations
 */
export class OperationFactory {
  constructor(
    private readonly getTimestamp: () => HybridTimestamp,
    private readonly replicaId: ReplicaId
  ) {}

  private createBase<T extends OperationType>(
    type: T,
    path: Path
  ): BaseOperation<T> {
    const timestamp = this.getTimestamp();
    return {
      id: generateOperationId(timestamp),
      type,
      timestamp,
      origin: this.replicaId,
      path,
    };
  }

  setRegister(path: Path, value: PrimitiveValue): SetRegisterOp {
    return {
      ...this.createBase(OperationType.SetRegister, path),
      value,
    };
  }

  increment(path: Path, amount: number = 1): IncrementOp {
    return {
      ...this.createBase(OperationType.Increment, path),
      amount,
    };
  }

  decrement(path: Path, amount: number = 1): DecrementOp {
    return {
      ...this.createBase(OperationType.Decrement, path),
      amount,
    };
  }

  addToSet(path: Path, value: PrimitiveValue): AddToSetOp {
    return {
      ...this.createBase(OperationType.AddToSet, path),
      value,
    };
  }

  removeFromSet(path: Path, value: PrimitiveValue, tombstones: string[]): RemoveFromSetOp {
    return {
      ...this.createBase(OperationType.RemoveFromSet, path),
      value,
      tombstones,
    };
  }

  setMapValue(path: Path, key: string, value: CRDTValue): SetMapValueOp {
    return {
      ...this.createBase(OperationType.SetMapValue, path),
      key,
      value,
    };
  }

  deleteMapKey(path: Path, key: string, tombstones: string[]): DeleteMapKeyOp {
    return {
      ...this.createBase(OperationType.DeleteMapKey, path),
      key,
      tombstones,
    };
  }

  listInsert(
    path: Path,
    value: CRDTValue,
    after: string | null,
    before: string | null
  ): ListInsertOp {
    const base = this.createBase(OperationType.ListInsert, path);
    return {
      ...base,
      value,
      after,
      before,
      elementId: base.id,
    };
  }

  listDelete(path: Path, elementId: string): ListDeleteOp {
    return {
      ...this.createBase(OperationType.ListDelete, path),
      elementId,
    };
  }

  listMove(
    path: Path,
    elementId: string,
    after: string | null,
    before: string | null
  ): ListMoveOp {
    return {
      ...this.createBase(OperationType.ListMove, path),
      elementId,
      after,
      before,
    };
  }

  textInsert(path: Path, text: string, after: string | null): TextInsertOp {
    const base = this.createBase(OperationType.TextInsert, path);
    return {
      ...base,
      text,
      after,
      segmentId: base.id,
    };
  }

  textDelete(
    path: Path,
    segmentId: string,
    start: number,
    length: number
  ): TextDeleteOp {
    return {
      ...this.createBase(OperationType.TextDelete, path),
      segmentId,
      start,
      length,
    };
  }

  textFormat(
    path: Path,
    startSegment: string,
    startOffset: number,
    endSegment: string,
    endOffset: number,
    format: TextFormat
  ): TextFormatOp {
    return {
      ...this.createBase(OperationType.TextFormat, path),
      startSegment,
      startOffset,
      endSegment,
      endOffset,
      format,
    };
  }

  createDocument(documentId: string, schema: string, schemaVersion: number): CreateDocumentOp {
    return {
      ...this.createBase(OperationType.CreateDocument, []),
      documentId,
      schema,
      schemaVersion,
    };
  }

  deleteDocument(documentId: string): DeleteDocumentOp {
    return {
      ...this.createBase(OperationType.DeleteDocument, []),
      documentId,
    };
  }
}

// ============================================
// Serialization
// ============================================

import { serializeTimestamp, deserializeTimestamp } from '../clock/hybrid-vector-clock.js';

export interface SerializedOperation {
  id: string;
  type: OperationType;
  timestamp: string;
  origin: ReplicaId;
  path: Path;
  [key: string]: unknown;
}

export function serializeOperation(op: Operation): SerializedOperation {
  const { timestamp, ...rest } = op;
  return {
    ...rest,
    timestamp: serializeTimestamp(timestamp),
  };
}

export function deserializeOperation(data: SerializedOperation): Operation {
  const { timestamp: timestampStr, ...rest } = data;
  return {
    ...rest,
    timestamp: deserializeTimestamp(timestampStr),
  } as Operation;
}

/**
 * Sort operations by timestamp for deterministic ordering
 */
export function sortOperations(ops: Operation[]): Operation[] {
  return [...ops].sort((a, b) => {
    // Compare by physical time first
    if (a.timestamp.hlc.physical !== b.timestamp.hlc.physical) {
      return a.timestamp.hlc.physical - b.timestamp.hlc.physical;
    }
    // Then by logical counter
    if (a.timestamp.hlc.logical !== b.timestamp.hlc.logical) {
      return a.timestamp.hlc.logical - b.timestamp.hlc.logical;
    }
    // Finally by replica ID for determinism
    return a.timestamp.hlc.replica.localeCompare(b.timestamp.hlc.replica);
  });
}
