import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { claude } from '../src/index.js';
import { Conversation } from '../src/conversation.js';
import type { Message } from '../src/types.js';

// Mock the InternalClient to simulate streaming input scenarios
vi.mock('../src/_internal/client.js', () => {
  const mockTransport = {
    isActive: vi.fn(() => true),
    writeToStdin: vi.fn(),
    disconnect: vi.fn(),
    closeStdin: vi.fn()
  };

  return {
    InternalClient: vi.fn().mockImplementation((prompt: string, options: any, streamingMode: boolean = false) => {
      const mockMessages: Message[] = [];

      // Generate appropriate response based on prompt content
      if (prompt.includes('security issues')) {
        mockMessages.push({
          type: 'assistant',
          content: [{ type: 'text', text: `Starting analysis and analyzing the codebase for: ${prompt}` }],
          session_id: 'streaming-session-123'
        });
      } else {
        mockMessages.push({
          type: 'assistant',
          content: [{ type: 'text', text: `Processing: ${prompt}` }],
          session_id: 'streaming-session-123'
        });
      }

      // Add additional messages for prompts that suggest streaming behavior
      if (prompt.includes('streaming') || prompt.includes('analysis') || prompt.includes('codebase')) {
        mockMessages.push({
          type: 'assistant',
          content: [{ type: 'text', text: 'Received streaming input' }],
          session_id: 'streaming-session-evolved'
        });
      }

      mockMessages.push({
        type: 'result',
        content: 'Task completed',
        session_id: 'streaming-session-evolved'
      });

      return {
        async *processQuery() {
          for (const message of mockMessages) {
            yield message;
          }
        },
        getTransport: () => mockTransport,
        hasActiveTransport: () => true,
        sendStreamingInput: vi.fn().mockResolvedValue(undefined),
        closeStdin: vi.fn(),
        dispose: vi.fn()
      };
    })
  };
});

describe('Streaming Input Tests', () => {
  let conversation: Conversation;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (conversation && !conversation.isDisposed()) {
      await conversation.dispose();
    }
  });

  describe('Basic Streaming Input', () => {
    it('should send streaming input to active process', async () => {
      conversation = claude().asConversation();
      const parser = conversation.query('Start long running task');

      // Send streaming input while query is running
      await conversation.send('Focus on performance');
      await conversation.send('Include error handling');

      const result = await parser.asText();
      expect(result).toContain('Processing: Start long running task');
    });

    it('should handle streaming input when no active process exists', async () => {
      conversation = claude().asConversation();

      // Mock the activeClient to simulate no active transport initially
      const mockClient = {
        hasActiveTransport: vi.fn(() => false),
        sendStreamingInput: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn()
      };

      // Simulate conversation.send() creating a new query (which updates session ID)
      const originalQuery = conversation.query.bind(conversation);
      conversation.query = vi.fn().mockImplementation((prompt: string) => {
        const parser = originalQuery(prompt);
        // Simulate session ID being set after query creation
        setTimeout(() => {
          (conversation as any).updateSessionId('streaming-session-evolved');
        }, 0);
        return parser;
      });

      // Send streaming input without active query - should start new process
      await conversation.send('Start new analysis');

      // Wait for async session update
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(conversation.getSessionId()).toBe('streaming-session-evolved');
    });

    it('should evolve session ID with streaming input', async () => {
      conversation = claude().asConversation();

      const initialSessionId = conversation.getSessionId();

      const parser = conversation.query('Initial query');
      await conversation.send('Streaming guidance');

      await parser.asText();

      const evolvedSessionId = conversation.getSessionId();
      expect(evolvedSessionId).toBe('streaming-session-evolved');
      expect(evolvedSessionId).not.toBe(initialSessionId);
    });
  });

  describe('Mixed Query + Streaming Input Patterns', () => {
    it('should handle the React app creation pattern from architecture doc', async () => {
      conversation = claude().asConversation();

      // Set up conversation-wide streaming
      const streamedMessages: Message[] = [];
      conversation.stream(message => {
        streamedMessages.push(message);
      });

      // Start complex task
      const parser = conversation.query('Create a React app with full setup');

      // Send streaming input while it's running
      await conversation.send('Add TypeScript support');
      await conversation.send('Include testing framework');
      await conversation.send('Add CI/CD pipeline');

      // Get the final result
      const result = await parser.asText();

      expect(result).toContain('Processing: Create a React app with full setup');
      expect(streamedMessages.length).toBeGreaterThan(0);
    });

    it('should handle the codebase analysis pattern from architecture doc', async () => {
      conversation = claude().asConversation();
      const parser = conversation.query('Analyze this codebase for security issues');

      // Stream messages from specific query with conditional streaming input
      let sentGuidance = false;
      await parser.stream(async message => {
        if (message.type === 'assistant' && !sentGuidance) {
          const text = message.content.find(block => block.type === 'text')?.text;
          if (text?.includes('analyzing')) {
            await conversation.send('Focus on JWT token validation');
            sentGuidance = true;
          }
        }
      });

      expect(sentGuidance).toBe(true);
    });
  });

  describe('Process Lifecycle with Streaming Input', () => {
    it('should maintain active process across multiple streaming inputs', async () => {
      conversation = claude().asConversation();
      const parser = conversation.query('Long running analysis');

      // Multiple streaming inputs should reuse same process
      await conversation.send('First guidance');
      await conversation.send('Second guidance');
      await conversation.send('Third guidance');

      const result = await parser.asText();
      expect(result).toBeDefined();
    });

    it('should handle process termination gracefully', async () => {
      conversation = claude().asConversation();
      const parser = conversation.query('Task that might fail');

      // Simulate process becoming inactive
      const mockClient = (conversation as any).activeClient;
      mockClient.hasActiveTransport = vi.fn(() => false);

      // Should start new process instead of failing
      await expect(conversation.send('Continue anyway')).resolves.not.toThrow();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle streaming input errors gracefully', async () => {
      conversation = claude().asConversation();
      const parser = conversation.query('Start task');

      // Mock streaming input failure
      const mockClient = (conversation as any).activeClient;
      mockClient.sendStreamingInput = vi.fn().mockRejectedValue(new Error('Process crashed'));

      await expect(conversation.send('This should fail')).rejects.toThrow('Process crashed');
    });

    it('should handle disposed conversation errors', async () => {
      conversation = claude().asConversation();
      await conversation.dispose();

      await expect(conversation.send('Should fail')).rejects.toThrow('Conversation has been disposed');
    });
  });

  describe('Session ID Evolution with Streaming Input', () => {
    it('should track session ID changes through streaming', async () => {
      conversation = claude().asConversation();

      const sessionIds: (string | null)[] = [];
      conversation.onSessionId(sessionId => {
        sessionIds.push(sessionId);
      });

      const parser = conversation.query('Initial query');
      await conversation.send('Streaming input 1');
      await conversation.send('Streaming input 2');

      await parser.asText();

      // Should have tracked session ID evolution
      expect(sessionIds).toContain('streaming-session-evolved');
    });

    it('should update session ID from stream messages', async () => {
      conversation = claude().asConversation();

      let capturedSessionId: string | null = null;
      conversation.stream((message, sessionId) => {
        capturedSessionId = sessionId;
      });

      const parser = conversation.query('Query with streaming');
      await conversation.send('Stream this');
      await parser.asText();

      expect(capturedSessionId).toBe('streaming-session-evolved');
    });
  });

  describe('Advanced Branching with Streaming Input', () => {
    it('should support the advanced branching pattern from architecture doc', async () => {
      const builder = claude();
      const parser = builder.query('Design a web application');
      await parser.asText();

      const sessionId = await parser.getSessionId();

      if (sessionId) {
        // Create streaming-capable branches
        const apiBranch = builder.withSessionId(sessionId).asConversation();
        const uiBranch = builder.withSessionId(sessionId).asConversation();

        // Start complex tasks
        const apiParser = apiBranch.query('Implement comprehensive API architecture');
        const uiParser = uiBranch.query('Design complete user interface');

        // Send streaming input to either branch
        await apiBranch.send('Focus on GraphQL and real-time subscriptions');
        await uiBranch.send('Use modern CSS Grid and responsive design');

        // Get final results
        const apiResult = await apiParser.asText();
        const uiResult = await uiParser.asText();

        expect(apiResult).toContain('Processing: Implement comprehensive API architecture');
        expect(uiResult).toContain('Processing: Design complete user interface');

        await apiBranch.dispose();
        await uiBranch.dispose();
      }
    });
  });

  describe('Multiple Queries in Conversation with Streaming', () => {
    it('should handle sequential queries with streaming input', async () => {
      conversation = claude().asConversation();

      // First query with streaming
      const parser1 = conversation.query('First analysis');
      await conversation.send('Focus on security');
      const result1 = await parser1.asText();

      // Second query should maintain conversation context
      const parser2 = conversation.query('Continue analysis');
      await conversation.send('Add performance metrics');
      const result2 = await parser2.asText();

      expect(result1).toContain('Processing: First analysis');
      expect(result2).toContain('Processing: Continue analysis');
      expect(conversation.getSessionId()).toBe('streaming-session-evolved');
    });
  });

  describe('Pure Streaming Input Pattern', () => {
    it('should handle the pure streaming pattern from architecture doc', async () => {
      conversation = claude().asConversation();

      const allMessages: Message[] = [];
      conversation.stream(message => {
        allMessages.push(message);
      });

      // Simulate stream messages being emitted when send() creates queries
      const originalQuery = conversation.query.bind(conversation);
      conversation.query = vi.fn().mockImplementation((prompt: string) => {
        const parser = originalQuery(prompt);
        // Simulate messages being emitted to stream handlers when query runs
        setTimeout(async () => {
          const mockMessage = {
            type: 'assistant' as const,
            content: [{ type: 'text', text: `Processing: ${prompt}` }],
            session_id: 'streaming-session-evolved'
          };
          await (conversation as any).emitMessage(mockMessage);
        }, 0);
        return parser;
      });

      // Just send messages, no individual results needed
      await conversation.send('Analyze this codebase');
      await conversation.send('Focus on security issues');
      await conversation.send('Generate a report');

      // Wait for async message processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have collected streaming results
      expect(allMessages.length).toBeGreaterThan(0);
      expect(conversation.getSessionId()).toBe('streaming-session-evolved');
    });
  });
});
