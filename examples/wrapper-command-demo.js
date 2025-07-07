#!/usr/bin/env node

import { claude } from '../src/index.js';

// Example 1: Using the fluent API with wrapper command
async function fluentApiExample() {
  console.log('=== Fluent API Example ===');

  try {
    const result = await claude()
      .withCommand('wsl.exe', 'node') // Run through WSL
      .withExecutable('/path/to/claude-cli.js') // Path to your CLI
      .debug() // Enable debug to see the actual command
      .query('What is 2 + 2?')
      .asText();

    console.log('Result:', result);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 2: Using direct options
async function directOptionsExample() {
  console.log('\n=== Direct Options Example ===');

  try {
    const messages = [];

    const generator = claude('Hello world!', {
      wrapperCommand: ['wsl.exe', 'node'],
      executablePath: '/path/to/claude-cli.js',
      debug: true
    });

    for await (const message of generator) {
      messages.push(message);
    }

    console.log('Messages received:', messages.length);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 3: Using with Docker
async function dockerExample() {
  console.log('\n=== Docker Example ===');

  try {
    const result = await claude()
      .withCommand('docker', 'run', '--rm', '-i', 'node:18') // Run in Docker
      .withExecutable('node') // The executable inside the container
      .debug()
      .query('What is the current date?')
      .asText();

    console.log('Result:', result);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run examples
async function main() {
  console.log('Wrapper Command Demo');
  console.log(
    'Note: These examples will fail unless you have the appropriate tools installed'
  );
  console.log('They are meant to demonstrate the API usage.\n');

  await fluentApiExample();
  await directOptionsExample();
  await dockerExample();
}

main().catch(console.error);
