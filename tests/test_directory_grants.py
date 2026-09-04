"""Security and contract tests for native Desktop directory grants."""


import directory_grants
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers import directory_grants as directory_grants_router

SECRET = "s" * 43


class _Clocks:
    wall = 1_800_000_000.0
    monotonic = 500.0

    def wall_time(self):
        return self.wall

    def monotonic_time(self):
        return self.monotonic


def _registry(*, ttl=120.0):
    clocks = _Clocks()
    registry = directory_grants.DirectoryGrantRegistry(
        SECRET,
        ttl_seconds=ttl,
        wall_clock=clocks.wall_time,
        monotonic_clock=clocks.monotonic_time,
    )
    return registry, clocks


def test_grant_is_opaque_owner_and_purpose_bound_and_consumed_once(tmp_path):
    selected = tmp_path / "External Library"
    selected.mkdir()
    registry, _ = _registry()

    issued = registry.issue(
        SECRET,
        owner="hybrid_track",
        purpose="library-root",
        path=str(selected),
    )

    assert str(selected) not in issued.grant
    assert len(issued.grant) >= 32
    assert registry.resolve(issued.grant, "other_plugin", "library-root") is None
    assert registry.resolve(issued.grant, "hybrid_track", "other-purpose") is None
    assert registry.resolve(issued.grant, "hybrid_track", "library-root") == selected.resolve()
    assert registry.resolve(issued.grant, "hybrid_track", "library-root") is None


def test_non_consuming_probe_can_be_followed_by_one_consuming_resolution(tmp_path):
    selected = tmp_path / "songs"
    selected.mkdir()
    registry, _ = _registry()
    issued = registry.issue(
        SECRET, owner="hybrid_track", purpose="library-root", path=str(selected)
    )

    assert registry.resolve(
        issued.grant, "hybrid_track", "library-root", consume=False
    ) == selected.resolve()
    assert registry.resolve(issued.grant, "hybrid_track", "library-root") == selected.resolve()
    assert registry.resolve(issued.grant, "hybrid_track", "library-root") is None


def test_expired_grant_cannot_be_resolved(tmp_path):
    selected = tmp_path / "songs"
    selected.mkdir()
    registry, clocks = _registry(ttl=2.0)
    issued = registry.issue(
        SECRET, owner="hybrid_track", purpose="library-root", path=str(selected)
    )
    clocks.monotonic += 2.0

    assert registry.resolve(issued.grant, "hybrid_track", "library-root") is None


@pytest.mark.parametrize("bad_secret", [None, "", "wrong", "s" * 42, "å" * 43])
def test_registration_requires_exact_strong_secret(tmp_path, bad_secret):
    selected = tmp_path / "songs"
    selected.mkdir()
    registry, _ = _registry()

    with pytest.raises(directory_grants.DirectoryGrantAuthorizationError):
        registry.issue(
            bad_secret,
            owner="hybrid_track",
            purpose="library-root",
            path=str(selected),
        )


def test_disabled_registry_rejects_registration_even_with_empty_secret(tmp_path):
    selected = tmp_path / "songs"
    selected.mkdir()
    registry = directory_grants.DirectoryGrantRegistry(None)

    with pytest.raises(directory_grants.DirectoryGrantAuthorizationError):
        registry.issue(
            None,
            owner="hybrid_track",
            purpose="library-root",
            path=str(selected),
        )


@pytest.mark.parametrize("bad_path_kind", ["relative", "file", "missing"])
def test_only_existing_absolute_directories_can_be_registered(tmp_path, bad_path_kind):
    registry, _ = _registry()
    if bad_path_kind == "relative":
        candidate = "relative/folder"
    elif bad_path_kind == "file":
        file = tmp_path / "song.txt"
        file.write_text("x", encoding="utf-8")
        candidate = str(file)
    else:
        candidate = str(tmp_path / "missing")

    with pytest.raises(directory_grants.DirectoryGrantError, match="existing absolute directory"):
        registry.issue(
            SECRET,
            owner="hybrid_track",
            purpose="library-root",
            path=candidate,
        )


@pytest.fixture()
def registration_client(monkeypatch):
    registry, _ = _registry()
    monkeypatch.setattr(directory_grants, "_registry", registry)
    app = FastAPI()
    app.include_router(directory_grants_router.router)
    with TestClient(app, client=("127.0.0.1", 50123)) as client:
        yield client


def test_loopback_endpoint_returns_only_opaque_grant(registration_client, tmp_path):
    selected = tmp_path / "Outside Current Library"
    selected.mkdir()
    response = registration_client.post(
        "/api/desktop/directory-grants",
        headers={directory_grants.DIRECTORY_GRANT_SECRET_HEADER: SECRET},
        json={
            "owner": "hybrid_track",
            "purpose": "library-root",
            "path": str(selected),
        },
    )

    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    assert set(response.json()) == {"grant", "expiresAt"}
    assert str(selected) not in response.text


def test_endpoint_rejects_bad_secret_before_parsing_body(registration_client):
    response = registration_client.post(
        "/api/desktop/directory-grants",
        headers={
            directory_grants.DIRECTORY_GRANT_SECRET_HEADER: "x" * 43,
            "Content-Type": "application/json",
        },
        content=b"{not-json",
    )

    assert response.status_code == 403


def test_endpoint_rejects_non_loopback_even_with_secret(monkeypatch, tmp_path):
    selected = tmp_path / "songs"
    selected.mkdir()
    registry, _ = _registry()
    monkeypatch.setattr(directory_grants, "_registry", registry)
    app = FastAPI()
    app.include_router(directory_grants_router.router)

    with TestClient(app, client=("192.0.2.50", 50123)) as client:
        response = client.post(
            "/api/desktop/directory-grants",
            headers={directory_grants.DIRECTORY_GRANT_SECRET_HEADER: SECRET},
            json={
                "owner": "hybrid_track",
                "purpose": "library-root",
                "path": str(selected),
            },
        )

    assert response.status_code == 403


def test_endpoint_bounds_authenticated_request_body(registration_client):
    response = registration_client.post(
        "/api/desktop/directory-grants",
        headers={directory_grants.DIRECTORY_GRANT_SECRET_HEADER: SECRET},
        content=b"x" * (16 * 1024 + 1),
    )

    assert response.status_code == 413
