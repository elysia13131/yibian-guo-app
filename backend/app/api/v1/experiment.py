import json
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
import logging
import os
import asyncio
import time

from app.db.session import get_db
from app.api.v1.auth import get_current_user_dep
from app.schemas.user import TokenData
from app.models.experiment import ExperimentReport, ExperimentStatus
from app.services.experiment_agent import experiment_agent, DEFAULT_SECTIONS
from app.services.document_service import DocumentService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/experiments", tags=["实验报告"])


@router.post("")
async def create_experiment(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    sections: Optional[str] = Form(None),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """创建实验报告项目（可选上传课件）"""
    sections_list = None
    if sections:
        try:
            import json
            sections_list = json.loads(sections)
        except json.JSONDecodeError:
            sections_list = None

    report = ExperimentReport(
        owner_id=token_data.user_id,
        title=title,
        sections_config=sections_list,
        status=ExperimentStatus.COLLECTING,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    asyncio.create_task(experiment_agent.run_collection(report.id, token_data.user_id))

    return {
        "success": True,
        "report": {
            "id": report.id,
            "title": report.title,
            "status": report.status.value if hasattr(report.status, 'value') else report.status,
            "sections_config": report.sections_config,
            "created_at": report.created_at.isoformat() if report.created_at else None,
        }
    }


@router.post("/{report_id}/upload")
async def upload_courseware(
    report_id: int,
    file: UploadFile = File(...),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """上传参考课件"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    upload_dir = "/uploads/experiments"
    os.makedirs(upload_dir, exist_ok=True)

    safe_name = f"{report_id}_{file.filename}"
    file_path = os.path.join(upload_dir, safe_name)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    report.courseware_file_path = file_path
    report.courseware_filename = file.filename
    db.commit()

    return {"success": True, "message": "课件上传成功"}


@router.post("/{report_id}/upload-images")
async def upload_courseware_images(
    report_id: int,
    files: List[UploadFile] = File(...),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """上传图片课件（课件截图），单张直发SoMark，多张拼接DOC后发SoMark"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    if not files:
        raise HTTPException(status_code=400, detail="请至少选择一张图片")

    upload_dir = "/uploads/experiments/images"
    os.makedirs(upload_dir, exist_ok=True)

    saved_paths = []
    for i, file in enumerate(files):
        safe_name = f"{report_id}_{int(time.time())}_{i}_{file.filename}"
        file_path = os.path.join(upload_dir, safe_name)
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        saved_paths.append(file_path)

    from app.services.somark_request_manager import somark_request_manager

    if len(saved_paths) == 1:
        somark_file_path = saved_paths[0]
    else:
        somark_file_path = await _stitch_images_to_doc(saved_paths, upload_dir, report_id)

    try:
        somark_result = await somark_request_manager.parse_document(
            file_path=somark_file_path,
            feature_config={
                "enable_text_cross_page": False,
                "enable_title_level_recognition": True,
                "enable_image_understanding": True,
            },
        )
        text = _extract_somark_text(somark_result)
    except Exception as e:
        text = ""
        logger.warning(f"SoMark 解析图片课件失败: {e}")

    # 加入 knowledge_base
    kb = report.knowledge_base or {}
    if text.strip():
        kb.setdefault("basic_principles", [])
        kb["basic_principles"].append({"source": "课件图片", "content": text[:8000]})
        kb.setdefault("sources", [])
        kb["sources"].append({"type": "课件图片", "name": f"{len(files)}张截图"})
        if text and (not kb.get("raw_courseware_text") or len(kb["raw_courseware_text"]) < len(text)):
            kb["raw_courseware_text"] = text
    report.knowledge_base = kb
    if not report.courseware_filename:
        report.courseware_filename = f"{len(files)}张课件截图"
    db.commit()

    # SoMark 解析成功后删除中间文件
    if text.strip():
        try:
            # 删除拼接的 DOCX（多张截图时才有）
            if len(saved_paths) > 1 and somark_file_path != saved_paths[0]:
                if os.path.exists(somark_file_path):
                    os.remove(somark_file_path)
            # 删除原始图片
            for p in saved_paths:
                if os.path.exists(p):
                    os.remove(p)
        except Exception as e:
            logger.warning(f"删除中间文件失败: {e}")

    return {
        "success": True,
        "text_length": len(text),
        "images_processed": len(saved_paths),
    }


async def _stitch_images_to_doc(image_paths: List[str], output_dir: str, report_id: int) -> str:
    """将多张图片拼接为竖版多页 DOC 文档"""
    from docx import Document
    from docx.shared import Inches, Pt, Cm
    from PIL import Image

    doc = Document()

    section = doc.sections[0]
    section.top_margin = Cm(1.5)
    section.bottom_margin = Cm(1.5)
    section.left_margin = Cm(2)
    section.right_margin = Cm(2)

    max_img_width = Inches(5.5)

    for img_path in image_paths:
        try:
            img = Image.open(img_path)
            img_width, img_height = img.size
            img_width_inches = img_width / 96.0
            scale = min(max_img_width.inches / img_width_inches, 1.0)
            doc.add_picture(img_path, width=Inches(img_width_inches * scale))
        except Exception as e:
            logger.warning(f"拼接图片失败 {img_path}: {e}")

    output_path = os.path.join(output_dir, f"{report_id}_stitched_{int(time.time())}.docx")
    doc.save(output_path)
    return output_path


def _extract_somark_text(result: dict) -> str:
    """从 SoMark 响应中提取文本"""
    try:
        blocks = []
        pages = result.get("data", {}).get("result", {}).get("outputs", {}).get("json", {}).get("pages", [])
        for page in pages:
            for block in page.get("blocks", []):
                txt = block.get("text", "").strip()
                if txt:
                    blocks.append(txt)
        return "\n\n".join(blocks)
    except Exception:
        return result.get("data", {}).get("result", {}).get("outputs", {}).get("markdown", "")


@router.get("")
async def list_experiments(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """获取实验报告列表"""
    reports = db.query(ExperimentReport).filter(
        ExperimentReport.owner_id == token_data.user_id,
    ).order_by(ExperimentReport.created_at.desc()).all()

    return {
        "reports": [
            {
                "id": r.id,
                "title": r.title,
                "status": r.status.value,
                "sections_config": r.sections_config,
                "has_courseware": bool(r.courseware_file_path),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in reports
        ]
    }


@router.get("/{report_id}")
async def get_experiment(
    report_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """获取实验报告详情"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    return {
        "id": report.id,
        "title": report.title,
        "status": report.status.value,
        "sections_config": report.sections_config,
        "knowledge_base": experiment_agent._upgrade_legacy_knowledge(report.knowledge_base or {}, report.sections_config or DEFAULT_SECTIONS),
        "draft_content": report.draft_content,
        "chat_history": report.chat_history,
        "has_courseware": bool(report.courseware_file_path),
        "error_message": report.error_message,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
    }


@router.websocket("/ws/{report_id}")
async def experiment_websocket(
    websocket: WebSocket,
    report_id: int,
    db: Session = Depends(get_db),
):
    """实验报告实时进度 WebSocket"""
    user_id = 0
    from app.models.user import User
    await websocket.accept()

    try:
        data = await websocket.receive_text()
        auth_data = json.loads(data)
        token = auth_data.get("token", "")

        from app.services.auth_service import decode_access_token
        payload = decode_access_token(token)
        if not payload:
            await websocket.send_json({"type": "error", "message": "认证失败"})
            await websocket.close()
            return

        user_id = payload.user_id

        report = db.query(ExperimentReport).filter(
            ExperimentReport.id == report_id,
            ExperimentReport.owner_id == user_id,
        ).first()
        if not report:
            await websocket.send_json({"type": "error", "message": "实验报告不存在"})
            await websocket.close()
            return

        from app.core.websocket import experiment_ws_manager
        await experiment_ws_manager.connect(user_id, report_id, websocket)

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"Experiment WS 异常: {e}")
    finally:
        from app.core.websocket import experiment_ws_manager
        experiment_ws_manager.disconnect(user_id, report_id, websocket)


@router.post("/{report_id}/reply")
async def reply_to_agent(
    report_id: int,
    body: dict,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """向写作助手发送回复"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    reply = body.get("reply", "")
    if not reply:
        raise HTTPException(status_code=400, detail="回复内容不能为空")

    updated_report = await experiment_agent.handle_user_reply(db, report_id, reply)

    return {
        "status": updated_report.status.value if updated_report else report.status.value,
        "draft_content": updated_report.draft_content if updated_report else report.draft_content,
        "chat_history": updated_report.chat_history if updated_report else report.chat_history,
        "knowledge_base": updated_report.knowledge_base if updated_report else report.knowledge_base,
    }


@router.post("/{report_id}/reply/stream")
async def reply_to_agent_stream(
    report_id: int,
    body: dict,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """流式回复接口 - SSE 逐 token 流式返回 AI 生成内容"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    reply = body.get("reply", "")
    if not reply:
        raise HTTPException(status_code=400, detail="回复内容不能为空")

    async def event_stream():
        try:
            async for event in experiment_agent.handle_user_reply_stream(db, report_id, reply):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{report_id}/photos")
async def upload_experiment_photo(
    report_id: int,
    file: UploadFile = File(...),
    photo_name: str = Form(...),
    notes: str = Form(""),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """上传实验报告结果照片（支持同一名称多张，带备注）"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    upload_dir = "/uploads/experiments/photos"
    os.makedirs(upload_dir, exist_ok=True)

    safe_name = f"{report_id}_{int(time.time())}_{file.filename}"
    file_path = os.path.join(upload_dir, safe_name)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    # Write knowledge_base.photos atomically first (primary source)
    import json as _json
    db.refresh(report)
    # json round-trip ensures SQLAlchemy detects the mutation
    kb = _json.loads(_json.dumps(report.knowledge_base or {}))
    if "photos" not in kb:
        kb["photos"] = {}
    if photo_name not in kb["photos"] or not isinstance(kb["photos"][photo_name], list):
        kb["photos"][photo_name] = []
    kb["photos"][photo_name].append({
        "file_path": file_path,
        "url": f"/uploads/experiments/photos/{safe_name}",
        "notes": notes.strip() if notes else "",
    })
    report.knowledge_base = kb
    db.commit()

    # Then update _photo_record in chat_history (non-critical, read-modify-write)
    db.refresh(report)
    photo_record = {"type": "_photo_record", "photos": _json.loads(_json.dumps(report.knowledge_base.get("photos") or {}))}
    history = list(report.chat_history or [])
    history = [m for m in history if m.get("type") != "_photo_record"]
    history.append(photo_record)
    report.chat_history = history
    db.commit()

    return {"success": True, "photo_name": photo_name, "url": f"/uploads/experiments/photos/{safe_name}", "notes": notes.strip() if notes else ""}


@router.post("/{report_id}/finalize")
async def finalize_experiment(
    report_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """用户确认完成实验报告"""
    from app.models.experiment import ExperimentStatus

    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")
    if report.status != ExperimentStatus.PENDING_REVIEW:
        raise HTTPException(status_code=400, detail="报告状态不正确，当前无法确认完成")

    report.status = ExperimentStatus.COMPLETED
    db.commit()

    return {"success": True, "status": "completed"}


@router.delete("/{report_id}")
async def delete_experiment(
    report_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """删除实验报告"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    if report.courseware_file_path and os.path.exists(report.courseware_file_path):
        try:
            os.remove(report.courseware_file_path)
        except Exception as e:
            logger.warning(f"删除课件文件失败: {e}")

    # 删除实验报告中引用的图片文件
    img_paths = set()
    for field in (report.draft_content, report.knowledge_base):
        if field:
            raw = json.dumps(field, ensure_ascii=False)
            img_paths.update(DocumentService.extract_image_paths(raw))
    DocumentService.delete_image_files(list(img_paths))

    db.delete(report)
    db.commit()

    return {"success": True}


@router.get("/{report_id}/export/{fmt}")
async def export_experiment(
    report_id: int,
    fmt: str,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """导出实验报告为 Word 或 PDF"""
    report = db.query(ExperimentReport).filter(
        ExperimentReport.id == report_id,
        ExperimentReport.owner_id == token_data.user_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="实验报告不存在")

    from fastapi.responses import Response
    import io
    import re
    import tempfile

    def strip_markdown(text: str) -> str:
        text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)
        text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
        text = re.sub(r'\*(.+?)\*', r'\1', text)
        # Remove bullet list markers (* and - at line start with space)
        text = re.sub(r'^[\*\-]\s+', '', text, flags=re.MULTILINE)
        # Remove any remaining stray asterisks
        text = text.replace('*', '')
        text = re.sub(r'`(.+?)`', r'\1', text)
        text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
        text = text.replace('\u2003', '  ').replace('\u00a0', ' ')
        return text

    def parse_chart_config(config: str) -> dict:
        result = {"type": "scatter_with_fit", "x_label": "X", "y_label": "Y"}
        for m in re.finditer(r'(\w+)=["\']([^"\']*)["\']', config):
            k, v = m.groups()
            if k == 'type': result['type'] = v
            elif k == 'x': result['x_label'] = v
            elif k == 'y': result['y_label'] = v
        return result

    def collect_chart_data(chat_history: list, x_col: str, y_col: str):
        import json
        for msg in reversed(chat_history or []):
            td = msg.get("table_data")
            if td and isinstance(td, dict):
                rows = td.get("data", [])
                if rows and isinstance(rows, list):
                    points = []
                    for row in rows:
                        if isinstance(row, dict):
                            x = None
                            y = None
                            for k, v in row.items():
                                if k == x_col or k.startswith(x_col) or x_col in k:
                                    try: x = float(v) if v is not None else None
                                    except: pass
                                if k == y_col or k.startswith(y_col) or y_col in k:
                                    try: y = float(v) if v is not None else None
                                    except: pass
                            if x is not None and y is not None:
                                points.append({"x": x, "y": y})
                    if points:
                        return points
            if isinstance(td, str):
                try:
                    td_data = json.loads(td)
                    return collect_chart_data([{"table_data": td_data}], x_col, y_col)
                except:
                    pass
        return []

    def generate_chart_image(config: dict, data_points: list) -> bytes:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import numpy as np
        plt.rcParams['font.sans-serif'] = ['SimHei', 'Noto Sans SC', 'DejaVu Sans']
        plt.rcParams['axes.unicode_minus'] = False
        chart_type = config.get('type', 'scatter_with_fit')
        x_label = config.get('x_label', '类别')
        y_label = config.get('y_label', '值')

        # Extract labels and values
        xs_raw = [p['x'] for p in data_points]
        ys = [p['y'] for p in data_points]
        # Detect if x values are numeric or string labels
        xs_numeric = all(isinstance(x, (int, float)) or str(x).replace('.','',1).replace('-','',1).isdigit() for x in xs_raw)
        xs_str = [str(x) for x in xs_raw]
        xs_num = [float(x) if xs_numeric else i for i, x in enumerate(xs_raw)]

        if chart_type in ('pie', 'doughnut'):
            fig, ax = plt.subplots(figsize=(5, 4), dpi=120)
            wedges, texts, autotexts = ax.pie(ys, labels=xs_str, autopct='%1.1f%%', startangle=90,
                colors=['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'])
            ax.axis('equal')
            if chart_type == 'doughnut':
                centre = plt.Circle((0, 0), 0.6, fc='white')
                fig.gca().add_artist(centre)
            fig.tight_layout()
            buf = io.BytesIO()
            fig.savefig(buf, format='png', dpi=120)
            plt.close(fig)
            buf.seek(0)
            return buf.getvalue()

        fig, ax = plt.subplots(figsize=(6, 3.8), dpi=120)
        title = config.get('title', '')

        if chart_type in ('bar', 'bar_chart'):
            ax.bar(range(len(xs_num)), ys, color='#3b82f6', width=0.6, label=y_label)
            ax.set_xticks(range(len(xs_num)))
            ax.set_xticklabels(xs_str, fontsize=8, rotation=15 if len(xs_str) > 4 else 0)
        elif chart_type == 'horizontalBar':
            ax.barh(range(len(xs_num)), ys, color='#3b82f6', height=0.6, label=y_label)
            ax.set_yticks(range(len(xs_num)))
            ax.set_yticklabels(xs_str, fontsize=8)
        elif chart_type in ('line',):
            ax.plot(range(len(xs_num)), ys, color='#3b82f6', linewidth=2, marker='o', markersize=6, label=y_label)
            ax.set_xticks(range(len(xs_num)))
            ax.set_xticklabels(xs_str, fontsize=8, rotation=15 if len(xs_str) > 4 else 0)
            ax.fill_between(range(len(xs_num)), ys, alpha=0.1, color='#3b82f6')
        elif chart_type in ('radar', 'polarArea'):
            angles = np.linspace(0, 2 * np.pi, len(xs_str), endpoint=False).tolist()
            values_plot = ys + [ys[0]]
            angles += [angles[0]]
            ax.remove()
            ax = fig.add_subplot(111, projection='polar')
            ax.plot(angles, values_plot, 'o-', linewidth=2, color='#3b82f6')
            ax.fill(angles, values_plot, alpha=0.25, color='#3b82f6')
            ax.set_xticks(angles[:-1])
            ax.set_xticklabels(xs_str, fontsize=8)
        elif chart_type in ('stackedBar',):
            half = max(1, len(ys) // 2)
            ax.bar(0, sum(ys[:half]), width=0.6, label=f'{x_label} (组1)', color='#3b82f6')
            ax.bar(1, sum(ys[half:]), width=0.6, label=f'{x_label} (组2)', color='#ef4444')
            ax.set_xticks([0, 1])
            ax.set_xticklabels(['组1', '组2'], fontsize=8)
        else:
            # scatter / scatter_with_fit / bubble
            if chart_type == 'bubble':
                sizes = [max(v * 10, 20) for v in ys]
                ax.scatter(xs_num, ys, s=sizes, color='#3b82f6', alpha=0.6, label='气泡图')
            else:
                ax.scatter(xs_num, ys, color='#3b82f6', s=40, label='实验数据')
            if chart_type == 'scatter_with_fit' and len(xs_num) >= 2:
                coeffs = np.polyfit(xs_num, ys, 1)
                a, b = coeffs
                x_fit = np.linspace(min(xs_num), max(xs_num), 100)
                y_fit = a * x_fit + b
                ax.plot(x_fit, y_fit, 'r-', linewidth=1.5, label=f'拟合 y={a:.3f}x{"+" if b>=0 else ""}{b:.3f}')
                eq_text = f'R² = {np.corrcoef(xs_num, ys)[0,1]**2:.4f}'
                ax.text(0.95, 0.05, eq_text, transform=ax.transAxes, fontsize=9, verticalalignment='bottom', horizontalalignment='right', bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.8))
        if chart_type not in ('pie', 'doughnut', 'radar', 'polarArea'):
            ax.set_xlabel(x_label, fontsize=10)
            ax.set_ylabel(y_label, fontsize=10)
            ax.legend(fontsize=8)
            ax.grid(True, alpha=0.3)
        if title:
            ax.set_title(title, fontsize=11)
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=120)
        plt.close(fig)
        buf.seek(0)
        return buf.getvalue()

    def render_mermaid(definition: str) -> bytes:
        """通过 mermaid.ink API 将 mermaid 定义渲染为 PNG"""
        import urllib.request
        import base64
        data = definition.strip()
        data_bytes = data.encode('utf-8')
        encoded = base64.b64encode(data_bytes).decode('utf-8')
        url = f'https://mermaid.ink/img/{encoded}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.read()
        except Exception as e:
            logger.warning(f"mermaid.ink 渲染失败: {e}")
            raise

    def parse_blocks(text: str, chat_history: list, photos: dict):
        lines = text.split('\n')
        blocks = []
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()
            # 检测 [RENDER_CHART]
            chart_match = re.match(r'\[RENDER_CHART:\s*(.*?)\]$', stripped)
            if chart_match:
                config = parse_chart_config(chart_match.group(1))
                data = collect_chart_data(chat_history, config['x_label'], config['y_label'])
                blocks.append({'type': 'chart', 'config': config, 'data': data})
                i += 1
                continue
            # 检测 ```mermaid ... ``` markdown 代码围栏
            if stripped == '```mermaid' or stripped == '``` mermaid':
                fence_lines = []
                i += 1
                while i < len(lines) and lines[i].strip() == '':
                    i += 1
                while i < len(lines):
                    if lines[i].strip() == '```':
                        i += 1
                        break
                    fence_lines.append(lines[i])
                    i += 1
                raw = '\n'.join(fence_lines).strip()
                if not raw:
                    continue
                first_word = fence_lines[0].strip().lower() if fence_lines else ''
                is_chart_kw = re.match(r'^(bar|bar_chart|pie|doughnut|polararea|radar|line|scatter|scatter_with_fit|horizontalbar|stackedbar|bubble)$', first_word, re.IGNORECASE)
                if raw.startswith('%%') or is_chart_kw:
                    ct = 'bar'
                    if is_chart_kw: ct = first_word
                    for cl in fence_lines:
                        cll = cl.strip().lower()
                        if '- pie' in cll or cll == 'pie': ct = 'pie'
                        elif '- doughnut' in cll or '- donut' in cll or cll == 'doughnut': ct = 'doughnut'
                        elif '- polar' in cll or cll == 'polar': ct = 'polarArea'
                        elif '- radar' in cll or cll == 'radar': ct = 'radar'
                        elif '- line' in cll or cll == 'line': ct = 'line'
                    in_data = False
                    labels = []
                    values = []
                    x_lbl = ''
                    auto_val = 0
                    for cl in fence_lines:
                        clt = cl.strip()
                        if clt.lower().startswith('x-axis '):
                            x_lbl = clt[7:].strip()
                        if clt.lower() in ('data', 'series'):
                            in_data = True
                            continue
                        if in_data:
                            colon_idx = clt.find(':')
                            if colon_idx >= 0:
                                lbl = clt[:colon_idx].strip()
                                rest = clt[colon_idx + 1:].strip()
                                rparts = rest.split(',')
                                try:
                                    val = float(rparts[0].strip())
                                    labels.append(lbl); values.append(val)
                                except:
                                    auto_val += 1; labels.append(lbl); values.append(auto_val)
                            else:
                                parts = clt.split()
                                if len(parts) >= 2:
                                    try:
                                        vals = [float(p) for p in parts if p.replace('.','',1).replace('-','',1).isdigit()]
                                        if vals:
                                            label_parts = [p for p in parts if not p.replace('.','',1).replace('-','',1).isdigit()]
                                            labels.append(' '.join(label_parts))
                                            values.append(vals[-1])
                                        else:
                                            auto_val += 1
                                            labels.append(clt)
                                            values.append(auto_val)
                                    except: pass
                    if labels and values:
                        blocks.append({'type': 'chart', 'config': {'type': ct, 'x_label': x_lbl or '类别', 'y_label': '值'}, 'data': [{'x': i, 'y': v} for i, v in enumerate(values)]})
                    else:
                        blocks.append({'type': 'text', 'content': strip_markdown(raw)})
                else:
                    # Pure mermaid content inside ```mermaid fence
                    blocks.append({'type': 'mermaid', 'definition': raw})
                continue
            # 检测 [CHART: type]...[/CHART] 标准图表块
            if stripped.startswith('[CHART:') and any('[/CHART]' in lines[j] for j in range(i, len(lines))):
                # 找到 [/CHART] 所在行
                end_line = i
                while end_line < len(lines) and '[/CHART]' not in lines[end_line]:
                    end_line += 1
                if end_line < len(lines):
                    raw = '\n'.join(lines[i:end_line + 1])
                    i = end_line + 1
                    ct = 'bar'
                    ct_m = re.match(r'\[CHART:\s*(\w+)\]', stripped)
                    if ct_m: ct = ct_m.group(1).strip()
                    title = ''
                    x_label = ''
                    labels = []
                    values = []
                    in_data = False
                    auto_val = 0
                    for ln in raw.split('\n'):
                        lt = ln.strip()
                        lc = lt.lower()
                        if lt.startswith('[CHART:') or lt == '[/CHART]': continue
                        if lc.startswith('title:'): title = lt[6:].strip(); continue
                        if lc.startswith('x-label:'): x_label = lt[8:].strip(); continue
                        if lc.startswith('y-label:'): continue
                        if lc == 'data:': in_data = True; continue
                        if in_data and lt:
                            ci = lt.find(':')
                            if ci >= 0:
                                lbl = lt[:ci].strip()
                                rest = lt[ci+1:].strip()
                                try:
                                    v = float(rest.split(',')[0].strip())
                                    labels.append(lbl); values.append(v)
                                except:
                                    auto_val += 1; labels.append(lbl); values.append(auto_val)
                    if labels and values:
                        blocks.append({'type': 'chart', 'config': {'type': ct, 'x_label': x_label or '类别', 'y_label': '值', 'title': title}, 'data': [{'x': labels[i] if i < len(labels) else str(i), 'y': v} for i, v in enumerate(values)]})
                    else:
                        blocks.append({'type': 'text', 'content': strip_markdown(raw)})
                continue
            # 检测 %%% mermaid ... %%% 围栏
            if stripped.startswith('%%% mermaid'):
                mermaid_lines = []
                i += 1
                while i < len(lines):
                    if lines[i].strip() == '%%%':
                        i += 1
                        break
                    mermaid_lines.append(lines[i])
                    i += 1
                raw = '\n'.join(mermaid_lines).strip()
                if raw:
                    blocks.append({'type': 'mermaid', 'definition': raw})
                continue
            # 检测裸 mermaid 语法（非 %% 开头，首行为 mermaid 关键词）
            mermaid_kw = re.match(r'^(graph\s+\w+|flowchart\s+\w+|sequenceDiagram|classDiagram|stateDiagram[-v2]*|erDiagram|gantt|journey|gitgraph|timeline|requirementDiagram|mindmap|sankey-beta|xychart-beta|block-beta|quadrantChart|zenuml|packet-beta|kanban|architecture-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|info|showInfo)', stripped, re.IGNORECASE)
            if mermaid_kw:
                mermaid_lines = [stripped]
                i += 1
                while i < len(lines):
                    ls = lines[i].strip()
                    if ls.startswith('##') or ls.startswith('[') or ls.startswith('```') or ls.startswith('%%%'):
                        break
                    if ls == '':
                        peek = i + 1
                        while peek < len(lines) and lines[peek].strip() == '':
                            peek += 1
                        if peek >= len(lines) or lines[peek].strip().startswith('##') or lines[peek].strip().startswith('['):
                            break
                    mermaid_lines.append(lines[i])
                    i += 1
                blocks.append({'type': 'mermaid', 'definition': '\n'.join(mermaid_lines).strip()})
                continue
            if stripped.startswith('%%') and not stripped.startswith('%%%'):
                chart_lines = [stripped]
                i += 1
                while i < len(lines):
                    ls = lines[i].strip()
                    if ls.startswith('##') or ls.startswith('%%') or ls.startswith('['):
                        break
                    chart_lines.append(ls)
                    i += 1
                combined = '\n'.join(chart_lines)
                # 检测图表类型
                ct = 'bar'
                for cl in chart_lines:
                    cll = cl.strip().lower()
                    if '- pie' in cll or cll == 'pie': ct = 'pie'
                    elif '- doughnut' in cll or '- donut' in cll or cll == 'doughnut': ct = 'doughnut'
                    elif '- polar' in cll or cll == 'polar': ct = 'polarArea'
                    elif '- radar' in cll or cll == 'radar': ct = 'radar'
                    elif '- line' in cll or cll == 'line': ct = 'line'
                # 提取数据
                in_data = False
                labels = []
                values = []
                x_lbl = ''
                auto_val = 0
                for cl in chart_lines:
                    clt = cl.strip()
                    if clt.startswith('x-axis '):
                        x_lbl = clt[7:].strip()
                    if clt == 'data' or clt == 'series':
                        in_data = True
                        continue
                    if in_data:
                        parts = clt.split()
                        if len(parts) >= 2:
                            try:
                                vals = [float(p) for p in parts if p.replace('.','',1).replace('-','',1).isdigit()]
                                if vals:
                                    label_parts = [p for p in parts if not p.replace('.','',1).replace('-','',1).isdigit()]
                                    labels.append(' '.join(label_parts))
                                    values.append(vals[-1])
                                else:
                                    # 非数值（如中文描述），使用递增序号
                                    auto_val += 1
                                    labels.append(clt)
                                    values.append(auto_val)
                            except: pass
                if labels and values:
                    blocks.append({'type': 'chart', 'config': {'type': ct, 'x_label': x_lbl or '类别', 'y_label': '值'}, 'data': [{'x': i, 'y': v} for i, v in enumerate(values)]})
                else:
                    blocks.append({'type': 'text', 'content': strip_markdown(combined)})
                continue
            # 检测 [PHOTO: name]
            photo_match = re.match(r'\[PHOTO:\s*([^\]]+)\]', stripped)
            if photo_match:
                name = photo_match.group(1).strip()
                photo_list = photos.get(name, [])
                blocks.append({'type': 'photo', 'name': name, 'photos': photo_list})
                i += 1
                continue
            # 检测 markdown 表格
            if stripped.startswith('|') and stripped.endswith('|') and i + 1 < len(lines):
                sep_line = lines[i + 1].strip() if i + 1 < len(lines) else ''
                if re.match(r'^\|[-\s:|]+\|$', sep_line):
                    header = [c.strip() for c in stripped.strip('|').split('|')]
                    rows = []
                    j = i + 2
                    while j < len(lines):
                        row_line = lines[j].strip()
                        if row_line.startswith('|') and row_line.endswith('|'):
                            cells = [c.strip() for c in row_line.strip('|').split('|')]
                            rows.append(cells)
                            j += 1
                        else:
                            break
                    blocks.append({'type': 'table', 'header': header, 'rows': rows})
                    i = j
                    continue
            if stripped:
                # 检测行内 [PHOTO: name] 标签 — 拆分为文本/照片交替
                inline_parts = re.split(r'(\[PHOTO:\s*[^\]]+\])', stripped)
                any_photo = False
                any_text = False
                for part in inline_parts:
                    pm = re.match(r'\[PHOTO:\s*([^\]]+)\]', part)
                    if pm:
                        name = pm.group(1).strip()
                        photo_list = photos.get(name, [])
                        blocks.append({'type': 'photo', 'name': name, 'photos': photo_list})
                        any_photo = True
                    else:
                        sp = strip_markdown(part)
                        if sp.strip():
                            blocks.append({'type': 'text', 'content': sp})
                            any_text = True
                if not any_photo and not any_text:
                    blocks.append({'type': 'text', 'content': strip_markdown(stripped)})
            else:
                blocks.append({'type': 'text', 'content': ''})
            i += 1
        return blocks

    safe_filename = report.title.replace('/', '_').replace('\\', '_').strip()
    chat_history = report.chat_history or []
    sections = report.draft_content or []

    # Photos: knowledge_base.photos is the single source of truth
    photos = (report.knowledge_base or {}).get("photos") if report.knowledge_base else None
    if not isinstance(photos, dict):
        photos = {}
    if not photos:
        logger.warning("[导出] knowledge_base.photos 为空")

    if fmt == "pdf":
        try:
            from fpdf import FPDF
            pdf = FPDF()
            pdf.set_auto_page_break(auto=True, margin=20)
            pdf.add_page()
            font_path = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'fonts', 'NotoSansSC-Regular.ttf')
            if not os.path.exists(font_path):
                font_path = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'simhei.ttf')
            if not os.path.exists(font_path):
                font_path = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'msyh.ttc')
            if not os.path.exists(font_path):
                font_path = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'simsun.ttc')
            has_cn_font = os.path.exists(font_path)
            if has_cn_font:
                pdf.add_font('NotoSansSC', '', font_path, uni=True)
                pdf.set_font('NotoSansSC', size=14)
            else:
                pdf.set_font("Helvetica", size=14)
            pdf.cell(0, 10, report.title, ln=True, align='C')
            pdf.ln(4)
            for i, sec in enumerate(sections, 1):
                title_text = f"{i}. {sec.get('title', '')}"
                if has_cn_font:
                    pdf.set_font('NotoSansSC', size=12)
                else:
                    pdf.set_font("Helvetica", size=12, style='B')
                pdf.cell(0, 8, title_text, ln=True)
                pdf.ln(2)
                raw = sec.get("content", "")
                blocks = parse_blocks(raw, chat_history, photos)
                if has_cn_font:
                    pdf.set_font('NotoSansSC', size=10)
                else:
                    pdf.set_font("Helvetica", size=10)
                for block in blocks:
                    pdf.set_x(pdf.l_margin)
                    if block['type'] == 'text':
                        if block['content'].strip():
                            try:
                                pdf.multi_cell(0, 6, block['content'])
                            except Exception:
                                safe = block['content'].encode('ascii', errors='replace').decode('ascii')
                                pdf.multi_cell(0, 6, safe)
                    elif block['type'] == 'table':
                        header = block['header']
                        rows = block['rows']
                        col_count = len(header)
                        col_width = pdf.w / (col_count + 2)
                        if has_cn_font:
                            pdf.set_font('NotoSansSC', style='', size=9)
                        else:
                            pdf.set_font("Helvetica", size=9, style='B')
                        for ci, h in enumerate(header):
                            pdf.cell(col_width, 8, h, border=1)
                        pdf.ln()
                        if has_cn_font:
                            pdf.set_font('NotoSansSC', size=9)
                        else:
                            pdf.set_font("Helvetica", size=9)
                        for row in rows:
                            for ci, cell in enumerate(row):
                                pdf.cell(col_width, 7, cell[:20], border=1)
                            pdf.ln()
                        pdf.ln(3)
                    elif block['type'] == 'chart':
                        data = block.get('data', [])
                        if len(data) >= 2:
                            try:
                                img_bytes = generate_chart_image(block['config'], data)
                                with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
                                    tmp.write(img_bytes)
                                    tmp_path = tmp.name
                                pdf.image(tmp_path, w=pdf.w - 20)
                                os.unlink(tmp_path)
                                pdf.ln(3)
                            except Exception as chart_e:
                                pdf.multi_cell(0, 6, f"[图表: {block['config'].get('x_label')} vs {block['config'].get('y_label')} (共{len(data)}组数据)]")
                        else:
                            pdf.multi_cell(0, 6, f"[图表数据不足 (当前{len(data)}组, 至少需要2组)]")
                    elif block['type'] == 'mermaid':
                        try:
                            img_bytes = render_mermaid(block['definition'])
                            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
                                tmp.write(img_bytes)
                                tmp_path = tmp.name
                            pdf.image(tmp_path, w=pdf.w - 20)
                            os.unlink(tmp_path)
                            pdf.ln(3)
                        except Exception as e:
                            pdf.set_font('NotoSansSC', size=8)
                            pdf.multi_cell(0, 5, f"[mermaid 图表]")
                            pdf.set_font('NotoSansSC', size=7)
                            for ml in block['definition'].split('\n')[:8]:
                                pdf.multi_cell(0, 4, ml.strip())
                            pdf.ln(2)
                    elif block['type'] == 'photo':
                        photo_list = block.get('photos', [])
                        if not photo_list:
                            if has_cn_font:
                                pdf.set_font('NotoSansSC', size=9, style='')
                            else:
                                pdf.set_font('Helvetica', size=9, style='I')
                            pdf.multi_cell(0, 6, f"[photo] {block.get('name', '')} (pending)")
                        else:
                            for pi, p in enumerate(photo_list):
                                try:
                                    img_path = p.get('file_path', '')
                                    # Also try URL-based path resolution
                                    if (not img_path or not os.path.isfile(img_path)):
                                        url = p.get('url', '')
                                        if url:
                                            alt = url.lstrip('/')
                                            if os.path.isfile(alt):
                                                img_path = alt
                                            else:
                                                alt2 = '.' + url
                                                if os.path.isfile(alt2):
                                                    img_path = alt2
                                                else:
                                                    # Try relative to uploads dir
                                                    alt3 = os.path.join('uploads', url.lstrip('/'))
                                                    if os.path.isfile(alt3):
                                                        img_path = alt3
                                    if not img_path or not os.path.isfile(img_path):
                                        raise FileNotFoundError(f"photo not found: {p}")
                                    caption = block.get('name', '')
                                    if p.get('notes'):
                                        caption += f" — {p['notes']}"
                                    if len(photo_list) > 1:
                                        caption += f" ({pi + 1}/{len(photo_list)})"
                                    pdf.image(img_path, w=pdf.w - 20)
                                    if has_cn_font:
                                        pdf.set_font('NotoSansSC', size=8, style='')
                                    else:
                                        pdf.set_font('Helvetica', size=8, style='I')
                                    pdf.multi_cell(0, 5, caption)
                                    pdf.ln(3)
                                except Exception as photo_e:
                                    if has_cn_font:
                                        pdf.set_font('NotoSansSC', size=9, style='')
                                    else:
                                        pdf.set_font('Helvetica', size=9, style='I')
                                    pdf.multi_cell(0, 6, f"[photo] {block.get('name', '')} (load failed)")
                                    pdf.ln(2)
                pdf.ln(2)
            output = io.BytesIO()
            raw = pdf.output()
            if isinstance(raw, str):
                raw = raw.encode('latin-1')
            output.write(raw)
            result_bytes = output.getvalue()
            if len(result_bytes) < 100:
                raise RuntimeError(f"PDF output too short ({len(result_bytes)} bytes), likely invalid")
            return Response(content=result_bytes, media_type="application/pdf",
                          headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_quote_filename(safe_filename)}.pdf"})
        except Exception as e:
            import traceback
            logging.getLogger(__name__).error(f"PDF导出失败 report_id={report_id}: {e}\n{traceback.format_exc()}")
            return Response(content=traceback.format_exc(), media_type="text/plain; charset=utf-8",
                          headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_quote_filename(safe_filename)}.txt"})

    elif fmt == "docx":
        try:
            from docx import Document
            from docx.shared import Pt, Inches, Cm
            from docx.enum.table import WD_TABLE_ALIGNMENT
            from docx.oxml.ns import qn
            doc = Document()
            style = doc.styles['Normal']
            style.font.size = Pt(11)
            style.font.name = '宋体'
            style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
            p = doc.add_paragraph()
            p.alignment = 1
            run = p.add_run(report.title)
            run.bold = True
            run.font.size = Pt(18)
            for i, sec in enumerate(sections, 1):
                doc.add_heading(f"{i}. {sec.get('title', '')}", level=1)
                raw = sec.get("content", "")
                blocks = parse_blocks(raw, chat_history, photos)
                for block in blocks:
                    if block['type'] == 'text':
                        if block['content'].strip():
                            doc.add_paragraph(block['content'])
                    elif block['type'] == 'table':
                        header = block['header']
                        rows = block['rows']
                        table = doc.add_table(rows=1 + len(rows), cols=len(header))
                        table.style = 'Table Grid'
                        table.alignment = WD_TABLE_ALIGNMENT.CENTER
                        for ci, h in enumerate(header):
                            cell = table.rows[0].cells[ci]
                            cell.text = h
                            for paragraph in cell.paragraphs:
                                for run in paragraph.runs:
                                    run.bold = True
                        for ri, row in enumerate(rows):
                            for ci, cell_text in enumerate(row):
                                table.rows[ri + 1].cells[ci].text = cell_text
                        doc.add_paragraph()
                    elif block['type'] == 'chart':
                        data = block.get('data', [])
                        if len(data) >= 2:
                            try:
                                img_bytes = generate_chart_image(block['config'], data)
                                with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
                                    tmp.write(img_bytes)
                                    tmp_path = tmp.name
                                doc.add_picture(tmp_path, width=Inches(5.5))
                                os.unlink(tmp_path)
                            except Exception as chart_e:
                                doc.add_paragraph(f"[图表: {block['config'].get('x_label')} vs {block['config'].get('y_label')} (共{len(data)}组数据)]")
                        else:
                            doc.add_paragraph(f"[图表数据不足 (当前{len(data)}组, 至少需要2组)]")
                        doc.add_paragraph()
                    elif block['type'] == 'mermaid':
                        try:
                            img_bytes = render_mermaid(block['definition'])
                            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
                                tmp.write(img_bytes)
                                tmp_path = tmp.name
                            doc.add_picture(tmp_path, width=Inches(5.5))
                            os.unlink(tmp_path)
                        except Exception:
                            p = doc.add_paragraph()
                            run = p.add_run('[mermaid 图表]')
                            run.italic = True
                            for ml in block['definition'].split('\n')[:8]:
                                p2 = doc.add_paragraph(ml.strip())
                                p2.style.font.size = Pt(8)
                        doc.add_paragraph()
                    elif block['type'] == 'photo':
                        photo_list = block.get('photos', [])
                        if not photo_list:
                            p = doc.add_paragraph()
                            run = p.add_run(f"📷 {block.get('name', '')}（照片待上传）")
                            run.italic = True
                            run.font.color.rgb = None
                        else:
                            for pi, p_item in enumerate(photo_list):
                                try:
                                    img_path = p_item.get('file_path', '')
                                    if (not img_path or not os.path.isfile(img_path)):
                                        url = p_item.get('url', '')
                                        if url:
                                            for alt in (url.lstrip('/'), '.' + url, os.path.join('uploads', url.lstrip('/'))):
                                                if os.path.isfile(alt): img_path = alt; break
                                    if not img_path or not os.path.isfile(img_path):
                                        raise FileNotFoundError(f"photo not found")
                                    doc.add_picture(img_path, width=Inches(4.5))
                                    caption = block.get('name', '')
                                    if p_item.get('notes'):
                                        caption += f" — {p_item['notes']}"
                                    if len(photo_list) > 1:
                                        caption += f" ({pi + 1}/{len(photo_list)})"
                                    cap_para = doc.add_paragraph()
                                    cap_run = cap_para.add_run(caption)
                                    cap_run.italic = True
                                    cap_para.alignment = 1
                                    doc.add_paragraph()
                                except Exception as photo_e:
                                    doc.add_paragraph(f"[photo] {block.get('name', '')} (load failed)")
            output = io.BytesIO()
            doc.save(output)
            return Response(content=output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                          headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_quote_filename(safe_filename)}.docx"})
        except Exception as e:
            import traceback
            return Response(content=traceback.format_exc(), media_type="text/plain; charset=utf-8",
                          headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_quote_filename(safe_filename)}.txt"})
    else:
        raise HTTPException(status_code=400, detail="不支持的导出格式，支持 pdf/docx")


def _quote_filename(name: str) -> str:
    from urllib.parse import quote
    return quote(name, safe='')
