"""Add flashcard_generation_tasks table

Revision ID: 20260420_add_generation_tasks
Revises: 20260420_add_flashcard_groups
Create Date: 2026-04-20

"""
from alembic import op
import sqlalchemy as sa


revision = '20260420_add_generation_tasks'
down_revision = '20260420_add_flashcard_groups'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'flashcard_generation_tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=True),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('total_chunks', sa.Integer(), nullable=True),
        sa.Column('processed_chunks', sa.Integer(), nullable=True),
        sa.Column('total_cards', sa.Integer(), nullable=True),
        sa.Column('max_cards', sa.Integer(), nullable=True),
        sa.Column('is_public', sa.Boolean(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text("datetime('now')"), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['group_id'], ['flashcard_groups.id'], ),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_flashcard_generation_tasks_id'), 'flashcard_generation_tasks', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_flashcard_generation_tasks_id'), table_name='flashcard_generation_tasks')
    op.drop_table('flashcard_generation_tasks')
