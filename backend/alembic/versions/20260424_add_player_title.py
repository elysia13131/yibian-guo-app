"""add_player_title

Revision ID: 20260424_add_player_title
Revises: 20260424_add_expression_descriptions
Create Date: 2026-04-24 23:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260424_add_player_title'
down_revision = '20260424_add_expression_descriptions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'users' in tables:
        columns = [col['name'] for col in inspector.get_columns('users')]
        if 'player_title' not in columns:
            op.add_column('users', sa.Column('player_title', sa.String(length=50), nullable=False, server_default='同学'))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'users' in tables:
        columns = [col['name'] for col in inspector.get_columns('users')]
        if 'player_title' in columns:
            op.drop_column('users', 'player_title')
