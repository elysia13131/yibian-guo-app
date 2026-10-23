"""add_uid_and_borrow_to_game_saves

Revision ID: d7ef576d465a
Revises: 20260424_add_player_title
Create Date: 2026-04-29 00:34:21.872539

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd7ef576d465a'
down_revision = '20260424_add_player_title'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('game_saves') as batch_op:
        batch_op.add_column(sa.Column('uid', sa.String(12), nullable=True))
        batch_op.add_column(sa.Column('is_public', sa.Boolean(), default=False))
        batch_op.add_column(sa.Column('borrowed_from_id', sa.Integer(), nullable=True))
    op.create_index('ix_game_saves_uid', 'game_saves', ['uid'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_game_saves_uid', table_name='game_saves')
    with op.batch_alter_table('game_saves') as batch_op:
        batch_op.drop_column('uid')
        batch_op.drop_column('is_public')
        batch_op.drop_column('borrowed_from_id')
