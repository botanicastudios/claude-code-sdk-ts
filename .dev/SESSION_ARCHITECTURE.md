# Session-Based Architecture for Streaming Input

## Overview

This document outlines the session-based architecture for streaming input, enabling real-time guidance during long-running Claude processes.

## Key Features

- **Streaming Input**: Send additional messages while Claude is processing
- **Session Management**: Automatic session ID tracking and evolution
- **Flexible Branching**: Resume conversations from any point
- **Clean API**: Three core conversation methods + session management

## Current vs Proposed Architecture

### Current Architecture

```
QueryBuilder.query() → InternalClient → SubprocessCLITransport
                                    ↓
                              CLI process (exits after response)
                              Returns: { sessionId: "new-123" }
```

### Proposed Architecture

```
QueryBuilder.query() → InternalClient → SubprocessCLITransport
                                    ↓
                              CLI process (exits after response)
                              Returns: { sessionId: "new-123" }

QueryBuilder.asConversation() → Conversation → InternalClient → SubprocessCLITransport
                                       ↓                              ↓
                                 Session ID tracking          CLI process (can accept streaming input)
                                       ↓                              ↓
                              Updates currentSessionId        Returns: { sessionId: "evolved-456" }
```

**Key Changes:**

- Add `Conversation` class for streaming input capability
- Conversation objects track evolving session IDs automatically

## API Design

### Universal Session ID Access

Every parser provides access to its session ID for branching and resumption:

```typescript
// Simple queries get session IDs
const builder = claude();
const parser = builder.query('Knock knock');
const result = await parser.asText(); // "Who's there?"

// Get session ID from completed query
const sessionId = parser.getSessionId();

// Branch using separate processes
const res1 = await builder.withSessionId(sessionId).query('Doctor').asText(); // "Doctor who?"
const res2 = await builder.withSessionId(sessionId).query('Achhhhh').asText(); // "Achhhhh who?"

// OR branch using conversations (with streaming input capability)
const branch1 = builder.withSessionId(sessionId).asConversation();
const branch2 = builder.withSessionId(sessionId).asConversation();
const res3 = await branch1.query('Doctor').asText(); // "Doctor who?" (branch1 evolves)
const res4 = await branch2.query('Achhhhh').asText(); // "Achhhhh who?" (branch2 evolves)
```

**Key behavior:** `parser.getSessionId()` returns the session ID from when that parser's query completed, enabling flexible branching strategies.

### Conversation API

Conversations provide three core methods with clear separation of concerns:

```typescript
class Conversation {
  // Normal query that returns ResponseParser (familiar API)
  query(prompt: string): ResponseParser;

  // Send streaming input (fire-and-forget with error handling)
  send(message: string): Promise<void>;

  // Observe all conversation activity (stateless event registration)
  stream(handler: (message: Message, sessionId: string | null) => void | Promise<void>): () => void;

  // Get current session ID for branching
  getSessionId(): string | null;

  // Listen for session ID changes
  onSessionId(callback: (sessionId: string | null) => void): () => void;
}
```

### Enhanced Stream Callbacks

Stream callbacks can trigger streaming input via conversations:

```typescript
const conversation = claude().asConversation();
const parser = conversation.query('Analyze this codebase for security issues');

// Set up conversation-wide streaming
conversation.stream(message => {
  console.log('Conversation activity:', message);
});

// Stream messages from specific query
await parser.stream(async message => {
  if (message.type === 'assistant') {
    const text = message.content.find(block => block.type === 'text')?.text;

    if (text?.includes('analyzing auth.js')) {
      // Send streaming input to conversation
      await conversation.send('Focus on JWT token validation');
    }
  }
});
```

### Conversations for Multi-turn Dialogue

`asConversation()` creates **new evolving conversations** that maintain conversation context:

```typescript
// Create new evolving conversation
const conversation = claude().asConversation();

// Set up streaming for entire conversation
conversation.stream((message, sessionId) => {
  console.log('Got message:', message, 'Session:', sessionId);
});

// Normal queries return ResponseParser
const parser1 = conversation.query('Knock knock');
const result1 = await parser1.asText(); // "Who's there?"

const parser2 = conversation.query('Doctor');
const result2 = await parser2.asText(); // "Doctor who?"

// Resume/branch from existing session ID
const sessionId = 'previous-conversation-123';
const resumed = claude().withSessionId(sessionId).asConversation();
const parser3 = resumed.query('Continue our discussion');
const result3 = await parser3.asText(); // Evolves from sessionId
```

**Key behavior:** `asConversation()` always creates new conversations that automatically evolve their session ID with each query, maintaining full conversation context.

### Flexible Branching Strategies

The API supports two branching approaches depending on your needs:

**Simple Branching** (`withSessionId()`) for independent queries:

```typescript
const builder = claude();
const parser = builder.query('Tell me about quantum computing');
await parser.asText();

// Get session ID for branching
const sessionId = parser.getSessionId();

// Each query creates separate process from same starting point
const simple = await builder.withSessionId(sessionId).query('Explain it simply').asText();
const technical = await builder.withSessionId(sessionId).query('Give technical details').asText();
const examples = await builder.withSessionId(sessionId).query('Show me examples').asText();
```

**Advanced Branching** (`withSessionId().asConversation()`) with streaming input capability:

```typescript
const builder = claude();
const parser = builder.query('Tell me about quantum computing');
await parser.asText();

// Get session ID for branching
const sessionId = parser.getSessionId();

// Create evolving branches that can accept streaming input
const simpleBranch = builder.withSessionId(sessionId).asConversation();
const techBranch = builder.withSessionId(sessionId).asConversation();

// Start complex queries
const simpleParser = simpleBranch.query('Explain quantum computing for beginners');
const techParser = techBranch.query('Explain quantum computing with mathematics');

// Can send streaming input to either branch while they're running
await simpleBranch.send('Focus on practical applications');
await techBranch.send('Include equations for quantum entanglement');

// Get final results
const simpleResult = await simpleParser.asText();
const techResult = await techParser.asText();
```

### Conversation Usage Patterns

**Mixed Query + Streaming Input:**

```typescript
const conversation = claude().asConversation();

// Set up streaming for entire conversation
conversation.stream(message => {
  console.log('Got message:', message);
});

// Start a complex task
const parser = conversation.query('Create a React app with full setup');

// Send streaming input while it's running
await conversation.send('Add TypeScript support');
await conversation.send('Include testing framework');
await conversation.send('Add CI/CD pipeline');

// Get the final result
const result = await parser.asText();
```

**Multiple Queries in Conversation:**

```typescript
const conversation = claude().asConversation();

conversation.stream((message, sessionId) => console.log(message, sessionId));

// Each query returns its own parser
const parser1 = conversation.query('Create a React app');
const result1 = await parser1.asText(); // Gets combined result from any streaming input

const parser2 = conversation.query('Now add a backend API');
const result2 = await parser2.asText(); // Separate result from new process
```

**Pure Streaming Input:**

```typescript
const conversation = claude().asConversation();

const allMessages = [];
conversation.stream(message => {
  allMessages.push(message);
});

// Just send messages, no individual results needed
await conversation.send('Analyze this codebase');
await conversation.send('Focus on security issues');
await conversation.send('Generate a report');

// Work with streaming results as they come in
```

## Implementation Details

### Conversation Class Implementation

```typescript
// Evolving conversation for multi-turn dialogue
class Conversation {
  private transport?: SubprocessCLITransport;
  private options: ClaudeCodeOptions;
  private currentSessionId: string | null = null;
  private streamHandlers: Array<(message: Message) => void | Promise<void>> = [];
  private sessionIdHandlers: Array<(sessionId: string | null) => void> = [];

  constructor(options: ClaudeCodeOptions) {
    this.options = { ...options };
    this.currentSessionId = options.sessionId || null; // Get from QueryBuilder options
  }

  query(prompt: string): ResponseParser {
    // Always create new process for queries - returns familiar ResponseParser
    const transport = new SubprocessCLITransport(prompt, {
      ...this.options,
      sessionId: this.currentSessionId
    });

    // Update session ID when response received (conversation evolves)
    const parser = new SessionAwareParser(transport.processQuery(), [], this.logger, newSessionId => {
      this.updateSessionId(newSessionId);
      this.transport = transport; // Keep reference for streaming input
    });

    // Emit messages to conversation stream handlers
    parser.stream(message => this.emitMessage(message));

    return parser;
  }

  async send(message: string): Promise<void> {
    if (this.transport?.isActive()) {
      // Send to active process using current session ID
      const jsonlMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: message }]
        }
      };

      this.transport.stdin.write(JSON.stringify(jsonlMessage) + '\n');
    } else {
      // Start new process - will update currentSessionId when it responds
      this.query(message);
    }
  }

  stream(handler: (message: Message, sessionId: string | null) => void | Promise<void>): () => void {
    // Stateless event registration with auto session ID tracking
    const wrappedHandler = async (message: Message) => {
      // Auto-update session ID from any message
      if (message.session_id) {
        this.updateSessionId(message.session_id);
      }
      await handler(message, this.currentSessionId);
    };

    this.streamHandlers.push(wrappedHandler);

    // Return unsubscribe function
    return () => {
      const index = this.streamHandlers.indexOf(wrappedHandler);
      if (index > -1) {
        this.streamHandlers.splice(index, 1);
      }
    };
  }

  getSessionId(): string | null {
    return this.currentSessionId; // Simple - just the latest
  }

  onSessionId(callback: (sessionId: string | null) => void): () => void {
    this.sessionIdHandlers.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.sessionIdHandlers.indexOf(callback);
      if (index > -1) {
        this.sessionIdHandlers.splice(index, 1);
      }
    };
  }

  private updateSessionId(newSessionId: string | null) {
    if (this.currentSessionId !== newSessionId) {
      this.currentSessionId = newSessionId;

      // Notify session ID listeners
      for (const handler of this.sessionIdHandlers) {
        try {
          handler(newSessionId);
        } catch (error) {
          console.error('Session ID handler error:', error);
        }
      }
    }
  }

  private async emitMessage(message: Message) {
    for (const handler of this.streamHandlers) {
      try {
        await handler(message);
      } catch (error) {
        console.error('Stream handler error:', error);
        // Continue with other handlers - don't break conversation flow
      }
    }
  }
}
```

### QueryBuilder Implementation

```typescript
class QueryBuilder {
  query(prompt: string): ResponseParser {
    // Create single-query process - no session object needed
    const transport = new SubprocessCLITransport(prompt, this.options);
    return new ResponseParser(transport.processQuery(), this.messageHandlers, this.logger);
  }

  asConversation(): Conversation {
    // Create evolving conversation for multi-turn dialogue
    // Uses current QueryBuilder options (including any sessionId from withSessionId())
    return new Conversation(this.options);
  }

  withSessionId(sessionId: string): QueryBuilder {
    // Store session ID directly in options - no session object needed
    const newBuilder = new QueryBuilder();
    newBuilder.options = { ...this.options, sessionId };
    return newBuilder;
  }
}
```

### ResponseParser Implementation

```typescript
class ResponseParser {
  // No session state stored - getSessionId() just parses messages

  async getSessionId(): Promise<string | null> {
    await this.consume(); // Ensure all messages are processed

    // Look for session_id on any message (CLI sets this on all messages)
    for (const msg of this.messages) {
      if (msg.session_id) {
        return msg.session_id;
      }

      // Also check system messages with session data
      if (msg.type === 'system' && msg.data?.session_id) {
        return msg.data.session_id;
      }
    }

    return null;
  }

  // Standard methods unchanged
  async asText(): Promise<string> {
    /* ... */
  }
  async stream(handler: (message: Message) => void | Promise<void>): Promise<void> {
    /* ... */
  }
}
```

## Simplified API Design

### Core Conversation Methods

1. **`conversation.query(prompt)`** - Returns familiar ResponseParser for structured responses
2. **`conversation.send(message)`** - Fire-and-forget streaming input (Promise resolves when delivered to stdin)
3. **`conversation.stream(handler)`** - Stateless event observation with session ID passed to handler
4. **`conversation.getSessionId()`** - Get current session ID for branching
5. **`conversation.onSessionId(callback)`** - Listen for session ID changes

### Session Management Methods

1. **`queryBuilder.asConversation()`** - Creates new evolving conversations with streaming input capability
2. **`queryBuilder.withSessionId(sessionId)`** - Sets session ID for resumption/branching (implemented)
3. **`parser.getSessionId()`** - Extracts session IDs from completed queries for branching

### Method Chaining for Composability

```typescript
// New conversation
const conversation = claude().asConversation();

// Resume/branch conversation
const resumed = claude().withSessionId(sessionId).asConversation();

// Simple branching (no streaming input)
const branch = claude().withSessionId(sessionId).query('...');
```

### Key Benefits

- **Resolves** when the message is successfully delivered to Claude's stdin
- **Rejects** if there's an error sending the message (process crashed, etc.)
- **Does NOT wait** for Claude's response to the streaming input

**3. `conversation.stream(handler)`** - Stateless event observation with unsubscribe:

```typescript
const conversation = claude().asConversation();

// Observe all conversation activity
const unsubscribe = conversation.stream((message, sessionId) => {
  console.log('Conversation message:', message);
  console.log('Current session ID:', sessionId);
});

const parser = conversation.query('Analyze this code');
await conversation.send('Focus on security');

// Later: stop observing
unsubscribe();

// Get current session ID for branching
const sessionId = conversation.getSessionId();

// Listen for session ID changes
const unsubscribeSessionId = conversation.onSessionId(sessionId => {
  console.log('Session ID changed to:', sessionId);
  // Could update UI, save to database, etc.
});
```

### Session Management for Branching

Session IDs (`getSessionId()` + `withSessionId()` + `asConversation()`) enable flexible branching:

```typescript
const builder = claude();
const parser = builder.query('Tell me about quantum physics');
await parser.asText();

const sessionId = parser.getSessionId();

// Simple branching (separate processes)
const simple = await builder.withSessionId(sessionId).query('Explain simply').asText();

// Advanced branching (with streaming input)
const branch = builder.withSessionId(sessionId).asConversation();
const parser2 = branch.query('Explain with mathematics');
await branch.send('Include quantum entanglement equations'); // Streaming input
const result = await parser2.asText();
```

### Benefits of This Design

- **Minimal API surface**: Just three conversation methods + session management
- **Clear separation**: Query (structured), Send (streaming), Stream (observation)
- **Familiar patterns**: `conversation.query()` returns standard ResponseParser
- **Maximum flexibility**: Choose simple or advanced branching as needed
- **No magic**: Session IDs are explicit and manageable
- **Composable**: Chain `withSessionId()` and `asConversation()` for complex workflows

## Benefits

### 1. Universal Streaming Input

Conversations provide streaming input capability everywhere it's needed.

### 2. Flexible Branching Strategies

Two clear branching approaches:

- **Simple**: `withSessionId()` for independent queries
- **Advanced**: `withSessionId().asConversation()` for streaming-capable branches

### 3. Minimal API Surface

Just three conversation methods handle all streaming needs:

- `conversation.query()` - returns familiar ResponseParser
- `conversation.send()` - fire-and-forget streaming input
- `conversation.stream()` - stateless event observation

Plus three session management methods:

- `asConversation()` - evolving conversations
- `getSessionId()` - extract session IDs for branching
- `withSessionId()` - simple branching

### 4. Automatic Session Management

Session IDs update automatically from both query responses and stream messages - no manual tracking needed.

### 5. Better Resource Utilization

Process reuse when beneficial (conversations), separate processes when needed (simple branching).

### 6. No Session Object Overhead

Session IDs flow through existing QueryBuilder options - no heavyweight session objects needed.

### 7. Composable Design

Chain `withSessionId()` and `asConversation()` for complex workflows.

### 8. Backward Compatibility

This design provides maximum flexibility while maintaining a minimal, intuitive API surface that builds naturally on existing patterns.

## Migration Path

### Phase 1: Core Conversation API

- Implement `Conversation` class with three core methods:
  - `conversation.query()` - returns familiar ResponseParser
  - `conversation.send()` - fire-and-forget streaming input
  - `conversation.stream()` - stateless event observation with unsubscribe
- Add `QueryBuilder.asConversation()` method
- Maintain existing API behavior (fully backward compatible)

### Phase 2: Session Management

- Implement automatic session ID tracking in conversations
- Enable session ID evolution with streaming input
- Add session ID extraction from CLI responses
- Integrate session management with conversation lifecycle

### Phase 3: Polish and Optimization

- Add robust error handling for stream handlers
- Implement process lifecycle management
- Add conversation disposal methods for memory management
- Optimize process reuse strategies

### Streaming Input with Evolving Session IDs

**Committed Approach: Session ID evolves with each JSONL message**

Since a session is actually created and managed before the process completes, each JSONL streaming input message updates the internal conversation session id.

**Key Implications:**

- `conversation.send()` evolves the session ID only when spawning a new process
- JSONL streaming input to active processes doesn't change session ID until completion
- The conversation's `currentSessionId` updates whenever CLI returns responses with new session IDs
- Final parser result includes responses to all streaming inputs

### Session ID Tracking Requirements

Conversations track a single current session ID that automatically updates:

- **Current Session ID**: Latest session ID returned by CLI (starts from QueryBuilder options)
- **Auto-update**: Session ID updates from both `query()` responses and `stream()` messages
- **Simple API**: Just `conversation.getSessionId()` returns current state

```typescript
class Conversation {
  private currentSessionId: string | null = null;

  constructor(options: ClaudeCodeOptions) {
    this.currentSessionId = options.sessionId || null; // Get from QueryBuilder
  }

  // Session ID updates automatically in query() callback and stream() handler
  private updateSessionId(newSessionId: string) {
    this.currentSessionId = newSessionId; // Simple - just update current
  }

  getSessionId(): string | null {
    return this.currentSessionId; // Always returns latest
  }
}
```

## Edge Cases and Considerations

### Process Lifecycle Management

- Handle process crashes gracefully
- Implement timeouts for inactive processes
- Clean up resources on session disposal

### Concurrent Queries

```typescript
const conversation = claude().asConversation();
const parser1 = conversation.query('Long task 1');
const parser2 = conversation.query('Long task 2'); // What happens here?
```

**Solution:** Error on concurrent queries within conversation. Each conversation maintains a single CLI process for streaming input. Users wanting concurrent queries should use separate conversations or simple `withSessionId()` queries.

### Option Changes

```typescript
const builder = claude().withModel('sonnet');
const parser1 = builder.query('Task 1');

builder.withModel('opus'); // Options changed!
const parser2 = builder.query('Task 2'); // Should this affect parser1's session?
```

**Solution:** Conversations capture options at creation time, so subsequent builder changes don't affect existing conversations.

### Memory Management

- Conversations should be garbage collectable when parsers are disposed
- Implement weak references to avoid memory leaks
- Provide explicit conversation disposal methods

## Example Usage Patterns

### Simple Streaming Input

```typescript
const conversation = claude().asConversation();
const parser = conversation.query('Analyze this codebase');

// Stream messages from specific query
parser.stream(async message => {
  if (message.content?.includes('analyzing package.json')) {
    await conversation.send('Focus on security vulnerabilities in dependencies');
  }
});

const result = await parser.asText();
```

### Multi-turn Conversation with Streaming Input

```typescript
const conversation = claude().asConversation();

// Set up conversation-wide streaming
conversation.stream(message => {
  console.log('Conversation activity:', message);
});

const parser = conversation.query('Create a React app');
await conversation.send('Add TypeScript support'); // Streaming input
await conversation.send('Also add testing setup'); // More streaming input

const result = await parser.asText(); // Final result includes all guidance
```

### Simple Branching for Different Approaches

```typescript
const builder = claude();
const parser = builder.query('Design a web application');
await parser.asText();

// Get session ID for branching
const sessionId = parser.getSessionId();

// Simple branches - separate processes
const apiFirst = await builder.withSessionId(sessionId).query('Use API-first approach').asText();
const uiFirst = await builder.withSessionId(sessionId).query('Use UI-first approach').asText();
```

### Advanced Branching with Streaming Input

```typescript
const builder = claude();
const parser = builder.query('Design a web application');
await parser.asText();

// Get session ID for advanced branching
const sessionId = parser.getSessionId();

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
```

## Final Design Summary

The final API design uses a clean approach with clear separation of concerns:

### Core Conversation Methods

1. **`conversation.query(prompt)`** - Returns familiar ResponseParser for structured responses
2. **`conversation.send(message)`** - Fire-and-forget streaming input (Promise resolves when delivered to stdin)
3. **`conversation.stream(handler)`** - Stateless event observation with session ID passed to handler
4. **`conversation.getSessionId()`** - Get current session ID for branching
5. **`conversation.onSessionId(callback)`** - Listen for session ID changes

### Session Management Methods

1. **`asConversation()`** - Creates new evolving conversations with streaming input capability
2. **`withSessionId(sessionId)`** - Sets session ID for resumption/branching
3. **`getSessionId()`** - Extracts session IDs from completed queries for branching

### Method Chaining for Composability

```typescript
// New conversation
const conversation = claude().asConversation();

// Resume/branch conversation
const resumed = claude().withSessionId(sessionId).asConversation();

// Simple branching (no streaming input)
const branch = claude().withSessionId(sessionId).query('...');
```

### Key Benefits

- **Clear separation of concerns**: Query (structured), Send (streaming), Stream (observation)
- **Familiar patterns**: `conversation.query()` returns standard ResponseParser
- **Stateless streaming**: No complex state management for conversation observation, with clean unsubscribe
- **Composable**: Chain methods for complex workflows
- **No API confusion**: Each method has a single, clear purpose
- **Consistent**: Session IDs work the same everywhere

This design provides maximum flexibility while maintaining a minimal, intuitive API surface that builds naturally on existing patterns.
