import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { claude } from '../src/index.js';
import { Conversation } from '../src/conversation.js';
import type { Message } from '../src/types.js';

// Mock the InternalClient to avoid needing actual Claude CLI
vi.mock('../src/_internal/client.js', () => {
  return {
    InternalClient: vi
      .fn()
      .mockImplementation((prompt: string, _options: any) => {
        const mockMessages: Message[] = [
          {
            type: 'assistant',
            content: [{ type: 'text', text: `Response to: ${prompt}` }],
            session_id: 'mock-session-123'
          },
          {
            type: 'result',
            content: 'Query completed',
            session_id: 'mock-session-123'
          }
        ];

        return {
          async *processQuery() {
            for (const message of mockMessages) {
              yield message;
            }
          },
          getTransport: () => undefined,
          hasActiveTransport: () => false,
          sendStreamingInput: vi.fn(),
          terminate: vi.fn().mockResolvedValue(undefined),
          dispose: vi.fn()
        };
      })
  };
});

describe('Conversation Integration', () => {
  let conversation: Conversation;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (conversation && !conversation.isDisposed()) {
      await conversation.dispose();
    }
  });

  describe('Basic Functionality', () => {
    it('should create conversation from QueryBuilder', () => {
      conversation = claude().asConversation();
      expect(conversation).toBeInstanceOf(Conversation);
      expect(conversation.isDisposed()).toBe(false);
    });

    it('should create conversation with initial session ID', () => {
      conversation = claude().withSessionId('initial-session').asConversation();
      expect(conversation.getSessionId()).toBe('initial-session');
    });

    it('should execute query and return ResponseParser', async () => {
      conversation = claude().asConversation();
      const parser = conversation.query('Test prompt');

      expect(parser).toBeDefined();
      expect(typeof parser.asText).toBe('function');
      expect(typeof parser.getSessionId).toBe('function');
    });
  });

  describe('Session ID Management', () => {
    it('should track session ID changes automatically', async () => {
      conversation = claude().asConversation();

      const sessionIds: (string | null)[] = [];
      conversation.onSessionId((sessionId) => {
        sessionIds.push(sessionId);
      });

      const parser = conversation.query('Test prompt');
      await parser.asText();

      expect(sessionIds).toContain('mock-session-123');
      expect(conversation.getSessionId()).toBe('mock-session-123');
    });

    it('should update session ID from messages', async () => {
      conversation = claude().asConversation();

      let capturedSessionId: string | null = null;
      conversation.stream((_, sessionId) => {
        capturedSessionId = sessionId;
      });

      const parser = conversation.query('Test prompt');
      await parser.asText();

      expect(capturedSessionId).toBe('mock-session-123');
    });

    it('should extract session ID from completed queries', async () => {
      const builder = claude();
      const parser = builder.query('Test prompt');
      await parser.asText();

      const sessionId = await parser.getSessionId();
      expect(sessionId).toBe('mock-session-123');
    });
  });

  describe('Streaming and Handlers', () => {
    it('should register and unregister stream handlers', () => {
      conversation = claude().asConversation();

      const handler = vi.fn();
      const unsubscribe = conversation.stream(handler);

      expect(typeof unsubscribe).toBe('function');

      // Should not throw
      unsubscribe();
    });

    it('should register and unregister session ID handlers', () => {
      conversation = claude().asConversation();

      const handler = vi.fn();
      const unsubscribe = conversation.onSessionId(handler);

      expect(typeof unsubscribe).toBe('function');

      // Should not throw
      unsubscribe();
    });

    it('should call stream handlers for messages', async () => {
      conversation = claude().asConversation();

      const handler = vi.fn();
      conversation.stream(handler);

      const parser = conversation.query('Test prompt');
      await parser.asText();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Branching', () => {
    it('should support simple branching with withSessionId', async () => {
      const builder = claude();
      const parser = builder.query('Initial query');
      await parser.asText();

      const sessionId = await parser.getSessionId();
      expect(sessionId).toBe('mock-session-123');

      if (sessionId) {
        // Simple branching
        const branch1 = await builder
          .withSessionId(sessionId)
          .query('Branch 1')
          .asText();
        const branch2 = await builder
          .withSessionId(sessionId)
          .query('Branch 2')
          .asText();

        expect(branch1).toContain('Branch 1');
        expect(branch2).toContain('Branch 2');
      }
    });

    it('should support advanced branching with conversations', async () => {
      const builder = claude();
      const parser = builder.query('Initial query');
      await parser.asText();

      const sessionId = await parser.getSessionId();

      if (sessionId) {
        // Advanced branching
        const branchConversation = builder
          .withSessionId(sessionId)
          .asConversation();
        expect(branchConversation.getSessionId()).toBe(sessionId);

        const branchParser = branchConversation.query('Branch query');
        const result = await branchParser.asText();

        expect(result).toContain('Branch query');

        await branchConversation.dispose();
      }
    });
  });

  describe('Error Handling and Disposal', () => {
    it('should handle disposal correctly', async () => {
      conversation = claude().asConversation();

      expect(conversation.isDisposed()).toBe(false);

      await conversation.dispose();

      expect(conversation.isDisposed()).toBe(true);
    });

    it('should throw error when using disposed conversation', async () => {
      conversation = claude().asConversation();
      await conversation.dispose();

      expect(() => conversation.query('test')).toThrow(
        'Conversation has been disposed'
      );
      expect(() => conversation.stream(() => {})).toThrow(
        'Conversation has been disposed'
      );
      expect(() => conversation.onSessionId(() => {})).toThrow(
        'Conversation has been disposed'
      );
      await expect(conversation.send('test')).rejects.toThrow(
        'Conversation has been disposed'
      );
    });

    it('should handle stream handler errors gracefully', async () => {
      conversation = claude().asConversation();

      const goodHandler = vi.fn();
      const badHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });

      conversation.stream(goodHandler);
      conversation.stream(badHandler);

      const parser = conversation.query('Test prompt');

      // Should not throw despite bad handler
      await expect(parser.asText()).resolves.toBeDefined();

      expect(goodHandler).toHaveBeenCalled();
      expect(badHandler).toHaveBeenCalled();
    });

    it('should allow multiple dispose calls safely', async () => {
      conversation = claude().asConversation();

      await conversation.dispose();

      // Should not throw
      await expect(conversation.dispose()).resolves.toBeUndefined();
    });
  });

  describe('Multiple Queries in Conversation', () => {
    it('should handle multiple sequential queries', async () => {
      conversation = claude().asConversation();

      const parser1 = conversation.query('First query');
      const result1 = await parser1.asText();
      expect(result1).toContain('First query');

      const parser2 = conversation.query('Second query');
      const result2 = await parser2.asText();
      expect(result2).toContain('Second query');

      // Session ID should be consistent
      expect(conversation.getSessionId()).toBe('mock-session-123');
    });
  });

  describe('End Method', () => {
    it('should end conversation with no active transport', async () => {
      conversation = claude().asConversation();
      
      // Should resolve immediately when no active transport
      await expect(conversation.end()).resolves.toBeUndefined();
    });

    it('should handle disposed conversation', async () => {
      conversation = claude().asConversation();
      await conversation.dispose();
      
      await expect(conversation.end()).rejects.toThrow(
        'Conversation has been disposed'
      );
    });

    it('should terminate process immediately when no tool use found', async () => {
      const mockClient = {
        hasActiveTransport: () => true,
        terminate: vi.fn().mockResolvedValue(undefined),
      };

      conversation = claude().asConversation();
      // @ts-ignore - accessing private property for testing
      conversation.activeClient = mockClient;

      // Mock stream to return unsubscribe function
      conversation.stream = vi.fn().mockImplementation(() => {
        return () => {}; // unsubscribe function
      });

      const endPromise = conversation.end();
      await expect(endPromise).resolves.toBeUndefined();
      
      // Should terminate after brief delay when no tool use found
      expect(mockClient.terminate).toHaveBeenCalled();
    });

    it('should wait for tool responses before terminating', async () => {
      const mockClient = {
        hasActiveTransport: () => true,
        terminate: vi.fn().mockResolvedValue(undefined),
      };

      conversation = claude().asConversation();
      // @ts-ignore - accessing private property for testing
      conversation.activeClient = mockClient;

      let messageHandler: any;
      
      // Mock stream to capture the message handler
      conversation.stream = vi.fn().mockImplementation((handler) => {
        messageHandler = handler;
        return () => {}; // unsubscribe function
      });

      const endPromise = conversation.end();

      // Simulate tool use message
      const toolUseMessage = {
        type: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'test-tool-use-id',
            name: 'test-tool',
            input: {}
          }
        ]
      };

      // Send tool use message
      setTimeout(() => messageHandler(toolUseMessage), 10);

      // Send corresponding tool result message
      const toolResultMessage = {
        type: 'assistant' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'test-tool-use-id',
            content: 'Tool result'
          }
        ]
      };

      setTimeout(() => messageHandler(toolResultMessage), 20);

      await expect(endPromise).resolves.toBeUndefined();
      expect(mockClient.terminate).toHaveBeenCalled();
    });

    it('should timeout if tool responses take too long', async () => {
      const mockClient = {
        hasActiveTransport: () => true,
        terminate: vi.fn().mockResolvedValue(undefined),
      };

      conversation = claude().asConversation();
      // @ts-ignore - accessing private property for testing
      conversation.activeClient = mockClient;

      let messageHandler: any;
      
      // Mock stream to capture the message handler
      conversation.stream = vi.fn().mockImplementation((handler) => {
        messageHandler = handler;
        return () => {}; // unsubscribe function
      });

      // Mock timeout to be much shorter for testing
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn().mockImplementation((fn, ms) => {
        if (ms === 30000) { // Main timeout
          return originalSetTimeout(fn, 50); // Reduce to 50ms for testing
        }
        return originalSetTimeout(fn, ms);
      }) as any;

      const endPromise = conversation.end();

      // Simulate tool use message but never send response
      const toolUseMessage = {
        type: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'test-tool-use-id',
            name: 'test-tool',
            input: {}
          }
        ]
      };

      setTimeout(() => messageHandler(toolUseMessage), 10);

      // Should timeout and terminate
      await expect(endPromise).resolves.toBeUndefined();
      expect(mockClient.terminate).toHaveBeenCalled();

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    });

    it('should handle terminate errors gracefully', async () => {
      const mockClient = {
        hasActiveTransport: () => true,
        terminate: vi.fn().mockRejectedValue(new Error('Terminate failed')),
      };

      conversation = claude().asConversation();
      // @ts-ignore - accessing private property for testing
      conversation.activeClient = mockClient;

      // Mock stream to return unsubscribe function
      conversation.stream = vi.fn().mockImplementation(() => {
        return () => {}; // unsubscribe function
      });

      const endPromise = conversation.end();
      await expect(endPromise).rejects.toThrow('Terminate failed');
    });
  });
});
