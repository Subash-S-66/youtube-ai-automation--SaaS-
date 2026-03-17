import { spawn } from 'child_process';
import path from 'path';
import Job from '../models/Job';
import { AppError } from '../middleware/errorHandler';

export const runPipeline = async (
  userId: string,
  promptId: string,
  geminiPrompt: string,
  settings: Record<string, any>
) => {
  // Check if user already has a running job
  const existingJob = await Job.findOne({ userId, status: 'running' });
  if (existingJob) {
    throw new AppError('A process is already running', 400);
  }

  // Create a new job
  const job = await Job.create({
    userId,
    promptId,
    status: 'running',
    logs: 'Starting pipeline...\n',
  });

  // Run the pipeline as a promise so we can wait for completion
  return new Promise((resolve, reject) => {
    try {
      // Resolve path to the Python project root (assuming it is the repo root)
      const pythonScriptPath = path.resolve(__dirname, '../../../');

      const args = [
        '-m',
        'youtube_ai_automation.main',
        `--userId=${userId}`,
        `--prompt=${geminiPrompt}`,
        `--settings=${JSON.stringify(settings)}`
      ];

      const pythonProcess = spawn('python3', args, {
        cwd: pythonScriptPath,
      });

      let fullLog = job.logs;

      pythonProcess.stdout.on('data', (data) => {
        const text = data.toString();
        fullLog += text;
        console.log(`Pipeline [${job._id}]: ${text.trim()}`);
      });

      pythonProcess.stderr.on('data', (data) => {
        const text = data.toString();
        fullLog += text;
        console.error(`Pipeline [${job._id}] Error: ${text.trim()}`);
      });

      pythonProcess.on('close', async (code) => {
        const status = code === 0 ? 'success' : 'failed';

        await Job.findByIdAndUpdate(job._id, {
          status,
          logs: fullLog + `\nProcess exited with code ${code}`,
        });

        if (code === 0) {
          resolve({ success: true, jobId: job._id });
        } else {
          resolve({ success: false, jobId: job._id, error: `Process failed with code ${code}` });
        }
      });

      pythonProcess.on('error', async (err) => {
        await Job.findByIdAndUpdate(job._id, {
          status: 'failed',
          logs: fullLog + `\nProcess failed to spawn: ${err.message}`,
        });

        resolve({ success: false, jobId: job._id, error: err.message });
      });

    } catch (error) {
      console.error('Failed to run pipeline:', error);
      Job.findByIdAndUpdate(job._id, { status: 'failed', logs: 'Failed to trigger process' }).exec();
      resolve({ success: false, jobId: job._id, error: 'Failed to trigger process' });
    }
  });
};
