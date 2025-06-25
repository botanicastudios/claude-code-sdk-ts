import { InternalClient } from './_internal/client.js';
import { ResponseParser } from './parser.js';
import type { ClaudeCodeOptions, Message, TextBlock, UserMessage } from './types.js';
import type { Logger } from './logger.js';

/**
 * Convert flexible input types to UserMessage content
 */
function normalizeUserContent(input: string | TextBlock | TextBlock[]): string | Array<TextBlock | unknown> {
  if (typeof input === 'string') {
    return [{ type: 'text', text: input }];
  }
  if (Array.isArray(input)) {
    return input;
  }
  return [input];
}

/**
 * Session-aware ResponseParser that updates conversation session ID
 */
class SessionAwareParser extends ResponseParser {
  constructor(
    generator: AsyncGenerator<Message>,
    handlers: Array<(message: Message) => void>,
    logger: Logger | undefined,
    private onSessionUpdate: (sessionId: string | null) => void,
    private onMessage: (message: Message) => Promise<void>,
    private client?: InternalClient
  ) {
    super(generator, handlers, logger);
  }

  protected async consume(): Promise<void> {
    if (this.consumed) return;

    this.logger?.debug('Consuming message generator with session tracking');

    for await (const message of this.generator) {
      this.logger?.debug('Received message', { type: message.type, sessionId: message.session_id });

      // Update session ID when received
      if (message.session_id) {
        this.onSessionUpdate(message.session_id);
      }

      // Emit to conversation handlers
      await this.onMessage(message);

      // Run handlers
      for (const handler of this.handlers) {
        try {
          handler(message);
        } catch (error) {
          this.logger?.error('Message handler error', { error });
        }
      }

      this.messages.push(message);
    }

    this.consumed = true;
    this.logger?.debug('Message generator consumed', {
      messageCount: this.messages.length
    });
  }

  async stream(callback: (message: Message) => void | Promise<void>): Promise<void> {
    for await (const message of this.generator) {
      // Update session ID when received
      if (message.session_id) {
        this.onSessionUpdate(message.session_id);
      }

      // Emit to conversation handlers
      await this.onMessage(message);

      // Run handlers
      for (const handler of this.handlers) {
        try {
          handler(message);
        } catch (error) {
          this.logger?.error('Message handler error', { error });
        }
      }

      // Store message
      this.messages.push(message);

      // Run callback
      await callback(message);
    }

    this.consumed = true;
  }

  /**
   * Get the internal client for accessing transport
   */
  getClient(): InternalClient | undefined {
    return this.client;
  }
}

/**
 * Conversation class for streaming input capability and multi-turn dialogue
 *
 * Provides three core methods:
 * - query(prompt): Returns familiar ResponseParser for structured responses
 * - send(message): Fire-and-forget streaming input
 * - stream(handler): Stateless event observation with session ID
 *
 * @example
 * ```typescript
 * const conversation = claude().asConversation();
 *
 * // Set up conversation-wide streaming
 * conversation.stream((message, sessionId) => {
 *   console.log('Got message:', message, 'Session:', sessionId);
 * });
 *
 * // Normal queries return ResponseParser
 * const parser = conversation.query('Create a React app');
 *
 * // Send streaming input while it's running
 * await conversation.send('Add TypeScript support');
 *
 * const result = await parser.asText();
 * ```
 */
export class Conversation {
  private activeClient?: InternalClient;
  private options: ClaudeCodeOptions;
  private currentSessionId: string | null = null;
  private streamHandlers: Array<(message: Message, sessionId: string | null) => void | Promise<void>> = [];
  private sessionIdHandlers: Array<(sessionId: string | null) => void> = [];
  private logger?: Logger;
  private disposed = false;
  private _keepAlive: boolean;

  constructor(options: ClaudeCodeOptions, logger?: Logger, keepAlive: boolean = false) {
    this.options = { ...options };
    this.currentSessionId = options.sessionId || null; // Get from QueryBuilder options
    this.logger = logger;
    this._keepAlive = keepAlive;
  }

  /**
   * Execute query and return response parser (familiar API)
   * Always creates new process for queries - returns familiar ResponseParser
   */
  query(prompt: string): ResponseParser {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this.logger?.info('Starting conversation query', { prompt, sessionId: this.currentSessionId });

    // Create internal client to process the query with streaming mode enabled
    const client = new InternalClient(
      prompt,
      {
        ...this.options,
        sessionId: this.currentSessionId || undefined,
        keepAlive: this._keepAlive // Pass keepAlive flag to client
      },
      true
    ); // Enable streaming mode for conversations

    // Store as active client so send() can write to stdin of the same process
    this.activeClient = client;

    // Create session-aware parser that updates session ID when it receives responses
    const parser = new SessionAwareParser(
      client.processQuery(),
      [],
      this.logger,
      newSessionId => {
        this.updateSessionId(newSessionId);
      },
      message => this.emitMessage(message),
      client
    );

    return parser;
  }

  /**
   * Send streaming input (fire-and-forget with error handling)
   * Resolves when message is delivered to stdin, not when response received
   */
  async send(input: string | TextBlock | TextBlock[]): Promise<void> {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    // Create UserMessage from flexible input
    const userMessage: UserMessage = {
      type: 'user',
      content: normalizeUserContent(input),
      session_id: this.currentSessionId || undefined
    };

    const hasActiveClient = !!this.activeClient;
    const hasActiveTransport = this.activeClient?.hasActiveTransport() ?? false;

    const messagePreview =
      typeof input === 'string' ? input.substring(0, 50) + (input.length > 50 ? '...' : '') : '[TextBlock content]';

    this.logger?.debug('Sending streaming input', {
      message: messagePreview,
      hasActiveClient,
      hasActiveTransport,
      activeClientType: this.activeClient ? 'InternalClient' : 'none'
    });

    try {
      if (this.activeClient?.hasActiveTransport()) {
        // Send to active process
        this.logger?.debug('Found active transport - writing to stdin of existing process');
        await this.activeClient.sendStreamingInput(userMessage);
        this.logger?.debug('Successfully sent streaming input to active process stdin');
      } else {
        // Start new client for fire-and-forget message processing
        this.logger?.debug('No active transport available', {
          reason: hasActiveClient ? 'client exists but transport inactive' : 'no active client',
          willSpawnNewProcess: true
        });

        // For new client, we need to extract string content for the prompt
        const promptText =
          typeof input === 'string'
            ? input
            : Array.isArray(input)
              ? input.map(block => (block.type === 'text' ? block.text : '[non-text]')).join(' ')
              : input.type === 'text'
                ? input.text
                : '[non-text]';

        const client = new InternalClient(
          promptText,
          {
            ...this.options,
            sessionId: this.currentSessionId || undefined,
            keepAlive: this._keepAlive // Pass keepAlive flag to client
          },
          true // Use streaming mode so subsequent send() calls can write to stdin
        );

        // Store as active client so future send() calls can use it
        this.activeClient = client;

        // Process messages in background (fire-and-forget)
        (async () => {
          try {
            for await (const response of client.processQuery()) {
              await this.emitMessage(response);
            }
          } catch (error) {
            this.logger?.error('Error processing send() message', { error });
          }
        })();
      }
    } catch (error) {
      this.logger?.error('Failed to send streaming input', { error });
      throw error;
    }
  }

  /**
   * Observe all conversation activity (stateless event registration)
   * Returns unsubscribe function
   */
  stream(handler: (message: Message, sessionId: string | null) => void | Promise<void>): () => void {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this.streamHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.streamHandlers.indexOf(handler);
      if (index > -1) {
        this.streamHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Get current session ID for branching
   */
  getSessionId(): string | null {
    return this.currentSessionId; // Simple - just the latest
  }

  /**
   * Listen for session ID changes
   * Returns unsubscribe function
   */
  onSessionId(callback: (sessionId: string | null) => void): () => void {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this.sessionIdHandlers.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.sessionIdHandlers.indexOf(callback);
      if (index > -1) {
        this.sessionIdHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Check if the conversation has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Enable or disable keep-alive mode for persistent conversations
   * When enabled, the conversation will stay alive across multiple request-response cycles
   * until explicitly ended with conversation.end()
   * @param enabled - Whether to enable keep-alive mode (default: true)
   * @returns this conversation instance for chaining
   */
  keepAlive(enabled: boolean = true): Conversation {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this._keepAlive = enabled;
    this.logger?.debug('Updated keepAlive setting', { keepAlive: enabled });

    return this;
  }

  /**
   * Dispose of conversation resources and clean up
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    this.logger?.debug('Disposing conversation', { sessionId: this.currentSessionId });

    // Clean up active client
    if (this.activeClient) {
      try {
        await this.activeClient.dispose();
      } catch (error) {
        this.logger?.error('Error disposing active client', { error });
      }
      this.activeClient = undefined;
    }

    // Clear handlers
    this.streamHandlers.length = 0;
    this.sessionIdHandlers.length = 0;

    this.disposed = true;
  }

  private updateSessionId(newSessionId: string | null) {
    if (this.currentSessionId !== newSessionId) {
      this.logger?.debug('Updating conversation session ID', {
        from: this.currentSessionId,
        to: newSessionId
      });

      this.currentSessionId = newSessionId;

      // Notify session ID listeners
      for (const handler of this.sessionIdHandlers) {
        try {
          handler(newSessionId);
        } catch (error) {
          this.logger?.error('Session ID handler error', { error });
        }
      }
    }
  }

  private async emitMessage(message: Message) {
    // Auto-update session ID from any message
    if (message.session_id) {
      this.updateSessionId(message.session_id);
    }

    // Emit to all stream handlers
    for (const handler of this.streamHandlers) {
      try {
        await handler(message, this.currentSessionId);
      } catch (error) {
        this.logger?.error('Stream handler error', { error });
        // Continue with other handlers - don't break conversation flow
      }
    }
  }

  /**
   * Explicitly end the conversation and close stdin
   * This allows the active process to exit gracefully
   */
  async end(): Promise<void> {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this.logger?.debug('Ending conversation - closing stdin of active process', {
      hasActiveClient: !!this.activeClient,
      hasActiveTransport: this.activeClient?.hasActiveTransport() ?? false
    });

    if (this.activeClient?.hasActiveTransport()) {
      this.activeClient.closeStdin();
      this.logger?.debug('Closed stdin of active process');

      // Clear active client since process will exit
      this.activeClient = undefined;
    } else {
      this.logger?.debug('No active transport to close');
    }
  }
}
