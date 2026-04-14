import axios from 'axios';

const DEFAULT_AZURE_ARM_API_VERSION = '2023-05-01';

export const resolveAzureArmApiVersion = (raw: unknown): string => {
  const value = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (value) {
    console.warn(
      `[Azure] Invalid AZURE_ARM_API_VERSION="${value}". Falling back to ${DEFAULT_AZURE_ARM_API_VERSION}.`
    );
  }
  return DEFAULT_AZURE_ARM_API_VERSION;
};

const parseExecutionNameFromLocation = (locationHeader: string): string | null => {
  if (!locationHeader) return null;
  const match = locationHeader.match(/\/executions\/([^/?]+)(?:\?|$)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const compactErrorData = (value: unknown): string => {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  if (typeof value === 'string') {
    return value.slice(0, 1000);
  }
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
};

export async function getAzureToken(): Promise<string | null> {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return null;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const tokenData = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://management.azure.com/.default'
  });

  const tokenRes = await axios.post(tokenUrl, tokenData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return tokenRes.data.access_token;
}

export async function triggerAzureJob(
  jobName: string,
  envVars: Array<{ name: string; value: string }>
): Promise<{ success: boolean; accessToken: string | null; executionName: string | null }> {
  try {
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
    const resourceGroup = process.env.AZURE_RESOURCE_GROUP || process.env.RESOURCE_GROUP;
    const containerName = process.env.AZURE_JOB_CONTAINER_NAME || jobName;
    const apiVersion = resolveAzureArmApiVersion(process.env.AZURE_ARM_API_VERSION);
    const accessToken = await getAzureToken();

    if (!accessToken || !subscriptionId || !resourceGroup) {
      const missing: string[] = [];
      if (!subscriptionId) {
        missing.push('AZURE_SUBSCRIPTION_ID');
      }
      if (!resourceGroup) {
        missing.push('AZURE_RESOURCE_GROUP|RESOURCE_GROUP');
      }
      if (!process.env.AZURE_TENANT_ID) {
        missing.push('AZURE_TENANT_ID');
      }
      if (!process.env.AZURE_CLIENT_ID) {
        missing.push('AZURE_CLIENT_ID');
      }
      if (!process.env.AZURE_CLIENT_SECRET) {
        missing.push('AZURE_CLIENT_SECRET');
      }

      const allowAzureSimulation =
        process.env.NODE_ENV !== 'production' &&
        String(process.env.ALLOW_AZURE_SIMULATION || '').toLowerCase() === 'true';

      if (allowAzureSimulation) {
        console.warn(`Azure credentials missing (${missing.join(', ')}), simulating job trigger.`);
        return { success: true, accessToken: null, executionName: null };
      }

      throw new Error(`Azure credentials missing: ${missing.join(', ') || 'unknown'}`);
    }

    // Trigger Job
    const triggerUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/jobs/${jobName}/start?api-version=${apiVersion}`;

    const jobDetailsUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/jobs/${jobName}?api-version=${apiVersion}`;
    const jobDetailsRes = await axios.get(jobDetailsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const existingContainer = (jobDetailsRes.data?.properties?.template?.containers || []).find(
      (container: any) => String(container?.name || '') === containerName
    ) || (jobDetailsRes.data?.properties?.template?.containers || [])[0];

    const image = String(existingContainer?.image || '').trim();
    if (!image) {
      throw new Error(`Azure job '${jobName}' container image not found for container '${containerName}'.`);
    }

    const existingEnv: Array<{ name: string; value?: string; secretRef?: string }> = Array.isArray(existingContainer?.env)
      ? existingContainer.env
      : [];

    const overrideMap = new Map(
      envVars
        .filter((entry) => String(entry?.name || '').trim())
        .map((entry) => [String(entry.name).trim(), String(entry.value ?? '')])
    );

    const mergedEnv: Array<{ name: string; value?: string; secretRef?: string }> = [];
    const seenNames = new Set<string>();

    for (const entry of existingEnv) {
      const name = String(entry?.name || '').trim();
      if (!name) continue;
      if (overrideMap.has(name)) {
        mergedEnv.push({ name, value: String(overrideMap.get(name) ?? '') });
      } else if (typeof entry?.secretRef === 'string' && entry.secretRef.trim()) {
        mergedEnv.push({ name, secretRef: entry.secretRef.trim() });
      } else {
        mergedEnv.push({ name, value: String(entry?.value ?? '') });
      }
      seenNames.add(name);
    }

    for (const [name, value] of overrideMap.entries()) {
      if (!seenNames.has(name)) {
        mergedEnv.push({ name, value });
      }
    }

    // StartJobExecutionTemplate expects top-level "containers".
    // Include image/resources from the current job template and merge env defaults with per-execution overrides.
    const payload = {
      containers: [
        {
          name: String(existingContainer?.name || containerName),
          image,
          ...(existingContainer?.resources ? { resources: existingContainer.resources } : {}),
          env: mergedEnv,
        },
      ],
    };

    const triggerRes = await axios.post(triggerUrl, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const bodyName = typeof triggerRes.data?.name === 'string' ? triggerRes.data.name : null;
    const bodyId = typeof triggerRes.data?.id === 'string' ? triggerRes.data.id : '';
    const executionName =
      bodyName ||
      parseExecutionNameFromLocation(String(triggerRes.headers?.location || '')) ||
      parseExecutionNameFromLocation(bodyId);

    return { success: true, accessToken, executionName };
  } catch (error: any) {
    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || '').trim();
    const requestId = String(
      error?.response?.headers?.['x-ms-request-id'] ||
      error?.response?.headers?.['x-ms-correlation-request-id'] ||
      ''
    ).trim();
    const responseDetail = compactErrorData(error?.response?.data);
    const detailParts = [
      status > 0 ? `status=${status}` : '',
      code ? `code=${code}` : '',
      requestId ? `requestId=${requestId}` : '',
      responseDetail ? `detail=${responseDetail}` : '',
      error?.message ? `message=${String(error.message).slice(0, 500)}` : '',
    ].filter(Boolean);

    const detailMessage = detailParts.length > 0
      ? detailParts.join(' | ')
      : 'unknown error';

    console.error('Failed to trigger Azure job:', detailMessage);
    throw new Error(`Azure Job API Error: ${detailMessage}`);
  }
}

export async function stopAzureJobExecution(
  jobName: string,
  executionName: string
): Promise<{ success: boolean; message: string }> {
  const normalizedJobName = String(jobName || '').trim();
  const normalizedExecutionName = String(executionName || '').trim();
  if (!normalizedJobName || !normalizedExecutionName) {
    return {
      success: false,
      message: 'Job name and execution name are required.',
    };
  }

  const subscriptionId = String(process.env.AZURE_SUBSCRIPTION_ID || '').trim();
  const resourceGroup = String(process.env.AZURE_RESOURCE_GROUP || process.env.RESOURCE_GROUP || '').trim();
  const apiVersion = resolveAzureArmApiVersion(process.env.AZURE_ARM_API_VERSION);
  const accessToken = await getAzureToken();

  if (!subscriptionId || !resourceGroup || !accessToken) {
    return {
      success: false,
      message: 'Azure credentials or scope settings are missing for stop operation.',
    };
  }

  const stopUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/jobs/${normalizedJobName}/executions/${encodeURIComponent(normalizedExecutionName)}/stop?api-version=${apiVersion}`;

  try {
    await axios.post(
      stopUrl,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      success: true,
      message: `Execution ${normalizedExecutionName} stopped successfully.`,
    };
  } catch (error: any) {
    const status = Number(error?.response?.status || 0);
    const detail = compactErrorData(error?.response?.data);
    const message =
      status > 0
        ? `Azure stop API failed (status=${status})${detail ? ` detail=${detail}` : ''}`
        : String(error?.message || 'Azure stop API failed');
    return {
      success: false,
      message,
    };
  }
}
