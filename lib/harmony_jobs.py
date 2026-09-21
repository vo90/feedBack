"""Profile-local chart analysis, with one cancellable worker and no library writes.

The source adapter and musical engine are independent of this job/cache layer.
Construction performs no IO and starts no threads; the server owns its lifetime.
"""

import copy
import hashlib
import heapq
import json
import logging
import math
import os
import threading
import time
import uuid
from pathlib import Path

from harmony import source_revision
from harmony_analysis import analyse_harmony, ALGORITHM_VERSION
from harmony_source import load_harmony_source


log = logging.getLogger("feedBack.harmony")
_TERMINAL = {"complete", "cancelled", "failed"}
_MAX_CACHE_BYTES = 16 * 1024 * 1024


class HarmonyQueueFull(ValueError):
    pass


class HarmonyJobs:
    """One song at a time; current-song work precedes queued batch songs."""

    def __init__(self, config_dir, *, loader=None, analyser=None, revision_check=None):
        self.cache_dir = Path(config_dir) / "harmony_analysis"
        self._loader = loader or load_harmony_source
        self._analyse = analyser or analyse_harmony
        self._revision_check = revision_check or source_revision
        self._condition = threading.Condition(threading.RLock())
        self._jobs = {}
        self._queue = []
        self._sequence = 0
        self._thread = None
        self._closed = False

    def submit(self, files, *, priority="batch", force=False):
        """files is an already containment-validated [(relative_name, Path)] list."""
        with self._condition:
            if self._closed:
                raise HarmonyQueueFull("Harmony analysis is shutting down")
            self._prune()
            if sum(j["status"] not in _TERMINAL for j in self._jobs.values()) >= 16:
                raise HarmonyQueueFull("Harmony queue is full; wait for a job or cancel one")
            job_id = uuid.uuid4().hex
            job = {"id": job_id, "status": "queued", "total": len(files),
                   "completed": 0, "created_at": time.time(), "force": bool(force),
                   "cancel": threading.Event(), "items": [
                       {"filename": name, "path": Path(path), "status": "queued"}
                       for name, path in files]}
            self._jobs[job_id] = job
            for index in range(len(files)):
                self._sequence += 1
                heapq.heappush(self._queue, (0 if priority == "current" else 10,
                                            self._sequence, job_id, index))
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="harmony-charts", daemon=True)
                self._thread.start()
            self._condition.notify_all()
            return self.snapshot(job_id, include_results=False)

    def _prune(self):
        # Retain recent completed jobs for clients, without retaining whole charts.
        terminal = [j for j in self._jobs.values() if j["status"] in _TERMINAL]
        for job in sorted(terminal, key=lambda j: j["created_at"])[:-8]:
            self._jobs.pop(job["id"], None)

    def snapshot(self, job_id, *, include_results=True):
        with self._condition:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            snapshot = {k: job[k] for k in ("id", "status", "total", "completed", "created_at")}
            snapshot["items"] = [{k: copy.deepcopy(v) for k, v in item.items()
                                  if k not in {"path", "result_path", "result"}}
                                 for item in job["items"]]
            stored = [(item.get("result_path"), item.get("result")) for item in job["items"]]
        # Disk IO never holds the queue lock or the server event loop.
        if include_results:
            for item, (path, memory_result) in zip(snapshot["items"], stored):
                result = memory_result or self._read_cache(path)
                if result is not None:
                    item["result"] = copy.deepcopy(result)
        return snapshot

    def cancel(self, job_id):
        with self._condition:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if job["status"] not in _TERMINAL:
                job["cancel"].set()
                job["status"] = "cancelled"
                for item in job["items"]:
                    if item["status"] in {"queued", "running"}:
                        item["status"] = "cancelled"
                job["completed"] = sum(i["status"] in _TERMINAL for i in job["items"])
                self._condition.notify_all()
            return self.snapshot(job_id, include_results=False)

    def close(self):
        with self._condition:
            self._closed = True
            for job_id in list(self._jobs):
                self.cancel(job_id)
            self._condition.notify_all()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=2)

    @staticmethod
    def _read_cache(path):
        if path is None:
            return None
        try:
            path = Path(path)
            if path.stat().st_size > _MAX_CACHE_BYTES:
                return None
            result = json.loads(path.read_text(encoding="utf-8"))
            if (not isinstance(result, dict) or result.get("version") != 1
                    or result.get("algorithm_version") != ALGORITHM_VERSION
                    or not all(isinstance(result.get(track), dict)
                               and isinstance(result[track].get("events"), list)
                               for track in ("keys", "harmony", "scales"))):
                return None
            duration = result.get("duration")
            if (not isinstance(duration, (float, int)) or isinstance(duration, bool)
                    or not math.isfinite(duration) or duration < 0):
                return None
            for track in ("keys", "harmony", "scales"):
                for event in result[track]["events"]:
                    if not isinstance(event, dict):
                        return None
                    start, end = event.get("t"), event.get("end")
                    if (any(not isinstance(t, (float, int)) or isinstance(t, bool) or not math.isfinite(t)
                            for t in (start, end)) or not 0 <= start < end <= duration + .00001):
                        return None
            return result
        except (OSError, ValueError, TypeError):
            return None

    def _write_cache(self, path, result, cancelled):
        # A cancelled computation never replaces the last completed result.
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix("." + uuid.uuid4().hex + ".tmp")
        try:
            payload = json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")
            if len(payload) > _MAX_CACHE_BYTES:
                raise OSError("Harmony result exceeds the local cache size limit")
            temporary.write_bytes(payload)
            # Cancellation and publication share a linearization point. Once
            # cancel() returns, no cancelled worker may replace a cache entry.
            with self._condition:
                if cancelled():
                    return False
                os.replace(temporary, path)
            return True
        finally:
            temporary.unlink(missing_ok=True)

    def _process(self, item, job):
        started = time.perf_counter()
        cancelled = lambda: self._closed or job["cancel"].is_set()
        source = self._loader(item["path"], cancelled=cancelled)
        if cancelled():
            return None
        identity = {"fingerprint": source["fingerprint"], "revision": source["revision"],
                    "algorithm": ALGORITHM_VERSION, "normalization": source.get("normalization_version"),
                    "options": {}}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        path = self.cache_dir / (key + ".json")
        result = None if job["force"] else self._read_cache(path)
        if result is not None and result.get("revision") != source["revision"]:
            result = None
        cached = result is not None
        if result is None:
            result = self._analyse(source, cancelled=cancelled)
        if cancelled():
            return None
        revision = self._revision_check(item["path"], source.get("revision_content_files", ()),
                                        source.get("revision_audio_files", ()))
        if not revision or revision != source["revision"]:
            raise ValueError("Song changed during analysis; reopen it and analyse again")
        updates = {"cached": cached, "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                   "analysis_status": result.get("status", "partial"), "revision": result["revision"]}
        if not cached:
            try:
                if not self._write_cache(path, result, cancelled):
                    return None
            except OSError:
                # An unwritable profile must not prevent the current play session.
                log.warning("Unable to cache chart harmony", exc_info=True)
                updates["result"] = result
                updates["cache_warning"] = "Result available for this session; local cache is unavailable"
        if "result" not in updates:
            updates["result_path"] = path
        return updates

    def _run(self):
        while True:
            with self._condition:
                self._condition.wait_for(lambda: self._closed or bool(self._queue))
                if self._closed:
                    return
                _, _, job_id, index = heapq.heappop(self._queue)
                job = self._jobs.get(job_id)
                if job is None or job["cancel"].is_set():
                    continue
                item = job["items"][index]
                job["status"] = "running"
                item["status"] = "running"
            try:
                updates = self._process(item, job)
                error = None
            except Exception as exc:
                updates = None
                error = str(exc) or type(exc).__name__
                if not job["cancel"].is_set():
                    log.warning("Chart analysis failed for %s: %s", item["filename"], error)
            with self._condition:
                if job["cancel"].is_set() or self._closed:
                    item["status"] = "cancelled"
                elif error:
                    item.update(status="failed", error=error)
                elif updates is not None:
                    item.update(updates, status="complete")
                else:
                    item["status"] = "cancelled"
                job["completed"] = sum(i["status"] in _TERMINAL for i in job["items"])
                if job["completed"] == job["total"] and not job["cancel"].is_set():
                    job["status"] = "failed" if all(i["status"] == "failed" for i in job["items"]) else "complete"
                self._condition.notify_all()
