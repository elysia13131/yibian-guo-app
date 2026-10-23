"""add tts_api_key column

Revision ID: d41ace63b55e
Revises: d7ef576d465a
Create Date: 2026-06-02 00:13:21.936060

"""
from alembic import op
import sqlalchemy as sa


revision = 'd41ace63b55e'
down_revision = 'd7ef576d465a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('tts_api_key', sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'tts_api_key')
