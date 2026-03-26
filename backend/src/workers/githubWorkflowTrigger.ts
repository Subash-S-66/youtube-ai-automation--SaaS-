import crypto from 'crypto';

export interface GithubWorkflowInputs {
  jobId: string;
  userId: string;
  runMode?: string;
  pipelinePayload?: string;
  youtubeTokenEncrypted: string;
}

export interface GithubWorkflowResult {
  success: boolean;
  dispatchId?: string;
}

const buildDispatchId = () => crypto.randomUUID();

export const triggerGithubWorkflow = async (
  inputs: GithubWorkflowInputs
): Promise<GithubWorkflowResult> => {
  const owner = process.env.GITHUB_REPO_OWNER || '';
  const repo = process.env.GITHUB_REPO_NAME || '';
  const workflowId = process.env.GITHUB_WORKFLOW_ID || 'run_pipeline.yml';
  const ref = process.env.GITHUB_WORKFLOW_REF || 'main';
  const token = process.env.GITHUB_TOKEN || '';

  if (!owner || !repo || !workflowId || !token) {
    throw new Error('Missing GitHub Actions configuration. Set GITHUB_REPO_OWNER, GITHUB_REPO_NAME, GITHUB_WORKFLOW_ID, and GITHUB_TOKEN.');
  }

  const dispatchId = buildDispatchId();
  const payload = {
    ref,
    inputs: {
      dispatch_id: dispatchId,
      job_id: inputs.jobId,
      user_id: inputs.userId,
      run_mode: inputs.runMode || 'prepared',
      pipeline_payload: inputs.pipelinePayload || '{}',
      youtube_token_encrypted: inputs.youtubeTokenEncrypted,
    },
  };

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${errorText}`);
  }

  return { success: true, dispatchId };
};
