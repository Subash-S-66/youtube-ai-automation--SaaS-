"""
Telegram control bot for the Clip Forge pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from collections import deque

import requests

from youtube_ai_automation.config import OUTPUT_DIR

LOGGER = logging.getLogger("telegram_bot")
STATE_FILE = OUTPUT_DIR / "telegram_bot_state.json"
SCHEDULE_FILE = OUTPUT_DIR / "telegram_schedule.json"
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED_CHAT_ID = os.getenv("TELEGRAM_ALLOWED_CHAT_ID", "").strip()
POLL_TIMEOUT_SECONDS = int(os.getenv("TELEGRAM_POLL_TIMEOUT", "30"))
MAX_COUNT = int(os.getenv("TELEGRAM_MAX_COUNT", "20"))
RUN_TARGET = os.getenv("TELEGRAM_RUN_TARGET", "local").strip().lower()
AZURE_JOB_NAME = os.getenv("AZURE_JOB_NAME", "subash-job").strip()
AZURE_JOB_NAME_PRIMARY = os.getenv("AZURE_JOB_NAME_PRIMARY", "").strip() or AZURE_JOB_NAME
AZURE_JOB_NAME_SECONDARY = os.getenv("AZURE_JOB_NAME_SECONDARY", "").strip()
AZURE_JOB_NAME_TERTIARY = os.getenv("AZURE_JOB_NAME_TERTIARY", "").strip()
AZURE_JOB_LABEL_PRIMARY = os.getenv("AZURE_JOB_LABEL_PRIMARY", "").strip() or AZURE_JOB_NAME_PRIMARY
AZURE_JOB_LABEL_SECONDARY = os.getenv("AZURE_JOB_LABEL_SECONDARY", "").strip() or AZURE_JOB_NAME_SECONDARY
AZURE_JOB_LABEL_TERTIARY = os.getenv("AZURE_JOB_LABEL_TERTIARY", "").strip() or AZURE_JOB_NAME_TERTIARY
AZURE_RESOURCE_GROUP = os.getenv("AZURE_RESOURCE_GROUP", "subash-rg").strip()
AZURE_SUBSCRIPTION_ID = os.getenv("AZURE_SUBSCRIPTION_ID", "").strip()
AZURE_TENANT_ID = os.getenv("AZURE_TENANT_ID", "").strip()
AZURE_CLIENT_ID = os.getenv("AZURE_CLIENT_ID", "").strip()
AZURE_CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET", "").strip()
AZURE_ARM_API_VERSION = os.getenv("AZURE_ARM_API_VERSION", "2025-01-01").strip()

MAX_CAPTURED_LINES = 200
SCHEDULER_POLL_SECONDS = 30
RUNNING_EXECUTION_STATUSES = {"Running", "Pending", "Scheduled", "Processing"}
SCHEDULE_OPTIONS = [
    ("1 every 3 hours (8/day)", 1, 3),
    ("1 every 4 hours (6/day)", 1, 4),
    ("1 every 6 hours (4/day)", 1, 6),
    ("1 every 8 hours (3/day)", 1, 8),
    ("2 every 6 hours (8/day)", 2, 6),
    ("2 every 8 hours (6/day)", 2, 8),
    ("3 every 8 hours (9/day)", 3, 8),
    ("4 every 12 hours (8/day)", 4, 12),
    ("5 every 12 hours (10/day)", 5, 12),
]
RUN_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8]


@dataclass
class PendingAction:
    action: str
    data: dict[str, str] = field(default_factory=dict)


@dataclass
class ActiveRun:
    count: int
    command_text: str
    mode: str
    job_name: str | None = None


class TelegramBotController:
    def __init__(self, token: str, allowed_chat_id: str) -> None:
        if not token:
            raise ValueError("TELEGRAM_BOT_TOKEN is missing.")
        if not allowed_chat_id:
            raise ValueError("TELEGRAM_ALLOWED_CHAT_ID is missing.")
        self.base_url = f"https://api.telegram.org/bot{token}"
        self.allowed_chat_id = allowed_chat_id
        self.pending_actions: dict[str, PendingAction] = {}
        self.current_process: subprocess.Popen[str] | None = None
        self.current_worker: threading.Thread | None = None
        self.current_chat_id: str | None = None
        self.active_run: ActiveRun | None = None
        self._seen_update_ids: set[int] = set()
        self._seen_update_queue: deque[int] = deque(maxlen=2000)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        self._ensure_state_files()
        self._register_bot_commands()
        scheduler = threading.Thread(target=self._scheduler_loop, daemon=True)
        scheduler.start()

    def run(self) -> None:
        offset = 0
        while True:
            try:
                payload = self._api_get(
                    "getUpdates",
                    params={"offset": offset, "timeout": POLL_TIMEOUT_SECONDS},
                    timeout=POLL_TIMEOUT_SECONDS + 10,
                )
                for update in payload.get("result", []):
                    offset = max(offset, int(update["update_id"]) + 1)
                    if self._is_duplicate_update(update):
                        continue
                    self._handle_update(update)
            except Exception as exc:
                LOGGER.warning("Telegram polling failed: %s", exc)
                time.sleep(5)

    def _is_duplicate_update(self, update: dict) -> bool:
        try:
            update_id = int(update.get("update_id"))
        except Exception:
            return False
        if update_id in self._seen_update_ids:
            return True
        self._seen_update_ids.add(update_id)
        self._seen_update_queue.append(update_id)
        if len(self._seen_update_queue) == self._seen_update_queue.maxlen:
            while len(self._seen_update_ids) > self._seen_update_queue.maxlen:
                old_id = self._seen_update_queue.popleft()
                self._seen_update_ids.discard(old_id)
        return False

    def _handle_update(self, update: dict) -> None:
        callback = update.get("callback_query") or {}
        if callback:
            self._handle_callback(callback)
            return
        message = update.get("message") or {}
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id", "")).strip()
        text = str(message.get("text", "")).strip()
        if not chat_id or not text:
            return
        if chat_id != self.allowed_chat_id:
            self._send_message(chat_id, "Unauthorized.")
            return

        if text.startswith("/start"):
            self._send_message(
                chat_id,
                "You can control Azure uploads from here.\n"
                "Use the buttons below or type a slash command.\n"
                "Run starts a new Azure job, Status checks Azure, Schedule sets automatic runs.",
                reply_markup={
                    "keyboard": [
                        [{"text": "/run"}, {"text": "/status"}],
                        [{"text": "/schedule"}, {"text": "/stop_schedule"}],
                    ],
                    "resize_keyboard": True,
                    "is_persistent": True,
                },
            )
            return

        if text.startswith("/status"):
            self._send_message(chat_id, self._build_status_message())
            return

        if text.startswith("/stop_schedule"):
            self._handle_stop_schedule_command(chat_id)
            return

        if text.startswith("/schedule"):
            self._handle_schedule_command(chat_id, text)
            return

        if text.startswith("/run"):
            if self._run_or_execution_active():
                self._send_message(chat_id, "A pipeline run is already active. Use /status to check it.")
                return
            if len(self._azure_job_names()) > 1:
                self.pending_actions[chat_id] = PendingAction(action="await_job_choice")
                self._send_message(
                    chat_id,
                    "Choose which Azure job to run:",
                    reply_markup=self._build_job_choice_buttons(),
                )
            else:
                self.pending_actions[chat_id] = PendingAction(action="await_count", data={"job_name": AZURE_JOB_NAME_PRIMARY})
                self._send_message(
                    chat_id,
                    "Pick a run count:",
                    reply_markup=self._build_run_count_buttons(),
                )
            return

        pending = self.pending_actions.get(chat_id)
        if pending:
            if pending.action == "await_job_choice":
                self._handle_job_choice(chat_id, text)
                return
            if pending.action == "await_count":
                self._handle_count(chat_id, text)
                return
            if pending.action == "await_schedule_choice":
                self._handle_schedule_choice(chat_id, text)
                return
            if pending.action == "await_schedule_job_choice":
                self._handle_schedule_job_choice(chat_id, text)
                return
            if pending.action == "await_custom_schedule_count":
                self._handle_custom_schedule_count(chat_id, text)
                return
            if pending.action == "await_custom_schedule_interval":
                self._handle_custom_schedule_interval(chat_id, text, pending.data)
                return
            if pending.action == "await_stop_schedule_job_choice":
                self._handle_stop_schedule_job_choice(chat_id, text)
                return

        self._send_message(chat_id, "Unknown command. Use /run, /status, or /schedule.")

    def _handle_count(self, chat_id: str, text: str) -> None:
        try:
            count = int(text)
        except ValueError:
            self._send_message(chat_id, f"Send a whole number from 1 to {MAX_COUNT}.")
            return
        if count < 1 or count > MAX_COUNT:
            self._send_message(chat_id, f"Count must be between 1 and {MAX_COUNT}.")
            return

        pending = self.pending_actions.pop(chat_id, None)
        job_name = pending.data.get("job_name") if pending else AZURE_JOB_NAME_PRIMARY
        self._start_pipeline(chat_id, count, job_name)

    def _handle_schedule_command(self, chat_id: str, text: str) -> None:
        if text.strip().lower() == "/schedule off":
            self._handle_stop_schedule_command(chat_id)
            return

        if len(self._azure_job_names()) > 1:
            self.pending_actions[chat_id] = PendingAction(action="await_schedule_job_choice")
            self._send_message(
                chat_id,
                "Choose which Azure job to schedule:",
                reply_markup=self._build_job_choice_buttons(prefix="schedule_job_choice"),
            )
        else:
            self.pending_actions[chat_id] = PendingAction(action="await_schedule_choice")
            self._send_message(
                chat_id,
                "Schedule options (tap a button):",
                reply_markup=self._build_schedule_buttons(),
            )

    def _handle_schedule_choice(self, chat_id: str, text: str) -> None:
        try:
            choice = int(text)
        except ValueError:
            self._send_message(chat_id, "Reply with a number from 1 to 10.")
            return

        if 1 <= choice <= len(SCHEDULE_OPTIONS):
            label, count, interval_hours = SCHEDULE_OPTIONS[choice - 1]
            pending = self.pending_actions.pop(chat_id, None)
            job_name = pending.data.get("job_name") if pending else AZURE_JOB_NAME_PRIMARY
            self._set_schedule(chat_id, count=count, interval_hours=interval_hours, label=label, job_name=job_name)
            return
        if choice == 10:
            pending = self.pending_actions.get(chat_id)
            job_name = pending.data.get("job_name") if pending else AZURE_JOB_NAME_PRIMARY
            self.pending_actions[chat_id] = PendingAction(
                action="await_custom_schedule_count",
                data={"job_name": job_name},
            )
            self._send_message(chat_id, f"Send the custom video count, from 1 to {MAX_COUNT}.")
            return
        self._send_message(chat_id, "Reply with a number from 1 to 10.")

    def _handle_schedule_job_choice(self, chat_id: str, text: str) -> None:
        normalized = text.strip()
        choices = self._azure_job_names()
        if normalized not in choices:
            self._send_message(chat_id, "Please pick a job from the buttons.")
            return
        self.pending_actions[chat_id] = PendingAction(action="await_schedule_choice", data={"job_name": normalized})
        self._send_message(
            chat_id,
            "Schedule options (tap a button):",
            reply_markup=self._build_schedule_buttons(),
        )

    def _handle_stop_schedule_command(self, chat_id: str) -> None:
        if len(self._azure_job_names()) > 1:
            self.pending_actions[chat_id] = PendingAction(action="await_stop_schedule_job_choice")
            self._send_message(
                chat_id,
                "Choose which Azure job to stop scheduling:",
                reply_markup=self._build_job_choice_buttons(prefix="stop_schedule_job_choice"),
            )
            return
        self._disable_schedule(chat_id, AZURE_JOB_NAME_PRIMARY)

    def _handle_stop_schedule_job_choice(self, chat_id: str, text: str) -> None:
        normalized = text.strip()
        choices = self._azure_job_names()
        if normalized not in choices:
            self._send_message(chat_id, "Please pick a job from the buttons.")
            return
        self.pending_actions.pop(chat_id, None)
        self._disable_schedule(chat_id, normalized)

    def _handle_job_choice(self, chat_id: str, text: str) -> None:
        normalized = text.strip()
        choices = self._azure_job_names()
        if normalized not in choices:
            self._send_message(chat_id, "Please pick a job from the buttons.")
            return
        self.pending_actions[chat_id] = PendingAction(action="await_count", data={"job_name": normalized})
        self._send_message(
            chat_id,
            "Pick a run count:",
            reply_markup=self._build_run_count_buttons(),
        )

    def _handle_callback(self, callback: dict) -> None:
        data = str(callback.get("data", "")).strip()
        message = callback.get("message") or {}
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id", "")).strip()
        if not chat_id or chat_id != self.allowed_chat_id:
            self._answer_callback(callback, "Unauthorized.")
            return

        if data.startswith("run_count:"):
            try:
                count = int(data.split(":", 1)[1])
            except ValueError:
                self._answer_callback(callback, "Invalid run count.")
                return
            if count < 1 or count > MAX_COUNT:
                self._answer_callback(callback, f"Count must be between 1 and {MAX_COUNT}.")
                return
            if self._run_or_execution_active():
                self._answer_callback(callback, "A run is already active.")
                return
            pending = self.pending_actions.pop(chat_id, None)
            job_name = pending.data.get("job_name") if pending else AZURE_JOB_NAME_PRIMARY
            self._answer_callback(callback, f"Starting run for {count}.")
            self._start_pipeline(chat_id, count, job_name)
            return

        if data.startswith("job_choice:"):
            job_name = data.split(":", 1)[1].strip()
            if not job_name:
                self._answer_callback(callback, "Invalid job selection.")
                return
            if self._run_or_execution_active():
                self._answer_callback(callback, "A run is already active.")
                return
            self.pending_actions[chat_id] = PendingAction(action="await_count", data={"job_name": job_name})
            self._answer_callback(callback, f"Selected job: {self._job_label(job_name)}")
            self._send_message(
                chat_id,
                "Pick a run count:",
                reply_markup=self._build_run_count_buttons(),
            )
            return

        if data.startswith("schedule_job_choice:"):
            job_name = data.split(":", 1)[1].strip()
            if not job_name:
                self._answer_callback(callback, "Invalid job selection.")
                return
            self.pending_actions[chat_id] = PendingAction(action="await_schedule_choice", data={"job_name": job_name})
            self._answer_callback(callback, f"Selected job: {self._job_label(job_name)}")
            self._send_message(
                chat_id,
                "Schedule options (tap a button):",
                reply_markup=self._build_schedule_buttons(),
            )
            return

        if data.startswith("stop_schedule_job_choice:"):
            job_name = data.split(":", 1)[1].strip()
            if not job_name:
                self._answer_callback(callback, "Invalid job selection.")
                return
            self.pending_actions.pop(chat_id, None)
            self._answer_callback(callback, f"Stopping schedule: {self._job_label(job_name)}")
            self._disable_schedule(chat_id, job_name)
            return

        if data.startswith("schedule_choice:"):
            try:
                choice = int(data.split(":", 1)[1])
            except ValueError:
                self._answer_callback(callback, "Invalid schedule option.")
                return
            if 1 <= choice <= len(SCHEDULE_OPTIONS):
                label, count, interval_hours = SCHEDULE_OPTIONS[choice - 1]
                pending = self.pending_actions.pop(chat_id, None)
                job_name = pending.data.get("job_name") if pending else AZURE_JOB_NAME_PRIMARY
                self._answer_callback(callback, f"Schedule set: {label}")
                self._set_schedule(chat_id, count=count, interval_hours=interval_hours, label=label, job_name=job_name)
                return
            if choice == 10:
                pending = self.pending_actions.get(chat_id)
                job_name = pending.data.get("job_name") if pending else AZURE_JOB_NAME_PRIMARY
                self.pending_actions[chat_id] = PendingAction(
                    action="await_custom_schedule_count",
                    data={"job_name": job_name},
                )
                self._answer_callback(callback, "Send custom count.")
                self._send_message(chat_id, f"Send the custom video count, from 1 to {MAX_COUNT}.")
                return
            self._answer_callback(callback, "Reply with a number from 1 to 10.")
            return

        self._answer_callback(callback, "Unknown action.")

    def _answer_callback(self, callback: dict, text: str) -> None:
        callback_id = str(callback.get("id", "")).strip()
        if not callback_id:
            return
        try:
            self._api_get("answerCallbackQuery", params={"callback_query_id": callback_id, "text": text})
        except Exception:
            return

    def _build_run_count_buttons(self) -> dict:
        rows = [
            [{"text": str(count), "callback_data": f"run_count:{count}"} for count in RUN_COUNT_OPTIONS[:4]],
            [{"text": str(count), "callback_data": f"run_count:{count}"} for count in RUN_COUNT_OPTIONS[4:]],
        ]
        return {"inline_keyboard": rows}

    def _build_job_choice_buttons(self, prefix: str = "job_choice") -> dict:
        rows: list[list[dict[str, str]]] = []
        for name in self._azure_job_names():
            rows.append([{"text": self._job_label(name), "callback_data": f"{prefix}:{name}"}])
        return {"inline_keyboard": rows} if rows else {}

    def _build_schedule_buttons(self) -> dict:
        rows: list[list[dict[str, str]]] = []
        row: list[dict[str, str]] = []
        for idx, (label, _count, _interval) in enumerate(SCHEDULE_OPTIONS, start=1):
            row.append({"text": label, "callback_data": f"schedule_choice:{idx}"})
            if len(row) == 2:
                rows.append(row)
                row = []
        if row:
            rows.append(row)
        rows.append([{"text": "10. Custom schedule", "callback_data": "schedule_choice:10"}])
        return {"inline_keyboard": rows}

    def _handle_custom_schedule_count(self, chat_id: str, text: str) -> None:
        try:
            count = int(text)
        except ValueError:
            self._send_message(chat_id, f"Send a whole number from 1 to {MAX_COUNT}.")
            return
        if count < 1 or count > MAX_COUNT:
            self._send_message(chat_id, f"Count must be between 1 and {MAX_COUNT}.")
            return
        pending = self.pending_actions.get(chat_id)
        job_name = pending.data.get("job_name") if pending else AZURE_JOB_NAME_PRIMARY
        self.pending_actions[chat_id] = PendingAction(
            action="await_custom_schedule_interval",
            data={"count": str(count), "job_name": job_name},
        )
        self._send_message(chat_id, "Send the interval in hours, for example 6.")

    def _handle_custom_schedule_interval(self, chat_id: str, text: str, data: dict[str, str]) -> None:
        try:
            interval_hours = int(text)
        except ValueError:
            self._send_message(chat_id, "Send a whole number of hours, for example 6.")
            return
        count = int(data.get("count", "0") or 0)
        job_name = data.get("job_name", AZURE_JOB_NAME_PRIMARY)
        if interval_hours < 1 or interval_hours > 24:
            self._send_message(chat_id, "Interval must be between 1 and 24 hours.")
            return
        projected_per_day = count * (24 / interval_hours)
        if projected_per_day > 10:
            self._send_message(
                chat_id,
                f"That schedule would try to upload {projected_per_day:.1f} videos/day. Keep it at 10/day or less.",
            )
            return
        self.pending_actions.pop(chat_id, None)
        self._set_schedule(
            chat_id,
            count=count,
            interval_hours=interval_hours,
            label=f"{count} every {interval_hours} hours ({projected_per_day:.1f}/day)",
            job_name=job_name,
        )

    def _set_schedule(self, chat_id: str, *, count: int, interval_hours: int, label: str, job_name: str | None = None) -> None:
        next_run_at = (datetime.now(timezone.utc) + timedelta(hours=interval_hours)).isoformat()
        schedule = {
            "enabled": True,
            "count": count,
            "interval_hours": interval_hours,
            "label": label,
            "next_run_at": next_run_at,
            "chat_id": chat_id,
            "job_name": job_name or AZURE_JOB_NAME_PRIMARY,
        }
        schedules = self._load_schedules()
        schedules[schedule["job_name"]] = schedule
        self._save_schedules(schedules)
        self._send_message(
            chat_id,
            f"Schedule started: {label}.\nNext automatic Azure run at {next_run_at}.\n"
            "You will get a Telegram message when each scheduled run starts, completes, or fails.",
        )

    def _disable_schedule(self, chat_id: str, job_name: str) -> None:
        schedules = self._load_schedules()
        schedule = schedules.get(job_name, {"job_name": job_name})
        schedule["enabled"] = False
        schedules[job_name] = schedule
        self._save_schedules(schedules)
        self.pending_actions.pop(chat_id, None)
        self._send_message(chat_id, f"Schedule stopped for {self._job_label(job_name)}.")

    def _start_pipeline(self, chat_id: str, count: int, job_name: str | None = None) -> None:
        self._save_state({"requested_count": count, "last_status": "starting", "last_job_name": job_name or ""})
        if RUN_TARGET == "azure":
            self._start_azure_job(chat_id, count, job_name or AZURE_JOB_NAME_PRIMARY)
            return

        cmd = [sys.executable, "main.py", "--optimized", "--count", str(count), "--upload"]
        self.current_process = subprocess.Popen(
            cmd,
            cwd=str(BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self.current_chat_id = chat_id
        command_text = " ".join(cmd)
        self.active_run = ActiveRun(count=count, command_text=command_text, mode="local")
        self._send_message(chat_id, f"Started: {command_text}")
        watcher = threading.Thread(target=self._watch_process, daemon=True)
        self.current_worker = watcher
        watcher.start()

    def _start_azure_job(self, chat_id: str, count: int, job_name: str) -> None:
        self.current_chat_id = chat_id
        self.active_run = ActiveRun(
            count=count,
            command_text=f"azure-start {job_name} RUN_COUNT={count}",
            mode="azure",
            job_name=job_name,
        )
        if self._has_azure_rest_credentials(job_name):
            self._send_message(chat_id, f"Starting Azure job for count {count}.")
            worker = threading.Thread(
                target=self._start_azure_job_via_rest,
                args=(chat_id, count, job_name),
                daemon=True,
            )
            self.current_worker = worker
            worker.start()
            return

        cmd = [
            "az", "containerapp", "job", "start",
            "-n", job_name,
            "-g", AZURE_RESOURCE_GROUP,
            "--env-vars", f"RUN_COUNT={count}",
        ]
        self.current_process = subprocess.Popen(
            cmd,
            cwd=str(BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        command_text = " ".join(cmd)
        self.active_run = ActiveRun(count=count, command_text=command_text, mode="azure", job_name=job_name)
        self._send_message(chat_id, f"Started Azure job: {command_text}")
        watcher = threading.Thread(target=self._watch_process, daemon=True)
        self.current_worker = watcher
        watcher.start()

    def _watch_process(self) -> None:
        process = self.current_process
        chat_id = self.current_chat_id
        active_run = self.active_run
        if process is None or chat_id is None:
            return
        output, _ = process.communicate()
        return_code = process.returncode
        if return_code == 0:
            if active_run is not None:
                success_text = (
                    f"Azure job accepted. Execution started for count {active_run.count}."
                    if active_run.mode == "azure"
                    else f"Completed successfully. {active_run.mode} run finished for count {active_run.count}."
                )
                self._send_message(chat_id, success_text)
                self._save_state({"requested_count": active_run.count, "last_status": "accepted"})
            else:
                self._send_message(chat_id, "Pipeline completed successfully.")
        else:
            self._send_message(chat_id, self._format_failure_message(active_run, return_code, output or ""))
            self._save_state({"last_status": "failed"})
        self.current_process = None
        self.current_worker = None
        self.current_chat_id = None
        self.active_run = None

    def _start_azure_job_via_rest(self, chat_id: str, count: int, job_name: str) -> None:
        try:
            access_token = self._get_azure_access_token()
            containers = self._get_azure_job_containers(access_token=access_token, job_name=job_name)
            updated_containers = self._override_run_count(containers=containers, count=count)
            payload = {"containers": updated_containers}
            response = requests.post(
                self._azure_job_start_url(job_name),
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json=payload,
                timeout=60,
            )
            response.raise_for_status()
            execution_payload = response.json() if response.content else {}
            execution_name = str(execution_payload.get("name", "")).strip()
            self._save_state(
                {
                    "requested_count": count,
                    "last_status": "accepted",
                    "last_execution_name": execution_name,
                    "last_started_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            self._send_message(chat_id, f"Azure job accepted ({job_name}). Execution started for count {count}.")
        except Exception as exc:
            self._send_message(chat_id, f"azure run failed for count {count}. Reason: {exc}")
            self._save_state({"last_status": "failed"})
        finally:
            self.current_process = None
            self.current_worker = None
            self.current_chat_id = None
            self.active_run = None

    def _build_status_message(self) -> str:
        if RUN_TARGET != "azure" or not self._has_azure_rest_credentials(AZURE_JOB_NAME_PRIMARY):
            if self._is_run_active():
                count = self.active_run.count if self.active_run else self._load_state().get("requested_count", 0)
                return f"Local pipeline is running. Target count: {count}."
            return "No active pipeline run."

        schedules = self._load_schedules()
        lines: list[str] = []
        for job_name in self._azure_job_names():
            schedule = schedules.get(job_name, {})
            schedule_line = "Schedule: off."
            if schedule.get("enabled"):
                schedule_line = (
                    f"Schedule: {schedule.get('label', 'custom')} | "
                    f"Next run: {schedule.get('next_run_at', 'unknown')}"
                )
            try:
                snapshot = self._get_latest_execution_snapshot(job_name)
            except Exception as exc:
                lines.append(f"{self._job_label(job_name)}: status error: {exc}\n{schedule_line}")
                continue

            if snapshot is None:
                lines.append(f"{self._job_label(job_name)}: no executions found.\n{schedule_line}")
                continue

            status = snapshot.get("status", "Unknown")
            execution_name = snapshot.get("name", "unknown")
            started = snapshot.get("startTime", "unknown")
            lines.append(
                " | ".join(
                    [
                        f"Job: {self._job_label(job_name)}",
                        f"Status: {status}",
                        f"Execution: {execution_name}",
                        f"Started: {started}",
                    ]
                )
            )
            lines.append(schedule_line)
        return "\n".join(lines).strip()

    def _format_failure_message(self, active_run: ActiveRun | None, exit_code: int, output: str) -> str:
        normalized = output.lower()
        if (
            "upload limit exceeded" in normalized
            or "uploadlimitexceeded" in normalized
            or "quota exceeded" in normalized
            or "quotaexceeded" in normalized
            or "dailylimitexceeded" in normalized
        ):
            return "YouTube limit reached."

        reason = self._extract_error_reason(output)
        if active_run is None:
            return f"Process failed with exit code {exit_code}. Reason: {reason}"
        job_note = f" ({self._job_label(active_run.job_name)})" if active_run and active_run.job_name else ""
        return f"{active_run.mode}{job_note} run failed for count {active_run.count} with exit code {exit_code}. Reason: {reason}"

    def _extract_error_reason(self, output: str) -> str:
        lines = deque(maxlen=MAX_CAPTURED_LINES)
        for raw_line in output.splitlines():
            line = raw_line.strip()
            if line:
                lines.append(line)
        if not lines:
            return "No error output captured."
        for line in reversed(lines):
            if any(pattern in line for pattern in ("| ERROR |", "Traceback", "HttpError", "Exception:", "Error:", "ERROR:", "Failed:", "failed:")):
                return line
        return lines[-1]

    def _run_or_execution_active(self) -> bool:
        if self._is_run_active():
            return True
        if RUN_TARGET == "azure":
            for job_name in self._azure_job_names():
                if not self._has_azure_rest_credentials(job_name):
                    continue
                try:
                    snapshot = self._get_latest_execution_snapshot(job_name)
                except Exception:
                    continue
                if snapshot and snapshot.get("status") in RUNNING_EXECUTION_STATUSES:
                    return True
        return False

    def _is_run_active(self) -> bool:
        if self.current_process is not None and self.current_process.poll() is None:
            return True
        if self.current_worker is not None and self.current_worker.is_alive():
            return True
        return False

    def _is_job_execution_active(self, job_name: str) -> bool:
        if self._is_run_active():
            if self.active_run and self.active_run.job_name == job_name:
                return True
            return False
        if RUN_TARGET == "azure":
            if not self._has_azure_rest_credentials(job_name):
                return False
            try:
                snapshot = self._get_latest_execution_snapshot(job_name)
            except Exception:
                return False
            if snapshot and snapshot.get("status") in RUNNING_EXECUTION_STATUSES:
                return True
        return False

    def _has_azure_rest_credentials(self, job_name: str | None) -> bool:
        return all(
            (
                AZURE_SUBSCRIPTION_ID,
                AZURE_TENANT_ID,
                AZURE_CLIENT_ID,
                AZURE_CLIENT_SECRET,
                AZURE_RESOURCE_GROUP,
                job_name,
            )
        )

    def _azure_job_names(self) -> list[str]:
        names = []
        if AZURE_JOB_NAME_PRIMARY:
            names.append(AZURE_JOB_NAME_PRIMARY)
        if AZURE_JOB_NAME_SECONDARY and AZURE_JOB_NAME_SECONDARY not in names:
            names.append(AZURE_JOB_NAME_SECONDARY)
        if AZURE_JOB_NAME_TERTIARY and AZURE_JOB_NAME_TERTIARY not in names:
            names.append(AZURE_JOB_NAME_TERTIARY)
        return names

    def _job_label(self, job_name: str) -> str:
        if job_name == AZURE_JOB_NAME_PRIMARY:
            return AZURE_JOB_LABEL_PRIMARY
        if job_name == AZURE_JOB_NAME_SECONDARY and AZURE_JOB_LABEL_SECONDARY:
            return AZURE_JOB_LABEL_SECONDARY
        if job_name == AZURE_JOB_NAME_TERTIARY and AZURE_JOB_LABEL_TERTIARY:
            return AZURE_JOB_LABEL_TERTIARY
        return job_name

    def _get_azure_access_token(self) -> str:
        response = requests.post(
            f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token",
            data={
                "grant_type": "client_credentials",
                "client_id": AZURE_CLIENT_ID,
                "client_secret": AZURE_CLIENT_SECRET,
                "scope": "https://management.azure.com/.default",
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        token = str(payload.get("access_token", "")).strip()
        if not token:
            raise RuntimeError("Azure token response did not include access_token.")
        return token

    def _azure_job_resource_url(self, job_name: str) -> str:
        return (
            "https://management.azure.com/subscriptions/"
            f"{AZURE_SUBSCRIPTION_ID}/resourceGroups/{AZURE_RESOURCE_GROUP}"
            f"/providers/Microsoft.App/jobs/{job_name}"
            f"?api-version={AZURE_ARM_API_VERSION}"
        )

    def _azure_job_start_url(self, job_name: str) -> str:
        return (
            "https://management.azure.com/subscriptions/"
            f"{AZURE_SUBSCRIPTION_ID}/resourceGroups/{AZURE_RESOURCE_GROUP}"
            f"/providers/Microsoft.App/jobs/{job_name}/start"
            f"?api-version={AZURE_ARM_API_VERSION}"
        )

    def _azure_job_executions_url(self, job_name: str) -> str:
        return (
            "https://management.azure.com/subscriptions/"
            f"{AZURE_SUBSCRIPTION_ID}/resourceGroups/{AZURE_RESOURCE_GROUP}"
            f"/providers/Microsoft.App/jobs/{job_name}/executions"
            f"?api-version={AZURE_ARM_API_VERSION}"
        )

    def _get_azure_job_containers(self, access_token: str, job_name: str) -> list[dict]:
        response = requests.get(
            self._azure_job_resource_url(job_name),
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        containers = payload.get("properties", {}).get("template", {}).get("containers", [])
        if not containers:
            raise RuntimeError("Azure job template did not return any containers.")
        return containers

    def _get_latest_execution_snapshot(self, job_name: str) -> dict | None:
        access_token = self._get_azure_access_token()
        response = requests.get(
            self._azure_job_executions_url(job_name),
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("value", [])
        if not isinstance(items, list) or not items:
            return None
        items.sort(
            key=lambda item: str(item.get("properties", {}).get("startTime", "")),
            reverse=True,
        )
        latest = items[0]
        props = latest.get("properties", {})
        return {
            "name": latest.get("name", ""),
            "status": props.get("status", "Unknown"),
            "startTime": props.get("startTime", ""),
            "endTime": props.get("endTime", ""),
        }

    def _override_run_count(self, containers: list[dict], count: int) -> list[dict]:
        updated: list[dict] = []
        for container in containers:
            updated_container = dict(container)
            env_list = []
            found_run_count = False
            for env_var in container.get("env", []):
                env_copy = dict(env_var)
                if env_copy.get("name") == "RUN_COUNT":
                    env_copy.pop("secretRef", None)
                    env_copy["value"] = str(count)
                    found_run_count = True
                env_list.append(env_copy)
            if not found_run_count:
                env_list.append({"name": "RUN_COUNT", "value": str(count)})
            updated_container["env"] = env_list
            updated.append(updated_container)
        return updated

    def _scheduler_loop(self) -> None:
        while True:
            try:
                schedules = self._load_schedules()
                for job_name, schedule in schedules.items():
                    if not schedule.get("enabled"):
                        continue
                    if self._is_job_execution_active(job_name):
                        continue
                    next_run_at = str(schedule.get("next_run_at", "")).strip()
                    if not next_run_at:
                        continue
                    due_at = datetime.fromisoformat(next_run_at)
                    if due_at.tzinfo is None:
                        due_at = due_at.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) >= due_at:
                        count = int(schedule.get("count", 0) or 0)
                        interval_hours = int(schedule.get("interval_hours", 0) or 0)
                        chat_id = str(schedule.get("chat_id", self.allowed_chat_id)).strip() or self.allowed_chat_id
                        if count > 0 and interval_hours > 0:
                            schedule["next_run_at"] = (datetime.now(timezone.utc) + timedelta(hours=interval_hours)).isoformat()
                            schedules[job_name] = schedule
                            self._save_schedules(schedules)
                            self._send_message(chat_id, f"Scheduled run starting now for count {count} ({self._job_label(job_name)}).")
                            self._start_pipeline(chat_id, count, job_name)
                time.sleep(SCHEDULER_POLL_SECONDS)
            except Exception as exc:
                LOGGER.warning("Scheduler loop failed: %s", exc)
                time.sleep(SCHEDULER_POLL_SECONDS)

    def _ensure_state_files(self) -> None:
        if not STATE_FILE.exists():
            self._save_state({})
        if not SCHEDULE_FILE.exists():
            self._save_schedules({})

    def _load_state(self) -> dict:
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_state(self, updates: dict) -> None:
        payload = self._load_state()
        payload.update(updates)
        STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _load_schedules(self) -> dict:
        try:
            payload = json.loads(SCHEDULE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        if "enabled" in payload:
            job_name = str(payload.get("job_name", "")).strip() or AZURE_JOB_NAME_PRIMARY
            return {job_name: payload}
        return payload

    def _save_schedules(self, payload: dict) -> None:
        SCHEDULE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _api_get(self, method: str, params: dict, timeout: int) -> dict:
        response = requests.get(f"{self.base_url}/{method}", params=params, timeout=timeout)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(f"Telegram API error: {payload}")
        return payload

    def _api_post(self, method: str, data: dict, timeout: int = 20) -> dict:
        response = requests.post(f"{self.base_url}/{method}", data=data, timeout=timeout)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(f"Telegram API error: {payload}")
        return payload

    def _send_message(self, chat_id: str, text: str, reply_markup: dict | None = None) -> None:
        try:
            payload = {"chat_id": chat_id, "text": text}
            if reply_markup is not None:
                payload["reply_markup"] = json.dumps(reply_markup)
            self._api_post("sendMessage", data=payload)
        except Exception as exc:
            LOGGER.warning("Failed to send Telegram message: %s", exc)

    def _register_bot_commands(self) -> None:
        commands = [
            {"command": "start", "description": "Show bot info and buttons"},
            {"command": "run", "description": "Start an Azure upload run"},
            {"command": "status", "description": "Show Azure execution status"},
            {"command": "schedule", "description": "Create an automatic schedule"},
            {"command": "stop_schedule", "description": "Stop the automatic schedule"},
        ]
        try:
            self._api_post(
                "setMyCommands",
                data={"commands": json.dumps(commands)},
            )
        except Exception as exc:
            LOGGER.warning("Failed to register Telegram commands: %s", exc)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    controller = TelegramBotController(token=BOT_TOKEN, allowed_chat_id=ALLOWED_CHAT_ID)
    controller.run()


if __name__ == "__main__":
    main()

