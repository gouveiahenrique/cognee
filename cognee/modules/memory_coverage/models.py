"""Memory coverage: past questions replayed against memory and scored.

One ``CoverageRun`` per "Run analysis" on a dataset, one ``CoverageScore`` per
question it replayed. Scores are an LLM-as-judge rating of how well the current
memory answers a question someone actually asked, so a low score marks a gap.
"""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, Uuid

from cognee.infrastructure.databases.relational import Base


class CoverageRun(Base):
    __tablename__ = "memory_coverage_runs"

    id = Column(Uuid, primary_key=True, default=uuid4)
    dataset_id = Column(Uuid, nullable=False, index=True)
    user_id = Column(Uuid, nullable=False)

    # running -> completed | errored
    status = Column(String(16), nullable=False, default="running")
    questions_total = Column(Integer, nullable=False, default=0)
    questions_scored = Column(Integer, nullable=False, default=0)
    # Mean of the question scores, 0-100. NULL until at least one is scored.
    score = Column(Float, nullable=True)
    error = Column(Text, nullable=True)

    started_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    finished_at = Column(DateTime(timezone=True), nullable=True)


class CoverageScore(Base):
    __tablename__ = "memory_coverage_scores"

    id = Column(Uuid, primary_key=True, default=uuid4)
    run_id = Column(
        Uuid, ForeignKey("memory_coverage_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dataset_id = Column(Uuid, nullable=False)

    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=True)
    # 0-100; NULL when the replay or the judge failed for this question.
    score = Column(Float, nullable=True)
    reason = Column(Text, nullable=True)
    # What the judge says is missing from memory, used as the "add this" hint.
    missing = Column(Text, nullable=True)

    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
