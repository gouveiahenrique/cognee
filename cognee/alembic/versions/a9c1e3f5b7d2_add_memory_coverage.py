"""Add memory coverage runs and scores.

Revision ID: a9c1e3f5b7d2
Revises: f6b8d0a2c4e6
Create Date: 2026-10-16 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a9c1e3f5b7d2"
down_revision: str | None = "f6b8d0a2c4e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNS = "memory_coverage_runs"
SCORES = "memory_coverage_scores"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table(RUNS):
        op.create_table(
            RUNS,
            sa.Column("id", sa.UUID(), nullable=False, primary_key=True),
            sa.Column("dataset_id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("questions_total", sa.Integer(), nullable=False),
            sa.Column("questions_scored", sa.Integer(), nullable=False),
            sa.Column("score", sa.Float(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_memory_coverage_runs_dataset_id", RUNS, ["dataset_id"])

    if not inspector.has_table(SCORES):
        op.create_table(
            SCORES,
            sa.Column("id", sa.UUID(), nullable=False, primary_key=True),
            sa.Column(
                "run_id",
                sa.UUID(),
                sa.ForeignKey(f"{RUNS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("dataset_id", sa.UUID(), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=True),
            sa.Column("score", sa.Float(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("missing", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_memory_coverage_scores_run_id", SCORES, ["run_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(SCORES):
        op.drop_table(SCORES)
    if inspector.has_table(RUNS):
        op.drop_table(RUNS)
