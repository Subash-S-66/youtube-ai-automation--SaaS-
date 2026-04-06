import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

export interface LocalPipelineResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface LocalPipelineCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

interface LocalPythonRuntimeResolution {
  available: boolean;
  command: string | null;
  candidates: string[];
  reason: string;
}

const PYTHON_RUNTIME_CACHE_TTL_MS = 30_000;
let cachedPythonRuntime: { expiresAt: number; value: LocalPythonRuntimeResolution } | null = null;

const dedupeCandidates = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

const resolvePythonCandidates = (): string[] => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const pipelineDir = path.join(repoRoot, 'pipeline');

  const candidates: string[] = [
    String(process.env.PIPELINE_PYTHON_CMD || '').trim(),
    String(process.env.PYTHON_EXECUTABLE || '').trim(),
    path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, '.venv', 'bin', 'python'),
    path.join(pipelineDir, '.venv', 'Scripts', 'python.exe'),
    path.join(pipelineDir, '.venv', 'bin', 'python'),
  ];

  if (process.platform === 'win32') {
    candidates.push('py', 'python', 'python3');
  } else {
    candidates.push('python3', 'python');
  }

  return dedupeCandidates(candidates);
};

const canExecutePythonCommand = (command: string): boolean => {
  if (!command) {
    return false;
  }

  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (hasPathSeparator && !fs.existsSync(command)) {
    return false;
  }

  try {
    const result = spawnSync(command, ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 2500,
    });

    if (result.error) {
      return false;
    }

    return typeof result.status === 'number' && result.status === 0;
  } catch {
    return false;
  }
};

export const resolveLocalPythonRuntime = (forceRefresh = false): LocalPythonRuntimeResolution => {
  const now = Date.now();
  if (!forceRefresh && cachedPythonRuntime && cachedPythonRuntime.expiresAt > now) {
    return cachedPythonRuntime.value;
  }

  const candidates = resolvePythonCandidates();
  for (const candidate of candidates) {
    if (canExecutePythonCommand(candidate)) {
      const resolved: LocalPythonRuntimeResolution = {
        available: true,
        command: candidate,
        candidates,
        reason: '',
      };
      cachedPythonRuntime = {
        expiresAt: now + PYTHON_RUNTIME_CACHE_TTL_MS,
        value: resolved,
      };
      return resolved;
    }
  }

  const unresolved: LocalPythonRuntimeResolution = {
    available: false,
    command: null,
    candidates,
    reason: 'No executable Python runtime found for local pipeline runner.',
  };
  cachedPythonRuntime = {
    expiresAt: now + PYTHON_RUNTIME_CACHE_TTL_MS,
    value: unresolved,
  };
  return unresolved;
};

export const isLocalPipelineRuntimeAvailable = (): boolean => {
  return resolveLocalPythonRuntime().available;
};

export const triggerLocalPipeline = async (
  envVars: Array<{ name: string; value: string }>,
  callbacks?: LocalPipelineCallbacks
): Promise<LocalPipelineResult> => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const pipelineDir = path.join(repoRoot, 'pipeline');
  const pipelineSrc = path.join(pipelineDir, 'src');
  const pythonRuntime = resolveLocalPythonRuntime();
  if (!pythonRuntime.available || !pythonRuntime.command) {
    const err: any = new Error(
      `[LocalPipeline] Python runtime not found. Checked candidates: ${pythonRuntime.candidates.join(', ')}`
    );
    err.code = 'ENOENT';
    throw err;
  }
  const pythonCmd = pythonRuntime.command;

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const entry of envVars) {
    env[entry.name] = entry.value;
  }
  env.PYTHONPATH = env.PYTHONPATH ? `${pipelineSrc}${path.delimiter}${env.PYTHONPATH}` : pipelineSrc;
  env.RUN_MODE = env.RUN_MODE || 'full';
  env.FORCE_GOOGLE_AUDIO_ONLY = env.FORCE_GOOGLE_AUDIO_ONLY || 'true';
  env.GEMINI_AUDIO_ENABLED = env.GEMINI_AUDIO_ENABLED || 'true';
  env.GEMINI_AUDIO_ONLY = env.GEMINI_AUDIO_ONLY || 'true';
  env.ALLOW_SILENT_AUDIO_FALLBACK = env.ALLOW_SILENT_AUDIO_FALLBACK || 'false';

  // Ensure GEMINI_MODEL is forwarded
  if (!env.GEMINI_MODEL && process.env.GEMINI_MODEL) {
    env.GEMINI_MODEL = process.env.GEMINI_MODEL;
  }

  return await new Promise<LocalPipelineResult>((resolve, reject) => {
    const child = spawn(
      pythonCmd,
      ['-m', 'youtube_ai_automation.azure_job_runner'],
      {
        cwd: pipelineDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      callbacks?.onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      callbacks?.onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      const moduleNotFoundMatch = /ModuleNotFoundError: No module named '([^']+)'/.exec(stderr);
      if (moduleNotFoundMatch) {
        const missingModule = moduleNotFoundMatch[1];
        stderr += `\n[LocalPipeline] Missing Python dependency: ${missingModule}. Run: pip install -r pipeline/requirements.txt\n`;
      }
      resolve({
        success: exitCode === 0,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
};
