const { claude } = require('../dist/index.js');

async function demonstrateConversations() {
  console.log('=== Conversation API Demo ===\n');

  // 1. Basic conversation with session ID tracking
  console.log('1. Basic conversation with automatic session ID tracking:');
  const conversation = claude().asConversation();

  // Set up conversation-wide streaming
  conversation.stream((message, sessionId) => {
    console.log(`[Stream] ${message.type}: ${JSON.stringify(message).slice(0, 100)}...`);
    console.log(`[Stream] Session ID: ${sessionId}`);
  });

  // Track session ID changes
  conversation.onSessionId(sessionId => {
    console.log(`[Session] Session ID updated to: ${sessionId}`);
  });

  // Execute a query
  const parser = conversation.query('Say hello and tell me your name');
  const result = await parser.asText();
  console.log('Result:', result);
  console.log('Current session ID:', conversation.getSessionId());
  console.log();

  // 2. Session ID extraction from completed queries
  console.log('2. Session ID extraction from completed queries:');
  const builder = claude();
  const simpleParser = builder.query('What is 2+2?');
  const simpleResult = await simpleParser.asText();
  const sessionId = await simpleParser.getSessionId();

  console.log('Simple query result:', simpleResult);
  console.log('Extracted session ID:', sessionId);
  console.log();

  // 3. Simple branching (separate processes)
  if (sessionId) {
    console.log('3. Simple branching from extracted session ID:');
    const branch1 = await builder.withSessionId(sessionId).query('What is 3+3?').asText();
    const branch2 = await builder.withSessionId(sessionId).query('What is 4+4?').asText();

    console.log('Branch 1 result:', branch1);
    console.log('Branch 2 result:', branch2);
    console.log();
  }

  // 4. Advanced branching with conversations
  if (sessionId) {
    console.log('4. Advanced branching with conversation streaming:');
    const advancedBranch = builder.withSessionId(sessionId).asConversation();

    // Set up streaming for the branch
    advancedBranch.stream((message, currentSessionId) => {
      console.log(`[Branch Stream] Session: ${currentSessionId}, Type: ${message.type}`);
    });

    const branchParser = advancedBranch.query('Tell me about mathematics');
    const branchResult = await branchParser.asText();

    console.log('Branch conversation result:', branchResult);
    console.log('Branch session ID:', advancedBranch.getSessionId());
    console.log();
  }

  // 5. Multiple queries in same conversation
  console.log('5. Multiple queries in same conversation:');
  const multiConversation = claude().asConversation();

  const query1 = multiConversation.query('What is the capital of France?');
  const result1 = await query1.asText();
  console.log('Query 1 result:', result1);
  console.log('Session after query 1:', multiConversation.getSessionId());

  const query2 = multiConversation.query('What about Italy?');
  const result2 = await query2.asText();
  console.log('Query 2 result:', result2);
  console.log('Session after query 2:', multiConversation.getSessionId());
  console.log();

  console.log('=== Demo Complete ===');
}

// Run the demo
demonstrateConversations().catch(console.error);
