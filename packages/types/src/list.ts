/**
 * List Types
 *
 * FugueList - CRDT list using the Fugue algorithm for correct interleaving
 */

import type {
  HybridTimestamp,
  ReplicaId,
  CRDTValue,
  Path,
  ListInsertOp,
  ListDeleteOp,
  ListMoveOp,
} from '@syncforge/core';
import { HybridVectorClock, TimestampOrder } from '@syncforge/core';

/**
 * Unique identifier for a list element
 */
export interface ElementId {
  /** The replica that created this element */
  replica: ReplicaId;
  /** Sequence number within that replica */
  seq: number;
}

/**
 * Tree node in the Fugue structure
 */
interface FugueNode<T> {
  /** Unique ID for this node */
  id: string;
  /** The value stored at this node */
  value: T;
  /** Whether this node has been deleted */
  deleted: boolean;
  /** Parent node ID (null for root children) */
  parent: string | null;
  /** Side: 'L' for left child, 'R' for right child */
  side: 'L' | 'R';
  /** When this node was created */
  timestamp: HybridTimestamp;
  /** Which replica created this node */
  origin: ReplicaId;
  /** Left children (sorted by timestamp) */
  leftChildren: string[];
  /** Right children (sorted by timestamp) */
  rightChildren: string[];
}

/**
 * FugueList: CRDT list using the Fugue algorithm
 *
 * Fugue provides correct interleaving for concurrent insertions,
 * avoiding the "anomalies" present in simpler list CRDTs.
 *
 * Key insight: Elements form a tree structure, not a linear sequence.
 * The linear order is derived by traversing the tree.
 */
export class FugueList<T extends CRDTValue = CRDTValue> {
  /** All nodes by ID */
  private nodes: Map<string, FugueNode<T>> = new Map();
  /** Root node IDs (elements with no parent) */
  private roots: string[] = [];
  /** Sequence counter for this replica */
  private seq: number = 0;
  private readonly path: Path;

  // Performance optimization: cache traversal results
  private cachedOrder: T[] | null = null;
  private cachedNodeIds: string[] | null = null;
  private cacheValid = false;

  constructor(path: Path = []) {
    this.path = path;
  }

  /** Invalidate cache - call after any mutation */
  private invalidateCache(): void {
    this.cacheValid = false;
    this.cachedOrder = null;
    this.cachedNodeIds = null;
  }

  /**
   * Get the length of the list (non-deleted elements)
   * Uses cached order for performance
   */
  get length(): number {
    return this.getLinearOrder().length;
  }

  /**
   * Check if list is empty
   */
  get isEmpty(): boolean {
    return this.length === 0;
  }

  /**
   * Get element at index
   */
  at(index: number): T | undefined {
    const order = this.getLinearOrder();
    return order[index];
  }

  /**
   * Get all elements in order
   */
  toArray(): T[] {
    return this.getLinearOrder();
  }

  /**
   * Insert a value at an index
   */
  insert(
    index: number,
    value: T,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): string {
    const elementId = this.generateElementId(origin);
    const order = this.getOrderedNodeIds();

    let parent: string | null = null;
    let side: 'L' | 'R' = 'R';

    if (order.length === 0) {
      // First element - no parent
      parent = null;
      side = 'R';
    } else if (index <= 0) {
      // Insert at beginning - become left child of first element
      parent = order[0] ?? null;
      side = 'L';
    } else if (index >= order.length) {
      // Insert at end - become right child of last element
      parent = order[order.length - 1] ?? null;
      side = 'R';
    } else {
      // Insert in middle - become right child of predecessor
      parent = order[index - 1] ?? null;
      side = 'R';
    }

    const node: FugueNode<T> = {
      id: elementId,
      value,
      deleted: false,
      parent,
      side,
      timestamp,
      origin,
      leftChildren: [],
      rightChildren: [],
    };

    this.nodes.set(elementId, node);

    // Update parent's children
    if (parent) {
      const parentNode = this.nodes.get(parent);
      if (parentNode) {
        if (side === 'L') {
          this.insertChild(parentNode.leftChildren, elementId, timestamp);
        } else {
          this.insertChild(parentNode.rightChildren, elementId, timestamp);
        }
      }
    } else {
      this.insertChild(this.roots, elementId, timestamp);
    }

    this.invalidateCache();
    return elementId;
  }

  /**
   * Insert after a specific element ID
   */
  insertAfter(
    afterId: string | null,
    value: T,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): string {
    const elementId = this.generateElementId(origin);

    const node: FugueNode<T> = {
      id: elementId,
      value,
      deleted: false,
      parent: afterId,
      side: 'R',
      timestamp,
      origin,
      leftChildren: [],
      rightChildren: [],
    };

    this.nodes.set(elementId, node);

    if (afterId) {
      const parentNode = this.nodes.get(afterId);
      if (parentNode) {
        this.insertChild(parentNode.rightChildren, elementId, timestamp);
      }
    } else {
      // Insert at beginning
      if (this.roots.length > 0) {
        const firstRoot = this.roots[0]!;
        const firstNode = this.nodes.get(firstRoot);
        if (firstNode) {
          node.parent = firstRoot;
          node.side = 'L';
          this.insertChild(firstNode.leftChildren, elementId, timestamp);
        }
      } else {
        this.insertChild(this.roots, elementId, timestamp);
      }
    }

    this.invalidateCache();
    return elementId;
  }

  /**
   * Delete an element by ID
   */
  delete(elementId: string): boolean {
    const node = this.nodes.get(elementId);
    if (!node || node.deleted) {
      return false;
    }
    node.deleted = true;
    this.invalidateCache();
    return true;
  }

  /**
   * Delete element at index
   */
  deleteAt(index: number): string | null {
    const order = this.getOrderedNodeIds();
    const elementId = order[index];
    if (!elementId) return null;

    this.delete(elementId);
    return elementId;
  }

  /**
   * Push value to end
   */
  push(value: T, timestamp: HybridTimestamp, origin: ReplicaId): string {
    return this.insert(this.length, value, timestamp, origin);
  }

  /**
   * Unshift value to beginning
   */
  unshift(value: T, timestamp: HybridTimestamp, origin: ReplicaId): string {
    return this.insert(0, value, timestamp, origin);
  }

  /**
   * Pop last element
   */
  pop(): T | undefined {
    const order = this.getOrderedNodeIds();
    if (order.length === 0) return undefined;

    const lastId = order[order.length - 1]!;
    const node = this.nodes.get(lastId);
    if (!node) return undefined;

    node.deleted = true;
    return node.value;
  }

  /**
   * Shift first element
   */
  shift(): T | undefined {
    const order = this.getOrderedNodeIds();
    if (order.length === 0) return undefined;

    const firstId = order[0]!;
    const node = this.nodes.get(firstId);
    if (!node) return undefined;

    node.deleted = true;
    return node.value;
  }

  /**
   * Apply an insert operation
   */
  applyInsert(op: ListInsertOp): void {
    const node: FugueNode<T> = {
      id: op.elementId,
      value: op.value as T,
      deleted: false,
      parent: op.after,
      side: op.after ? 'R' : 'L',
      timestamp: op.timestamp,
      origin: op.origin,
      leftChildren: [],
      rightChildren: [],
    };

    this.nodes.set(op.elementId, node);

    if (op.after) {
      const parentNode = this.nodes.get(op.after);
      if (parentNode) {
        this.insertChild(parentNode.rightChildren, op.elementId, op.timestamp);
      }
    } else if (op.before) {
      const beforeNode = this.nodes.get(op.before);
      if (beforeNode) {
        node.parent = op.before;
        node.side = 'L';
        this.insertChild(beforeNode.leftChildren, op.elementId, op.timestamp);
      }
    } else {
      this.insertChild(this.roots, op.elementId, op.timestamp);
    }
    this.invalidateCache();
  }

  /**
   * Apply a delete operation
   */
  applyDelete(op: ListDeleteOp): void {
    this.delete(op.elementId);
    // delete() already calls invalidateCache()
  }

  /**
   * Merge with another FugueList
   */
  merge(other: FugueList<T>): void {
    // Add all nodes from other
    for (const [id, otherNode] of other.nodes) {
      if (!this.nodes.has(id)) {
        const node: FugueNode<T> = {
          ...otherNode,
          leftChildren: [...otherNode.leftChildren],
          rightChildren: [...otherNode.rightChildren],
        };
        this.nodes.set(id, node);

        // Update parent's children list
        if (node.parent) {
          const parentNode = this.nodes.get(node.parent);
          if (parentNode) {
            if (node.side === 'L') {
              if (!parentNode.leftChildren.includes(id)) {
                this.insertChild(parentNode.leftChildren, id, node.timestamp);
              }
            } else {
              if (!parentNode.rightChildren.includes(id)) {
                this.insertChild(parentNode.rightChildren, id, node.timestamp);
              }
            }
          }
        } else {
          if (!this.roots.includes(id)) {
            this.insertChild(this.roots, id, node.timestamp);
          }
        }
      } else {
        // Node exists - merge deleted state
        const existingNode = this.nodes.get(id)!;
        if (otherNode.deleted) {
          existingNode.deleted = true;
        }
      }
    }
    this.invalidateCache();
  }

  /**
   * Get element ID at index
   */
  getIdAt(index: number): string | undefined {
    const order = this.getOrderedNodeIds();
    return order[index];
  }

  /**
   * Get index of element ID
   */
  indexOf(elementId: string): number {
    const order = this.getOrderedNodeIds();
    return order.indexOf(elementId);
  }

  /**
   * Iterate over elements
   */
  [Symbol.iterator](): Iterator<T> {
    return this.toArray()[Symbol.iterator]();
  }

  /**
   * Apply a function to each element
   */
  forEach(callback: (value: T, index: number) => void): void {
    this.toArray().forEach(callback);
  }

  /**
   * Map elements
   */
  map<U>(callback: (value: T, index: number) => U): U[] {
    return this.toArray().map(callback);
  }

  /**
   * Filter elements
   */
  filter(predicate: (value: T, index: number) => boolean): T[] {
    return this.toArray().filter(predicate);
  }

  /**
   * Find an element
   */
  find(predicate: (value: T, index: number) => boolean): T | undefined {
    return this.toArray().find(predicate);
  }

  /**
   * Find index of element matching predicate
   */
  findIndex(predicate: (value: T, index: number) => boolean): number {
    return this.toArray().findIndex(predicate);
  }

  /**
   * Convert to JSON
   */
  toJSON(): T[] {
    return this.toArray();
  }

  /**
   * Get internal state for serialization
   */
  getState(): {
    nodes: Array<[string, FugueNode<T>]>;
    roots: string[];
    seq: number;
  } {
    return {
      nodes: Array.from(this.nodes.entries()),
      roots: [...this.roots],
      seq: this.seq,
    };
  }

  /**
   * Restore from state
   */
  setState(state: {
    nodes: Array<[string, FugueNode<T>]>;
    roots: string[];
    seq: number;
  }): void {
    this.nodes = new Map(state.nodes);
    this.roots = [...state.roots];
    this.seq = state.seq;
    this.invalidateCache();
  }

  // ============================================
  // Private methods
  // ============================================

  private generateElementId(origin: ReplicaId): string {
    return `${origin}-${this.seq++}`;
  }

  private insertChild(children: string[], id: string, timestamp: HybridTimestamp): void {
    // Insert in sorted order by timestamp
    let insertIndex = children.length;
    for (let i = 0; i < children.length; i++) {
      const childNode = this.nodes.get(children[i]!);
      if (childNode && this.compareTimestamps(timestamp, childNode.timestamp) < 0) {
        insertIndex = i;
        break;
      }
    }
    children.splice(insertIndex, 0, id);
  }

  private compareTimestamps(a: HybridTimestamp, b: HybridTimestamp): number {
    if (a.hlc.physical !== b.hlc.physical) {
      return a.hlc.physical - b.hlc.physical;
    }
    if (a.hlc.logical !== b.hlc.logical) {
      return a.hlc.logical - b.hlc.logical;
    }
    return a.hlc.replica.localeCompare(b.hlc.replica);
  }

  /**
   * Get linear order by traversing the tree
   * Uses in-order traversal: left children, self, right children
   * Results are cached for performance
   */
  private getLinearOrder(): T[] {
    // Return cached result if valid
    if (this.cacheValid && this.cachedOrder !== null) {
      return this.cachedOrder;
    }

    const result: T[] = [];
    const visited = new Set<string>();

    const traverse = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return;

      // Traverse left children first
      for (const childId of node.leftChildren) {
        traverse(childId);
      }

      // Visit self (if not deleted)
      if (!node.deleted) {
        result.push(node.value);
      }

      // Traverse right children
      for (const childId of node.rightChildren) {
        traverse(childId);
      }
    };

    // Start from roots
    for (const rootId of this.roots) {
      traverse(rootId);
    }

    // Cache the result
    this.cachedOrder = result;
    this.cacheValid = true;

    return result;
  }

  /**
   * Get ordered node IDs (non-deleted only)
   * Results are cached for performance
   */
  private getOrderedNodeIds(): string[] {
    // Return cached result if valid
    if (this.cacheValid && this.cachedNodeIds !== null) {
      return this.cachedNodeIds;
    }

    const result: string[] = [];
    const visited = new Set<string>();

    const traverse = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return;

      for (const childId of node.leftChildren) {
        traverse(childId);
      }

      if (!node.deleted) {
        result.push(node.id);
      }

      for (const childId of node.rightChildren) {
        traverse(childId);
      }
    };

    for (const rootId of this.roots) {
      traverse(rootId);
    }

    // Cache the result
    this.cachedNodeIds = result;

    return result;
  }
}

/**
 * Factory functions for creating lists
 */
export const CRDTList = {
  /**
   * Create a FugueList
   */
  create<T extends CRDTValue>(path: Path = []): FugueList<T> {
    return new FugueList(path);
  },

  /**
   * Create from initial values
   */
  from<T extends CRDTValue>(
    values: T[],
    path: Path = [],
    replicaId: ReplicaId = 'initial'
  ): FugueList<T> {
    const list = new FugueList<T>(path);
    for (const value of values) {
      const timestamp = {
        hlc: {
          physical: Date.now(),
          logical: 0,
          replica: replicaId,
        },
      };
      list.push(value, timestamp, replicaId);
    }
    return list;
  },
};
