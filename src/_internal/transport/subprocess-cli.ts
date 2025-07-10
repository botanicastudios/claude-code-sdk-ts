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
  ProcessCompleteHandler
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

    if (this.options.debug) {
      console.error('DEBUG: [Transport] isActive() check:', {
        hasProcess,
        isKilled,
        hasExitCode,
        exitCode: this.process?.exitCode,
        hasStdin,
        stdinDestroyed,
        result: isActive
      });
    }

    return isActive;
  }

  /**
   * Write streaming input to the active process stdin
   */
  writeToStdin(data: string): void {
    if (!this.isActive()) {
      throw new Error('No active process to write to');
    }

    if (this.process && this.process.stdin) {
      try {
        if (this.streamingMode) {
          // For streaming mode, wrap message in JSONL format
          const jsonlMessage = {
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'text', text: data }]
            }
          };

          if (this.options.debug) {
            console.error(
              'DEBUG: [Transport] Writing JSONL to process stdin:',
              JSON.stringify(jsonlMessage).substring(0, 150) + '...'
            );
          }

          this.process.stdin.write(JSON.stringify(jsonlMessage) + '\n');

          if (this.options.debug) {
            console.error(
              'DEBUG: [Transport] Successfully wrote JSONL to stdin'
            );
          }
        } else {
          // For non-streaming mode, write as-is (though this shouldn't happen)
          if (this.options.debug) {
            console.error(
              'DEBUG: [Transport] Writing raw data to stdin:',
              data.substring(0, 100) + '...'
            );
          }
          this.process.stdin.write(data);
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
      if (this.options.debug) {
        console.error(
          'DEBUG: Running command:',
          executablePath,
          executableArgs.join(' ')
        );
      }

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
        if (this.options.debug) {
          console.error('DEBUG: Process error:', error);
        }
      });

      this.process.on('exit', (code, signal) => {
        if (this.options.debug) {
          console.error('DEBUG: Process exited:', { code, signal });
        }
      });

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

          if (this.options.debug) {
            console.error(
              'DEBUG: [Transport] Sending initial JSONL message in streaming mode',
              {
                streamingMode: this.streamingMode,
                keepAlive: this.keepAlive,
                willKeepStdinOpen: this.keepAlive
                  ? 'indefinitely until end()'
                  : 'until result message received'
              }
            );
          }

          this.process.stdin.write(JSON.stringify(jsonlMessage) + '\n');
          // Keep stdin open for potential streaming input and for keepAlive behavior
          // stdin will be closed when we receive a result message (if keepAlive=false) or explicitly via end()
        } else {
          // For simple queries, send as plain text and close stdin
          this.process.stdin.write(this.prompt + '\n');
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
        if (this.options.debug) {
          console.error('DEBUG stderr:', line);
        }
      });

      stderrRl.on('error', (error) => {
        if (this.options.debug) {
          console.error('DEBUG stderr error:', error);
        }
      });
    }

    const rl = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    try {
      // Process stream-json format - each line is a JSON object
      for await (const line of rl) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (this.options.debug) {
          console.error('DEBUG stdout:', trimmedLine);
        }

        try {
          const parsed = JSON.parse(trimmedLine) as CLIOutput;

          // For non-keepAlive mode, close stdin when we receive a result message
          // This allows the CLI process to exit gracefully after completing the response
          if (
            !this.keepAlive &&
            (parsed as any).type === 'result' &&
            this.process?.stdin &&
            !this.process.stdin.destroyed
          ) {
            if (this.options.debug) {
              console.error(
                'DEBUG: [Transport] Received result message, closing stdin for non-keepAlive mode'
              );
            }
            this.process.stdin.end();
          }

          yield parsed;
        } catch (error) {
          // Skip non-JSON lines (like Python SDK does)
          if (trimmedLine.startsWith('{') || trimmedLine.startsWith('[')) {
            throw new CLIJSONDecodeError(
              `Failed to parse CLI output: ${error}`,
              trimmedLine
            );
          }
          continue;
        }
      }

      // After all messages are processed, wait for process to exit
      try {
        await this.process;

        // Call process complete handlers on successful exit
        for (const handler of this.processCompleteHandlers) {
          try {
            handler(0); // Exit code 0 for success
          } catch (error) {
            if (this.options.debug) {
              console.error('DEBUG: Error in process complete handler:', error);
            }
          }
        }
      } catch (error: any) {
        const exitCode = error.exitCode ?? 1;

        // Call process complete handlers on error
        for (const handler of this.processCompleteHandlers) {
          try {
            handler(exitCode, error);
          } catch (handlerError) {
            if (this.options.debug) {
              console.error(
                'DEBUG: Error in process complete handler:',
                handlerError
              );
            }
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
    } finally {
      rl.close();
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
        if (this.options.debug) {
          console.error('DEBUG: Cleanup error:', error);
        }
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
