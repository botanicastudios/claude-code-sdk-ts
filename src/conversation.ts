import { InternalClient } from './_internal/client.js';
import { ResponseParser } from './parser.js';
import type {
  ClaudeCodeOptions,
  Message,
  TextBlock,
  UserMessage,
  ProcessCompleteHandler,
  ToolUseBlock,
  ToolResultBlock
} from './types.js';
import type { Logger } from './logger.js';

/**
 * Convert flexible input types to UserMessage content
 */
function normalizeUserContent(
  input: string | TextBlock | TextBlock[]
): string | Array<TextBlock | unknown> {
  if (typeof input === 'string') {
    return input;
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
    private client?: InternalClient,
    processCompleteHandlers: Array<ProcessCompleteHandler> = []
  ) {
    super(generator, handlers, logger, processCompleteHandlers);
  }

  protected async consume(): Promise<void> {
    if (this.consumed) return;

    this.logger?.debug('Consuming message generator with session tracking');

    for await (const message of this.generator) {
      this.logger?.debug('Received message', {
        type: message.type,
        sessionId: message.session_id
      });

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

  async stream(
    callback: (message: Message) => void | Promise<void>
  ): Promise<void> {
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
  private activeParser?: SessionAwareParser;
  private options: ClaudeCodeOptions;
  private currentSessionId: string | null = null;
  private streamHandlers: Array<
    (message: Message, sessionId: string | null) => void | Promise<void>
  > = [];
  private sessionIdHandlers: Array<(sessionId: string | null) => void> = [];
  private processCompleteHandlers: Array<ProcessCompleteHandler> = [];
  private logger?: Logger;
  private disposed = false;
  private _keepAlive: boolean;

  constructor(
    options: ClaudeCodeOptions,
    logger?: Logger,
    keepAlive: boolean = false,
    processCompleteHandlers: Array<ProcessCompleteHandler> = []
  ) {
    this.options = { ...options };
    this.currentSessionId = options.sessionId || null; // Get from QueryBuilder options
    this.logger = logger;
    this._keepAlive = keepAlive;
    this.processCompleteHandlers = processCompleteHandlers;
  }

  /**
   * Execute query and return response parser (familiar API)
   * Always creates new process for queries - returns familiar ResponseParser
   */
  query(prompt: string): ResponseParser {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this.logger?.info('Starting conversation query', {
      prompt,
      sessionId: this.currentSessionId
    });

    // Create internal client to process the query with streaming mode enabled
    const client = new InternalClient(
      prompt,
      {
        ...this.options,
        sessionId: this.currentSessionId || undefined,
        keepAlive: this._keepAlive // Pass keepAlive flag to client
      },
      true, // Enable streaming mode for conversations
      this.processCompleteHandlers
    );

    // Store as active client so send() can write to stdin of the same process
    this.activeClient = client;

    // Create session-aware parser that updates session ID when it receives responses
    const parser = new SessionAwareParser(
      client.processQuery(),
      [],
      this.logger,
      (newSessionId) => {
        this.updateSessionId(newSessionId);
      },
      (message) => this.emitMessage(message),
      client,
      this.processCompleteHandlers
    );

    // Store as active parser so end() can access already-processed messages
    this.activeParser = parser;

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
      typeof input === 'string'
        ? input.substring(0, 50) + (input.length > 50 ? '...' : '')
        : '[TextBlock content]';

    this.logger?.debug('Sending streaming input', {
      message: messagePreview,
      hasActiveClient,
      hasActiveTransport,
      activeClientType: this.activeClient ? 'InternalClient' : 'none'
    });

    try {
      if (this.activeClient?.hasActiveTransport()) {
        // Send to active process
        this.logger?.debug(
          'Found active transport - writing to stdin of existing process'
        );
        await this.activeClient.sendStreamingInput(userMessage);
        this.logger?.debug(
          'Successfully sent streaming input to active process stdin'
        );
      } else {
        // Start new client for fire-and-forget message processing
        this.logger?.debug('No active transport available', {
          reason: hasActiveClient
            ? 'client exists but transport inactive'
            : 'no active client',
          willSpawnNewProcess: true
        });

        // For new client, we need to extract string content for the prompt
        const promptText =
          typeof input === 'string'
            ? input
            : Array.isArray(input)
              ? input
                  .map((block) =>
                    block.type === 'text' ? block.text : '[non-text]'
                  )
                  .join(' ')
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
          true, // Use streaming mode so subsequent send() calls can write to stdin
          this.processCompleteHandlers
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
  stream(
    handler: (
      message: Message,
      sessionId: string | null
    ) => void | Promise<void>
  ): () => void {
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
   * Listen for process completion events
   * Returns unsubscribe function
   *
   * This is useful for knowing when all queued messages have been processed,
   * especially in streaming scenarios where you might receive result messages
   * before all input has been fully processed.
   *
   * @param handler Function called with (exitCode, error) when process terminates
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const conversation = claude().asConversation();
   *
   * conversation.onProcessComplete((exitCode, error) => {
   *   if (exitCode === 0) {
   *     console.log('All processing complete!');
   *   } else {
   *     console.log('Processing failed:', error);
   *   }
   * });
   *
   * const parser = conversation.query('Analyze this code');
   * await parser.asText();
   * ```
   */
  onProcessComplete(handler: ProcessCompleteHandler): () => void {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this.processCompleteHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.processCompleteHandlers.indexOf(handler);
      if (index > -1) {
        this.processCompleteHandlers.splice(index, 1);
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

    this.logger?.debug('Disposing conversation', {
      sessionId: this.currentSessionId
    });

    // Clean up active client
    if (this.activeClient) {
      try {
        await this.activeClient.dispose();
      } catch (error) {
        this.logger?.error('Error disposing active client', { error });
      }
      this.activeClient = undefined;
    }

    // Clean up active parser reference
    this.activeParser = undefined;

    // Clear handlers
    this.streamHandlers.length = 0;
    this.sessionIdHandlers.length = 0;
    this.processCompleteHandlers.length = 0;

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
   * Explicitly end the conversation and terminate the subprocess
   * If the last message was a tool use, waits for tool response before terminating
   * Returns a promise that resolves when the process exits
   */
  async end(): Promise<void> {
    if (this.disposed) {
      throw new Error('Conversation has been disposed');
    }

    this.logger?.debug('Ending conversation - terminating subprocess', {
      hasActiveClient: !!this.activeClient,
      hasActiveTransport: this.activeClient?.hasActiveTransport() ?? false
    });

    if (!this.activeClient?.hasActiveTransport()) {
      this.logger?.debug('No active transport to terminate');
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const pendingToolUseIds = new Set<string>();
      let hasFoundToolUse = false;
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      const terminateProcess = async () => {
        try {
          cleanup();
          unsubscribe();
          await this.activeClient!.terminate();
          this.activeClient = undefined;
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      // Helper function to check for pending tool uses in messages
      const checkForPendingToolUses = (messages: Message[]) => {
        const foundToolUses = new Set<string>();
        const completedToolUses = new Set<string>();

        for (const message of messages) {
          if (message.type === 'assistant' && message.content) {
            for (const block of message.content) {
              if (block.type === 'tool_use') {
                const toolUseBlock = block as ToolUseBlock;
                if (toolUseBlock.id) {
                  foundToolUses.add(toolUseBlock.id);
                  this.logger?.debug('Found existing tool use', {
                    toolUseId: toolUseBlock.id,
                    toolName: toolUseBlock.name
                  });
                }
              } else if (block.type === 'tool_result') {
                const toolResultBlock = block as ToolResultBlock;
                if (toolResultBlock.tool_use_id) {
                  completedToolUses.add(toolResultBlock.tool_use_id);
                  this.logger?.debug('Found existing tool result', {
                    toolUseId: toolResultBlock.tool_use_id
                  });
                }
              }
            }
          }
        }

        // Return only the tool uses that don't have corresponding results
        const pending = new Set<string>();
        for (const toolUseId of foundToolUses) {
          if (!completedToolUses.has(toolUseId)) {
            pending.add(toolUseId);
          }
        }

        return { pending, hasAnyToolUse: foundToolUses.size > 0 };
      };

      // Check if there's a SessionAwareParser we can get messages from
      const checkExistingMessages = async () => {
        if (this.activeParser) {
          try {
            // Get the already-processed messages from the active parser
            const messages = await this.activeParser.asArray();
            const { pending, hasAnyToolUse } =
              checkForPendingToolUses(messages);

            this.logger?.debug('Checked existing messages', {
              totalMessages: messages.length,
              hasAnyToolUse,
              pendingToolUses: pending.size
            });

            // If there are pending tool uses, add them to our tracking
            if (pending.size > 0) {
              for (const toolUseId of pending) {
                pendingToolUseIds.add(toolUseId);
              }
              hasFoundToolUse = true;
              this.logger?.debug(
                'Found pending tool uses in existing messages',
                {
                  pendingToolUseIds: Array.from(pendingToolUseIds)
                }
              );
            }
          } catch (error) {
            this.logger?.debug('Could not check existing messages:', { error });
          }
        }
      };

      // Set up a message handler to track tool use/response pairs
      const messageHandler = (message: Message) => {
        if (message.type === 'assistant' && message.content) {
          // Check for tool use blocks
          for (const block of message.content) {
            if (block.type === 'tool_use') {
              const toolUseBlock = block as ToolUseBlock;
              if (toolUseBlock.id) {
                pendingToolUseIds.add(toolUseBlock.id);
                hasFoundToolUse = true;
                this.logger?.debug('Found tool use, waiting for response', {
                  toolUseId: toolUseBlock.id,
                  toolName: toolUseBlock.name
                });
              }
            }
            // Check for tool result blocks
            else if (block.type === 'tool_result') {
              const toolResultBlock = block as ToolResultBlock;
              if (
                toolResultBlock.tool_use_id &&
                pendingToolUseIds.has(toolResultBlock.tool_use_id)
              ) {
                pendingToolUseIds.delete(toolResultBlock.tool_use_id);
                this.logger?.debug('Received tool response', {
                  toolUseId: toolResultBlock.tool_use_id,
                  remainingTools: pendingToolUseIds.size
                });

                // If no more pending tool uses, we can terminate
                if (pendingToolUseIds.size === 0) {
                  this.logger?.debug(
                    'All tool responses received, terminating'
                  );
                  terminateProcess();
                }
              }
            }
          }
        }
      };

      // Add temporary handler to monitor messages
      const unsubscribe = this.stream(messageHandler);

      // Set up a timeout to prevent hanging indefinitely
      timeoutId = setTimeout(() => {
        this.logger?.debug(
          'Timeout waiting for tool responses, terminating anyway'
        );
        terminateProcess();
      }, 30000); // 30 second timeout

      // Check existing messages first
      checkExistingMessages().then(() => {
        // If we don't find any tool use after checking existing messages and a brief delay, terminate immediately
        setTimeout(() => {
          if (!hasFoundToolUse) {
            this.logger?.debug('No tool use found, terminating immediately');
            terminateProcess();
          }
        }, 100);
      });
    });
  }
}
