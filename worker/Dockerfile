# Worker-only runtime image
# Build context should be repository root: `docker build -f worker/Dockerfile .`

FROM node:20-bookworm-slim AS node_builder
WORKDIR /src/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src
RUN npm run build

FROM python:3.11-slim AS python_deps
WORKDIR /deps
COPY pipeline/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt --target /opt/pydeps

FROM node:20-bookworm-slim AS runtime
WORKDIR /worker

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PIPELINE_PYTHON_CMD=python3

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY --from=node_builder /src/backend/dist ./dist
# Keep runtime worker modules only; remove API server entrypoints.
RUN rm -rf dist/controllers dist/routes dist/middleware dist/app.js dist/server.js dist/socket.js

COPY pipeline ./pipeline
COPY --from=python_deps /opt/pydeps /opt/pydeps

ENV PYTHONPATH=/worker/pipeline/src:/opt/pydeps

CMD ["node", "dist/workers/startPipelineWorker.js"]
