"""add game_saves table

Revision ID: 20260424_add_game_saves
Revises: 20260420_add_multiple_choice
Create Date: 2026-04-24

"""
from alembic import op
import sqlalchemy as sa


revision = '20260424_add_game_saves'
down_revision = '20260420_add_multiple_choice'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'game_saves',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('document_id', sa.Integer(), sa.ForeignKey('documents.id'), nullable=True),
        sa.Column('document_title', sa.String(500), nullable=False),
        sa.Column('parse_mode', sa.String(50), nullable=False, server_default='smart'),
        sa.Column('status', sa.String(50), nullable=False, server_default='generating'),
        sa.Column('sections', sa.JSON(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_game_saves_id', 'game_saves', ['id'])
    op.create_index('ix_game_saves_owner_id', 'game_saves', ['owner_id'])


def downgrade() -> None:
    op.drop_index('ix_game_saves_owner_id', table_name='game_saves')
    op.drop_index('ix_game_saves_id', table_name='game_saves')
    op.drop_table('game_saves')
