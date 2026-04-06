export interface RemotePipelineResult {
  success: boolean;
  message: string;
}

export const triggerRemotePipeline = async (params: {
  jobId: string;
  userId: string;
  envVars: Array<{ name: string; value: string }>;
  baseUrlOverride?: string;
  authSecretOverride?: string;
}): Promise<RemotePipelineResult> => {
  const baseUrl = String(params.baseUrlOverride || process.env.PIPELINE_SERVICE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('PIPELINE_SERVICE_URL is required for remote pipeline runner.');
  }

  const authSecret = String(
    params.authSecretOverride || process.env.PIPELINE_SERVICE_SECRET || process.env.WEBHOOK_SECRET || ''
  ).trim();
  const env: Record<string, string> = {};
  for (const item of params.envVars) {
    env[item.name] = item.value;
  }

  const response = await fetch(`${baseUrl}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authSecret ? { 'x-webhook-secret': authSecret } : {}),
    },
    body: JSON.stringify({
      jobId: params.jobId,
      userId: params.userId,
      env,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Remote pipeline dispatch failed (${response.status}): ${errorBody}`);
  }

  const payload = await response.json() as { message?: string };
  return {
    success: true,
    message: payload.message || 'Remote pipeline accepted',
  };
};

