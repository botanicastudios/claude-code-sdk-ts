import { SubprocessCLITransport } from './transport/subprocess-cli.js';
import type {
  ClaudeCodeOptions,
  Message,
  UserMessage,
  ProcessCompleteHandler
} from '../types.js';
import { ClaudeSDKError } from '../errors.js';

export class InternalClient {
  private options: ClaudeCodeOptions;
  private prompt: string;
  private transport?: SubprocessCLITransport;
  private streamingMode: boolean;
  private processCompleteHandlers: Array<ProcessCompleteHandler>;

  constructor(
    prompt: string,
    options: ClaudeCodeOptions = {},
    streamingMode: boolean = false,
    processCompleteHandlers: Array<ProcessCompleteHandler> = []
  ) {
    this.prompt = prompt;
    this.options = options;
    this.streamingMode = streamingMode;
    this.processCompleteHandlers = processCompleteHandlers;
  }

  /**
   * Get the active transport for streaming input
   */
  getTransport(): SubprocessCLITransport | undefined {
    return this.transport;
  }

  /**
   * Check if there's an active transport that can accept streaming input
   */
  hasActiveTransport(): boolean {
    return !!this.transport?.isActive();
  }

  async *processQuery(): AsyncGenerator<Message> {
    this.transport = new SubprocessCLITransport(
      this.prompt,
      this.options,
      this.streamingMode,
      this.options.keepAlive,
      this.processCompleteHandlers
    );

    try {
      await this.transport.connect();

      for await (const output of this.transport.receiveMessages()) {
        const message = this.parseMessage(output);
        if (message) {
          yield message;
        }
      }
    } finally {
      // For non-streaming mode, disconnect immediately
      // For streaming mode, keep transport alive for potential streaming input
      if (!this.streamingMode && this.transport) {
        await this.transport.disconnect();
      }
      // Keep transport reference for potential streaming input until explicitly disposed
    }
  }

  /**
   * Send streaming input to active transport
   */
  async sendStreamingInput(userMessage: UserMessage): Promise<void> {
    if (!this.transport?.isActive()) {
      throw new Error('No active transport for streaming input');
    }

    const messagePreview =
      typeof userMessage.content === 'string'
        ? userMessage.content.substring(0, 50) + '...'
        : '[content blocks]';

    this.options.debug &&
      console.error(
        'DEBUG: Sending streaming input to active transport:',
        messagePreview
      );

    const jsonlMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: userMessage.content
      }
    };

    this.options.debug &&
      console.error(
        'DEBUG: Writing JSONL to stdin:',
        JSON.stringify(jsonlMessage).substring(0, 100) + '...'
      );

    this.transport.writeToStdin(JSON.stringify(jsonlMessage) + '\n');

    this.options.debug &&
      console.error('DEBUG: Successfully wrote JSONL message to stdin');
  }

  /**
   * Close stdin to signal end of streaming input
   */
  closeStdin(): void {
    if (this.transport) {
      this.transport.closeStdin();
    }
  }

  /**
   * Clean up transport resources
   */
  async dispose(): Promise<void> {
    if (this.transport) {
      // For streaming mode, close stdin first to allow process to exit gracefully
      if (this.streamingMode) {
        this.transport.closeStdin();
      }
      await this.transport.disconnect();
      this.transport = undefined;
    }
  }

  private parseMessage(output: any): Message | null {
    // Handle stream-json format directly from CLI
    switch (output.type) {
      case 'user':
        return {
          type: 'user',
          content: output.message?.content || '',
          session_id: output.session_id
        };

      case 'assistant':
        return {
          type: 'assistant',
          content: output.message?.content || [],
          session_id: output.session_id
        };

      case 'system':
        return {
          type: 'system',
          subtype: output.subtype,
          data: output,
          session_id: output.session_id
        };

      case 'result':
        return {
          type: 'result',
          subtype: output.subtype,
          is_error: output.is_error,
          content: output.result || '',
          result: output.result || '',
          usage: output.usage,
          cost: {
            total_cost: output.total_cost_usd
          },
          session_id: output.session_id
        };

      case 'error':
        throw new ClaudeSDKError(
          `CLI error: ${output.error?.message || 'Unknown error'}`
        );

      default:
        // Skip unknown message types
        return null;
    }
  }
}
