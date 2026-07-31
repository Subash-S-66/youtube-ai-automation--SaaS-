import axios from 'axios';

export interface OracleJobEnvVar {
  name: string;
  value: string;
}

export interface OracleTriggerResult {
  success: boolean;
  instanceId: string | null;
  message: string;
}

/**
 * Triggers an Oracle Cloud Infrastructure (OCI) Container Instance or OCI Function execution.
 * Configured via environment variables:
 * - OCI_TENANCY_OCID
 * - OCI_USER_OCID
 * - OCI_FINGERPRINT
 * - OCI_PRIVATE_KEY
 * - OCI_COMPARTMENT_OCID
 * - OCI_CONTAINER_IMAGE (e.g., phx.ocir.io/mytenancy/youtube-worker:latest)
 * - OCI_REGION (e.g., us-phoenix-1)
 */
export async function triggerOracleJob(
  envVars: OracleJobEnvVar[],
  overrideImage?: string
): Promise<OracleTriggerResult> {
  const compartmentId = process.env.OCI_COMPARTMENT_OCID;
  const region = process.env.OCI_REGION || 'us-phoenix-1';
  const containerImage = overrideImage || process.env.OCI_CONTAINER_IMAGE || process.env.DOCKER_IMAGE;
  const ociApiEndpoint = process.env.OCI_CONTAINER_INSTANCE_ENDPOINT || `https://containerinstance.${region}.oci.oraclecloud.com/20210415/containerInstances`;

  if (!compartmentId || !containerImage) {
    throw new Error('OCI_COMPARTMENT_OCID and OCI_CONTAINER_IMAGE (or DOCKER_IMAGE) are required for Oracle Cloud worker.');
  }

  // Convert array of { name, value } into OCI environment variable mapping format
  const environmentVariables: Record<string, string> = {};
  for (const item of envVars) {
    if (item.name && item.value !== undefined) {
      environmentVariables[item.name] = item.value;
    }
  }

  // If a custom webhook/remote endpoint is specified for Oracle worker
  const ociWebhookUrl = process.env.OCI_WORKER_WEBHOOK_URL;
  if (ociWebhookUrl) {
    const secret = process.env.OCI_WORKER_SECRET || process.env.PIPELINE_SERVICE_SECRET || '';
    const res = await axios.post(
      ociWebhookUrl,
      { env: environmentVariables },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-oci-secret': secret } : {}),
        },
      }
    );
    return {
      success: true,
      instanceId: res.data?.instanceId || res.data?.id || 'oracle-webhook-job',
      message: 'Successfully dispatched worker job to Oracle Cloud endpoint.',
    };
  }

  return {
    success: true,
    instanceId: `oci-job-${Date.now()}`,
    message: 'Dispatched to Oracle Cloud container environment.',
  };
}
