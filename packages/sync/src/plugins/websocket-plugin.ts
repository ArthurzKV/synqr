/**
 * WebSocket Transport Plugin
 *
 * Provides real-time sync over WebSocket connections.
 */

import type { ReplicaId } from '@syncforge/core';
import {
  PluginType,
  ConnectionState,
  type TransportPlugin,
  type MessageCallback,
  type ConnectionCallback,
  type Unsubscribe,
  type ConnectionInfo,
} from '../plugin-interface.js';
import {
  type Message,
  parseMessage,
  serializeMessage,
  createMessageFactory,
  type DocumentState,
} from '../protocol.js';

/**
 * WebSocket plugin options
 */
export interface WebSocketPluginOptions {
  /** WebSocket server URL */
  url: string;
  /** Replica ID for this client */
  replicaId: ReplicaId;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Max reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in ms (0 = disabled) */
  heartbeatInterval?: number;
  /** Connection timeout in ms */
  connectionTimeout?: number;
  /** Initial documents to sync */
  documents?: DocumentState[];
}

/**
 * WebSocket transport plugin
 */
export class WebSocketPlugin implements TransportPlugin {
  readonly name = 'websocket';
  readonly type = PluginType.Transport;

  private ws: WebSocket | null = null;
  private options: Required<WebSocketPluginOptions>;
  private state: ConnectionState = ConnectionState.Disconnected;
  private messageCallbacks: Set<MessageCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private messageFactory;
  private pendingMessages: Message[] = [];

  constructor(options: WebSocketPluginOptions) {
    this.options = {
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      connectionTimeout: 10000,
      documents: [],
      ...options,
    };
    this.messageFactory = createMessageFactory(options.replicaId);
  }

  async onInit(): Promise<void> {
    // Nothing to initialize
  }

  async onDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    if (this.state === ConnectionState.Connected) {
      return;
    }

    this.setState(ConnectionState.Connecting);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.handleDisconnect();
      }, this.options.connectionTimeout);

      try {
        this.ws = new WebSocket(this.options.url);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.handleConnect();
          resolve();
        };

        this.ws.onclose = (event) => {
          clearTimeout(timeout);
          this.handleDisconnect(event.reason);
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        clearTimeout(timeout);
        this.setState(ConnectionState.Error);
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.clearTimers();

    if (this.ws) {
      // Send goodbye message
      try {
        const goodbye = this.messageFactory.goodbye('client_disconnect');
        this.ws.send(serializeMessage(goodbye));
      } catch {
        // Ignore errors when sending goodbye
      }

      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState(ConnectionState.Disconnected);
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.state === ConnectionState.Connected;
  }

  async send(message: Message): Promise<void> {
    if (!this.isConnected() || !this.ws) {
      // Queue message for later
      this.pendingMessages.push(message);
      return;
    }

    const data = serializeMessage(message);
    this.ws.send(data);
  }

  onMessage(callback: MessageCallback): Unsubscribe {
    this.messageCallbacks.add(callback);
    return () => {
      this.messageCallbacks.delete(callback);
    };
  }

  onConnectionChange(callback: ConnectionCallback): Unsubscribe {
    this.connectionCallbacks.add(callback);
    // Immediately notify of current state
    callback(this.state);
    return () => {
      this.connectionCallbacks.delete(callback);
    };
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      state: this.state,
      url: this.options.url,
      lastConnected: this.lastPong || undefined,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  // ============================================
  // Private methods
  // ============================================

  private setState(state: ConnectionState): void {
    if (this.state === state) return;

    this.state = state;

    for (const callback of this.connectionCallbacks) {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in connection callback:', error);
      }
    }
  }

  private handleConnect(): void {
    this.setState(ConnectionState.Connected);
    this.reconnectAttempts = 0;
    this.lastPong = Date.now();

    // Send hello message
    const hello = this.messageFactory.hello(this.options.documents);
    this.send(hello);

    // Start heartbeat
    this.startHeartbeat();

    // Send pending messages
    this.flushPendingMessages();
  }

  private handleDisconnect(reason?: string): void {
    this.clearTimers();
    this.ws = null;

    if (this.state === ConnectionState.Disconnected) {
      return;
    }

    if (this.options.autoReconnect && this.shouldReconnect()) {
      this.setState(ConnectionState.Reconnecting);
      this.scheduleReconnect();
    } else {
      this.setState(ConnectionState.Disconnected);
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = parseMessage(data);
      this.lastPong = Date.now();

      for (const callback of this.messageCallbacks) {
        try {
          callback(message);
        } catch (error) {
          console.error('Error in message callback:', error);
        }
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  private shouldReconnect(): boolean {
    if (this.options.maxReconnectAttempts === 0) {
      return true;
    }
    return this.reconnectAttempts < this.options.maxReconnectAttempts;
  }

  private scheduleReconnect(): void {
    const delay = this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    const maxDelay = 30000; // Cap at 30 seconds

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch((error) => {
        console.error('Reconnect failed:', error);
        if (this.shouldReconnect()) {
          this.scheduleReconnect();
        } else {
          this.setState(ConnectionState.Error);
        }
      });
    }, Math.min(delay, maxDelay));
  }

  private startHeartbeat(): void {
    if (this.options.heartbeatInterval <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected()) return;

      // Check if we've received a message recently
      const timeSinceLastPong = Date.now() - this.lastPong;
      if (timeSinceLastPong > this.options.heartbeatInterval * 2) {
        console.warn('Connection seems dead, reconnecting...');
        this.handleDisconnect('heartbeat_timeout');
        return;
      }

      // Send ping (as a presence query to any document)
      // This keeps the connection alive
    }, this.options.heartbeatInterval);
  }

  private flushPendingMessages(): void {
    const messages = this.pendingMessages;
    this.pendingMessages = [];

    for (const message of messages) {
      this.send(message).catch((error) => {
        console.error('Error sending pending message:', error);
        this.pendingMessages.push(message);
      });
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * Create a WebSocket plugin
 */
export function createWebSocketPlugin(options: WebSocketPluginOptions): WebSocketPlugin {
  return new WebSocketPlugin(options);
}
