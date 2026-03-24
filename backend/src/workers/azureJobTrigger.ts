import axios from 'axios';

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
): Promise<{ success: boolean; accessToken: string | null }> {
  try {
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
    const resourceGroup = process.env.RESOURCE_GROUP;
    const accessToken = await getAzureToken();

    if (!accessToken || !subscriptionId || !resourceGroup) {
      console.warn('Azure credentials missing, simulating job trigger.');
      return { success: true, accessToken: null }; // fallback for dev
    }

    // Trigger Job
    const triggerUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/jobs/${jobName}/start?api-version=2023-05-01`;

    const payload = {
      template: {
        containers: [
          {
            name: "pipeline-worker",
            env: envVars
          }
        ]
      }
    };

    await axios.post(triggerUrl, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return { success: true, accessToken };
  } catch (error: any) {
    console.error('Failed to trigger Azure job:', error?.response?.data || error.message);
    throw new Error('Azure Job API Error');
  }
}
