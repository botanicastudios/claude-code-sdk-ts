import { execa, type ExecaChildProcess } from 'execa';
import which from 'which';
import { createInterface } from 'node:readline';
import { platform } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { access, constants } from 'node:fs/promises';
import {
  CLIConnectionError,
  CLINotFoundError,
  ProcessError,
  CLIJSONDecodeError
} from '../../errors.js';
import type {
  ClaudeCodeOptions,
  CLIOutput,
  ProcessCompleteHandler,
  UserMessage
} from '../../types.js';

export class SubprocessCLITransport {
  private process?: ExecaChildProcess;
  private options: ClaudeCodeOptions;
  private prompt: string;
  private connectTimeout?: NodeJS.Timeout;

  private streamingMode: boolean = false; // Track if we need streaming input capability
  private keepAlive: boolean = false; // Track if we should keep process alive across request-response cycles
  private processCompleteHandlers: Array<ProcessCompleteHandler>;

  constructor(
    prompt: string,
    options: ClaudeCodeOptions = {},
    streamingMode: boolean = false,
    keepAlive: boolean = false,
    processCompleteHandlers: Array<ProcessCompleteHandler> = []
  ) {
    this.prompt = prompt;
    this.options = options;
    this.streamingMode = streamingMode;
    this.keepAlive = keepAlive;
    this.processCompleteHandlers = processCompleteHandlers;
  }

  private debugLog(...args: any[]): void {
    if (this.options.debug) {
      if (typeof this.options.debug === 'function') {
        this.options.debug(...args);
      } else {
        console.error(...args);
      }
    }
  }

  /**
   * Check if the transport has an active process that can accept streaming input
   */
  isActive(): boolean {
    const hasProcess = !!this.process;
    const isKilled = this.process?.killed ?? true;
    const hasExitCode = this.process?.exitCode !== null;
    const hasStdin = !!this.process?.stdin;
    const stdinDestroyed = this.process?.stdin?.destroyed ?? true;

    const isActive = !!(
      this.process &&
      !this.process.killed &&
      this.process.exitCode === null &&
      this.process.stdin &&
      !this.process.stdin.destroyed
    );

    this.debugLog('DEBUG: [Transport] isActive() check:', {
      hasProcess,
      isKilled,
      hasExitCode,
      exitCode: this.process?.exitCode,
      hasStdin,
      stdinDestroyed,
      result: isActive
    });

    return isActive;
  }

  /**
   * Write streaming input to the active process stdin
   */
  writeToStdin(userMessage: UserMessage): void {
    if (!this.isActive()) {
      throw new Error('No active process to write to');
    }

    if (this.process && this.process.stdin) {
      try {
        const content = userMessage.content as string;
        if (this.streamingMode) {
          // For streaming mode, wrap message in JSONL format
          const jsonlMessage = {
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'text', text: content }]
            }
          };

          const jsonlString = JSON.stringify(jsonlMessage) + '\n';

          this.debugLog(
            'DEBUG: [Transport] Writing JSONL to process stdin:',
            JSON.stringify(jsonlMessage).substring(0, 150) + '...'
          );

          if (this.options.debug) {
            this.debugLog('DEBUG stdin (raw):', jsonlString);
          }

          this.process.stdin.write(jsonlString);

          this.debugLog('DEBUG: [Transport] Successfully wrote JSONL to stdin');
        } else {
          // For non-streaming mode, write as-is (though this shouldn't happen)
          this.debugLog(
            'DEBUG: [Transport] Writing raw data to stdin:',
            content.substring(0, 100) + '...'
          );

          if (this.options.debug) {
            this.debugLog('DEBUG stdin (raw):', content);
          }

          this.process.stdin.write(content);
        }
      } catch (error) {
        throw new Error(`Failed to write to stdin: ${error}`);
      }
    }
  }

  private async findCLI(): Promise<string> {
    // First check if a custom executable path is provided
    if (this.options.executablePath) {
      try {
        await access(this.options.executablePath, constants.X_OK);
        return this.options.executablePath;
      } catch {
        throw new CLINotFoundError();
      }
    }

    // Then check for local Claude installation (newer version with --output-format support)
    const localPaths = [
      join(homedir(), '.claude', 'local', 'claude'),
      join(homedir(), '.claude', 'bin', 'claude')
    ];

    for (const path of localPaths) {
      try {
        await access(path, constants.X_OK);
        return path;
      } catch {
        // Continue checking
      }
    }

    // Then try to find in PATH - try both 'claude' and 'claude-code' for compatibility
    try {
      return await which('claude');
    } catch {
      // Try the alternative name
      try {
        return await which('claude-code');
      } catch {
        // Not found in PATH, continue to check other locations
      }
    }

    // Common installation paths to check
    const paths: string[] = [];
    const isWindows = platform() === 'win32';
    const home = homedir();

    if (isWindows) {
      paths.push(
        join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
        join(
          home,
          'AppData',
          'Local',
          'Programs',
          'claude-code',
          'claude-code.exe'
        ),
        'C:\\Program Files\\claude\\claude.exe',
        'C:\\Program Files\\claude-code\\claude-code.exe'
      );
    } else {
      paths.push(
        '/usr/local/bin/claude',
        '/usr/local/bin/claude-code',
        '/usr/bin/claude',
        '/usr/bin/claude-code',
        '/opt/homebrew/bin/claude',
        '/opt/homebrew/bin/claude-code',
        join(home, '.local', 'bin', 'claude'),
        join(home, '.local', 'bin', 'claude-code'),
        join(home, 'bin', 'claude'),
        join(home, 'bin', 'claude-code'),
        join(home, '.claude', 'local', 'claude') // Claude's custom installation path
      );
    }

    // Try global npm/yarn paths
    try {
      const { stdout: npmPrefix } = await execa('npm', [
        'config',
        'get',
        'prefix'
      ]);
      if (npmPrefix) {
        paths.push(
          join(npmPrefix.trim(), 'bin', 'claude'),
          join(npmPrefix.trim(), 'bin', 'claude-code')
        );
      }
    } catch {
      // Ignore error and continue
    }

    // Check each path
    for (const path of paths) {
      try {
        await execa(path, ['--version']);
        return path;
      } catch {
        // Ignore error and continue
      }
    }

    throw new CLINotFoundError();
  }

  private buildCommand(): string[] {
    // Build command following Python SDK pattern
    const args: string[] = ['--output-format', 'stream-json', '--verbose'];

    // Claude CLI supported flags (from --help)
    if (this.options.model) args.push('--model', this.options.model);
    // Don't pass --debug flag as it produces non-JSON output

    // Handle max turns
    if (this.options.maxTurns !== undefined) {
      args.push('--max-turns', this.options.maxTurns.toString());
    }

    // Handle system prompt
    if (this.options.systemPrompt) {
      args.push('--system-prompt', this.options.systemPrompt);
    }

    // Handle append system prompt
    if (this.options.appendSystemPrompt) {
      args.push('--append-system-prompt', this.options.appendSystemPrompt);
    }

    // Note: Claude CLI handles authentication internally
    // It will use either session auth or API key based on user's setup

    // Handle session resumption
    if (this.options.sessionId) {
      args.push('--resume', this.options.sessionId);
    }

    // Handle allowed/disallowed tools (Claude CLI uses camelCase flags)
    if (this.options.allowedTools && this.options.allowedTools.length > 0) {
      args.push('--allowedTools', this.options.allowedTools.join(','));
    }
    if (this.options.deniedTools && this.options.deniedTools.length > 0) {
      args.push('--disallowedTools', this.options.deniedTools.join(','));
    }

    // Handle permission mode - map to CLI's actual flag
    if (this.options.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    }
    // Note: 'default' and 'acceptEdits' are not supported by current CLI version

    // Handle MCP config
    if (
      this.options.mcpServers &&
      Object.keys(this.options.mcpServers).length > 0
    ) {
      const mcpConfig = {
        mcpServers: this.options.mcpServers
      };
      args.push('--mcp-config', JSON.stringify(mcpConfig));
    }

    // Handle add directories
    if (this.options.addDirectories && this.options.addDirectories.length > 0) {
      args.push('--add-dir', this.options.addDirectories.join(' '));
    }

    // Add streaming input support for conversations
    if (this.streamingMode) {
      args.push('--input-format', 'stream-json');
    }

    // Add --print flag (prompt will be sent via stdin)
    args.push('--print');

    return args;
  }

  async connect(): Promise<void> {
    const cliPath = await this.findCLI();
    const args = this.buildCommand();

    const env = {
      ...process.env,
      ...this.options.env,
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts'
    };

    try {
      let executablePath: string;
      let executableArgs: string[];

      if (
        this.options.wrapperCommand &&
        this.options.wrapperCommand.length > 0
      ) {
        // Use wrapper command: e.g., ['wsl.exe', 'node'] + cliPath + args
        executablePath = this.options.wrapperCommand[0]!;
        executableArgs = [
          ...this.options.wrapperCommand.slice(1),
          cliPath,
          ...args
        ];
      } else {
        // Direct execution: cliPath + args
        executablePath = cliPath;
        executableArgs = args;
      }

      // Debug: Log the actual command being run
      this.debugLog(
        'DEBUG: Running command:',
        executablePath,
        executableArgs.join(' ')
      );

      this.process = execa(executablePath, executableArgs, {
        env,
        cwd: this.options.cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        buffer: false
      });

      // Set up process error handling
      this.process.on('error', (error) => {
        this.debugLog('DEBUG: Process error:', error);
      });

      this.process.on('exit', (code, signal) => {
        this.debugLog('DEBUG: Process exited:', { code, signal });
      });

      // Log all stderr output when debug is enabled
      if (this.process.stderr && this.options.debug) {
        this.process.stderr.on('data', (chunk: Buffer) => {
          this.debugLog('DEBUG stderr (raw):', chunk.toString());
        });
      }

      // Log all stdout output when debug is enabled
      if (this.process.stdout && this.options.debug) {
        this.process.stdout.on('data', (chunk: Buffer) => {
          this.debugLog('DEBUG stdout (raw):', chunk.toString());
        });
      }

      // Send prompt via stdin
      if (this.process.stdin) {
        if (this.streamingMode) {
          // For streaming mode, send initial prompt as JSONL
          const jsonlMessage = {
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'text', text: this.prompt }]
            }
          };

          const initialJsonlString = JSON.stringify(jsonlMessage) + '\n';

          this.debugLog(
            'DEBUG: [Transport] Sending initial JSONL message in streaming mode',
            {
              streamingMode: this.streamingMode,
              keepAlive: this.keepAlive,
              willKeepStdinOpen: this.keepAlive
                ? 'indefinitely until end()'
                : 'until result message received'
            }
          );

          if (this.options.debug) {
            this.debugLog('DEBUG stdin (raw):', initialJsonlString);
          }

          this.process.stdin.write(initialJsonlString);
          // Keep stdin open for potential streaming input and for keepAlive behavior
          // stdin will be closed when we receive a result message (if keepAlive=false) or explicitly via end()
        } else {
          // For simple queries, send as plain text and close stdin
          const promptString = this.prompt + '\n';

          if (this.options.debug) {
            this.debugLog('DEBUG stdin (raw):', promptString);
          }

          this.process.stdin.write(promptString);
          this.process.stdin.end();
        }
      }

      // Set up connection timeout
      if (this.options.timeout) {
        this.connectTimeout = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.cancel();
            throw new CLIConnectionError(
              `Connection timeout after ${this.options.timeout}ms`
            );
          }
        }, this.options.timeout);
      }
    } catch (error) {
      await this.cleanup();
      throw new CLIConnectionError(`Failed to start Claude Code CLI: ${error}`);
    }
  }

  async *receiveMessages(): AsyncGenerator<CLIOutput> {
    if (!this.process || !this.process.stdout) {
      throw new CLIConnectionError('Not connected to CLI');
    }

    // Clear connection timeout once we start receiving messages
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = undefined;
    }

    // Handle stderr in background
    if (this.process.stderr) {
      const stderrRl = createInterface({
        input: this.process.stderr,
        crlfDelay: Infinity
      });

      stderrRl.on('line', (line) => {
        this.debugLog('DEBUG stderr:', line);
      });

      stderrRl.on('error', (error) => {
        this.debugLog('DEBUG stderr error:', error);
      });
    }

    try {
      // Handle large JSON responses that may exceed readline buffer limits
      // by manually parsing JSON from raw data instead of relying on line-by-line reading
      let buffer = '';
      const messages: CLIOutput[] = [];
      let processComplete = false;
      let parseError: Error | null = null;

      // Set up data handler for manual JSON parsing
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();

        // Try to parse complete JSON objects from the buffer
        let startIndex = 0;
        while (startIndex < buffer.length) {
          const openBrace = buffer.indexOf('{', startIndex);
          const openBracket = buffer.indexOf('[', startIndex);

          // Find the first JSON object/array start
          let jsonStart = -1;
          if (openBrace !== -1 && openBracket !== -1) {
            jsonStart = Math.min(openBrace, openBracket);
          } else if (openBrace !== -1) {
            jsonStart = openBrace;
          } else if (openBracket !== -1) {
            jsonStart = openBracket;
          }

          if (jsonStart === -1) break;

          // Try to parse JSON starting from this position
          let depth = 0;
          let inString = false;
          let escaped = false;
          let jsonEnd = -1;

          for (let i = jsonStart; i < buffer.length; i++) {
            const char = buffer[i];

            if (escaped) {
              escaped = false;
              continue;
            }

            if (char === '\\') {
              escaped = true;
              continue;
            }

            if (char === '"') {
              inString = !inString;
              continue;
            }

            if (!inString) {
              if (char === '{' || char === '[') {
                depth++;
              } else if (char === '}' || char === ']') {
                depth--;
                if (depth === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
          }

          if (jsonEnd !== -1) {
            // Found complete JSON object
            const jsonStr = buffer.substring(jsonStart, jsonEnd);

            this.debugLog(
              'DEBUG stdout:',
              jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '')
            );

            try {
              const parsed = JSON.parse(jsonStr) as CLIOutput;

              // For non-keepAlive mode, close stdin when we receive a result message
              if (
                !this.keepAlive &&
                (parsed as any).type === 'result' &&
                this.process?.stdin &&
                !this.process.stdin.destroyed
              ) {
                this.debugLog(
                  'DEBUG: [Transport] Received result message, closing stdin for non-keepAlive mode'
                );
                this.process.stdin.end();
              }

              messages.push(parsed);
            } catch (error) {
              // If JSON parsing fails but it looks like JSON, capture error
              if (
                jsonStr.trim().startsWith('{') ||
                jsonStr.trim().startsWith('[')
              ) {
                parseError = new CLIJSONDecodeError(
                  `Failed to parse CLI output: ${error}`,
                  jsonStr
                );
                return; // Stop processing more data
              }
              this.debugLog(
                'DEBUG: Skipping non-JSON data:',
                jsonStr.substring(0, 100)
              );
            }

            // Remove processed JSON from buffer
            buffer = buffer.substring(jsonEnd);
            startIndex = 0;
          } else {
            // No complete JSON found, wait for more data
            break;
          }
        }
      };

      const onEnd = () => {
        processComplete = true;
      };

      this.process.stdout.on('data', onData);
      this.process.stdout.on('end', onEnd);

      // Yield messages as they become available
      let messageIndex = 0;
      while (!processComplete || messageIndex < messages.length) {
        // Check for parse errors first
        if (parseError) {
          throw parseError;
        }

        if (messageIndex < messages.length) {
          const message = messages[messageIndex];
          if (message) {
            yield message;
          }
          messageIndex++;
        } else {
          // Wait a bit for more messages
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Clean up event listeners
      this.process.stdout.removeListener('data', onData);
      this.process.stdout.removeListener('end', onEnd);

      // Final check for parse errors
      if (parseError) {
        throw parseError;
      }

      // After all messages are processed, wait for process to exit
      try {
        await this.process;

        // Call process complete handlers on successful exit
        for (const handler of this.processCompleteHandlers) {
          try {
            handler(0); // Exit code 0 for success
          } catch (error) {
            this.debugLog('DEBUG: Error in process complete handler:', error);
          }
        }
      } catch (error: any) {
        const exitCode = error.exitCode ?? 1;

        // Call process complete handlers on error
        for (const handler of this.processCompleteHandlers) {
          try {
            handler(exitCode, error);
          } catch (handlerError) {
            this.debugLog(
              'DEBUG: Error in process complete handler:',
              handlerError
            );
          }
        }

        if (error.exitCode !== 0) {
          throw new ProcessError(
            `Claude Code CLI exited with code ${error.exitCode}`,
            error.exitCode,
            error.signal
          );
        }
      }
    } catch (error) {
      // Ensure cleanup on any error
      await this.cleanup();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    // Clear any timeouts
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = undefined;
    }

    // Clean up process
    if (this.process) {
      try {
        if (!this.process.killed) {
          this.process.cancel();
        }

        // Wait a bit for graceful shutdown
        await Promise.race([
          this.process.catch(() => {}), // Ignore exit errors
          new Promise((resolve) => setTimeout(resolve, 1000)) // 1 second timeout
        ]);
      } catch (error) {
        // Ignore cleanup errors
        this.debugLog('DEBUG: Cleanup error:', error);
      } finally {
        this.process = undefined;
      }
    }
  }

  /**
   * Close stdin to signal end of streaming input (for streaming mode)
   */
  closeStdin(): void {
    if (this.process && this.process.stdin && !this.process.stdin.destroyed) {
      try {
        this.process.stdin.end();
      } catch (error) {
        // Ignore errors when closing stdin
      }
    }
  }

  /**
   * Terminate the process and return a promise that resolves when it exits
   */
  async terminate(): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        this.process = undefined;
        resolve();
      };

      // Set up exit handler
      this.process!.on('exit', cleanup);
      this.process!.on('error', cleanup);

      // Try graceful termination first
      if (this.process!.stdin && !this.process!.stdin.destroyed) {
        try {
          this.process!.stdin.end();
        } catch (error) {
          // Ignore errors when closing stdin
        }
      }

      // If process doesn't exit within 1 second, force kill it
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.cancel();
        }
      }, 1000);
    });
  }
}
