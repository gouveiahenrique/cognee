from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cognee.api.v1.memory_coverage.routers import get_memory_coverage_router
from cognee.modules.users.methods import get_authenticated_user

USER = SimpleNamespace(id=uuid4(), email="caller@example.com")
DATASET_ID = uuid4()

_ROUTER = "cognee.api.v1.memory_coverage.routers.get_memory_coverage_router"


def _client():
    app = FastAPI()
    app.include_router(get_memory_coverage_router(), prefix="/api/v1/datasets")

    async def override_user():
        return USER

    app.dependency_overrides[get_authenticated_user] = override_user
    return TestClient(app, raise_server_exceptions=False)


def _authorized(permissions_seen):
    async def fake(dataset_ids, permission, user):
        permissions_seen.append(permission)
        return [SimpleNamespace(id=dataset_ids[0])]

    return fake


def test_unknown_dataset_is_404():
    async def none(*_):
        return []

    with patch(f"{_ROUTER}.get_authorized_existing_datasets", none):
        response = _client().get(f"/api/v1/datasets/{DATASET_ID}/coverage")

    assert response.status_code == 404


def test_never_analysed_returns_null():
    async def no_coverage(_):
        return None

    seen = []
    with (
        patch(f"{_ROUTER}.get_authorized_existing_datasets", _authorized(seen)),
        patch(f"{_ROUTER}.get_latest_coverage", no_coverage),
    ):
        response = _client().get(f"/api/v1/datasets/{DATASET_ID}/coverage")

    assert response.status_code == 200
    assert response.json() is None
    assert seen == ["read"]


def test_coverage_reports_questions_available():
    async def coverage(_):
        return {"status": "completed", "score": 72.5, "questions": []}

    async def questions(_):
        return ["q1", "q2"]

    with (
        patch(f"{_ROUTER}.get_authorized_existing_datasets", _authorized([])),
        patch(f"{_ROUTER}.get_latest_coverage", coverage),
        patch(f"{_ROUTER}.get_dataset_questions", questions),
    ):
        body = _client().get(f"/api/v1/datasets/{DATASET_ID}/coverage").json()

    assert body["score"] == 72.5
    assert body["questions_available"] == 2


def test_starting_a_run_needs_write_permission():
    seen = []

    async def denied(dataset_ids, permission, user):
        seen.append(permission)
        return []

    with patch(f"{_ROUTER}.get_authorized_existing_datasets", denied):
        response = _client().post(f"/api/v1/datasets/{DATASET_ID}/coverage")

    assert response.status_code == 404
    assert seen == ["write"]
