import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubprocessCLITransport } from '../src/_internal/transport/subprocess-cli.js';
import { execa } from 'execa';

// Mock execa
vi.mock('execa');
const mockExeca = vi.mocked(execa);

describe('SubprocessCLITransport - Wrapper Command', () => {
  let transport: SubprocessCLITransport;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful execa call
    const mockProcess = {
      exitCode: null,
      killed: false,
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        destroyed: false
      },
      stdout: {
        on: vi.fn(),
        pipe: vi.fn()
      },
      stderr: {
        on: vi.fn(),
        pipe: vi.fn()
      },
      on: vi.fn(),
      cancel: vi.fn(),
      all: undefined
    };

    mockExeca.mockReturnValue(mockProcess as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should use wrapper command when provided', async () => {
    const options = {
      wrapperCommand: ['wsl.exe', 'node'],
      executablePath: '/path/to/claude-cli.js',
      debug: true
    };

    transport = new SubprocessCLITransport('test prompt', options);

    // Mock findCLI to return a known path
    const findCLISpy = vi
      .spyOn(transport as any, 'findCLI')
      .mockResolvedValue('/path/to/claude-cli.js');

    await transport.connect();

    expect(findCLISpy).toHaveBeenCalled();
    expect(mockExeca).toHaveBeenCalledWith(
      'wsl.exe',
      expect.arrayContaining(['node', '/path/to/claude-cli.js']),
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_ENTRYPOINT: 'sdk-ts'
        }),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        buffer: false
      })
    );
  });

  it('should use direct execution when no wrapper command provided', async () => {
    const options = {
      executablePath: '/path/to/claude-cli.js',
      debug: true
    };

    transport = new SubprocessCLITransport('test prompt', options);

    // Mock findCLI to return a known path
    const findCLISpy = vi
      .spyOn(transport as any, 'findCLI')
      .mockResolvedValue('/path/to/claude-cli.js');

    await transport.connect();

    expect(findCLISpy).toHaveBeenCalled();
    expect(mockExeca).toHaveBeenCalledWith(
      '/path/to/claude-cli.js',
      expect.arrayContaining(['--output-format', 'stream-json']),
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_ENTRYPOINT: 'sdk-ts'
        }),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        buffer: false
      })
    );
  });

  it('should handle complex wrapper commands', async () => {
    const options = {
      wrapperCommand: ['docker', 'run', '--rm', '-i', 'node:18', 'node'],
      executablePath: '/app/claude-cli.js',
      debug: true
    };

    transport = new SubprocessCLITransport('test prompt', options);

    // Mock findCLI to return a known path
    const findCLISpy = vi
      .spyOn(transport as any, 'findCLI')
      .mockResolvedValue('/app/claude-cli.js');

    await transport.connect();

    expect(findCLISpy).toHaveBeenCalled();
    expect(mockExeca).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining([
        'run',
        '--rm',
        '-i',
        'node:18',
        'node',
        '/app/claude-cli.js',
        '--output-format',
        'stream-json'
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_ENTRYPOINT: 'sdk-ts'
        }),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        buffer: false
      })
    );
  });

  it('should handle empty wrapper command gracefully', async () => {
    const options = {
      wrapperCommand: [],
      executablePath: '/path/to/claude-cli.js',
      debug: true
    };

    transport = new SubprocessCLITransport('test prompt', options);

    // Mock findCLI to return a known path
    const findCLISpy = vi
      .spyOn(transport as any, 'findCLI')
      .mockResolvedValue('/path/to/claude-cli.js');

    await transport.connect();

    expect(findCLISpy).toHaveBeenCalled();
    // Should fall back to direct execution
    expect(mockExeca).toHaveBeenCalledWith(
      '/path/to/claude-cli.js',
      expect.arrayContaining(['--output-format', 'stream-json']),
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_ENTRYPOINT: 'sdk-ts'
        }),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        buffer: false
      })
    );
  });
});
