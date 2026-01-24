/**
 * @syncforge/sync
 *
 * Sync protocol with delta sync and plugin system
 */

// Protocol
export {
  MessageType,
  ErrorCode,
  PROTOCOL_VERSION,
  SUPPORTED_FEATURES,
  generateMessageId,
  createMessageFactory,
  serializeMessage,
  parseMessage,
  type Message,
  type BaseMessage,
  type HelloMessage,
  type WelcomeMessage,
  type GoodbyeMessage,
  type SyncRequestMessage,
  type SyncResponseMessage,
  type OperationsMessage,
  type AckMessage,
  type PresenceUpdateMessage,
  type PresenceQueryMessage,
  type SubscribeMessage,
  type UnsubscribeMessage,
  type ErrorMessage,
  type VersionVector,
  type DocumentState,
  type SerializedOperation,
  type PresenceData,
  type UserInfo,
  type CursorPosition,
  type Selection,
} from './protocol.js';

// Delta Sync
export {
  DeltaSync,
  SyncManager,
  computeVersionVector,
  mergeVersionVectors,
  compareVersionVectors,
  type SyncState,
  type SerializedSyncState,
} from './delta-sync.js';

// Plugin Interface
export {
  PluginType,
  ConnectionState,
  PluginManager,
  type Plugin,
  type PluginLifecycle,
  type PersistencePlugin,
  type TransportPlugin,
  type MiddlewarePlugin,
  type StorageMetadata,
  type MessageCallback,
  type ConnectionCallback,
  type Unsubscribe,
  type ConnectionInfo,
  type ValidationResult,
} from './plugin-interface.js';

// Plugins
export {
  WebSocketPlugin,
  createWebSocketPlugin,
  type WebSocketPluginOptions,
} from './plugins/websocket-plugin.js';

export {
  IndexedDBPlugin,
  createIndexedDBPlugin,
  InMemoryPersistencePlugin,
  createInMemoryPlugin,
  type IndexedDBPluginOptions,
} from './plugins/indexeddb-plugin.js';

// SyncForge
export {
  SyncForge,
  TypedDocument,
  createSyncForge,
  type SyncForgeOptions,
  type CreateDocumentOptions,
} from './syncforge.js';
