import logging
import os
from fastapi import APIRouter, Depends, Query, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.session import get_db
from app.api.v1.auth import get_current_user_dep
from app.schemas.user import TokenData
from app.schemas.game import (
    GameTaskCreate,
    GameTaskResponse,
    GameTaskStatusResponse,
    GameSaveListItem,
    GameSaveListResponse,
    GameSaveDetailResponse,
    BorrowSaveRequest,
)
from app.services.game_service import game_service
from app.models.game import GameSaveBorrow
from app.models.character import CharacterBorrow
from app.services.ai_service import ai_service
from app.core.websocket import game_ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Game"])


class AskRequest(BaseModel):
    character_name: str
    character_desc: str = ""
    sections: list
    current_section_index: int = 0
    user_question: str
    ending_text: str = ""
    expression_descriptions: list = []


@router.post("/game/ask")
async def ask_question(body: AskRequest):
    """用户举手提问，AI以角色身份回答"""
    try:
        full_text = "\n".join(
            f"[{s.get('character', body.character_name)}]：{s.get('text', '')}"
            for s in body.sections
        )
        if body.ending_text:
            full_text += f"\n[结束语]：{body.ending_text}"

        expr_prompt = ""
        if body.expression_descriptions:
            expr_lines = []
            for i, desc in enumerate(body.expression_descriptions):
                expr_lines.append(f'  - expression_{i}: {desc}')
            expr_ids = ', '.join(f'expression_{i}' for i in range(len(body.expression_descriptions)))
            expr_prompt = (
                '\n\n角色可用的表情差分（根据当前情绪选择合适的表情，在回答前用中括号标注）：\n'
                + '\n'.join(expr_lines)
                + '\n请根据回答时的情绪，在回答内容前加上"[expression_X]"标记。'
                  f'可用的表情标识为：{expr_ids}，请只使用以上列出的表情。'
                  '如果不确定，可以不填标记，默认为"portrait"。'
            )

        prompt = f"""你正在扮演一个教学角色「{body.character_name}」，{body.character_desc}

你正在给学生讲解以下小说/教材内容（完整文本如下）。当前讲到第 {body.current_section_index} 段。

完整文本：
{full_text}

学生问了一个问题：{body.user_question}

请按照以下要求回答：
1. 用 {body.character_name} 的口吻回答，符合角色性格
2. 如果问题在后面的内容中有讲解，要指出来
3. 回答完毕后，加一句自然的结束语（如"好了，我们接着学习吧"），表示继续学习
4. 回答要亲切自然，鼓励学习
{expr_prompt}
直接输出回答内容即可，不要输出额外角色名。"""
        result = await ai_service.generate_text(prompt)
        expression = 'portrait'
        reply = result
        import re
        m = re.match(r'^\[(expression_\d+)\](.*)', result.strip(), re.DOTALL)
        if m:
            expression = m.group(1)
            reply = m.group(2).strip()
        return {"code": 200, "data": {"reply": reply, "expression": expression}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/game/tasks", response_model=GameTaskResponse)
async def create_generation_task(
    body: GameTaskCreate,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    try:
        game_save = await game_service.create_task_and_generate(
            db=db,
            document_id=body.document_id,
            parse_mode=body.parse_mode,
            user_id=current_user.user_id,
            character_id=body.character_id,
        )
        return GameTaskResponse(
            task_id=game_save.id,
            status=game_save.status,
            document_title=game_save.document_title,
            created_at=game_save.created_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"创建游戏生成任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="创建任务失败")


_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BGM_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(_THIS_DIR))), 'static', 'bgm')
os.makedirs(BGM_DIR, exist_ok=True)

BGM_NAMES = {
    "bamboo_forest": "宁静竹林",
    "moon_lake": "月夜湖畔",
    "garden_morning": "晨光花园",
    "starry_walk": "星空漫步",
    "bookish": "书卷气息",
}


@router.get("/game/bgm/list")
async def list_bgm():
    """列出所有可用 BGM"""
    files = []
    for fname in sorted(os.listdir(BGM_DIR)):
        if fname.endswith('.wav') or fname.endswith('.mp3') or fname.endswith('.flac'):
            name = os.path.splitext(fname)[0]
            files.append({
                "filename": fname,
                "name": BGM_NAMES.get(name, name),
            })
    return {"code": 200, "data": files}


@router.get("/game/bgm/{filename}")
async def get_bgm(filename: str):
    """获取 BGM 音频文件"""
    filepath = os.path.join(BGM_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="BGM 不存在")
    media_type = "audio/wav" if filename.endswith('.wav') else "audio/mpeg" if filename.endswith('.mp3') else "audio/flac"
    return FileResponse(filepath, media_type=media_type)


@router.websocket("/ws/game/{user_id}")
async def game_websocket(websocket: WebSocket, user_id: int):
    await game_ws_manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        game_ws_manager.disconnect(user_id, websocket)
    except Exception:
        game_ws_manager.disconnect(user_id, websocket)


@router.get("/game/tasks/{task_id}", response_model=GameTaskStatusResponse)
async def get_task_status(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    game_save = await game_service.get_task_status(
        db=db, task_id=task_id, user_id=current_user.user_id,
    )
    if not game_save:
        raise HTTPException(status_code=404, detail="任务不存在")
    return GameTaskStatusResponse(
        task_id=game_save.id,
        status=game_save.status,
        document_title=game_save.document_title,
        error_message=game_save.error_message,
        created_at=game_save.created_at,
        updated_at=game_save.updated_at,
    )


@router.get("/game/saves", response_model=GameSaveListResponse)
async def list_saves(
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    saves = game_service.get_user_saves(db=db, user_id=current_user.user_id)
    items = [
        GameSaveListItem(
            id=s.id,
            uid=s.uid,
            document_id=s.document_id,
            document_title=s.document_title,
            parse_mode=s.parse_mode,
            status=s.status,
            is_public=s.is_public or False,
            owner_id=s.owner_id,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in saves
    ]
    return GameSaveListResponse(saves=items)


@router.post("/game/saves/borrow", response_model=GameSaveListItem)
async def borrow_save(
    body: BorrowSaveRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    original = game_service.get_save_by_uid(db=db, uid=body.save_uid)
    if not original:
        raise HTTPException(status_code=404, detail="存档不存在或已失效")
    if original.owner_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="不能借阅自己的存档")
    result = game_service.borrow_save(db=db, original=original, user_id=current_user.user_id)
    await game_ws_manager.broadcast(current_user.user_id, {
        "type": "save_update", "action": "borrowed",
    })
    return GameSaveListItem(
        id=result.id,
        uid=result.uid,
        document_id=result.document_id,
        document_title=result.document_title,
        parse_mode=result.parse_mode,
        status=result.status,
        is_public=result.is_public or False,
        owner_id=result.owner_id,
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


@router.get("/game/saves/{save_id}", response_model=GameSaveDetailResponse)
async def get_save_detail(
    save_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    game_save = game_service.get_save_detail(
        db=db, save_id=save_id, user_id=current_user.user_id,
    )
    if not game_save:
        raise HTTPException(status_code=404, detail="存档不存在")

    sections = game_save.sections
    if game_save.owner_id != current_user.user_id and sections and len(sections) > 0:
        meta = dict(sections[0]) if isinstance(sections[0], dict) else sections[0]
        if meta and isinstance(meta, dict) and meta.get("type") == "_character_meta":
            char_id = meta.get("character_id")
            if char_id:
                borrow = db.query(CharacterBorrow).filter(
                    CharacterBorrow.character_id == char_id,
                    CharacterBorrow.user_id == current_user.user_id,
                ).first()
                meta["speaker_id"] = borrow.speaker_id if borrow and borrow.speaker_id else None
                # 传递 is_default 信息到前端
                from app.models.game import GameCharacter
                character = db.query(GameCharacter).filter(GameCharacter.id == char_id).first()
                meta["is_default"] = character.is_default if character else False
                sections = [meta] + list(sections[1:])

    return GameSaveDetailResponse(
        id=game_save.id,
        uid=game_save.uid,
        document_id=game_save.document_id,
        document_title=game_save.document_title,
        parse_mode=game_save.parse_mode,
        status=game_save.status,
        sections=sections,
        error_message=game_save.error_message,
        created_at=game_save.created_at,
        updated_at=game_save.updated_at,
    )


@router.delete("/game/saves/{save_id}")
async def delete_save(
    save_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    deleted = game_service.delete_save(
        db=db, save_id=save_id, user_id=current_user.user_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="存档不存在")
    return {"code": 200, "message": "删除成功"}


@router.get("/game/read/{document_id}")
async def get_game_content(
    document_id: int,
    parse_mode: str = Query('smart', description='解析模式: normal(普通直接解析) / smart(SoMark智能解析)'),
    character_id: int = Query(None, description='角色ID'),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    try:
        content = await game_service.get_game_content(
            db=db, document_id=document_id, parse_mode=parse_mode,
            character_id=character_id, user_id=current_user.user_id,
        )
        return {"code": 200, "data": content}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
