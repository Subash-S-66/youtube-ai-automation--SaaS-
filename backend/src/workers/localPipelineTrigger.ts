import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

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

export const triggerLocalPipeline = async (
  envVars: Array<{ name: string; value: string }>,
  callbacks?: LocalPipelineCallbacks
): Promise<LocalPipelineResult> => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const pipelineDir = path.join(repoRoot, 'pipeline');
  const pipelineSrc = path.join(pipelineDir, 'src');
  const venvPythonWin = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
  const venvPythonUnix = path.join(repoRoot, '.venv', 'bin', 'python');
  const pythonCmd =
    process.env.PIPELINE_PYTHON_CMD ||
    (fs.existsSync(venvPythonWin)
      ? venvPythonWin
      : (fs.existsSync(venvPythonUnix) ? venvPythonUnix : 'python'));

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
