"""add_expression_descriptions

Revision ID: 20260424_add_expression_descriptions
Revises: 6a0075b062f3
Create Date: 2026-04-24 23:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260424_add_expression_descriptions'
down_revision = '6a0075b062f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'game_characters' in tables:
        columns = [col['name'] for col in inspector.get_columns('game_characters')]
        if 'expression_descriptions' not in columns:
            op.add_column('game_characters', sa.Column('expression_descriptions', sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'game_characters' in tables:
        columns = [col['name'] for col in inspector.get_columns('game_characters')]
        if 'expression_descriptions' in columns:
            op.drop_column('game_characters', 'expression_descriptions')
