"""add_uid_to_game_characters

Revision ID: 6a0075b062f3
Revises: 20260424_add_game_saves
Create Date: 2026-04-24 22:29:54.641018

"""
from alembic import op
import sqlalchemy as sa
import random
import string


# revision identifiers, used by Alembic.
revision = '6a0075b062f3'
down_revision = '20260424_add_game_saves'
branch_labels = None
depends_on = None


def _generate_uid():
    return ''.join(random.choices(string.ascii_letters + string.digits, k=8))


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'game_characters' in tables:
        columns = [col['name'] for col in inspector.get_columns('game_characters')]
        if 'uid' not in columns:
            op.add_column('game_characters', sa.Column('uid', sa.String(length=12), nullable=True))
            op.create_index(op.f('ix_game_characters_uid'), 'game_characters', ['uid'], unique=True)

            meta = sa.MetaData()
            meta.reflect(bind=conn)
            t = meta.tables['game_characters']
            rows = conn.execute(sa.select(t.c.id, t.c.uid)).fetchall()
            for row in rows:
                if not row[1]:
                    uid = _generate_uid()
                    conn.execute(sa.update(t).where(t.c.id == row[0]).values(uid=uid))

            with op.batch_alter_table('game_characters') as batch_op:
                batch_op.alter_column('uid', nullable=False)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'game_characters' in tables:
        columns = [col['name'] for col in inspector.get_columns('game_characters')]
        if 'uid' in columns:
            op.drop_index(op.f('ix_game_characters_uid'), table_name='game_characters')
            op.drop_column('game_characters', 'uid')
