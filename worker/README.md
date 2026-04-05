# Worker-Only Deployment

This folder lets you deploy a dedicated worker runtime (queue consumer + pipeline runtime) without running the backend HTTP server process.

## What Runs Here

- BullMQ pipeline worker (`dist/workers/startPipelineWorker.js`)
- Python pipeline runtime (`pipeline/src`)
- Redis heartbeat + job execution dispatch

## What Does Not Run Here

- Express backend server
- Auth/payment/admin HTTP API routes

## Prerequisites

1. Shared MongoDB with backend API
2. Shared Redis with backend API
3. Valid backend webhook endpoint (`BACKEND_URL`) and `WEBHOOK_SECRET`

## Quick Start (Docker)

Two deployment modes are supported:

1. VM with worker folder only (run prebuilt image)
2. Full repository checkout (build image locally)

1. Copy env template:

```bash
cp worker/.env.example worker/.env
```

2. Edit values in `worker/.env`.

### Mode A: VM with worker folder only

1. Set `WORKER_IMAGE` in `worker/.env` to your registry image.
2. Pull and run:

```bash
cd worker
docker compose pull
docker compose up -d
```

### Mode B: Full repository checkout

1. Build and run from source:

```bash
cd worker
docker compose -f docker-compose.build.yml up -d --build
```

3. Check logs:

```bash
docker compose logs -f clipforge-worker
```

## Scale Strategy

- Laptop worker: set `PIPELINE_WORKER_PROFILE=local`
- VM worker: set `PIPELINE_WORKER_PROFILE=vm`
- Cloud worker: set `PIPELINE_WORKER_PROFILE=cloud`
- Optional explicit override: `PIPELINE_WORKER_CONCURRENCY=<1-32>`

Note: runtime controls are primarily loaded from `SystemConfig` (Admin Panel). Env values are fallbacks.

## Brain-Only Backend Setup

On DigitalOcean backend API service, keep these disabled:

- `RUN_EMBEDDED_WORKER=false`
- `AUTO_START_EMBEDDED_WORKER_WHEN_MISSING=false`

That keeps API as brain-only while workers run on VM/laptop/Azure.
