/**
 * IndexedDB Persistence Plugin
 *
 * Provides local persistence using IndexedDB.
 */

import type {
  Operation,
  DocumentSnapshot,
} from 'synqr-core';
import { serializeOperation, deserializeOperation } from 'synqr-core';
import {
  PluginType,
  type PersistencePlugin,
  type StorageMetadata,
} from '../plugin-interface.js';

/**
 * IndexedDB plugin options
 */
export interface IndexedDBPluginOptions {
  /** Database name */
  dbName?: string;
  /** Database version */
  dbVersion?: number;
}

/**
 * Store names
 */
const STORES = {
  operations: 'operations',
  snapshots: 'snapshots',
  metadata: 'metadata',
} as const;

/**
 * IndexedDB persistence plugin
 */
export class IndexedDBPlugin implements PersistencePlugin {
  readonly name = 'indexeddb';
  readonly type = PluginType.Persistence;

  private db: IDBDatabase | null = null;
  private options: Required<IndexedDBPluginOptions>;
  private initPromise: Promise<void> | null = null;

  constructor(options: IndexedDBPluginOptions = {}) {
    this.options = {
      dbName: 'synqr',
      dbVersion: 1,
      ...options,
    };
  }

  async onInit(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.openDatabase();
    return this.initPromise;
  }

  async onDestroy(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async saveOperations(documentId: string, operations: Operation[]): Promise<void> {
    await this.ensureReady();

    const tx = this.db!.transaction([STORES.operations, STORES.metadata], 'readwrite');
    const store = tx.objectStore(STORES.operations);
    const metaStore = tx.objectStore(STORES.metadata);

    // Save each operation
    for (const op of operations) {
      const serialized = serializeOperation(op);
      await this.promisify(store.put({
        documentId,
        operationId: op.id,
        data: serialized,
        timestamp: op.timestamp.hlc.physical,
      }));
    }

    // Update metadata
    const existingMeta = await this.promisify<StorageMetadata | undefined>(
      metaStore.get(documentId)
    );
    await this.promisify(metaStore.put({
      documentId,
      operationCount: (existingMeta?.operationCount ?? 0) + operations.length,
      lastModified: Date.now(),
    }));

    await this.promisifyTransaction(tx);
  }

  async loadOperations(documentId: string): Promise<Operation[]> {
    await this.ensureReady();

    const tx = this.db!.transaction(STORES.operations, 'readonly');
    const store = tx.objectStore(STORES.operations);
    const index = store.index('documentId');

    const results = await this.promisify<Array<{
      documentId: string;
      operationId: string;
      data: ReturnType<typeof serializeOperation>;
      timestamp: number;
    }>>(index.getAll(documentId));

    // Sort by timestamp and convert back to Operations
    return results
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(r => deserializeOperation(r.data));
  }

  async saveSnapshot(documentId: string, snapshot: DocumentSnapshot): Promise<void> {
    await this.ensureReady();

    const tx = this.db!.transaction([STORES.snapshots, STORES.metadata], 'readwrite');
    const store = tx.objectStore(STORES.snapshots);
    const metaStore = tx.objectStore(STORES.metadata);

    await this.promisify(store.put({
      documentId,
      snapshot,
      savedAt: Date.now(),
    }));

    // Update metadata
    const existingMeta = await this.promisify<StorageMetadata | undefined>(
      metaStore.get(documentId)
    );
    await this.promisify(metaStore.put({
      ...existingMeta,
      documentId,
      snapshotVersion: snapshot.version,
      lastModified: Date.now(),
    }));

    await this.promisifyTransaction(tx);
  }

  async loadSnapshot(documentId: string): Promise<DocumentSnapshot | null> {
    await this.ensureReady();

    const tx = this.db!.transaction(STORES.snapshots, 'readonly');
    const store = tx.objectStore(STORES.snapshots);

    const result = await this.promisify<{
      documentId: string;
      snapshot: DocumentSnapshot;
      savedAt: number;
    } | undefined>(store.get(documentId));

    return result?.snapshot ?? null;
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.ensureReady();

    const tx = this.db!.transaction(
      [STORES.operations, STORES.snapshots, STORES.metadata],
      'readwrite'
    );

    // Delete operations
    const opStore = tx.objectStore(STORES.operations);
    const opIndex = opStore.index('documentId');
    const opKeys = await this.promisify<IDBValidKey[]>(opIndex.getAllKeys(documentId));
    for (const key of opKeys) {
      await this.promisify(opStore.delete(key));
    }

    // Delete snapshot
    const snapStore = tx.objectStore(STORES.snapshots);
    await this.promisify(snapStore.delete(documentId));

    // Delete metadata
    const metaStore = tx.objectStore(STORES.metadata);
    await this.promisify(metaStore.delete(documentId));

    await this.promisifyTransaction(tx);
  }

  async listDocuments(): Promise<string[]> {
    await this.ensureReady();

    const tx = this.db!.transaction(STORES.metadata, 'readonly');
    const store = tx.objectStore(STORES.metadata);

    const results = await this.promisify<StorageMetadata[]>(store.getAll());
    return results.map(r => r.documentId);
  }

  async getMetadata(documentId: string): Promise<StorageMetadata | null> {
    await this.ensureReady();

    const tx = this.db!.transaction(STORES.metadata, 'readonly');
    const store = tx.objectStore(STORES.metadata);

    const result = await this.promisify<StorageMetadata | undefined>(store.get(documentId));
    return result ?? null;
  }

  // ============================================
  // Private methods
  // ============================================

  private async openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.options.dbName, this.options.dbVersion);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };
    });
  }

  private createStores(db: IDBDatabase): void {
    // Operations store
    if (!db.objectStoreNames.contains(STORES.operations)) {
      const opStore = db.createObjectStore(STORES.operations, {
        keyPath: ['documentId', 'operationId'],
      });
      opStore.createIndex('documentId', 'documentId', { unique: false });
      opStore.createIndex('timestamp', 'timestamp', { unique: false });
    }

    // Snapshots store
    if (!db.objectStoreNames.contains(STORES.snapshots)) {
      db.createObjectStore(STORES.snapshots, {
        keyPath: 'documentId',
      });
    }

    // Metadata store
    if (!db.objectStoreNames.contains(STORES.metadata)) {
      db.createObjectStore(STORES.metadata, {
        keyPath: 'documentId',
      });
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.db) {
      await this.onInit();
    }
  }

  private promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private promisifyTransaction(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
    });
  }
}

/**
 * Create an IndexedDB plugin
 */
export function createIndexedDBPlugin(options?: IndexedDBPluginOptions): IndexedDBPlugin {
  return new IndexedDBPlugin(options);
}

/**
 * In-memory persistence plugin (for testing/Node.js)
 */
export class InMemoryPersistencePlugin implements PersistencePlugin {
  readonly name = 'memory';
  readonly type = PluginType.Persistence;

  private operations: Map<string, Operation[]> = new Map();
  private snapshots: Map<string, DocumentSnapshot> = new Map();
  private metadata: Map<string, StorageMetadata> = new Map();

  async onInit(): Promise<void> {}
  async onDestroy(): Promise<void> {
    this.operations.clear();
    this.snapshots.clear();
    this.metadata.clear();
  }

  async saveOperations(documentId: string, operations: Operation[]): Promise<void> {
    const existing = this.operations.get(documentId) ?? [];
    this.operations.set(documentId, [...existing, ...operations]);

    const meta = this.metadata.get(documentId) ?? {
      documentId,
      operationCount: 0,
      lastModified: 0,
    };
    meta.operationCount += operations.length;
    meta.lastModified = Date.now();
    this.metadata.set(documentId, meta);
  }

  async loadOperations(documentId: string): Promise<Operation[]> {
    return this.operations.get(documentId) ?? [];
  }

  async saveSnapshot(documentId: string, snapshot: DocumentSnapshot): Promise<void> {
    this.snapshots.set(documentId, snapshot);

    const meta = this.metadata.get(documentId) ?? {
      documentId,
      operationCount: 0,
      lastModified: 0,
    };
    meta.snapshotVersion = snapshot.version;
    meta.lastModified = Date.now();
    this.metadata.set(documentId, meta);
  }

  async loadSnapshot(documentId: string): Promise<DocumentSnapshot | null> {
    return this.snapshots.get(documentId) ?? null;
  }

  async deleteDocument(documentId: string): Promise<void> {
    this.operations.delete(documentId);
    this.snapshots.delete(documentId);
    this.metadata.delete(documentId);
  }

  async listDocuments(): Promise<string[]> {
    return Array.from(this.metadata.keys());
  }

  async getMetadata(documentId: string): Promise<StorageMetadata | null> {
    return this.metadata.get(documentId) ?? null;
  }
}

/**
 * Create an in-memory persistence plugin
 */
export function createInMemoryPlugin(): InMemoryPersistencePlugin {
  return new InMemoryPersistencePlugin();
}
