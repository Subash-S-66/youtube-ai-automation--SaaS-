# GitHub Actions CI/CD (Vercel Backend + Azure Worker)

This repository supports hybrid deployment through GitHub Actions:

1. Backend API on Vercel (`.github/workflows/backend.yml`)
2. Pipeline worker on Azure Container Apps Job (`.github/workflows/pipeline.yml`)

## Workflows

- `backend.yml`
  - Trigger: push to `main` when `backend/**` changes (or manual run)
  - CI: install, audit, type-check
  - CD: trigger deployment on Vercel

- `pipeline.yml`
  - Trigger: push to `main` when `pipeline/**` changes (or manual run)
  - CI: Python dependency install + pytest
  - CD: build image and create/update Azure Container Apps Job via `pipeline/scripts/deploy_azure_job.ps1`

## Required GitHub Secrets

Set these in GitHub: Repository -> Settings -> Secrets and variables -> Actions -> Secrets.

### Shared

- No shared secrets across both workflows are required.

### Backend Workflow

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_BACKEND_PROJECT_ID`

### Pipeline Workflow

- `AZURE_SUBSCRIPTION_ID`
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_RESOURCE_GROUP`
- `AZURE_ACR_NAME`
- `AZURE_ENVIRONMENT_RESOURCE_ID`
  - Container Apps managed environment ARM ID
- `ENV_FILE_BASE64`
  - Base64 of `pipeline/config/.env`
- `YOUTUBE_CLIENT_SECRET_JSON_BASE64`
  - Base64 of `pipeline/config/client_secret.json`
- `YOUTUBE_TOKEN_JSON_BASE64`
  - Base64 of `pipeline/data/output/token.json`

## Optional GitHub Repository Variables

Set these in GitHub: Repository -> Settings -> Secrets and variables -> Actions -> Variables.

### Backend

- No backend variables required by default.

### Pipeline

- `AZURE_JOB_NAME` (required; set as Actions Variable or Secret)
- `AZURE_JOB_CONTAINER_NAME` (optional)
- `AZURE_JOB_ALLOW_CREATE` (default: `false`)
- `AZURE_JOB_CPU` (default: `1`)
- `AZURE_JOB_MEMORY` (default: `2Gi`)
- `AZURE_JOB_PARALLELISM` (default: `2`)
- `AZURE_JOB_REPLICA_COMPLETION_COUNT` (default: `1`)
- `AZURE_JOB_REPLICA_RETRY_LIMIT` (default: `0`)
- `AZURE_JOB_REPLICA_TIMEOUT` (default: `3600`)

Optional secret:

- `AZURE_ARM_API_VERSION` (default in workflow: `2023-05-01`)

## One-Time Azure Setup Notes

1. Create Azure Container Registry (ACR).
2. Create Container Apps Environment for pipeline job deployment.
3. Create or verify DigitalOcean App Platform app for backend API.
4. Grant the service principal (`AZURE_CLIENT_ID`) access to:
   - Resource group (Contributor)
   - ACR push/build permissions (`AcrPush`)

## Security and Runtime Notes

- Keep backend as brain-only if you are using dedicated workers:
  - `RUN_EMBEDDED_WORKER=false`
  - `AUTO_START_EMBEDDED_WORKER_WHEN_MISSING=false`
- Azure worker deployment updates only the configured `AZURE_JOB_NAME` via explicit `az containerapp job ... -n <job> -g <rg>` commands; no wildcard updates are used.
- Job creation is opt-in (`AZURE_JOB_ALLOW_CREATE=true`). By default, deployment fails if target job does not exist, preventing accidental changes in shared resource groups.
- Do not use `latest` image tags. Workflow computes a pinned tag per run and deployment script also rejects `latest`.
- Rotate any secrets that were previously exposed outside secret managers.

## Manual Deploy

You can run either workflow manually from the Actions tab using `workflow_dispatch`.
