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

    const payload = {
      template: {
        containers: [
          {
            name: containerName,
            env: envVars
          }
        ]
      }
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
    console.error('Failed to trigger Azure job:', error?.response?.data || error.message);
    throw new Error('Azure Job API Error');
  }
}
