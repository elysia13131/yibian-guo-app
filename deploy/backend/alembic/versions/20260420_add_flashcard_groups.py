"""Add flashcard_groups table

Revision ID: 20260420_add_flashcard_groups
Revises: f6091c580138
Create Date: 2026-04-20

"""
from alembic import op
import sqlalchemy as sa


revision = '20260420_add_flashcard_groups'
down_revision = 'f6091c580138'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'flashcard_groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('card_count', sa.Integer(), nullable=True),
        sa.Column('is_public', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text("datetime('now')"), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_flashcard_groups_id'), 'flashcard_groups', ['id'], unique=False)

    with op.batch_alter_table('flashcards') as batch_op:
        batch_op.add_column(sa.Column('group_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_flashcards_group_id', 'flashcard_groups', ['group_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('flashcards') as batch_op:
        batch_op.drop_constraint('fk_flashcards_group_id', type_='foreignkey')
        batch_op.drop_column('group_id')

    op.drop_index(op.f('ix_flashcard_groups_id'), table_name='flashcard_groups')
    op.drop_table('flashcard_groups')
