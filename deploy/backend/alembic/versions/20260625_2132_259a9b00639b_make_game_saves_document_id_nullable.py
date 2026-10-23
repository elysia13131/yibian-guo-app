"""make_game_saves_document_id_nullable

Revision ID: 259a9b00639b
Revises: d41ace63b55e
Create Date: 2026-06-25 21:32:15.213855

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '259a9b00639b'
down_revision = 'd41ace63b55e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('game_saves') as batch_op:
        batch_op.alter_column('document_id', nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('game_saves') as batch_op:
        batch_op.alter_column('document_id', nullable=False)
