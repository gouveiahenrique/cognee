from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from pydantic import BaseModel

from cognee.modules.memory_coverage import run_coverage_analysis as module
from cognee.modules.memory_coverage.run_coverage_analysis import CoverageJudgement

USER = SimpleNamespace(id=uuid4())
DATASET_ID = uuid4()


def test_as_text_flattens_completion_shapes():
    class Answer(BaseModel):
        text: str

    assert module._as_text("plain") == "plain"
    assert module._as_text(["a", "b"]) == "a\nb"
    assert module._as_text(Answer(text="x")) == '{"text":"x"}'


@pytest.mark.asyncio
async def test_empty_answer_scores_zero_without_calling_the_judge():
    async def judge_must_not_run(**_):
        raise AssertionError("judge called for an empty answer")

    with patch.object(module.LLMGateway, "acreate_structured_output", judge_must_not_run):
        judgement = await module._judge("What is our refund policy?", "   ")

    assert judgement.score == 0


@pytest.mark.asyncio
async def test_score_question_replays_without_logging_history():
    calls = {}

    async def fake_authorized_search(**kwargs):
        calls.update(kwargs)
        return [SimpleNamespace(completion=["Refunds within 30 days."], context=None)]

    async def fake_judge(**_):
        return CoverageJudgement(score=80, reason="mostly", missing="exceptions")

    with (
        patch.object(module, "authorized_search", fake_authorized_search),
        patch.object(module.LLMGateway, "acreate_structured_output", fake_judge),
    ):
        scored = await module._score_question("What is our refund policy?", USER, DATASET_ID)

    assert scored == {
        "question": "What is our refund policy?",
        "answer": "Refunds within 30 days.",
        "score": 80.0,
        "reason": "mostly",
        "missing": "exceptions",
    }
    # Scoped to the one dataset, and no session, so nothing is written back.
    assert calls["dataset_ids"] == [DATASET_ID]
    assert "session_id" not in calls


@pytest.mark.asyncio
async def test_a_failing_question_is_stored_unscored():
    async def boom(**_):
        raise RuntimeError("retrieval down")

    with patch.object(module, "authorized_search", boom):
        scored = await module._score_question("What is our refund policy?", USER, DATASET_ID)

    assert scored["score"] is None
    assert scored["reason"] == "Replay failed: RuntimeError"
