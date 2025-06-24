import { claude } from '../src/index.js';

// Basic conversation with session ID tracking
const conversation = claude().asConversation();

// Set up conversation-wide streaming
conversation.stream((message, sessionId) => {
  console.log(`[Stream] ${message.type}: ${JSON.stringify(message).slice(0, 100)}...`);
  console.log(`[Stream] Session ID: ${sessionId}`);
});

// Tracking session ID changes
conversation.onSessionId(sessionId => {
  console.log(`[Session] Session ID updated to: ${sessionId}`);
});

// Execute a query
const parser = conversation.query('Say hello and tell me your name');
const result = await parser.asText();
console.log('Result:', result);

const sessionId = await conversation.getSessionId();
console.log('Current session ID:', sessionId);

// Advanced branching with conversations
if (sessionId) {
  console.log('4. Advanced parallel branching with sophisticated conversation flows:');

  // Create multiple branches from the same session
  const mathBranch = claude().withSessionId(sessionId).asConversation();
  const creativeBranch = claude().withSessionId(sessionId).asConversation();
  const analyticsBranch = claude().withSessionId(sessionId).asConversation();

  // Set up sophisticated streaming for each branch
  const streamHandlers = {
    math: (message, currentSessionId) => {
      console.log(
        `[🔢 Math Branch] Session: ${currentSessionId.slice(-8)}, ${message.type}: ${message.text?.slice(0, 50) || 'N/A'}...`
      );
    },
    creative: (message, currentSessionId) => {
      console.log(
        `[🎨 Creative Branch] Session: ${currentSessionId.slice(-8)}, ${message.type}: ${message.text?.slice(0, 50) || 'N/A'}...`
      );
    },
    analytics: (message, currentSessionId) => {
      console.log(
        `[📊 Analytics Branch] Session: ${currentSessionId.slice(-8)}, ${message.type}: ${message.text?.slice(0, 50) || 'N/A'}...`
      );
    }
  };

  mathBranch.stream(streamHandlers.math);
  creativeBranch.stream(streamHandlers.creative);
  analyticsBranch.stream(streamHandlers.analytics);

  // Track session evolution across branches
  const sessionTracker = new Map();
  [mathBranch, creativeBranch, analyticsBranch].forEach((branch, index) => {
    const branchNames = ['Math', 'Creative', 'Analytics'];
    branch.onSessionId(sessionId => {
      sessionTracker.set(branchNames[index], sessionId);
      console.log(`[📍 Session Tracker] ${branchNames[index]} branch evolved to: ${sessionId.slice(-8)}`);
    });
  });

  // Execute parallel conversations with different complexity levels
  console.log('\n🚀 Launching parallel conversation branches...\n');

  const parallelQueries = [
    // Math branch: Sequential mathematical reasoning
    mathBranch.query('Given that 2+2=4, what would be the result of (2+2)² × 3?').then(parser => parser.asText()),

    // Creative branch: Storytelling with context
    creativeBranch
      .query('Write a creative short story about a mathematician who discovers numbers have personalities')
      .then(parser => parser.asText()),

    // Analytics branch: Data analysis request
    analyticsBranch
      .query('Analyze the relationship between mathematical concepts and creative thinking, providing 3 key insights')
      .then(parser => parser.asText())
  ];

  // Wait for all branches to complete
  const [mathResult, creativeResult, analyticsResult] = await Promise.all(parallelQueries);

  console.log('\n📊 Parallel Branch Results:');
  console.log('─'.repeat(60));
  console.log('🔢 Math Branch Result:', mathResult.slice(0, 100) + '...');
  console.log('   Session ID:', mathBranch.getSessionId()?.slice(-8));
  console.log();
  console.log('🎨 Creative Branch Result:', creativeResult.slice(0, 100) + '...');
  console.log('   Session ID:', creativeBranch.getSessionId()?.slice(-8));
  console.log();
  console.log('📊 Analytics Branch Result:', analyticsResult.slice(0, 100) + '...');
  console.log('   Session ID:', analyticsBranch.getSessionId()?.slice(-8));
  console.log();

  // Demonstrate branch convergence - combine insights from all branches
  console.log('🔄 Demonstrating branch convergence...');
  const convergenceBranch = claude().withSessionId(sessionId).asConversation();

  convergenceBranch.stream((message, sessionId) => {
    console.log(`[🔄 Convergence] ${message.type}: Processing branch insight...`);
  });

  // Send one message per branch result
  console.log('📤 Sending Math branch insights...');
  await convergenceBranch.send(`Math branch result: ${mathResult}`);

  console.log('📤 Sending Creative branch insights...');
  await convergenceBranch.send(`Creative branch result: ${creativeResult}`);

  console.log('📤 Sending Analytics branch insights...');
  await convergenceBranch.send(`Analytics branch result: ${analyticsResult}`);

  // Now request synthesis of all the branch insights
  console.log('📤 Requesting synthesis...');
  const synthesisParser = convergenceBranch.query(
    'Now synthesize these three branch results into one unified insight about the intersection of logic and creativity.'
  );
  const convergenceResult = await synthesisParser.asText();

  console.log('🎯 Convergence Result:', convergenceResult);
  console.log('🎯 Final Session ID:', convergenceBranch.getSessionId()?.slice(-8));
  console.log();
}

// KeepAlive Demo - Process persistence vs spawning new processes
console.log('5. KeepAlive Demo - Process persistence comparison:');

// Regular conversation (spawns new process for each send)
console.log('🔄 Regular conversation (new process each time):');
const regularConv = claude().debug(true).asConversation();

regularConv.stream((message, sessionId) => {
  if (message.type === 'assistant') {
    console.log(`[Regular] 🤖: ${message.text?.slice(0, 60) || 'N/A'}...`);
  }
});

console.log('   📤 Sending first message...');
await regularConv.send('Count to 2');
await new Promise(resolve => setTimeout(resolve, 1000));

console.log('   📤 Sending second message (watch for new process spawn)...');
await regularConv.send('Now count to 3');
await new Promise(resolve => setTimeout(resolve, 1000));

await regularConv.dispose();
console.log('   ✅ Regular conversation disposed');
console.log();

// KeepAlive conversation (persistent process)
console.log('⚡ KeepAlive conversation (persistent process):');
const keepAliveConv = claude().debug(true).asConversation().keepAlive();

keepAliveConv.stream((message, sessionId) => {
  if (message.type === 'assistant') {
    console.log(`[KeepAlive] 🤖: ${message.text?.slice(0, 60) || 'N/A'}...`);
  }
});

console.log('   📤 Sending first message...');
await keepAliveConv.send('Count to 2');
await new Promise(resolve => setTimeout(resolve, 1000));

console.log('   📤 Sending second message (same process - no spawn)...');
await keepAliveConv.send('Now count to 3');
await new Promise(resolve => setTimeout(resolve, 1000));

console.log('   📤 Sending third message (still same process)...');
await keepAliveConv.send('What comes after 3?');
await new Promise(resolve => setTimeout(resolve, 1000));

console.log('   🔚 Explicitly ending keepAlive conversation...');
await keepAliveConv.end(); // This closes stdin and allows process to exit gracefully

// Multiple queries in same conversation
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
