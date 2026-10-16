"""The administrator user-management routes, exercised through the router."""

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi_users.exceptions import UserAlreadyExists

from cognee.api.v1.users.routers import get_users_admin_router
from cognee.modules.users.methods import get_authenticated_user

ADMIN = SimpleNamespace(id=uuid4(), email="admin@example.com", is_superuser=True)
MEMBER = SimpleNamespace(id=uuid4(), email="member@example.com", is_superuser=False)

_ROUTER_MODULE = "cognee.api.v1.users.routers.get_users_admin_router"


def _client(caller):
    app = FastAPI()
    app.include_router(get_users_admin_router(), prefix="/api/v1/users")

    async def override_user():
        return caller

    app.dependency_overrides[get_authenticated_user] = override_user
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("get", "/api/v1/users/admin", None),
        ("post", "/api/v1/users/admin", {"email": "new@example.com", "password": "secret123"}),
        ("delete", f"/api/v1/users/admin/{uuid4()}", None),
        ("post", f"/api/v1/users/admin/{uuid4()}/password", {"password": "secret123"}),
    ],
)
def test_non_superuser_is_forbidden(method, path, body):
    client = _client(MEMBER)
    response = client.request(method, path, json=body)
    assert response.status_code == 403


def test_create_user_passes_fields_and_serializes():
    created = SimpleNamespace(
        id=uuid4(),
        email="new@example.com",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        tenant_id=None,
        created_at=None,
    )
    calls = []

    async def fake_create_user(email, password, is_superuser=False, is_verified=False, **_):
        calls.append((email, password, is_superuser, is_verified))
        return created

    with patch(f"{_ROUTER_MODULE}.create_user", fake_create_user):
        response = _client(ADMIN).post(
            "/api/v1/users/admin",
            json={"email": "new@example.com", "password": "secret123"},
        )

    assert response.status_code == 201
    assert response.json()["email"] == "new@example.com"
    assert calls == [("new@example.com", "secret123", False, True)]


def test_create_duplicate_user_is_conflict():
    async def fake_create_user(**_):
        raise UserAlreadyExists()

    with patch(f"{_ROUTER_MODULE}.create_user", fake_create_user):
        response = _client(ADMIN).post(
            "/api/v1/users/admin",
            json={"email": "dup@example.com", "password": "secret123"},
        )

    assert response.status_code == 409


def test_admin_cannot_delete_self():
    response = _client(ADMIN).delete(f"/api/v1/users/admin/{ADMIN.id}")
    assert response.status_code == 400
