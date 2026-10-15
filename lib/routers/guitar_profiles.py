"""Local physical-guitar settings; no song library writes."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
import appstate
import guitar_profiles

router = APIRouter()


@router.get("/api/guitar-profiles")
def get_profiles():
    try:
        return guitar_profiles.read(appstate.config_dir / "guitar-profiles.json")
    except guitar_profiles.ProfileError as error:
        return JSONResponse({"error": str(error)}, error.status)


@router.post("/api/guitar-profiles")
def change_profiles(data: dict):
    try:
        return guitar_profiles.update(appstate.config_dir / "guitar-profiles.json", data)
    except guitar_profiles.ProfileError as error:
        return JSONResponse({"error": str(error)}, error.status)
