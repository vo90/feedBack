"""Private authenticated Desktop -> Core directory-grant registration."""

from __future__ import annotations

import ipaddress
import json

import directory_grants
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter()
_MAX_REQUEST_BYTES = 16 * 1024


def _is_loopback_request(request: Request) -> bool:
    if request.client is None:
        return False
    try:
        address = ipaddress.ip_address(request.client.host)
    except ValueError:
        return False
    if address.is_loopback:
        return True
    mapped = getattr(address, "ipv4_mapped", None)
    return bool(mapped and mapped.is_loopback)


async def _read_bounded_json_object(request: Request) -> dict:
    raw_length = request.headers.get("content-length")
    if raw_length is not None:
        try:
            content_length = int(raw_length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid request body") from exc
        if content_length < 0:
            raise HTTPException(status_code=400, detail="Invalid request body")
        if content_length > _MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="Request body too large")

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > _MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="Request body too large")
        body.extend(chunk)
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")
    return payload


@router.post("/api/desktop/directory-grants", include_in_schema=False)
async def create_directory_grant(request: Request):
    # Authenticate before consuming/parsing the body.  The backend can be LAN
    # reachable, but this private capability-minting endpoint never is.
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="Directory grant registration denied")
    supplied_secret = request.headers.get(directory_grants.DIRECTORY_GRANT_SECRET_HEADER)
    if not directory_grants.registration_authorized(supplied_secret):
        raise HTTPException(status_code=403, detail="Directory grant registration denied")

    payload = await _read_bounded_json_object(request)
    try:
        issued = directory_grants.register_directory_grant(
            supplied_secret,
            owner=payload.get("owner"),
            purpose=payload.get("purpose"),
            path=payload.get("path"),
        )
    except directory_grants.DirectoryGrantAuthorizationError as exc:
        # Re-check inside the registry so future direct callers cannot bypass
        # authentication merely because this router checked once already.
        raise HTTPException(
            status_code=403,
            detail="Directory grant registration denied",
        ) from exc
    except directory_grants.DirectoryGrantError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return JSONResponse(
        status_code=201,
        content={"grant": issued.grant, "expiresAt": issued.expires_at_ms},
        headers={"Cache-Control": "no-store"},
    )
