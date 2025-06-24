import { claude } from '../src/index.js';

async function demonstratePersistentConversation() {
  console.log('🚀 Starting persistent conversation demo...\n');

  // Method 1: Using keepAlive() conversation method
  const conv1 = claude().debug(true).asConversation().keepAlive();

  console.log('📋 Method 1: Using claude().asConversation().keepAlive()');

  conv1.stream((msg, sessionId) => {
    if (msg.type === 'assistant') {
      console.log(`🤖 Claude: ${msg.content[0]?.text?.substring(0, 100)}...`);
    }
  });

  // Send multiple messages to the same persistent process
  await conv1.send("Hello! What's your name?");
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for response

  await conv1.send('Can you count to 3?');
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for response

  await conv1.send('Now speak like a pirate!');
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for response

  // Explicitly end the conversation
  console.log('\n🔚 Ending persistent conversation...');
  await conv1.end();
  await conv1.dispose();

  console.log('\n' + '='.repeat(50) + '\n');

  // Method 2: Using keepAlive(true) explicitly
  const conv2 = claude().debug(true).asConversation().keepAlive(true);

  console.log('📋 Method 2: Using claude().asConversation().keepAlive(true)');

  conv2.stream((msg, sessionId) => {
    if (msg.type === 'assistant') {
      console.log(`🤖 Claude: ${msg.content[0]?.text?.substring(0, 100)}...`);
    }
  });

  // Another persistent conversation
  await conv2.send('Tell me a joke');
  await new Promise(resolve => setTimeout(resolve, 2000));

  await conv2.send('Now make it even funnier');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n🔚 Ending second persistent conversation...');
  await conv2.end();
  await conv2.dispose();

  console.log('\n✅ Persistent conversation demo completed!');
}

// Compare with regular conversation (spawns new process each time)
async function demonstrateRegularConversation() {
  console.log('\n🔄 For comparison - regular conversation (spawns new process each send):');

  const conv = claude().debug(true).asConversation(); // Default: keepAlive = false

  conv.stream((msg, sessionId) => {
    if (msg.type === 'assistant') {
      console.log(`🤖 Claude: ${msg.content[0]?.text?.substring(0, 100)}...`);
    }
  });

  await conv.send('Hello');
  await new Promise(resolve => setTimeout(resolve, 2000));

  await conv.send('Count to 3'); // This should spawn a new process (you'll see new "Running command")
  await new Promise(resolve => setTimeout(resolve, 2000));

  await conv.dispose();
  console.log('\n✅ Regular conversation demo completed!');
}

// Run the demos
demonstratePersistentConversation()
  .then(() => demonstrateRegularConversation())
  .catch(console.error);
