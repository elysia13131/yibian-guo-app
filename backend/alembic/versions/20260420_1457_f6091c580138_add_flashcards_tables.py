"""add flashcards tables

Revision ID: f6091c580138
Revises: 20260420_1500_add_category_to_documents
Create Date: 2026-04-20 14:57:16.929677

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f6091c580138'
down_revision = '20260420_1500_add_category_to_documents'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 创建 flashcards 表
    op.create_table('flashcards',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('chapter_id', sa.Integer(), nullable=True),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('answer', sa.Text(), nullable=False),
        sa.Column('ai_generated', sa.Boolean(), nullable=True, default=True),
        sa.Column('source_text', sa.Text(), nullable=True),
        sa.Column('confidence', sa.Float(), nullable=True, default=0.0),
        sa.Column('difficulty', sa.Float(), nullable=True, default=0.0),
        sa.Column('stability', sa.Float(), nullable=True, default=0.0),
        sa.Column('retrievability', sa.Float(), nullable=True, default=0.0),
        sa.Column('due', sa.DateTime(timezone=True), nullable=True),
        sa.Column('elapsed_days', sa.Float(), nullable=True, default=0.0),
        sa.Column('scheduled_days', sa.Float(), nullable=True, default=0.0),
        sa.Column('reps', sa.Integer(), nullable=True, default=0),
        sa.Column('lapses', sa.Integer(), nullable=True, default=0),
        sa.Column('status', sa.String(length=50), nullable=False, default='new'),
        sa.Column('last_reviewed', sa.DateTime(timezone=True), nullable=True),
        sa.Column('next_review', sa.DateTime(timezone=True), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('is_public', sa.Boolean(), nullable=True, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # 创建索引
    op.create_index('ix_flashcards_id', 'flashcards', ['id'], unique=False)
    op.create_index('ix_flashcards_owner_id', 'flashcards', ['owner_id'], unique=False)
    op.create_index('ix_flashcards_document_id', 'flashcards', ['document_id'], unique=False)
    op.create_index('ix_flashcards_due', 'flashcards', ['due'], unique=False)
    op.create_index('ix_flashcards_status', 'flashcards', ['status'], unique=False)
    
    # 创建 flashcard_review_logs 表
    op.create_table('flashcard_review_logs',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('flashcard_id', sa.Integer(), nullable=False),
        sa.Column('rating', sa.String(length=20), nullable=False),
        sa.Column('review_time', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column('duration_seconds', sa.Float(), nullable=True, default=0.0),
        sa.Column('difficulty_before', sa.Float(), nullable=True),
        sa.Column('stability_before', sa.Float(), nullable=True),
        sa.Column('retrievability_before', sa.Float(), nullable=True),
        sa.Column('difficulty_after', sa.Float(), nullable=True),
        sa.Column('stability_after', sa.Float(), nullable=True),
        sa.Column('retrievability_after', sa.Float(), nullable=True),
        sa.Column('elapsed_days', sa.Float(), nullable=True),
        sa.Column('scheduled_days', sa.Float(), nullable=True),
        sa.Column('status_before', sa.String(length=50), nullable=True),
        sa.Column('status_after', sa.String(length=50), nullable=True),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        
        sa.ForeignKeyConstraint(['flashcard_id'], ['flashcards.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('ix_flashcard_review_logs_id', 'flashcard_review_logs', ['id'], unique=False)
    op.create_index('ix_flashcard_review_logs_flashcard_id', 'flashcard_review_logs', ['flashcard_id'], unique=False)
    op.create_index('ix_flashcard_review_logs_review_time', 'flashcard_review_logs', ['review_time'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_flashcard_review_logs_review_time', table_name='flashcard_review_logs')
    op.drop_index('ix_flashcard_review_logs_flashcard_id', table_name='flashcard_review_logs')
    op.drop_index('ix_flashcard_review_logs_id', table_name='flashcard_review_logs')
    op.drop_table('flashcard_review_logs')
    
    op.drop_index('ix_flashcards_status', table_name='flashcards')
    op.drop_index('ix_flashcards_due', table_name='flashcards')
    op.drop_index('ix_flashcards_document_id', table_name='flashcards')
    op.drop_index('ix_flashcards_owner_id', table_name='flashcards')
    op.drop_index('ix_flashcards_id', table_name='flashcards')
    op.drop_table('flashcards')