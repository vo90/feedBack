"""Chart harmony jobs: explicitly selected local feedpaks, profile-local results."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import appstate
import sloppak
from dlc_paths import _get_dlc_dir, _resolve_dlc_path
from harmony_jobs import HarmonyQueueFull


router = APIRouter(prefix="/api/harmony", tags=["harmony"])


class AnalysisRequest(BaseModel):
    filenames: list[str] = Field(min_length=1, max_length=100)
    force: bool = False
    priority: str = "batch"


@router.post("/analyse", status_code=202)
def analyse(request: AnalysisRequest):
    root = _get_dlc_dir()
    if root is None:
        raise HTTPException(400, "Song library is not configured")
    if request.priority not in {"batch", "current"}:
        raise HTTPException(422, "Unknown analysis priority")
    files = []
    seen = set()
    for filename in request.filenames:
        if len(filename) > 4096:
            raise HTTPException(422, "Song filename is too long")
        path = _resolve_dlc_path(root, filename)
        if path is None or path == root.resolve():
            raise HTTPException(403, "Song path is outside the library")
        if not path.exists():
            raise HTTPException(404, "Song was not found")
        if not sloppak.is_sloppak(path):
            raise HTTPException(422, "Chart analysis currently supports Feedpak songs")
        if path not in seen:
            seen.add(path)
            files.append((filename, path))
    try:
        return appstate.harmony_jobs.submit(files, priority=request.priority, force=request.force)
    except HarmonyQueueFull as exc:
        raise HTTPException(429, str(exc)) from exc


@router.get("/jobs/{job_id}")
def get_job(job_id: str, include_results: bool = True):
    snapshot = appstate.harmony_jobs.snapshot(job_id, include_results=include_results)
    if snapshot is None:
        raise HTTPException(404, "Harmony job is no longer available; analyse again")
    return snapshot


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str):
    snapshot = appstate.harmony_jobs.cancel(job_id)
    if snapshot is None:
        raise HTTPException(404, "Harmony job was not found")
    return snapshot
