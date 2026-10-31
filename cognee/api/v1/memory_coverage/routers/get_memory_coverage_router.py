import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from cognee.infrastructure.background_tasks import register_background_task
from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.data.methods import get_authorized_existing_datasets
from cognee.modules.memory_coverage import (
    execute_coverage_run,
    get_dataset_questions,
    get_latest_coverage,
    start_coverage_run,
)
from cognee.modules.memory_coverage.models import CoverageRun
from cognee.modules.users.methods import get_authenticated_user
from cognee.modules.users.models import User

# One check-and-insert at a time per dataset, so two concurrent requests cannot
# both see "nothing running" and start two paid runs. Process-local, which
# matches where runs execute (in this process's event loop).
_start_locks: dict[UUID, asyncio.Lock] = {}


async def _authorized_dataset_id(dataset_id: UUID, permission: str, user: User) -> UUID:
    datasets = await get_authorized_existing_datasets([dataset_id], permission, user)
    if not datasets:
        raise HTTPException(status_code=404, detail=f"Dataset ({dataset_id}) not found.")
    return datasets[0].id


def get_memory_coverage_router() -> APIRouter:
    router = APIRouter()

    @router.get("/{dataset_id}/coverage")
    async def get_coverage(dataset_id: UUID, user: User = Depends(get_authenticated_user)):
        """Latest coverage analysis for a dataset — GET /api/v1/datasets/{dataset_id}/coverage.

        Returns ``null`` when the dataset has never been analysed, matching the
        Cognee Cloud contract. Otherwise the run's status, its 0-100 score, and
        every replayed question with its score, worst first.
        """
        dataset_id = await _authorized_dataset_id(dataset_id, "read", user)
        coverage = await get_latest_coverage(dataset_id)
        if coverage is None:
            return None
        # How many questions a new run would replay, so the UI can say so.
        coverage["questions_available"] = len(await get_dataset_questions(dataset_id))
        return coverage

    @router.post("/{dataset_id}/coverage", status_code=202)
    async def run_coverage(dataset_id: UUID, user: User = Depends(get_authenticated_user)):
        """Start a coverage analysis — POST /api/v1/datasets/{dataset_id}/coverage.

        Replays the dataset's past questions and scores each answer with the
        LLM. Runs in the background; poll GET for the result. Costs one
        completion plus one judge call per question (capped by
        MEMORY_COVERAGE_MAX_QUESTIONS). Requires write access, since it spends
        the dataset's LLM budget.
        """
        dataset_id = await _authorized_dataset_id(dataset_id, "write", user)

        async with _start_locks.setdefault(dataset_id, asyncio.Lock()):
            return await _start_run(dataset_id, user)

    async def _start_run(dataset_id: UUID, user: User) -> dict:
        async with get_relational_engine().get_async_session() as session:
            running = (
                await session.execute(
                    select(CoverageRun.id).where(
                        CoverageRun.dataset_id == dataset_id, CoverageRun.status == "running"
                    )
                )
            ).first()
        if running is not None:
            raise HTTPException(status_code=409, detail="An analysis is already running.")

        run = await start_coverage_run(dataset_id, user)
        if run.questions_total == 0:
            async with get_relational_engine().get_async_session() as session:
                stored = await session.get(CoverageRun, run.id)
                stored.status = "completed"
                await session.commit()
            return {"run_id": str(run.id), "status": "completed", "questions_total": 0}

        register_background_task(
            asyncio.create_task(execute_coverage_run(run.id, dataset_id, user))
        )
        return {"run_id": str(run.id), "status": "running", "questions_total": run.questions_total}

    return router
