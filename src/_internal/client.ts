import { SubprocessCLITransport } from './transport/subprocess-cli.js';
import type { ClaudeCodeOptions, Message } from '../types.js';
import { ClaudeSDKError } from '../errors.js';

export class InternalClient {
  private options: ClaudeCodeOptions;
  private prompt: string;
  private transport?: SubprocessCLITransport;
  private streamingMode: boolean;

  constructor(prompt: string, options: ClaudeCodeOptions = {}, streamingMode: boolean = false) {
    this.prompt = prompt;
    this.options = options;
    this.streamingMode = streamingMode;
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
    this.transport = new SubprocessCLITransport(this.prompt, this.options, this.streamingMode, this.options.keepAlive);

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
  async sendStreamingInput(message: string): Promise<void> {
    if (!this.transport?.isActive()) {
      throw new Error('No active transport for streaming input');
    }

    this.options.debug &&
      console.error('DEBUG: Sending streaming input to active transport:', message.substring(0, 50) + '...');

    const jsonlMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: message }]
      }
    };

    this.options.debug &&
      console.error('DEBUG: Writing JSONL to stdin:', JSON.stringify(jsonlMessage).substring(0, 100) + '...');

    this.transport.writeToStdin(JSON.stringify(jsonlMessage) + '\n');

    this.options.debug && console.error('DEBUG: Successfully wrote JSONL message to stdin');
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
          content: output.result || '',
          usage: output.usage,
          cost: {
            total_cost: output.total_cost_usd
          },
          session_id: output.session_id
        };

      case 'error':
        throw new ClaudeSDKError(`CLI error: ${output.error?.message || 'Unknown error'}`);

      default:
        // Skip unknown message types
        return null;
    }
  }
}
