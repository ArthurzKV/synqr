/**
 * Plugin Interface
 *
 * Defines the plugin system for Synqr, allowing extensible
 * persistence, transport, and middleware capabilities.
 */

import type {
  Operation,
  DocumentSnapshot,
} from 'synqr-core';
import type { Message } from './protocol.js';

/**
 * Plugin lifecycle hooks
 */
export interface PluginLifecycle {
  /** Called when plugin is initialized */
  onInit?(): Promise<void>;
  /** Called when plugin is destroyed */
  onDestroy?(): Promise<void>;
  /** Called when a document is opened */
  onDocumentOpen?(documentId: string): Promise<void>;
  /** Called when a document is closed */
  onDocumentClose?(documentId: string): Promise<void>;
}

/**
 * Base plugin interface
 */
export interface Plugin extends PluginLifecycle {
  /** Unique plugin name */
  readonly name: string;
  /** Plugin type */
  readonly type: PluginType;
}

/**
 * Plugin types
 */
export enum PluginType {
  Persistence = 'persistence',
  Transport = 'transport',
  Middleware = 'middleware',
}

/**
 * Persistence plugin interface
 *
 * Handles storing and retrieving document data locally.
 */
export interface PersistencePlugin extends Plugin {
  readonly type: PluginType.Persistence;

  /**
   * Save operations for a document
   */
  saveOperations(documentId: string, operations: Operation[]): Promise<void>;

  /**
   * Load operations for a document
   */
  loadOperations(documentId: string): Promise<Operation[]>;

  /**
   * Save a snapshot of the document
   */
  saveSnapshot(documentId: string, snapshot: DocumentSnapshot): Promise<void>;

  /**
   * Load the latest snapshot
   */
  loadSnapshot(documentId: string): Promise<DocumentSnapshot | null>;

  /**
   * Delete all data for a document
   */
  deleteDocument(documentId: string): Promise<void>;

  /**
   * List all stored document IDs
   */
  listDocuments(): Promise<string[]>;

  /**
   * Get storage metadata
   */
  getMetadata?(documentId: string): Promise<StorageMetadata | null>;
}

/**
 * Storage metadata
 */
export interface StorageMetadata {
  documentId: string;
  operationCount: number;
  snapshotVersion?: number;
  lastModified: number;
  sizeBytes?: number;
}

/**
 * Transport plugin interface
 *
 * Handles network communication with remote peers/servers.
 */
export interface TransportPlugin extends Plugin {
  readonly type: PluginType.Transport;

  /**
   * Connect to the remote endpoint
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the remote endpoint
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Send a message
   */
  send(message: Message): Promise<void>;

  /**
   * Subscribe to incoming messages
   */
  onMessage(callback: MessageCallback): Unsubscribe;

  /**
   * Subscribe to connection state changes
   */
  onConnectionChange(callback: ConnectionCallback): Unsubscribe;

  /**
   * Get connection info
   */
  getConnectionInfo(): ConnectionInfo;
}

/**
 * Message callback
 */
export type MessageCallback = (message: Message) => void;

/**
 * Connection state callback
 */
export type ConnectionCallback = (state: ConnectionState) => void;

/**
 * Unsubscribe function
 */
export type Unsubscribe = () => void;

/**
 * Connection states
 */
export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Error = 'error',
}

/**
 * Connection info
 */
export interface ConnectionInfo {
  state: ConnectionState;
  url?: string | undefined;
  latency?: number | undefined;
  lastConnected?: number | undefined;
  reconnectAttempts?: number | undefined;
}

/**
 * Middleware plugin interface
 *
 * Intercepts and transforms operations and messages.
 */
export interface MiddlewarePlugin extends Plugin {
  readonly type: PluginType.Middleware;

  /**
   * Process an outgoing operation before it's sent
   */
  processOutgoing?(operation: Operation): Operation | null;

  /**
   * Process an incoming operation before it's applied
   */
  processIncoming?(operation: Operation): Operation | null;

  /**
   * Process an outgoing message
   */
  processOutgoingMessage?(message: Message): Message | null;

  /**
   * Process an incoming message
   */
  processIncomingMessage?(message: Message): Message | null;

  /**
   * Validate an operation
   */
  validateOperation?(operation: Operation): ValidationResult;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Plugin manager
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private persistencePlugins: PersistencePlugin[] = [];
  private transportPlugins: TransportPlugin[] = [];
  private middlewarePlugins: MiddlewarePlugin[] = [];

  /**
   * Register a plugin
   */
  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, plugin);

    switch (plugin.type) {
      case PluginType.Persistence:
        this.persistencePlugins.push(plugin as PersistencePlugin);
        break;
      case PluginType.Transport:
        this.transportPlugins.push(plugin as TransportPlugin);
        break;
      case PluginType.Middleware:
        this.middlewarePlugins.push(plugin as MiddlewarePlugin);
        break;
    }

    if (plugin.onInit) {
      await plugin.onInit();
    }
  }

  /**
   * Unregister a plugin
   */
  async unregister(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return;

    if (plugin.onDestroy) {
      await plugin.onDestroy();
    }

    this.plugins.delete(pluginName);

    switch (plugin.type) {
      case PluginType.Persistence:
        this.persistencePlugins = this.persistencePlugins.filter(p => p.name !== pluginName);
        break;
      case PluginType.Transport:
        this.transportPlugins = this.transportPlugins.filter(p => p.name !== pluginName);
        break;
      case PluginType.Middleware:
        this.middlewarePlugins = this.middlewarePlugins.filter(p => p.name !== pluginName);
        break;
    }
  }

  /**
   * Get a plugin by name
   */
  get<T extends Plugin>(name: string): T | undefined {
    return this.plugins.get(name) as T | undefined;
  }

  /**
   * Get all persistence plugins
   */
  getPersistence(): PersistencePlugin[] {
    return this.persistencePlugins;
  }

  /**
   * Get primary persistence plugin
   */
  getPrimaryPersistence(): PersistencePlugin | undefined {
    return this.persistencePlugins[0];
  }

  /**
   * Get all transport plugins
   */
  getTransports(): TransportPlugin[] {
    return this.transportPlugins;
  }

  /**
   * Get primary transport plugin
   */
  getPrimaryTransport(): TransportPlugin | undefined {
    return this.transportPlugins[0];
  }

  /**
   * Get all middleware plugins
   */
  getMiddleware(): MiddlewarePlugin[] {
    return this.middlewarePlugins;
  }

  /**
   * Process operation through middleware
   */
  processOperation(operation: Operation, direction: 'incoming' | 'outgoing'): Operation | null {
    let op: Operation | null = operation;

    for (const middleware of this.middlewarePlugins) {
      if (!op) break;

      if (direction === 'incoming' && middleware.processIncoming) {
        op = middleware.processIncoming(op);
      } else if (direction === 'outgoing' && middleware.processOutgoing) {
        op = middleware.processOutgoing(op);
      }
    }

    return op;
  }

  /**
   * Process message through middleware
   */
  processMessage(message: Message, direction: 'incoming' | 'outgoing'): Message | null {
    let msg: Message | null = message;

    for (const middleware of this.middlewarePlugins) {
      if (!msg) break;

      if (direction === 'incoming' && middleware.processIncomingMessage) {
        msg = middleware.processIncomingMessage(msg);
      } else if (direction === 'outgoing' && middleware.processOutgoingMessage) {
        msg = middleware.processOutgoingMessage(msg);
      }
    }

    return msg;
  }

  /**
   * Validate operation through middleware
   */
  validateOperation(operation: Operation): ValidationResult {
    for (const middleware of this.middlewarePlugins) {
      if (middleware.validateOperation) {
        const result = middleware.validateOperation(operation);
        if (!result.valid) {
          return result;
        }
      }
    }
    return { valid: true };
  }

  /**
   * Notify document open
   */
  async notifyDocumentOpen(documentId: string): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onDocumentOpen) {
        await plugin.onDocumentOpen(documentId);
      }
    }
  }

  /**
   * Notify document close
   */
  async notifyDocumentClose(documentId: string): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onDocumentClose) {
        await plugin.onDocumentClose(documentId);
      }
    }
  }

  /**
   * Destroy all plugins
   */
  async destroyAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onDestroy) {
        await plugin.onDestroy();
      }
    }
    this.plugins.clear();
    this.persistencePlugins = [];
    this.transportPlugins = [];
    this.middlewarePlugins = [];
  }
}
