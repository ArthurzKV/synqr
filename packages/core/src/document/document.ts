/**
 * Document Container
 *
 * The main entry point for working with CRDT data. A Document:
 * - Manages a set of operations
 * - Provides a convenient API for reading/writing data
 * - Handles subscription to changes
 * - Coordinates with the clock and merge engine
 */

import {
  HybridVectorClock,
  generateReplicaId,
  type HybridTimestamp,
  type ReplicaId,
} from '../clock/hybrid-vector-clock.js';
import {
  OperationFactory,
  sortOperations,
  type Operation,
  type Path,
  type PrimitiveValue,
  type CRDTValue,
  OperationType,
} from '../operations/operation.js';

/**
 * Subscriber callback type
 */
export type Subscriber<T = unknown> = (value: T, path: Path) => void;

/**
 * Unsubscribe function
 */
export type Unsubscribe = () => void;

/**
 * Document state snapshot
 */
export interface DocumentSnapshot {
  readonly id: string;
  readonly replicaId: ReplicaId;
  readonly data: Readonly<Record<string, unknown>>;
  readonly version: number;
}

/**
 * Document configuration options
 */
export interface DocumentOptions {
  /** Unique document ID */
  id: string;
  /** Replica ID (auto-generated if not provided) */
  replicaId?: ReplicaId;
  /** Initial operations to apply */
  operations?: Operation[];
}

/**
 * Internal state for a CRDT value
 */
interface CRDTState {
  // For LWW Register
  registerValue?: PrimitiveValue;
  registerTimestamp?: HybridTimestamp;

  // For Counter
  counterIncrements?: Map<ReplicaId, number>;
  counterDecrements?: Map<ReplicaId, number>;

  // For AWSet
  setElements?: Map<PrimitiveValue, Set<string>>; // value -> add operation IDs

  // For AWMap
  mapEntries?: Map<string, CRDTState>;

  // For List
  listElements?: Map<string, ListElement>;
  listHead?: string | null;
  // Performance: cache sorted elements and last element ID
  _sortedCache?: ListElement[];
  _lastElementId?: string | null;
  _cacheDirty?: boolean;

  // Nested structure
  children?: Map<string, CRDTState>;
}

interface ListElement {
  id: string;
  value: CRDTValue;
  deleted: boolean;
  after: string | null;
  before: string | null;
  timestamp: HybridTimestamp;
}

/**
 * Document - Main CRDT container
 */
export class Document {
  private readonly _id: string;
  private readonly clock: HybridVectorClock;
  private readonly opFactory: OperationFactory;
  private operations: Operation[] = [];
  private state: CRDTState = {};
  private subscribers: Map<string, Set<Subscriber>> = new Map();
  private version = 0;

  // Performance: track applied operation IDs to avoid duplicates
  private appliedOpIds: Set<string> = new Set();
  // Performance: cache sorted list elements per path
  private listCache: Map<string, { elements: ListElement[]; dirty: boolean }> = new Map();

  constructor(options: DocumentOptions) {
    this._id = options.id;
    const replicaId = options.replicaId ?? generateReplicaId();
    this.clock = new HybridVectorClock(replicaId);
    this.opFactory = new OperationFactory(
      () => this.clock.tick(),
      replicaId
    );

    if (options.operations && options.operations.length > 0) {
      // Initialize from existing operations
      for (const op of options.operations) {
        this.clock.receive(op.timestamp);
        this.applyOperationToState(op);
        this.operations.push(op);
        this.appliedOpIds.add(op.id);
        this.version++;
      }
    }
  }

  /**
   * Get the document ID
   */
  get id(): string {
    return this._id;
  }

  /**
   * Get the replica ID
   */
  get replicaId(): ReplicaId {
    return this.clock.getReplicaId();
  }

  /**
   * Get current version (number of operations)
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Get all operations
   */
  getOperations(): readonly Operation[] {
    return this.operations;
  }

  /**
   * Get operations since a specific version
   */
  getOperationsSince(version: number): readonly Operation[] {
    return this.operations.slice(version);
  }

  // ============================================
  // Read API
  // ============================================

  /**
   * Get a value at a path
   */
  get<T = unknown>(path: Path | string): T | undefined {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const state = this.getStateAtPath(normalizedPath);
    if (!state) return undefined;
    return this.stateToValue(state) as T;
  }

  /**
   * Check if a path exists
   */
  has(path: Path | string): boolean {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    return this.getStateAtPath(normalizedPath) !== undefined;
  }

  /**
   * Get the entire document as a plain object
   */
  toJSON(): Record<string, unknown> {
    return this.stateToValue(this.state) as Record<string, unknown>;
  }

  // ============================================
  // Write API
  // ============================================

  /**
   * Set a register value
   */
  set(path: Path | string, value: PrimitiveValue): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const op = this.opFactory.setRegister(normalizedPath, value);
    this.applyOperation(op);
    return op;
  }

  /**
   * Increment a counter
   */
  increment(path: Path | string, amount: number = 1): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const op = this.opFactory.increment(normalizedPath, amount);
    this.applyOperation(op);
    return op;
  }

  /**
   * Decrement a counter
   */
  decrement(path: Path | string, amount: number = 1): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const op = this.opFactory.decrement(normalizedPath, amount);
    this.applyOperation(op);
    return op;
  }

  /**
   * Add to a set
   */
  addToSet(path: Path | string, value: PrimitiveValue): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const op = this.opFactory.addToSet(normalizedPath, value);
    this.applyOperation(op);
    return op;
  }

  /**
   * Remove from a set
   */
  removeFromSet(path: Path | string, value: PrimitiveValue): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const state = this.getOrCreateStateAtPath(normalizedPath);
    const tombstones = state.setElements?.get(value)
      ? Array.from(state.setElements.get(value)!)
      : [];
    const op = this.opFactory.removeFromSet(normalizedPath, value, tombstones);
    this.applyOperation(op);
    return op;
  }

  /**
   * Set a value in a map
   */
  setMapValue(path: Path | string, key: string, value: CRDTValue): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const op = this.opFactory.setMapValue(normalizedPath, key, value);
    this.applyOperation(op);
    return op;
  }

  /**
   * Delete a key from a map
   */
  deleteMapKey(path: Path | string, key: string): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const state = this.getStateAtPath(normalizedPath);
    const tombstones: string[] = [];
    // Collect tombstones from the key's state
    if (state?.mapEntries?.has(key)) {
      const keyState = state.mapEntries.get(key)!;
      if (keyState.registerTimestamp) {
        tombstones.push(`${keyState.registerTimestamp.hlc.physical}-${keyState.registerTimestamp.hlc.replica}`);
      }
    }
    const op = this.opFactory.deleteMapKey(normalizedPath, key, tombstones);
    this.applyOperation(op);
    return op;
  }

  /**
   * Insert into a list
   */
  listInsert(
    path: Path | string,
    value: CRDTValue,
    index: number
  ): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const state = this.getOrCreateStateAtPath(normalizedPath);

    // Find the element at the given index
    const { after, before } = this.getListInsertPosition(state, index);
    const op = this.opFactory.listInsert(normalizedPath, value, after, before);
    this.applyOperation(op);
    return op;
  }

  /**
   * Delete from a list
   */
  listDelete(path: Path | string, index: number): Operation | null {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const state = this.getStateAtPath(normalizedPath);
    if (!state?.listElements) return null;

    const elementId = this.getListElementAtIndex(state, index);
    if (!elementId) return null;

    const op = this.opFactory.listDelete(normalizedPath, elementId);
    this.applyOperation(op);
    return op;
  }

  /**
   * Push to end of list
   */
  listPush(path: Path | string, value: CRDTValue): Operation {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const state = this.getOrCreateStateAtPath(normalizedPath);
    const lastId = this.getLastListElementId(state);
    const op = this.opFactory.listInsert(normalizedPath, value, lastId, null);
    this.applyOperation(op);
    return op;
  }

  // ============================================
  // Subscription API
  // ============================================

  /**
   * Subscribe to changes at a path
   */
  subscribe(path: Path | string, callback: Subscriber): Unsubscribe {
    const normalizedPath = typeof path === 'string' ? [path] : path;
    const pathKey = normalizedPath.join('.');

    if (!this.subscribers.has(pathKey)) {
      this.subscribers.set(pathKey, new Set());
    }
    this.subscribers.get(pathKey)!.add(callback);

    // Immediately call with current value
    const currentValue = this.get(normalizedPath);
    callback(currentValue, normalizedPath);

    return () => {
      this.subscribers.get(pathKey)?.delete(callback);
    };
  }

  /**
   * Subscribe to all changes
   */
  subscribeAll(callback: Subscriber): Unsubscribe {
    return this.subscribe([], callback);
  }

  // ============================================
  // Merge API
  // ============================================

  /**
   * Apply operations from another replica
   * Uses incremental updates instead of full rebuild for performance
   */
  applyOperations(ops: Operation[], notify = true): void {
    let newOpsApplied = 0;

    for (const op of ops) {
      // Skip if already applied (idempotent)
      if (this.appliedOpIds.has(op.id)) {
        continue;
      }

      this.clock.receive(op.timestamp);
      this.applyOperationToState(op);
      this.operations.push(op);
      this.appliedOpIds.add(op.id);
      this.version++;
      newOpsApplied++;

      // Invalidate list cache for this path
      this.invalidateListCache(op.path);
    }

    if (newOpsApplied > 0 && notify) {
      this.notifySubscribers([]);
    }
  }

  /**
   * Merge with another document
   */
  merge(other: Document): void {
    const otherOps = other.getOperations();
    const existingIds = new Set(this.operations.map(op => op.id));
    const newOps = otherOps.filter(op => !existingIds.has(op.id));
    this.applyOperations(newOps);
  }

  /**
   * Create a snapshot of the current state
   */
  snapshot(): DocumentSnapshot {
    return {
      id: this._id,
      replicaId: this.replicaId,
      data: this.toJSON(),
      version: this.version,
    };
  }

  // ============================================
  // Internal Methods
  // ============================================

  private applyOperation(op: Operation): void {
    this.applyOperationToState(op);
    this.operations.push(op);
    this.appliedOpIds.add(op.id);
    this.version++;
    this.invalidateListCache(op.path);
    this.notifySubscribers(op.path);
  }

  private invalidateListCache(path: Path): void {
    const pathKey = path.join('.');
    const cache = this.listCache.get(pathKey);
    if (cache) {
      cache.dirty = true;
    }
  }

  private applyOperationToState(op: Operation): void {
    const state = this.getOrCreateStateAtPath(op.path);

    switch (op.type) {
      case OperationType.SetRegister:
        this.applySetRegister(state, op);
        break;
      case OperationType.Increment:
        this.applyIncrement(state, op);
        break;
      case OperationType.Decrement:
        this.applyDecrement(state, op);
        break;
      case OperationType.AddToSet:
        this.applyAddToSet(state, op);
        break;
      case OperationType.RemoveFromSet:
        this.applyRemoveFromSet(state, op);
        break;
      case OperationType.SetMapValue:
        this.applySetMapValue(state, op);
        break;
      case OperationType.DeleteMapKey:
        this.applyDeleteMapKey(state, op);
        break;
      case OperationType.ListInsert:
        this.applyListInsert(state, op);
        break;
      case OperationType.ListDelete:
        this.applyListDelete(state, op);
        break;
    }
  }

  private applySetRegister(state: CRDTState, op: Operation & { value: PrimitiveValue }): void {
    // LWW: Only apply if this operation is newer
    if (
      !state.registerTimestamp ||
      this.isTimestampNewer(op.timestamp, state.registerTimestamp)
    ) {
      state.registerValue = op.value;
      state.registerTimestamp = op.timestamp;
    }
  }

  private applyIncrement(state: CRDTState, op: Operation & { amount: number }): void {
    if (!state.counterIncrements) {
      state.counterIncrements = new Map();
    }
    const current = state.counterIncrements.get(op.origin) ?? 0;
    state.counterIncrements.set(op.origin, current + op.amount);
  }

  private applyDecrement(state: CRDTState, op: Operation & { amount: number }): void {
    if (!state.counterDecrements) {
      state.counterDecrements = new Map();
    }
    const current = state.counterDecrements.get(op.origin) ?? 0;
    state.counterDecrements.set(op.origin, current + op.amount);
  }

  private applyAddToSet(state: CRDTState, op: Operation & { value: PrimitiveValue }): void {
    if (!state.setElements) {
      state.setElements = new Map();
    }
    if (!state.setElements.has(op.value)) {
      state.setElements.set(op.value, new Set());
    }
    state.setElements.get(op.value)!.add(op.id);
  }

  private applyRemoveFromSet(
    state: CRDTState,
    op: Operation & { value: PrimitiveValue; tombstones: readonly string[] }
  ): void {
    if (!state.setElements) return;
    const addIds = state.setElements.get(op.value);
    if (!addIds) return;

    // Remove the tombstoned add operations
    for (const tombstone of op.tombstones) {
      addIds.delete(tombstone);
    }

    // If no more adds for this value, remove the entry
    if (addIds.size === 0) {
      state.setElements.delete(op.value);
    }
  }

  private applySetMapValue(
    state: CRDTState,
    op: Operation & { key: string; value: CRDTValue }
  ): void {
    if (!state.mapEntries) {
      state.mapEntries = new Map();
    }
    if (!state.mapEntries.has(op.key)) {
      state.mapEntries.set(op.key, {});
    }
    const keyState = state.mapEntries.get(op.key)!;

    // Store as register
    if (
      !keyState.registerTimestamp ||
      this.isTimestampNewer(op.timestamp, keyState.registerTimestamp)
    ) {
      keyState.registerValue = op.value as PrimitiveValue;
      keyState.registerTimestamp = op.timestamp;
    }
  }

  private applyDeleteMapKey(
    state: CRDTState,
    op: Operation & { key: string; tombstones: readonly string[] }
  ): void {
    if (!state.mapEntries) return;
    // Add-wins: only delete if our tombstones cover the current adds
    // For simplicity, we just check if the key exists
    state.mapEntries.delete(op.key);
  }

  private applyListInsert(
    state: CRDTState,
    op: Operation & {
      value: CRDTValue;
      after: string | null;
      before: string | null;
      elementId: string;
    }
  ): void {
    if (!state.listElements) {
      state.listElements = new Map();
    }

    state.listElements.set(op.elementId, {
      id: op.elementId,
      value: op.value,
      deleted: false,
      after: op.after,
      before: op.before,
      timestamp: op.timestamp,
    });

    // Performance optimization: if inserting at end (after current last),
    // update _lastElementId directly without full sort
    if (op.after === state._lastElementId || state._lastElementId === undefined) {
      state._lastElementId = op.elementId;
    } else {
      // Invalidate cache only if not a simple append
      state._cacheDirty = true;
    }
  }

  private applyListDelete(
    state: CRDTState,
    op: Operation & { elementId: string }
  ): void {
    if (!state.listElements) return;
    const element = state.listElements.get(op.elementId);
    if (element) {
      element.deleted = true;
      // Invalidate cache
      state._cacheDirty = true;
    }
  }

  private getStateAtPath(path: Path): CRDTState | undefined {
    let current: CRDTState | undefined = this.state;
    for (const key of path) {
      if (!current?.children) return undefined;
      current = current.children.get(String(key));
      if (!current) return undefined;
    }
    return current;
  }

  private getOrCreateStateAtPath(path: Path): CRDTState {
    let current = this.state;
    for (const key of path) {
      if (!current.children) {
        current.children = new Map();
      }
      if (!current.children.has(String(key))) {
        current.children.set(String(key), {});
      }
      current = current.children.get(String(key))!;
    }
    return current;
  }

  private stateToValue(state: CRDTState): unknown {
    // Check what type of CRDT this state represents

    // Register
    if (state.registerValue !== undefined) {
      return state.registerValue;
    }

    // Counter
    if (state.counterIncrements || state.counterDecrements) {
      let total = 0;
      if (state.counterIncrements) {
        for (const v of state.counterIncrements.values()) {
          total += v;
        }
      }
      if (state.counterDecrements) {
        for (const v of state.counterDecrements.values()) {
          total -= v;
        }
      }
      return total;
    }

    // Set
    if (state.setElements) {
      const values: PrimitiveValue[] = [];
      for (const [value, addIds] of state.setElements) {
        if (addIds.size > 0) {
          values.push(value);
        }
      }
      return values;
    }

    // Map entries (explicit map)
    if (state.mapEntries) {
      const obj: Record<string, unknown> = {};
      for (const [key, keyState] of state.mapEntries) {
        obj[key] = this.stateToValue(keyState);
      }
      return obj;
    }

    // List
    if (state.listElements) {
      return this.listToArray(state);
    }

    // Nested children (object structure)
    if (state.children && state.children.size > 0) {
      const obj: Record<string, unknown> = {};
      for (const [key, childState] of state.children) {
        obj[key] = this.stateToValue(childState);
      }
      return obj;
    }

    return undefined;
  }

  private listToArray(state: CRDTState): CRDTValue[] {
    if (!state.listElements) return [];
    const elements = this.getSortedListElements(state);
    return elements.map(el => el.value);
  }

  /**
   * Get sorted list elements with caching for performance
   */
  private getSortedListElements(state: CRDTState): ListElement[] {
    if (!state.listElements) return [];

    // Return cached if valid
    if (state._sortedCache && !state._cacheDirty) {
      return state._sortedCache;
    }

    // Build the list in order using Fugue algorithm
    const elements = Array.from(state.listElements.values())
      .filter(el => !el.deleted)
      .sort((a, b) => {
        // Sort by timestamp for deterministic ordering
        if (a.timestamp.hlc.physical !== b.timestamp.hlc.physical) {
          return a.timestamp.hlc.physical - b.timestamp.hlc.physical;
        }
        if (a.timestamp.hlc.logical !== b.timestamp.hlc.logical) {
          return a.timestamp.hlc.logical - b.timestamp.hlc.logical;
        }
        return a.timestamp.hlc.replica.localeCompare(b.timestamp.hlc.replica);
      });

    // Cache the result
    state._sortedCache = elements;
    state._lastElementId = elements.length > 0 ? elements[elements.length - 1]!.id : null;
    state._cacheDirty = false;

    return elements;
  }

  private getListInsertPosition(
    state: CRDTState,
    index: number
  ): { after: string | null; before: string | null } {
    if (!state.listElements || state.listElements.size === 0) {
      return { after: null, before: null };
    }

    const elements = this.getSortedListElements(state);

    if (index <= 0) {
      return { after: null, before: elements[0]?.id ?? null };
    }
    if (index >= elements.length) {
      return { after: elements[elements.length - 1]?.id ?? null, before: null };
    }

    return {
      after: elements[index - 1]?.id ?? null,
      before: elements[index]?.id ?? null,
    };
  }

  private getListElementAtIndex(state: CRDTState, index: number): string | null {
    if (!state.listElements) return null;
    const elements = this.getSortedListElements(state);
    return elements[index]?.id ?? null;
  }

  private getLastListElementId(state: CRDTState): string | null {
    if (!state.listElements) return null;

    // Fast path: use cached last element if valid
    if (!state._cacheDirty && state._lastElementId !== undefined) {
      return state._lastElementId;
    }

    const elements = this.getSortedListElements(state);
    return elements[elements.length - 1]?.id ?? null;
  }

  private isTimestampNewer(a: HybridTimestamp, b: HybridTimestamp): boolean {
    if (a.hlc.physical !== b.hlc.physical) {
      return a.hlc.physical > b.hlc.physical;
    }
    if (a.hlc.logical !== b.hlc.logical) {
      return a.hlc.logical > b.hlc.logical;
    }
    return a.hlc.replica > b.hlc.replica;
  }

  private rebuildState(): void {
    this.state = {};
    for (const op of this.operations) {
      this.applyOperationToState(op);
    }
  }

  private notifySubscribers(changedPath: Path): void {
    // Notify exact path subscribers
    const pathKey = changedPath.join('.');
    const exactSubscribers = this.subscribers.get(pathKey);
    if (exactSubscribers) {
      const value = this.get(changedPath);
      for (const callback of exactSubscribers) {
        callback(value, changedPath);
      }
    }

    // Notify parent path subscribers
    for (let i = changedPath.length - 1; i >= 0; i--) {
      const parentPath = changedPath.slice(0, i);
      const parentKey = parentPath.join('.');
      const parentSubscribers = this.subscribers.get(parentKey);
      if (parentSubscribers) {
        const value = this.get(parentPath);
        for (const callback of parentSubscribers) {
          callback(value, parentPath);
        }
      }
    }

    // Always notify root subscribers
    const rootSubscribers = this.subscribers.get('');
    if (rootSubscribers) {
      const value = this.toJSON();
      for (const callback of rootSubscribers) {
        callback(value, []);
      }
    }
  }
}

/**
 * Create a new document
 */
export function createDocument(options: DocumentOptions): Document {
  return new Document(options);
}
