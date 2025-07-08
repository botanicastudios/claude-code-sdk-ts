import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { claude } from '../src/index.js';
import { Conversation } from '../src/conversation.js';
import type { ProcessCompleteHandler } from '../src/types.js';

// Mock the InternalClient and SubprocessCLITransport
vi.mock('../src/_internal/client.js', () => {
  return {
    InternalClient: vi
      .fn()
      .mockImplementation(
        (prompt, options, streamingMode, processCompleteHandlers) => {
          // Store handlers to call them later
          const handlers = processCompleteHandlers || [];

          return {
            options: options || {},
            prompt: prompt || '',
            streamingMode: streamingMode || false,
            processCompleteHandlers: handlers,
            async *processQuery() {
              yield {
                type: 'assistant',
                content: [{ type: 'text', text: `Response to: ${prompt}` }],
                session_id: 'test-session'
              };
              yield {
                type: 'result',
                content: 'Query completed',
                session_id: 'test-session'
              };

              // Simulate process completion after yielding messages
              setTimeout(() => {
                handlers.forEach((handler: ProcessCompleteHandler) => {
                  try {
                    handler(0); // Success exit code
                  } catch (error) {
                    console.error('Handler error:', error);
                  }
                });
              }, 0);
            },
            getTransport: () => undefined,
            hasActiveTransport: () => false,
            sendStreamingInput: vi.fn(),
            closeStdin: vi.fn(),
            dispose: vi.fn()
          };
        }
      )
  };
});

describe('onProcessComplete Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('QueryBuilder.onProcessComplete', () => {
    it('should call handler on successful completion', async () => {
      const handler = vi.fn();

      await claude().onProcessComplete(handler).query('Test prompt').asText();

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });

    it('should call handler with error on failed completion', async () => {
      const handler = vi.fn();

      // Mock InternalClient to simulate process failure
      const { InternalClient } = await import('../src/_internal/client.js');
      vi.mocked(InternalClient).mockImplementation(
        (prompt, options, streamingMode, processCompleteHandlers) => {
          const handlers = processCompleteHandlers || [];

          return {
            async *processQuery() {
              yield {
                type: 'result',
                content: 'Query failed',
                session_id: 'test-session'
              };

              // Simulate process failure
              setTimeout(() => {
                const error = new Error('Process failed');
                (error as any).exitCode = 1;
                handlers.forEach((handler: ProcessCompleteHandler) => {
                  try {
                    handler(1, error);
                  } catch (e) {
                    console.error('Handler error:', e);
                  }
                });
              }, 0);
            },
            hasActiveTransport: () => false,
            dispose: vi.fn()
          };
        }
      );

      await claude().onProcessComplete(handler).query('Test prompt').asText();

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(1, expect.any(Error));
    });

    it('should support multiple handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      await claude()
        .onProcessComplete(handler1)
        .onProcessComplete(handler2)
        .query('Test prompt')
        .asText();

      // Wait for async handler calls
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler1).toHaveBeenCalledWith(0);
      expect(handler2).toHaveBeenCalledWith(0);
    });

    it('should work with fluent API chaining', async () => {
      const handler = vi.fn();

      const result = await claude()
        .withModel('sonnet')
        .onProcessComplete(handler)
        .skipPermissions()
        .query('Test prompt')
        .asText();

      expect(result).toContain('Response to: Test prompt');

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });
  });

  describe('Conversation.onProcessComplete', () => {
    let conversation: Conversation;

    afterEach(async () => {
      if (conversation && !conversation.isDisposed()) {
        await conversation.dispose();
      }
    });

    it('should call handler on query completion', async () => {
      const handler = vi.fn();

      conversation = claude().asConversation();
      conversation.onProcessComplete(handler);

      const parser = conversation.query('Test prompt');
      await parser.asText();

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });

    it('should call handler on send() completion', async () => {
      const handler = vi.fn();

      conversation = claude().asConversation();
      conversation.onProcessComplete(handler);

      await conversation.send('Test streaming input');

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();

      conversation = claude().asConversation();
      const unsubscribe = conversation.onProcessComplete(handler);

      expect(typeof unsubscribe).toBe('function');

      // Should not throw
      unsubscribe();
    });

    it('should not call handler after unsubscribe', async () => {
      const handler = vi.fn();

      conversation = claude().asConversation();
      const unsubscribe = conversation.onProcessComplete(handler);

      // Unsubscribe before query
      unsubscribe();

      const parser = conversation.query('Test prompt');
      await parser.asText();

      // Wait for potential async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple handlers and unsubscribe correctly', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      conversation = claude().asConversation();

      const unsubscribe1 = conversation.onProcessComplete(handler1);
      const unsubscribe2 = conversation.onProcessComplete(handler2);
      const unsubscribe3 = conversation.onProcessComplete(handler3);

      // Unsubscribe middle handler
      unsubscribe2();

      const parser = conversation.query('Test prompt');
      await parser.asText();

      // Wait for async handler calls
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler1).toHaveBeenCalledWith(0);
      expect(handler2).not.toHaveBeenCalled();
      expect(handler3).toHaveBeenCalledWith(0);
    });

    it('should throw error if conversation is disposed', async () => {
      conversation = claude().asConversation();
      await conversation.dispose();

      expect(() => {
        conversation.onProcessComplete(vi.fn());
      }).toThrow('Conversation has been disposed');
    });

    it('should clear handlers on dispose', async () => {
      const handler = vi.fn();

      conversation = claude().asConversation();
      conversation.onProcessComplete(handler);

      await conversation.dispose();

      // Handler should not be called after dispose
      expect(handler).not.toHaveBeenCalled();
    });

    it('should work with keepAlive conversations', async () => {
      const handler = vi.fn();

      conversation = claude().asConversation(true); // keepAlive = true
      conversation.onProcessComplete(handler);

      const parser = conversation.query('Test prompt');
      await parser.asText();

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });
  });

  describe('Integration with existing APIs', () => {
    it('should work with onMessage handlers', async () => {
      const messageHandler = vi.fn();
      const processHandler = vi.fn();

      await claude()
        .onMessage(messageHandler)
        .onProcessComplete(processHandler)
        .query('Test prompt')
        .asText();

      // Wait for async handler calls
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(messageHandler).toHaveBeenCalledTimes(2); // assistant + result
      expect(processHandler).toHaveBeenCalledWith(0);
    });

    it('should work with streaming', async () => {
      const streamHandler = vi.fn();
      const processHandler = vi.fn();

      await claude()
        .onProcessComplete(processHandler)
        .query('Test prompt')
        .stream(streamHandler);

      // Wait for async handler calls
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(streamHandler).toHaveBeenCalledTimes(2); // assistant + result
      expect(processHandler).toHaveBeenCalledWith(0);
    });

    it('should work with asResult()', async () => {
      const handler = vi.fn();

      const result = await claude()
        .onProcessComplete(handler)
        .query('Test prompt')
        .asResult();

      expect(result).toBe('Query completed');

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });

    it('should work with asJSON()', async () => {
      const handler = vi.fn();

      // Mock response with JSON
      const { InternalClient } = await import('../src/_internal/client.js');
      vi.mocked(InternalClient).mockImplementation(
        (prompt, options, streamingMode, processCompleteHandlers) => {
          const handlers = processCompleteHandlers || [];

          return {
            async *processQuery() {
              yield {
                type: 'assistant',
                content: [{ type: 'text', text: '{"status": "success"}' }],
                session_id: 'test-session'
              };
              yield {
                type: 'result',
                content: 'Query completed',
                session_id: 'test-session'
              };

              setTimeout(() => {
                handlers.forEach((handler: ProcessCompleteHandler) => {
                  try {
                    handler(0);
                  } catch (error) {
                    console.error('Handler error:', error);
                  }
                });
              }, 0);
            },
            hasActiveTransport: () => false,
            dispose: vi.fn()
          };
        }
      );

      const result = await claude()
        .onProcessComplete(handler)
        .query('Test prompt')
        .asJSON();

      expect(result).toEqual({ status: 'success' });

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });
  });

  describe('Error handling', () => {
    it('should handle exceptions in process complete handlers', async () => {
      const faultyHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      // Should not throw even if handler throws
      await expect(
        claude()
          .onProcessComplete(faultyHandler)
          .onProcessComplete(goodHandler)
          .query('Test prompt')
          .asText()
      ).resolves.not.toThrow();

      // Wait for async handler calls
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(faultyHandler).toHaveBeenCalledWith(0);
      expect(goodHandler).toHaveBeenCalledWith(0);
    });

    it('should handle process termination without hanging', async () => {
      const handler = vi.fn();

      // Mock process that terminates quickly
      const { InternalClient } = await import('../src/_internal/client.js');
      vi.mocked(InternalClient).mockImplementation(
        (prompt, options, streamingMode, processCompleteHandlers) => {
          const handlers = processCompleteHandlers || [];

          return {
            async *processQuery() {
              // Immediate termination
              setTimeout(() => {
                handlers.forEach((handler: ProcessCompleteHandler) => {
                  try {
                    handler(0);
                  } catch (error) {
                    console.error('Handler error:', error);
                  }
                });
              }, 0);
            },
            hasActiveTransport: () => false,
            dispose: vi.fn()
          };
        }
      );

      const result = await claude()
        .onProcessComplete(handler)
        .query('Test prompt')
        .asText();

      expect(result).toBe('');

      // Wait for async handler call
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(0);
    });
  });
});
