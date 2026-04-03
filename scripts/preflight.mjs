import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const repoRoot = process.cwd();
const isCi = process.argv.includes('--ci');

const venvPython = isWindows
  ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
  : path.join(repoRoot, '.venv', 'bin', 'python');

const pythonCmd = existsSync(venvPython) ? venvPython : 'python';

const run = (label, command, args, options = {}) => {
  console.log(`\n[Preflight] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...(options.env || {}) },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
};

const quoteForCmd = (value) => {
  const str = String(value);
  if (!/[\s"]/u.test(str)) {
    return str;
  }
  return `"${str.replace(/"/gu, '\\"')}"`;
};

const runNpm = (label, args) => {
  if (!isWindows) {
    run(label, 'npm', args);
    return;
  }

  const cmdExe = process.env.ComSpec || 'cmd.exe';
  const commandLine = ['npm', ...args].map(quoteForCmd).join(' ');
  run(label, cmdExe, ['/d', '/s', '/c', commandLine]);
};

try {
  runNpm('Backend build', ['--prefix', 'backend', 'run', 'build']);
  runNpm('Backend security audit', ['--prefix', 'backend', 'audit', '--omit=dev']);

  runNpm('Frontend build', ['--prefix', 'frontend', 'run', 'build']);
  runNpm('Frontend lint', ['--prefix', 'frontend', 'run', 'lint']);
  runNpm('Frontend security audit', ['--prefix', 'frontend', 'audit', '--omit=dev']);

  if (!isCi) {
    run('Install pipeline test dependencies', pythonCmd, ['-m', 'pip', 'install', '-r', 'pipeline/requirements-dev.txt']);
  }
  run(
    'Pipeline tests',
    pythonCmd,
    ['-m', 'pytest', '-q', 'tests'],
    { env: { PYTHONPATH: 'pipeline/src' } }
  );

  console.log('\n[Preflight] All checks passed.');
} catch (error) {
  console.error(`\n[Preflight] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
