from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi_users.exceptions import InvalidPasswordException, UserAlreadyExists
from pydantic import EmailStr
from sqlalchemy import select

from cognee.api.DTO import InDTO
from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.users.get_user_db import get_user_db_context
from cognee.modules.users.get_user_manager import get_user_manager_context
from cognee.modules.users.methods import create_user, get_authenticated_user
from cognee.modules.users.models.User import User


class AdminUserCreatePayload(InDTO):
    email: EmailStr
    password: str
    is_superuser: bool = False


class AdminPasswordResetPayload(InDTO):
    password: str


def _require_superuser(user: User = Depends(get_authenticated_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Only administrators can manage users.")
    return user


def _serialize(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "is_verified": user.is_verified,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def get_users_admin_router() -> APIRouter:
    """Administrator user management — the self-hosted equivalent of a members page.

    Agent users (rows with a parent_user_id) are API-key identities owned by a
    human user, so they are listed by /activity/agents and left out here.
    """
    router = APIRouter()

    @router.get("/admin")
    async def list_users(_: User = Depends(_require_superuser)):
        """List human users — GET /api/v1/users/admin. Superuser only."""
        async with get_relational_engine().get_async_session() as session:
            users = (
                await session.execute(
                    select(User).where(User.parent_user_id.is_(None)).order_by(User.created_at)
                )
            ).scalars()
            return [_serialize(user) for user in users]

    @router.post("/admin", status_code=201)
    async def create_user_as_admin(
        payload: AdminUserCreatePayload, _: User = Depends(_require_superuser)
    ):
        """Create a user — POST /api/v1/users/admin. Superuser only.

        Works whether or not public sign-up (/auth/register) is enabled.
        """
        try:
            user = await create_user(
                email=str(payload.email),
                password=payload.password,
                is_superuser=payload.is_superuser,
                is_verified=True,
            )
        except UserAlreadyExists:
            raise HTTPException(status_code=409, detail="A user with this email already exists.")
        except InvalidPasswordException as error:
            raise HTTPException(status_code=400, detail=str(error.reason))
        return _serialize(user)

    @router.post("/admin/{user_id}/password", status_code=204)
    async def reset_password_as_admin(
        user_id: UUID,
        payload: AdminPasswordResetPayload,
        _: User = Depends(_require_superuser),
    ):
        """Set a user's password — POST /api/v1/users/admin/{user_id}/password. Superuser only."""
        async with (
            get_relational_engine().get_async_session() as session,
            get_user_db_context(session) as user_db,
            get_user_manager_context(user_db) as user_manager,
        ):
            target = await user_db.get(user_id)
            if target is None:
                raise HTTPException(status_code=404, detail="User not found")
            try:
                await user_manager.validate_password(payload.password, target)
            except InvalidPasswordException as error:
                raise HTTPException(status_code=400, detail=str(error.reason))
            await user_db.update(
                target, {"hashed_password": user_manager.password_helper.hash(payload.password)}
            )

    @router.delete("/admin/{user_id}", status_code=204)
    async def delete_user_as_admin(user_id: UUID, admin: User = Depends(_require_superuser)):
        """Delete a user — DELETE /api/v1/users/admin/{user_id}. Superuser only."""
        if user_id == admin.id:
            raise HTTPException(status_code=400, detail="You cannot delete your own account.")
        async with (
            get_relational_engine().get_async_session() as session,
            get_user_db_context(session) as user_db,
            get_user_manager_context(user_db) as user_manager,
        ):
            target = await user_db.get(user_id)
            if target is None:
                raise HTTPException(status_code=404, detail="User not found")
            await user_manager.delete(target)

    return router
