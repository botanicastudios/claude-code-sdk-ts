import { query as baseQuery } from './index.js';
import type {
  ClaudeCodeOptions,
  Message,
  ToolName,
  PermissionMode,
  MCPServer,
  ProcessCompleteHandler
} from './types.js';
import { ResponseParser } from './parser.js';
import { Logger } from './logger.js';
import { Conversation } from './conversation.js';

/**
 * Fluent API for building Claude Code queries with chainable methods
 *
 * @example
 * ```typescript
 * const result = await claude()
 *   .withModel('opus')
 *   .allowTools('Read', 'Write')
 *   .skipPermissions()
 *   .withTimeout(30000)
 *   .onMessage(msg => console.log('Got:', msg.type))
 *   .onProcessComplete((exitCode, error) => {
 *     if (exitCode === 0) {
 *       console.log('All processing complete!');
 *     } else {
 *       console.log('Processing failed:', error);
 *     }
 *   })
 *   .query('Create a README file')
 *   .asText();
 * ```
 */
export class QueryBuilder {
  protected options: ClaudeCodeOptions = {};
  protected messageHandlers: Array<(message: Message) => void> = [];
  protected processCompleteHandlers: Array<ProcessCompleteHandler> = [];
  protected logger?: Logger;

  /**
   * Set the model to use
   */
  withModel(model: string): this {
    this.options.model = model;
    return this;
  }

  /**
   * Set allowed tools
   */
  allowTools(...tools: ToolName[]): this {
    this.options.allowedTools = tools;
    return this;
  }

  /**
   * Set denied tools
   */
  denyTools(...tools: ToolName[]): this {
    this.options.deniedTools = tools;
    return this;
  }

  /**
   * Set permission mode
   */
  withPermissions(mode: PermissionMode): this {
    this.options.permissionMode = mode;
    return this;
  }

  /**
   * Skip all permissions (shorthand for bypassPermissions)
   */
  skipPermissions(): this {
    this.options.permissionMode = 'bypassPermissions';
    return this;
  }

  /**
   * Accept all edits automatically
   */
  acceptEdits(): this {
    this.options.permissionMode = 'acceptEdits';
    return this;
  }

  /**
   * Set working directory
   */
  inDirectory(cwd: string): this {
    this.options.cwd = cwd;
    return this;
  }

  /**
   * Set environment variables
   */
  withEnv(env: Record<string, string>): this {
    this.options.env = { ...this.options.env, ...env };
    return this;
  }

  /**
   * Set timeout in milliseconds
   */
  withTimeout(ms: number): this {
    this.options.timeout = ms;
    return this;
  }

  /**
   * Set custom path to Claude Code executable
   */
  withExecutable(path: string): this {
    this.options.executablePath = path;
    return this;
  }

  /**
   * Set wrapper command to run the CLI through (e.g., 'wsl.exe', 'node')
   */
  withCommand(...command: string[]): this {
    this.options.wrapperCommand = command;
    return this;
  }

  /**
   * Set session ID for continuing an existing conversation
   */
  withSessionId(sessionId: string): this {
    this.options.sessionId = sessionId;
    return this;
  }

  /**
   * Set maximum number of turns/iterations
   */
  withMaxTurns(turns: number): this {
    this.options.maxTurns = turns;
    return this;
  }

  /**
   * Set system prompt
   */
  withSystemPrompt(prompt: string): this {
    this.options.systemPrompt = prompt;
    return this;
  }

  /**
   * Append to system prompt
   */
  appendSystemPrompt(prompt: string): this {
    this.options.appendSystemPrompt = prompt;
    return this;
  }

  /**
   * Enable debug mode
   */
  debug(enabled = true): this {
    this.options.debug = enabled;
    return this;
  }

  /**
   * Add MCP servers
   */
  withMCP(servers: Record<string, MCPServer>): this {
    if (!this.options.mcpServers) {
      this.options.mcpServers = {};
    }
    this.options.mcpServers = { ...this.options.mcpServers, ...servers };
    return this;
  }

  /**
   * Add directory(-ies) to include in the context
   */
  addDirectory(directories: string | string[]): this {
    if (!this.options.addDirectories) {
      this.options.addDirectories = [];
    }
    const dirsToAdd = Array.isArray(directories) ? directories : [directories];
    this.options.addDirectories.push(...dirsToAdd);
    return this;
  }

  /**
   * Set logger
   */
  withLogger(logger: Logger): this {
    this.logger = logger;
    return this;
  }

  /**
   * Add message handler
   */
  onMessage(handler: (message: Message) => void): this {
    this.messageHandlers.push(handler);
    return this;
  }

  /**
   * Add process complete handler - called when the subprocess terminates
   *
   * This is useful for knowing when all queued messages have been processed,
   * especially in streaming scenarios where you might receive result messages
   * before all input has been fully processed.
   *
   * @param handler Function called with (exitCode, error) when process terminates
   * @returns this QueryBuilder instance for chaining
   *
   * @example
   * ```typescript
   * await claude()
   *   .onProcessComplete((exitCode, error) => {
   *     if (exitCode === 0) {
   *       console.log('All processing complete!');
   *     } else {
   *       console.log('Processing failed:', error);
   *     }
   *   })
   *   .query('Analyze this codebase')
   *   .asText();
   * ```
   */
  onProcessComplete(handler: ProcessCompleteHandler): this {
    this.processCompleteHandlers.push(handler);
    return this;
  }

  /**
   * Add handler for specific message type
   */
  onAssistant(handler: (content: any) => void): this {
    this.messageHandlers.push((msg) => {
      if (msg.type === 'assistant') {
        handler((msg as any).content);
      }
    });
    return this;
  }

  /**
   * Add handler for tool usage
   */
  onToolUse(handler: (tool: { name: string; input: any }) => void): this {
    this.messageHandlers.push((msg) => {
      if (msg.type === 'assistant') {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            handler({ name: block.name, input: block.input });
          }
        }
      }
    });
    return this;
  }

  /**
   * Execute query and return response parser
   */
  query(prompt: string): ResponseParser {
    const parser = new ResponseParser(
      baseQuery(prompt, this.options, this.processCompleteHandlers),
      this.messageHandlers,
      this.logger,
      this.processCompleteHandlers
    );
    return parser;
  }

  /**
   * Create a conversation for streaming input capability
   * @param keepAlive - If true, keeps the process alive across multiple exchanges until conversation.end() is called
   * @returns Conversation instance for multi-turn dialogue
   */
  asConversation(keepAlive: boolean = false): Conversation {
    return new Conversation(
      this.options,
      this.logger,
      keepAlive,
      this.processCompleteHandlers
    );
  }

  /**
   * Execute query and return raw async generator (for backward compatibility)
   */
  async *queryRaw(prompt: string): AsyncGenerator<Message> {
    this.logger?.info('Starting query', { prompt, options: this.options });

    for await (const message of baseQuery(
      prompt,
      this.options,
      this.processCompleteHandlers
    )) {
      this.logger?.debug('Received message', { type: message.type });

      // Run handlers
      for (const handler of this.messageHandlers) {
        try {
          handler(message);
        } catch (error) {
          this.logger?.error('Message handler error', { error });
        }
      }

      yield message;
    }

    this.logger?.info('Query completed');
  }

  /**
   * Static factory method for cleaner syntax
   */
  static create(): QueryBuilder {
    return new QueryBuilder();
  }
}

/**
 * Factory function for creating a new query builder
 *
 * @example
 * ```typescript
 * const response = await claude()
 *   .withModel('sonnet')
 *   .query('Hello')
 *   .asText();
 * ```
 */
export function claude(): QueryBuilder {
  return new QueryBuilder();
}

// Re-export for convenience
export { ResponseParser } from './parser.js';
export { Logger, LogLevel, ConsoleLogger } from './logger.js';
export { Conversation } from './conversation.js';
