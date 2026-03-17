import { spawn } from 'child_process';
import path from 'path';
import Job from '../models/Job';
import { AppError } from '../middleware/errorHandler';

export const runPipeline = async (
  userId: string,
  promptId: string,
  geminiPrompt: string,
  settings: Record<string, any>,
  youtubeToken: string
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

  // Start the pipeline in the background and do NOT wait for it to finish
  try {
    // Resolve path to the Python project root
    const pythonScriptPath = path.resolve(__dirname, '../../../');

    const args = [
      '-m',
      'youtube_ai_automation.main',
      `--userId=${userId}`,
      `--prompt=${geminiPrompt}`,
      `--token=${youtubeToken}`,
      `--settings=${JSON.stringify(settings)}`
    ];

    const pythonProcess = spawn('python3', args, {
      cwd: pythonScriptPath,
      env: { ...process.env, PYTHONPATH: 'src' }
    });

    let fullLog = job.logs;

    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString();
      fullLog += text;
      console.log(`Pipeline [${job._id}]: ${text.trim()}`);

      // Optionally update DB incrementally (careful with too many writes)
      Job.findByIdAndUpdate(job._id, { logs: fullLog }).exec().catch(console.error);
    });

    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      fullLog += text;
      console.error(`Pipeline [${job._id}] Error: ${text.trim()}`);

      Job.findByIdAndUpdate(job._id, { logs: fullLog }).exec().catch(console.error);
    });

    pythonProcess.on('close', async (code) => {
      const status = code === 0 ? 'success' : 'failed';
      fullLog += `\nProcess exited with code ${code}`;

      await Job.findByIdAndUpdate(job._id, {
        status,
        logs: fullLog,
      }).catch(console.error);
    });

    pythonProcess.on('error', async (err) => {
      fullLog += `\nProcess failed to spawn: ${err.message}`;
      await Job.findByIdAndUpdate(job._id, {
        status: 'failed',
        logs: fullLog,
      }).catch(console.error);
    });

  } catch (error) {
    console.error('Failed to trigger pipeline:', error);
    // Mark as failed if spawn fails synchronously
    await Job.findByIdAndUpdate(job._id, { status: 'failed', logs: 'Failed to trigger process' });
    throw new AppError('Failed to trigger process', 500);
  }

  // Return the jobId immediately
  return job._id;
};
