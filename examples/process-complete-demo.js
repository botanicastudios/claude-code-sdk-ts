import { claude } from '../src/index.js';

console.log('=== onProcessComplete() Demo ===\n');

// Example 1: Basic usage with QueryBuilder
console.log('1. Basic QueryBuilder usage:');
try {
  const result = await claude()
    .onProcessComplete((exitCode, error) => {
      if (exitCode === 0) {
        console.log('✅ Process completed successfully!');
      } else {
        console.log(
          `❌ Process failed with exit code ${exitCode}:`,
          error?.message
        );
      }
    })
    .query('What is 2 + 2?')
    .asText();

  console.log('Result:', result);
} catch (error) {
  console.error('Error:', error.message);
}

console.log('\n2. Multiple handlers:');
try {
  await claude()
    .onProcessComplete((exitCode) => {
      console.log(`📊 Handler 1: Exit code ${exitCode}`);
    })
    .onProcessComplete((exitCode) => {
      console.log(`📋 Handler 2: Exit code ${exitCode}`);
    })
    .query('What is the current date?')
    .asText();
} catch (error) {
  console.error('Error:', error.message);
}

console.log('\n3. Conversation usage:');
try {
  const conversation = claude().asConversation();

  // Add process complete handler to conversation
  const unsubscribe = conversation.onProcessComplete((exitCode, error) => {
    if (exitCode === 0) {
      console.log('🎉 Conversation process completed successfully!');
    } else {
      console.log(
        `💥 Conversation process failed with exit code ${exitCode}:`,
        error?.message
      );
    }
  });

  // Use the conversation
  const parser = conversation.query('Count to 3');
  const result = await parser.asText();
  console.log('Conversation result:', result);

  // Clean up
  unsubscribe();
  await conversation.dispose();
} catch (error) {
  console.error('Error:', error.message);
}

console.log('\n4. Integration with other handlers:');
try {
  let messageCount = 0;
  let processCompleted = false;

  const result = await claude()
    .onMessage((message) => {
      messageCount++;
      console.log(`📝 Message ${messageCount}: ${message.type}`);
    })
    .onProcessComplete((exitCode) => {
      processCompleted = true;
      console.log(`🏁 Process completed with exit code ${exitCode}`);
      console.log(`📊 Total messages processed: ${messageCount}`);
    })
    .query('What is the weather like?')
    .asText();

  console.log('Final result:', result);
  console.log('Process completed:', processCompleted);
} catch (error) {
  console.error('Error:', error.message);
}

console.log('\n5. Streaming with process completion:');
try {
  let streamCount = 0;
  let processCompleted = false;

  await claude()
    .onProcessComplete((exitCode) => {
      processCompleted = true;
      console.log(`🎬 Streaming process completed with exit code ${exitCode}`);
      console.log(`📺 Total stream callbacks: ${streamCount}`);
    })
    .query('List 3 programming languages')
    .stream((message) => {
      streamCount++;
      console.log(`🎭 Stream ${streamCount}: ${message.type}`);
    });

  console.log('Streaming process completed:', processCompleted);
} catch (error) {
  console.error('Error:', error.message);
}

console.log('\n=== Demo completed ===');
