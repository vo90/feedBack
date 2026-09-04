"""Short-lived, owner-scoped grants for Desktop-selected directories.

The Electron main process is the only component that receives the native
filesystem selection.  It registers that path here over an authenticated
loopback request and gives the renderer only the returned opaque token.  A
plugin can then redeem the token through its loader-scoped context callable.

Grants deliberately live only in this process.  Restarting Core invalidates
every outstanding grant, and restarting Desktop rotates the registration
secret that authorizes new ones.
"""

from __future__ import annotations

import hmac
import os
import re
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

DIRECTORY_GRANT_SECRET_ENV = "FEEDBACK_DESKTOP_DIRECTORY_GRANT_SECRET"
DIRECTORY_GRANT_SECRET_HEADER = "X-FeedBack-Desktop-Grant-Secret"
DIRECTORY_GRANT_TTL_SECONDS = 120.0
DIRECTORY_GRANT_MAX_ACTIVE = 256

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_GRANT_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
_MAX_PATH_CHARS = 4096
_MIN_SECRET_CHARS = 32


class DirectoryGrantError(ValueError):
    """A safe, non-path-bearing directory-grant validation error."""


class DirectoryGrantAuthorizationError(PermissionError):
    """The private Desktop registration secret was absent or incorrect."""


@dataclass(frozen=True)
class IssuedDirectoryGrant:
    grant: str
    expires_at_ms: int


@dataclass(frozen=True)
class _DirectoryGrantRecord:
    owner: str
    purpose: str
    path: Path
    expires_at_ms: int
    deadline: float


class DirectoryGrantRegistry:
    """Thread-safe in-memory registry for opaque directory capabilities."""

    def __init__(
        self,
        registration_secret: str | None,
        *,
        ttl_seconds: float = DIRECTORY_GRANT_TTL_SECONDS,
        max_active: int = DIRECTORY_GRANT_MAX_ACTIVE,
        wall_clock: Callable[[], float] = time.time,
        monotonic_clock: Callable[[], float] = time.monotonic,
    ) -> None:
        # Fail closed on a missing or conspicuously weak configured secret.  The
        # managed Desktop supplies a fresh 256-bit value on every backend run.
        self._registration_secret = (
            registration_secret
            if isinstance(registration_secret, str)
            and len(registration_secret) >= _MIN_SECRET_CHARS
            else None
        )
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        if max_active <= 0:
            raise ValueError("max_active must be positive")
        self._ttl_seconds = float(ttl_seconds)
        self._max_active = int(max_active)
        self._wall_clock = wall_clock
        self._monotonic_clock = monotonic_clock
        self._records: dict[str, _DirectoryGrantRecord] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_environment(cls) -> DirectoryGrantRegistry:
        return cls(os.environ.get(DIRECTORY_GRANT_SECRET_ENV))

    def registration_authorized(self, supplied_secret: str | None) -> bool:
        expected = self._registration_secret
        if expected is None or not isinstance(supplied_secret, str):
            return False
        try:
            # compare_digest on str intentionally accepts ASCII only.  The
            # generated secret is URL-safe ASCII, but a crafted header need not
            # be; fail closed instead of turning that input into a 500.
            return hmac.compare_digest(supplied_secret, expected)
        except TypeError:
            return False

    @staticmethod
    def _validate_binding(value: object, field: str) -> str:
        if not isinstance(value, str) or _ID_RE.fullmatch(value) is None:
            raise DirectoryGrantError(f"{field} must be a valid identifier")
        return value

    @staticmethod
    def _canonical_directory(value: object) -> Path:
        if (
            not isinstance(value, str)
            or not value
            or len(value) > _MAX_PATH_CHARS
            or "\x00" in value
        ):
            raise DirectoryGrantError("path must name an existing absolute directory")
        candidate = Path(value)
        if not candidate.is_absolute():
            raise DirectoryGrantError("path must name an existing absolute directory")
        try:
            canonical = candidate.resolve(strict=True)
            if not canonical.is_dir():
                raise DirectoryGrantError("path must name an existing absolute directory")
        except DirectoryGrantError:
            raise
        except (OSError, RuntimeError, ValueError) as exc:
            raise DirectoryGrantError(
                "path must name an existing absolute directory"
            ) from exc
        return canonical

    def _prune_expired_locked(self, now: float) -> None:
        for token, record in list(self._records.items()):
            if record.deadline <= now:
                self._records.pop(token, None)

    def issue(
        self,
        supplied_secret: str | None,
        *,
        owner: object,
        purpose: object,
        path: object,
    ) -> IssuedDirectoryGrant:
        if not self.registration_authorized(supplied_secret):
            raise DirectoryGrantAuthorizationError("directory grant registration denied")

        checked_owner = self._validate_binding(owner, "owner")
        checked_purpose = self._validate_binding(purpose, "purpose")
        canonical_path = self._canonical_directory(path)
        now_monotonic = self._monotonic_clock()
        expires_at_ms = int((self._wall_clock() + self._ttl_seconds) * 1000)

        with self._lock:
            self._prune_expired_locked(now_monotonic)
            # A stuck renderer cannot grow this server-owned table forever.
            # Once full, discard the grant closest to expiry before issuing a
            # fresh one; tokens are intentionally not durable state.
            if len(self._records) >= self._max_active:
                oldest = min(self._records, key=lambda key: self._records[key].deadline)
                self._records.pop(oldest, None)
            while True:
                token = secrets.token_urlsafe(32)
                if token not in self._records:
                    break
            self._records[token] = _DirectoryGrantRecord(
                owner=checked_owner,
                purpose=checked_purpose,
                path=canonical_path,
                expires_at_ms=expires_at_ms,
                deadline=now_monotonic + self._ttl_seconds,
            )

        return IssuedDirectoryGrant(grant=token, expires_at_ms=expires_at_ms)

    def resolve(
        self,
        grant: object,
        owner: object,
        purpose: object,
        *,
        consume: bool = True,
    ) -> Path | None:
        if (
            not isinstance(grant, str)
            or _GRANT_RE.fullmatch(grant) is None
            or not isinstance(owner, str)
            or not isinstance(purpose, str)
        ):
            return None

        now = self._monotonic_clock()
        with self._lock:
            self._prune_expired_locked(now)
            record = self._records.get(grant)
            # A binding mismatch must not consume the rightful owner's token.
            if record is None or record.owner != owner or record.purpose != purpose:
                return None
            if consume:
                self._records.pop(grant, None)

        try:
            if not record.path.is_dir():
                # If a non-consuming probe found a now-missing directory, do
                # not leave the dead capability resident until its TTL elapses.
                with self._lock:
                    self._records.pop(grant, None)
                return None
        except OSError:
            with self._lock:
                self._records.pop(grant, None)
            return None
        return record.path


_registry = DirectoryGrantRegistry.from_environment()


def registration_authorized(supplied_secret: str | None) -> bool:
    """Return whether *supplied_secret* may register a native selection."""

    return _registry.registration_authorized(supplied_secret)


def register_directory_grant(
    supplied_secret: str | None,
    *,
    owner: object,
    purpose: object,
    path: object,
) -> IssuedDirectoryGrant:
    return _registry.issue(
        supplied_secret,
        owner=owner,
        purpose=purpose,
        path=path,
    )


def resolve_directory_grant(
    grant: object,
    owner: object,
    purpose: object,
    *,
    consume: bool = True,
) -> Path | None:
    """Resolve a grant for the exact owner/purpose pair, normally once."""

    return _registry.resolve(grant, owner, purpose, consume=consume)
