"""add multiple choice fields to flashcards

Revision ID: 20260420_add_multiple_choice
Revises: 20260420_add_generation_tasks
Create Date: 2026-04-20

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260420_add_multiple_choice'
down_revision = '20260420_add_generation_tasks'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add multiple choice fields to flashcards
    op.add_column('flashcards', sa.Column('is_multiple_choice', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('flashcards', sa.Column('options', sa.JSON(), nullable=True))
    op.add_column('flashcards', sa.Column('correct_option_label', sa.String(length=10), nullable=True))


def downgrade() -> None:
    # Remove multiple choice fields from flashcards
    op.drop_column('flashcards', 'correct_option_label')
    op.drop_column('flashcards', 'options')
    op.drop_column('flashcards', 'is_multiple_choice')
