"""
Lightweight HTTP service that accepts backend dispatch requests and runs the
prepared pipeline runner asynchronously.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
PYTHON_CMD = os.getenv("PIPELINE_PYTHON_CMD", "python")
SERVICE_HOST = os.getenv("PIPELINE_SERVICE_HOST", "0.0.0.0")
SERVICE_PORT = int(os.getenv("PIPELINE_SERVICE_PORT", "8090"))
AUTH_SECRET = (os.getenv("PIPELINE_SERVICE_SECRET", "") or os.getenv("WEBHOOK_SECRET", "")).strip()

RUN_STATE: dict[str, str] = {}
RUN_LOCK = threading.Lock()


def _json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _run_job(job_id: str, env_updates: dict[str, str]) -> None:
    with RUN_LOCK:
        RUN_STATE[job_id] = "running"
    env = os.environ.copy()
    env.update(env_updates)
    env["PYTHONPATH"] = str(ROOT_DIR / "src")
    env["RUN_MODE"] = env.get("RUN_MODE", "prepared")

    result = subprocess.run(
        [PYTHON_CMD, "-m", "youtube_ai_automation.azure_job_runner"],
        cwd=str(ROOT_DIR),
        env=env,
        capture_output=True,
        text=True,
    )

    if result.stdout:
        print(f"[pipeline-service][{job_id}][stdout]\n{result.stdout[-4000:]}")
    if result.stderr:
        print(f"[pipeline-service][{job_id}][stderr]\n{result.stderr[-4000:]}")

    with RUN_LOCK:
        RUN_STATE[job_id] = "success" if result.returncode == 0 else f"failed:{result.returncode}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[pipeline-service] {self.address_string()} - {fmt % args}")

    def do_GET(self) -> None:
        if self.path == "/health":
            with RUN_LOCK:
                running = sum(1 for status in RUN_STATE.values() if status == "running")
            _json(self, 200, {"ok": True, "runningJobs": running})
            return
        _json(self, 404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/run":
            _json(self, 404, {"ok": False, "error": "Not found"})
            return

        if AUTH_SECRET:
            provided = (self.headers.get("x-webhook-secret", "") or "").strip()
            if not provided or provided != AUTH_SECRET:
                _json(self, 401, {"ok": False, "error": "Unauthorized"})
                return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) if length > 0 else b"{}")
        except Exception:
            _json(self, 400, {"ok": False, "error": "Invalid JSON body"})
            return

        job_id = str(payload.get("jobId", "")).strip()
        env_updates = payload.get("env", {})
        if not job_id:
            _json(self, 400, {"ok": False, "error": "jobId is required"})
            return
        if not isinstance(env_updates, dict):
            _json(self, 400, {"ok": False, "error": "env must be an object"})
            return

        safe_env = {str(k): str(v) for k, v in env_updates.items()}
        with RUN_LOCK:
            current = RUN_STATE.get(job_id)
            if current == "running":
                _json(self, 202, {"ok": True, "message": "Job already running"})
                return

        thread = threading.Thread(target=_run_job, args=(job_id, safe_env), daemon=True)
        thread.start()
        _json(self, 202, {"ok": True, "message": "Job accepted"})


def main() -> None:
    server = ThreadingHTTPServer((SERVICE_HOST, SERVICE_PORT), Handler)
    print(f"[pipeline-service] listening on http://{SERVICE_HOST}:{SERVICE_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()

