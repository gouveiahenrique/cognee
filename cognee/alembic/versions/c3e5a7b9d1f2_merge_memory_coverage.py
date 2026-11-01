"""Merge the memory coverage migration into upstream's chain

Revision ID: c3e5a7b9d1f2
Revises: a9c1e3f5b7d2, dd760c09e075
Create Date: 2026-11-01

The memory coverage table (a9c1e3f5b7d2) was added on top of an older
upstream head, and deployed databases already carry it. Re-parenting it
would make Alembic treat upstream's later migrations as applied there, so
this merge joins the two branches instead.

When upstream adds migrations after dd760c09e075, add another merge
revision on top of this one; never edit this file's parents.
"""

from collections.abc import Sequence

revision: str = "c3e5a7b9d1f2"
down_revision: str | Sequence[str] | None = ("a9c1e3f5b7d2", "dd760c09e075")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
