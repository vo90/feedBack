"""Local physical-guitar settings; no song library writes."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
import appstate
import guitar_profiles
from appconfig import _load_config
from tunings import settings_with_instrument_profiles

router = APIRouter()


def existing_family():
    settings = settings_with_instrument_profiles(_load_config(appstate.config_dir / "config.json") or {})
    role = settings.get("active_instrument_profile", "guitar-lead")
    return ("bass" if settings.get("instrument") == "bass" else "guitar",
            role if role in ("guitar-lead", "guitar-rhythm") else "guitar-lead")


@router.get("/api/guitar-profiles")
def get_profiles():
    try:
        return guitar_profiles.read(appstate.config_dir / "guitar-profiles.json", *existing_family())
    except guitar_profiles.ProfileError as error:
        return JSONResponse({"error": str(error)}, error.status)


@router.post("/api/guitar-profiles")
def change_profiles(data: dict):
    try:
        return guitar_profiles.update(appstate.config_dir / "guitar-profiles.json", data, *existing_family())
    except guitar_profiles.ProfileError as error:
        return JSONResponse({"error": str(error)}, error.status)
