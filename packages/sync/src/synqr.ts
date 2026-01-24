/**
 * Synqr
 *
 * Main entry point that ties together documents, sync, and plugins.
 */

import {
  Document,
  createDocument,
  generateReplicaId,
  type ReplicaId,
} from 'synqr-core';
import { type SchemaDefinition, coerce } from 'synqr-schema';
import {
  PluginManager,
  ConnectionState,
  type Plugin,
} from './plugin-interface.js';
import { SyncManager } from './delta-sync.js';
import {
  MessageType,
  createMessageFactory,
  type Message,
  type PresenceData,
} from './protocol.js';

/**
 * Synqr configuration options
 */
export interface SynqrOptions {
  /** Replica ID (auto-generated if not provided) */
  replicaId?: ReplicaId;
  /** Schema definitions */
  schemas?: SchemaDefinition[];
  /** Plugins to use */
  plugins?: Plugin[];
  /** Auto-connect transports on init */
  autoConnect?: boolean;
  /** Auto-sync interval in ms (0 = disabled) */
  autoSyncInterval?: number;
}

/**
 * Document creation options
 */
export interface CreateDocumentOptions<T = unknown> {
  /** Initial data */
  data?: Partial<T>;
  /** Document ID (auto-generated if not provided) */
  id?: string;
}

/**
 * Synqr - Main CRDT manager
 */
export class Synqr {
  private readonly replicaId: ReplicaId;
  private readonly pluginManager: PluginManager;
  private readonly syncManager: SyncManager;
  private readonly schemas: Map<string, SchemaDefinition>;
  private readonly documents: Map<string, Document>;
  private readonly messageFactory;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private presenceData: Map<string, Map<ReplicaId, PresenceData>> = new Map();

  constructor(options: SynqrOptions = {}) {
    this.replicaId = options.replicaId ?? generateReplicaId();
    this.pluginManager = new PluginManager();
    this.syncManager = new SyncManager(this.replicaId);
    this.schemas = new Map();
    this.documents = new Map();
    this.messageFactory = createMessageFactory(this.replicaId);

    // Register schemas
    if (options.schemas) {
      for (const schema of options.schemas) {
        this.schemas.set(schema.name, schema);
      }
    }

    // Initialize plugins
    if (options.plugins) {
      for (const plugin of options.plugins) {
        this.pluginManager.register(plugin).catch(console.error);
      }
    }

    // Auto-connect transports
    if (options.autoConnect !== false) {
      this.connectAll().catch(console.error);
    }

    // Setup auto-sync
    if (options.autoSyncInterval && options.autoSyncInterval > 0) {
      this.autoSyncTimer = setInterval(() => {
        this.syncAll().catch(console.error);
      }, options.autoSyncInterval);
    }

    // Setup message handlers
    this.setupMessageHandlers();
  }

  /**
   * Get the replica ID
   */
  getReplicaId(): ReplicaId {
    return this.replicaId;
  }

  /**
   * Register a schema
   */
  registerSchema(schema: SchemaDefinition): void {
    this.schemas.set(schema.name, schema);
  }

  /**
   * Get a registered schema
   */
  getSchema(name: string): SchemaDefinition | undefined {
    return this.schemas.get(name);
  }

  // ============================================
  // Document Management
  // ============================================

  /**
   * Create a new document
   */
  async create<T>(
    schema: SchemaDefinition,
    options: CreateDocumentOptions<T> = {}
  ): Promise<TypedDocument<T>> {
    const documentId = options.id ?? `${schema.name}-${generateReplicaId()}`;

    // Validate and coerce initial data
    let initialData = options.data ?? {};
    if (Object.keys(initialData).length > 0) {
      initialData = coerce(initialData, schema) as Partial<T>;
    }

    // Create the document
    const doc = createDocument({
      id: documentId,
      replicaId: this.replicaId,
    });

    // Set initial values
    for (const [key, value] of Object.entries(initialData)) {
      doc.set(key, value as any);
    }

    // Store the document
    this.documents.set(documentId, doc);

    // Notify plugins
    await this.pluginManager.notifyDocumentOpen(documentId);

    // Setup sync
    this.setupDocumentSync(documentId, doc);

    // Persist initial state
    await this.persistDocument(documentId);

    return this.wrapDocument<T>(doc, schema);
  }

  /**
   * Open an existing document
   */
  async open<T>(
    documentId: string,
    schema: SchemaDefinition
  ): Promise<TypedDocument<T> | null> {
    // Check if already open
    if (this.documents.has(documentId)) {
      return this.wrapDocument<T>(this.documents.get(documentId)!, schema);
    }

    // Try to load from persistence
    const persistence = this.pluginManager.getPrimaryPersistence();
    if (persistence) {
      const operations = await persistence.loadOperations(documentId);

      if (operations.length > 0) {
        const doc = createDocument({
          id: documentId,
          replicaId: this.replicaId,
          operations,
        });

        this.documents.set(documentId, doc);
        await this.pluginManager.notifyDocumentOpen(documentId);
        this.setupDocumentSync(documentId, doc);

        return this.wrapDocument<T>(doc, schema);
      }
    }

    return null;
  }

  /**
   * Close a document
   */
  async close(documentId: string): Promise<void> {
    const doc = this.documents.get(documentId);
    if (!doc) return;

    // Persist final state
    await this.persistDocument(documentId);

    // Notify plugins
    await this.pluginManager.notifyDocumentClose(documentId);

    // Remove from tracking
    this.documents.delete(documentId);
    this.syncManager.removeSync(documentId);
  }

  /**
   * Delete a document
   */
  async delete(documentId: string): Promise<void> {
    await this.close(documentId);

    const persistence = this.pluginManager.getPrimaryPersistence();
    if (persistence) {
      await persistence.deleteDocument(documentId);
    }
  }

  /**
   * List all documents
   */
  async listDocuments(): Promise<string[]> {
    const persistence = this.pluginManager.getPrimaryPersistence();
    if (persistence) {
      return persistence.listDocuments();
    }
    return Array.from(this.documents.keys());
  }

  // ============================================
  // Sync
  // ============================================

  /**
   * Sync all documents
   */
  async syncAll(): Promise<void> {
    const transport = this.pluginManager.getPrimaryTransport();
    if (!transport?.isConnected()) return;

    for (const [documentId, _doc] of this.documents) {
      await this.syncDocument(documentId);
    }
  }

  /**
   * Sync a specific document
   */
  async syncDocument(documentId: string): Promise<void> {
    const transport = this.pluginManager.getPrimaryTransport();
    if (!transport?.isConnected()) return;

    const sync = this.syncManager.getSync(documentId);

    // Send pending operations
    const pending = sync.getPendingOutbound();
    if (pending.length > 0) {
      const message = this.messageFactory.operations(
        documentId,
        pending.map(op => ({
          id: op.id,
          type: op.type,
          timestamp: `${op.timestamp.hlc.physical}-${op.timestamp.hlc.logical}-${op.timestamp.hlc.replica}`,
          origin: op.origin,
          path: [...op.path],
          ...(op as any),
        }))
      );
      await transport.send(message);
      sync.clearPendingOutbound();
    }

    // Request updates from server
    const versionVector = sync.getVersionVector();
    const request = this.messageFactory.syncRequest(documentId, versionVector);
    await transport.send(request);
  }

  /**
   * Connect all transports
   */
  async connectAll(): Promise<void> {
    const transports = this.pluginManager.getTransports();
    await Promise.all(transports.map(t => t.connect().catch(console.error)));
  }

  /**
   * Disconnect all transports
   */
  async disconnectAll(): Promise<void> {
    const transports = this.pluginManager.getTransports();
    await Promise.all(transports.map(t => t.disconnect()));
  }

  /**
   * Get connection state
   */
  getConnectionState(): ConnectionState {
    const transport = this.pluginManager.getPrimaryTransport();
    return transport?.getConnectionInfo().state ?? ConnectionState.Disconnected;
  }

  // ============================================
  // Presence
  // ============================================

  /**
   * Update local presence for a document
   */
  async setPresence(documentId: string, data: Partial<PresenceData>): Promise<void> {
    const presence: PresenceData = {
      replicaId: this.replicaId,
      ...data,
      lastUpdated: Date.now(),
    };

    // Update local cache
    if (!this.presenceData.has(documentId)) {
      this.presenceData.set(documentId, new Map());
    }
    this.presenceData.get(documentId)!.set(this.replicaId, presence);

    // Send to remote
    const transport = this.pluginManager.getPrimaryTransport();
    if (transport?.isConnected()) {
      const message = this.messageFactory.presenceUpdate(documentId, presence);
      await transport.send(message);
    }
  }

  /**
   * Get all presence data for a document
   */
  getPresence(documentId: string): PresenceData[] {
    const presenceMap = this.presenceData.get(documentId);
    if (!presenceMap) return [];
    return Array.from(presenceMap.values());
  }

  /**
   * Subscribe to presence updates
   */
  onPresence(
    _documentId: string,
    _callback: (presence: PresenceData[]) => void
  ): () => void {
    // TODO: Implement presence subscription
    return () => {};
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Destroy the Synqr instance
   */
  async destroy(): Promise<void> {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    // Close all documents
    for (const documentId of this.documents.keys()) {
      await this.close(documentId);
    }

    // Destroy plugins
    await this.pluginManager.destroyAll();
  }

  // ============================================
  // Private methods
  // ============================================

  private wrapDocument<T>(doc: Document, schema: SchemaDefinition): TypedDocument<T> {
    return new TypedDocument<T>(doc, schema, this);
  }

  private setupDocumentSync(documentId: string, doc: Document): void {
    // Track operations for sync
    doc.subscribeAll((_value, _path) => {
      const ops = doc.getOperations();
      const lastOp = ops[ops.length - 1];
      if (lastOp) {
        this.syncManager.recordLocal(documentId, lastOp);
      }
    });
  }

  private async persistDocument(documentId: string): Promise<void> {
    const doc = this.documents.get(documentId);
    if (!doc) return;

    const persistence = this.pluginManager.getPrimaryPersistence();
    if (!persistence) return;

    const operations = doc.getOperations();
    await persistence.saveOperations(documentId, [...operations]);
  }

  private setupMessageHandlers(): void {
    for (const transport of this.pluginManager.getTransports()) {
      transport.onMessage((message) => {
        this.handleMessage(message);
      });
    }
  }

  private handleMessage(message: Message): void {
    switch (message.type) {
      case MessageType.SyncResponse:
        this.handleSyncResponse(message);
        break;

      case MessageType.Operations:
        this.handleOperations(message);
        break;

      case MessageType.PresenceUpdate:
        this.handlePresenceUpdate(message);
        break;

      case MessageType.Error:
        console.error('Sync error:', message.code, message.message);
        break;
    }
  }

  private handleSyncResponse(message: Message & { type: MessageType.SyncResponse }): void {
    const doc = this.documents.get(message.documentId);
    if (!doc) return;

    // TODO: Deserialize and apply operations
    // const operations = message.operations.map(deserialize);
    // doc.applyOperations(operations);

    this.syncManager.getSync(message.documentId).markSynced();
  }

  private handleOperations(message: Message & { type: MessageType.Operations }): void {
    const doc = this.documents.get(message.documentId);
    if (!doc) return;

    // TODO: Deserialize and apply operations
  }

  private handlePresenceUpdate(message: Message & { type: MessageType.PresenceUpdate }): void {
    if (!this.presenceData.has(message.documentId)) {
      this.presenceData.set(message.documentId, new Map());
    }
    this.presenceData.get(message.documentId)!.set(
      message.presence.replicaId,
      message.presence
    );
  }
}

/**
 * Typed document wrapper with schema-aware API
 */
export class TypedDocument<T> {
  constructor(
    private readonly doc: Document,
    private readonly _schema: SchemaDefinition,
    private readonly _forge: Synqr
  ) {}

  /**
   * Get document ID
   */
  get id(): string {
    return this.doc.id;
  }

  /**
   * Get a value by key
   */
  get<K extends keyof T>(key: K): T[K] | undefined {
    return this.doc.get(key as string) as T[K] | undefined;
  }

  /**
   * Set a value
   */
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.doc.set(key as string, value as any);
  }

  /**
   * Get the full data object
   */
  getData(): Partial<T> {
    return this.doc.toJSON() as Partial<T>;
  }

  /**
   * Subscribe to changes
   */
  subscribe<K extends keyof T>(
    key: K,
    callback: (value: T[K] | undefined) => void
  ): () => void {
    return this.doc.subscribe(key as string, callback as any);
  }

  /**
   * Subscribe to all changes
   */
  subscribeAll(callback: (data: Partial<T>) => void): () => void {
    return this.doc.subscribeAll(callback as any);
  }

  /**
   * Access list operations at a path
   */
  at<K extends keyof T>(key: K): ListAccessor<T[K] extends Array<infer U> ? U : never> {
    return new ListAccessor(this.doc, [key as string]);
  }

  /**
   * Increment a counter
   */
  increment<K extends keyof T>(key: K, amount: number = 1): void {
    this.doc.increment(key as string, amount);
  }

  /**
   * Decrement a counter
   */
  decrement<K extends keyof T>(key: K, amount: number = 1): void {
    this.doc.decrement(key as string, amount);
  }

  /**
   * Add to a set
   */
  addToSet<K extends keyof T>(key: K, value: T[K] extends Array<infer U> ? U : never): void {
    this.doc.addToSet(key as string, value as any);
  }

  /**
   * Remove from a set
   */
  removeFromSet<K extends keyof T>(key: K, value: T[K] extends Array<infer U> ? U : never): void {
    this.doc.removeFromSet(key as string, value as any);
  }

  /**
   * Get underlying document
   */
  getUnderlyingDocument(): Document {
    return this.doc;
  }
}

/**
 * List accessor for array operations
 */
class ListAccessor<T> {
  constructor(
    private readonly doc: Document,
    private readonly path: string[]
  ) {}

  /**
   * Push a value to the end
   */
  push(value: T): void {
    this.doc.listPush(this.path, value as any);
  }

  /**
   * Insert at index
   */
  insert(index: number, value: T): void {
    this.doc.listInsert(this.path, value as any, index);
  }

  /**
   * Delete at index
   */
  delete(index: number): void {
    this.doc.listDelete(this.path, index);
  }

  /**
   * Get value at index
   */
  get(index: number): T | undefined {
    const list = this.doc.get<T[]>(this.path);
    return list?.[index];
  }

  /**
   * Get all values
   */
  toArray(): T[] {
    return this.doc.get<T[]>(this.path) ?? [];
  }
}

/**
 * Create a Synqr instance
 */
export function createSynqr(options?: SynqrOptions): Synqr {
  return new Synqr(options);
}
