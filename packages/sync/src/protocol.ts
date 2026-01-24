/**
 * Sync Protocol
 *
 * Defines the message format and protocol for synchronizing
 * documents between replicas.
 */

import type { ReplicaId } from '@syncforge/core';

/**
 * Protocol message types
 */
export enum MessageType {
  // Connection
  Hello = 'hello',
  Welcome = 'welcome',
  Goodbye = 'goodbye',

  // Sync
  SyncRequest = 'sync_request',
  SyncResponse = 'sync_response',
  Operations = 'operations',
  Ack = 'ack',

  // Presence
  PresenceUpdate = 'presence_update',
  PresenceQuery = 'presence_query',

  // Subscription
  Subscribe = 'subscribe',
  Unsubscribe = 'unsubscribe',

  // Errors
  Error = 'error',
}

/**
 * Base message structure
 */
export interface BaseMessage {
  /** Message type */
  type: MessageType;
  /** Unique message ID for tracking */
  id: string;
  /** Timestamp when message was created */
  timestamp: number;
  /** Sender replica ID */
  sender: ReplicaId;
}

/**
 * Hello message - sent when connecting
 */
export interface HelloMessage extends BaseMessage {
  type: MessageType.Hello;
  /** Protocol version */
  protocolVersion: number;
  /** Supported features */
  features: string[];
  /** Documents to sync */
  documents: DocumentState[];
}

/**
 * Welcome message - response to Hello
 */
export interface WelcomeMessage extends BaseMessage {
  type: MessageType.Welcome;
  /** Assigned replica ID (if new) */
  assignedReplicaId?: ReplicaId | undefined;
  /** Server's protocol version */
  protocolVersion: number;
  /** Server's supported features */
  features: string[];
}

/**
 * Goodbye message - sent when disconnecting
 */
export interface GoodbyeMessage extends BaseMessage {
  type: MessageType.Goodbye;
  /** Reason for disconnect */
  reason?: string | undefined;
}

/**
 * Sync request - ask for operations since a version
 */
export interface SyncRequestMessage extends BaseMessage {
  type: MessageType.SyncRequest;
  /** Document ID */
  documentId: string;
  /** Our current version vector */
  versionVector: VersionVector;
  /** Max number of operations to receive */
  limit?: number | undefined;
}

/**
 * Sync response - operations in response to request
 */
export interface SyncResponseMessage extends BaseMessage {
  type: MessageType.SyncResponse;
  /** Document ID */
  documentId: string;
  /** Operations to apply */
  operations: SerializedOperation[];
  /** Whether there are more operations */
  hasMore: boolean;
  /** Continue token for pagination */
  continueToken?: string | undefined;
}

/**
 * Operations message - push new operations
 */
export interface OperationsMessage extends BaseMessage {
  type: MessageType.Operations;
  /** Document ID */
  documentId: string;
  /** Operations to apply */
  operations: SerializedOperation[];
}

/**
 * Acknowledgment message
 */
export interface AckMessage extends BaseMessage {
  type: MessageType.Ack;
  /** ID of message being acknowledged */
  ackId: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string | undefined;
}

/**
 * Presence update message
 */
export interface PresenceUpdateMessage extends BaseMessage {
  type: MessageType.PresenceUpdate;
  /** Document ID */
  documentId: string;
  /** Presence data */
  presence: PresenceData;
}

/**
 * Presence query message
 */
export interface PresenceQueryMessage extends BaseMessage {
  type: MessageType.PresenceQuery;
  /** Document ID */
  documentId: string;
}

/**
 * Subscribe to a document
 */
export interface SubscribeMessage extends BaseMessage {
  type: MessageType.Subscribe;
  /** Document ID */
  documentId: string;
  /** Paths to subscribe to (empty = all) */
  paths?: string[][] | undefined;
}

/**
 * Unsubscribe from a document
 */
export interface UnsubscribeMessage extends BaseMessage {
  type: MessageType.Unsubscribe;
  /** Document ID */
  documentId: string;
}

/**
 * Error message
 */
export interface ErrorMessage extends BaseMessage {
  type: MessageType.Error;
  /** Error code */
  code: ErrorCode;
  /** Error message */
  message: string;
  /** Related message ID */
  relatedMessageId?: string | undefined;
}

/**
 * Union of all message types
 */
export type Message =
  | HelloMessage
  | WelcomeMessage
  | GoodbyeMessage
  | SyncRequestMessage
  | SyncResponseMessage
  | OperationsMessage
  | AckMessage
  | PresenceUpdateMessage
  | PresenceQueryMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | ErrorMessage;

/**
 * Error codes
 */
export enum ErrorCode {
  Unknown = 'unknown',
  InvalidMessage = 'invalid_message',
  DocumentNotFound = 'document_not_found',
  PermissionDenied = 'permission_denied',
  RateLimited = 'rate_limited',
  ServerError = 'server_error',
  VersionMismatch = 'version_mismatch',
}

/**
 * Version vector for tracking sync state
 */
export type VersionVector = Record<ReplicaId, number>;

/**
 * Document state for sync
 */
export interface DocumentState {
  /** Document ID */
  documentId: string;
  /** Schema name */
  schemaName: string;
  /** Schema version */
  schemaVersion: number;
  /** Current version vector */
  versionVector: VersionVector;
}

/**
 * Serialized operation for transport
 */
export interface SerializedOperation {
  id: string;
  type: string;
  timestamp: string;
  origin: ReplicaId;
  path: (string | number)[];
  [key: string]: unknown;
}

/**
 * Presence data structure
 */
export interface PresenceData {
  /** Replica/user ID */
  replicaId: ReplicaId;
  /** User info */
  user?: UserInfo;
  /** Cursor position */
  cursor?: CursorPosition;
  /** Selection */
  selection?: Selection;
  /** Custom data */
  custom?: Record<string, unknown>;
  /** Last updated */
  lastUpdated: number;
}

export interface UserInfo {
  name?: string;
  color?: string;
  avatar?: string;
}

export interface CursorPosition {
  path: (string | number)[];
  offset?: number;
  x?: number;
  y?: number;
}

export interface Selection {
  start: CursorPosition;
  end: CursorPosition;
}

/**
 * Current protocol version
 */
export const PROTOCOL_VERSION = 1;

/**
 * Supported features
 */
export const SUPPORTED_FEATURES = [
  'operations',
  'presence',
  'selective-sync',
  'compression',
];

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Create a message factory bound to a replica ID
 */
export function createMessageFactory(replicaId: ReplicaId) {
  const createBase = <T extends MessageType>(type: T): BaseMessage & { type: T } => ({
    type,
    id: generateMessageId(),
    timestamp: Date.now(),
    sender: replicaId,
  });

  return {
    hello(documents: DocumentState[], features: string[] = SUPPORTED_FEATURES): HelloMessage {
      return {
        ...createBase(MessageType.Hello),
        protocolVersion: PROTOCOL_VERSION,
        features,
        documents,
      };
    },

    welcome(
      features: string[] = SUPPORTED_FEATURES,
      assignedReplicaId?: ReplicaId
    ): WelcomeMessage {
      return {
        ...createBase(MessageType.Welcome),
        protocolVersion: PROTOCOL_VERSION,
        features,
        assignedReplicaId,
      };
    },

    goodbye(reason?: string): GoodbyeMessage {
      return {
        ...createBase(MessageType.Goodbye),
        reason,
      };
    },

    syncRequest(
      documentId: string,
      versionVector: VersionVector,
      limit?: number
    ): SyncRequestMessage {
      return {
        ...createBase(MessageType.SyncRequest),
        documentId,
        versionVector,
        limit,
      };
    },

    syncResponse(
      documentId: string,
      operations: SerializedOperation[],
      hasMore: boolean,
      continueToken?: string
    ): SyncResponseMessage {
      return {
        ...createBase(MessageType.SyncResponse),
        documentId,
        operations,
        hasMore,
        continueToken,
      };
    },

    operations(documentId: string, operations: SerializedOperation[]): OperationsMessage {
      return {
        ...createBase(MessageType.Operations),
        documentId,
        operations,
      };
    },

    ack(ackId: string, success: boolean, error?: string): AckMessage {
      return {
        ...createBase(MessageType.Ack),
        ackId,
        success,
        error,
      };
    },

    presenceUpdate(documentId: string, presence: PresenceData): PresenceUpdateMessage {
      return {
        ...createBase(MessageType.PresenceUpdate),
        documentId,
        presence,
      };
    },

    presenceQuery(documentId: string): PresenceQueryMessage {
      return {
        ...createBase(MessageType.PresenceQuery),
        documentId,
      };
    },

    subscribe(documentId: string, paths?: string[][]): SubscribeMessage {
      return {
        ...createBase(MessageType.Subscribe),
        documentId,
        paths,
      };
    },

    unsubscribe(documentId: string): UnsubscribeMessage {
      return {
        ...createBase(MessageType.Unsubscribe),
        documentId,
      };
    },

    error(code: ErrorCode, message: string, relatedMessageId?: string): ErrorMessage {
      return {
        ...createBase(MessageType.Error),
        code,
        message,
        relatedMessageId,
      };
    },
  };
}

/**
 * Serialize a message for transport
 */
export function serializeMessage(message: Message): string {
  return JSON.stringify(message);
}

/**
 * Parse a message from transport
 */
export function parseMessage(data: string): Message {
  return JSON.parse(data) as Message;
}
