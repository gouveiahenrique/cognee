"""Replay a dataset's past questions against current memory and score each answer.

A question someone asked is the best evidence of what memory should know. The
analysis takes the distinct questions recorded for a dataset (search and recall
history, see ``log_search_history``), asks each one again, and has the LLM judge
how fully the answer covers it. The mean is the dataset's coverage score; the
low-scoring questions are its gaps.

Each question costs one completion plus one judge call, so a run is capped at
``MEMORY_COVERAGE_MAX_QUESTIONS`` (newest questions first).
"""

import asyncio
import os
from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.infrastructure.llm.LLMGateway import LLMGateway
from cognee.modules.search.methods.search import authorized_search
from cognee.modules.search.models.Query import Query
from cognee.modules.search.types import SearchType
from cognee.modules.users.models import User
from cognee.shared.logging_utils import get_logger

from .models import CoverageRun, CoverageScore

logger = get_logger("memory_coverage")

MAX_QUESTIONS = int(os.getenv("MEMORY_COVERAGE_MAX_QUESTIONS", "25"))
# Replays run a few at a time: each one is a full retrieval plus two LLM calls.
CONCURRENCY = int(os.getenv("MEMORY_COVERAGE_CONCURRENCY", "3"))
# Questions shorter than this are greetings or typos, not knowledge requests.
MIN_QUESTION_LENGTH = 8

JUDGE_SYSTEM_PROMPT = """You grade how well an AI memory answered a user's question.

You get the question and the answer the memory produced from its stored knowledge.
Score 0-100 how completely and specifically the answer addresses the question:
- 90-100: complete, specific, clearly grounded in stored knowledge
- 60-89: mostly answered, some detail missing
- 30-59: partial or vague, important parts missing
- 0-29: does not answer, says it does not know, or is generic filler

Judge coverage of the question, not writing style. An answer that says the
information is not available scores low: that is exactly the gap to report.
In "missing", name the specific knowledge that would need to be added to memory
to answer fully (empty when nothing is missing)."""


class CoverageJudgement(BaseModel):
    score: int = Field(ge=0, le=100)
    reason: str
    missing: str = ""


async def get_dataset_questions(dataset_id: UUID, limit: int = MAX_QUESTIONS) -> list[str]:
    """Distinct questions asked against this dataset, most recent first."""
    async with get_relational_engine().get_async_session() as session:
        rows = (
            await session.execute(
                select(Query.text, func.max(Query.created_at).label("last_asked"))
                .where(Query.dataset_id == dataset_id, Query.text.is_not(None))
                .group_by(Query.text)
                .order_by(func.max(Query.created_at).desc())
            )
        ).all()

    questions: list[str] = []
    seen: set[str] = set()
    for text, _ in rows:
        normalized = " ".join(text.split()).lower()
        if len(normalized) < MIN_QUESTION_LENGTH or normalized in seen:
            continue
        seen.add(normalized)
        questions.append(text.strip())
        if len(questions) >= limit:
            break
    return questions


async def _answer(question: str, user: User, dataset_id: UUID) -> str:
    # authorized_search, not search(): the same permission-checked retrieval,
    # but it records no search history, so replays never become new
    # "questions" for the next analysis. No session_id, so no session writes.
    results = await authorized_search(
        query_type=SearchType.HYBRID_COMPLETION,
        query_text=question,
        user=user,
        dataset_ids=[dataset_id],
    )
    for result in results:
        completion = getattr(result, "completion", None) or getattr(result, "context", None)
        if completion:
            return _as_text(completion)
    return ""


def _as_text(value) -> str:
    """Completions come back as a string, a list of strings, or a model."""
    if isinstance(value, str):
        return value
    if isinstance(value, BaseModel):
        return value.model_dump_json()
    if isinstance(value, list):
        return "\n".join(_as_text(item) for item in value)
    return str(value)


async def _judge(question: str, answer: str) -> CoverageJudgement:
    if not answer.strip():
        return CoverageJudgement(score=0, reason="Memory returned no answer.", missing="")
    return await LLMGateway.acreate_structured_output(
        text_input=f"Question:\n{question}\n\nAnswer from memory:\n{answer}",
        system_prompt=JUDGE_SYSTEM_PROMPT,
        response_model=CoverageJudgement,
    )


async def _score_question(question: str, user: User, dataset_id: UUID) -> dict:
    try:
        answer = await _answer(question, user, dataset_id)
        judgement = await _judge(question, answer)
        return {
            "question": question,
            "answer": answer,
            "score": float(judgement.score),
            "reason": judgement.reason,
            "missing": judgement.missing or None,
        }
    except Exception as error:
        # One failing question must not sink the run; it is stored unscored.
        logger.warning("Coverage replay failed for one question", exc_info=True)
        return {
            "question": question,
            "answer": None,
            "score": None,
            "reason": f"Replay failed: {type(error).__name__}",
            "missing": None,
        }


async def start_coverage_run(dataset_id: UUID, user: User) -> CoverageRun:
    """Create the run row up front so the caller can return its id immediately."""
    questions = await get_dataset_questions(dataset_id)
    async with get_relational_engine().get_async_session() as session:
        run = CoverageRun(
            dataset_id=dataset_id,
            user_id=user.id,
            status="running",
            questions_total=len(questions),
            questions_scored=0,
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
    return run


async def execute_coverage_run(run_id: UUID, dataset_id: UUID, user: User) -> None:
    """Replay and score every question for ``run_id``; safe to run in the background."""
    engine = get_relational_engine()
    try:
        questions = await get_dataset_questions(dataset_id)
        semaphore = asyncio.Semaphore(max(1, CONCURRENCY))

        async def bounded(question: str) -> dict:
            async with semaphore:
                return await _score_question(question, user, dataset_id)

        scored = await asyncio.gather(*(bounded(q) for q in questions))

        values = [s["score"] for s in scored if s["score"] is not None]
        async with engine.get_async_session() as session:
            session.add_all(
                CoverageScore(run_id=run_id, dataset_id=dataset_id, **s) for s in scored
            )
            run = await session.get(CoverageRun, run_id)
            run.questions_total = len(questions)
            run.questions_scored = len(values)
            run.score = sum(values) / len(values) if values else None
            run.status = "completed"
            run.finished_at = datetime.now(timezone.utc)
            await session.commit()
    except Exception as error:
        logger.exception("Memory coverage run %s failed", run_id)
        async with engine.get_async_session() as session:
            run = await session.get(CoverageRun, run_id)
            if run is not None:
                run.status = "errored"
                run.error = f"{type(error).__name__}: {error}"[:2000]
                run.finished_at = datetime.now(timezone.utc)
                await session.commit()


async def get_latest_coverage(dataset_id: UUID) -> dict | None:
    """The newest run for a dataset with its per-question scores, worst first."""
    async with get_relational_engine().get_async_session() as session:
        run = (
            await session.execute(
                select(CoverageRun)
                .where(CoverageRun.dataset_id == dataset_id)
                .order_by(CoverageRun.started_at.desc())
                .limit(1)
            )
        ).scalar()
        if run is None:
            return None
        scores = (
            await session.execute(select(CoverageScore).where(CoverageScore.run_id == run.id))
        ).scalars()
        questions = sorted(
            (
                {
                    "question": s.question,
                    "answer": s.answer,
                    "score": s.score,
                    "reason": s.reason,
                    "missing": s.missing,
                }
                for s in scores
            ),
            # Unscored (failed) questions last; otherwise lowest score first.
            key=lambda q: (q["score"] is None, q["score"] if q["score"] is not None else 0),
        )
    return {
        "run_id": str(run.id),
        "dataset_id": str(run.dataset_id),
        "status": run.status,
        "score": run.score,
        "questions_total": run.questions_total,
        "questions_scored": run.questions_scored,
        "error": run.error,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "questions": questions,
    }


async def fail_interrupted_coverage_runs() -> int:
    """Mark runs left "running" by a previous process as errored.

    Runs execute in-process, so a restart kills them without a final write; a
    leftover "running" row would otherwise block every new analysis (409).
    Called once at API startup, before any new run can start.
    """
    async with get_relational_engine().get_async_session() as session:
        runs = (
            (await session.execute(select(CoverageRun).where(CoverageRun.status == "running")))
            .scalars()
            .all()
        )
        for run in runs:
            run.status = "errored"
            run.error = "Interrupted by a server restart."
            run.finished_at = datetime.now(timezone.utc)
        if runs:
            await session.commit()
    return len(runs)
