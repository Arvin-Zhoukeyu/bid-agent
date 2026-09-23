"""Run with `python app.py`, then open http://127.0.0.1:8765."""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import threading
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from config import load_env
from engine import ROOT, SAMPLES, analyze, analyze_with_model, evaluate, export_docx, generate_draft, looks_like_tender, pop_usage_events, read_document, refresh_evidence

load_env(ROOT / ".env")

DATA_FILE = ROOT / "data" / "state.json"
WEB = ROOT / "web"
LOCK = threading.RLock()
STATE_SCHEMA_VERSION = 3


def seed_state() -> dict:
    library = json.loads((SAMPLES / "library.json").read_text(encoding="utf-8"))
    projects = []
    for filename, title, customer in [
        ("tender_government.txt", "市级政务服务平台运维服务", "星城市政务服务中心"),
        ("tender_campus.txt", "高校智慧校园数据治理平台", "滨海科技学院"),
    ]:
        raw = (SAMPLES / filename).read_text(encoding="utf-8")
        projects.append({"id": filename.replace("tender_", "demo-").replace(".txt", ""),
                         "name": title, "customer": customer, "filename": filename,
                         "text": raw, "created_at": "2026-09-22", "synthetic": True,
                         "requirements": analyze(raw, library), "analysis_mode": "离线规则分析",
                         "analysis_error": "", "draft": None})
    return {"projects": projects, "library": library, "evaluation": None, "model_usage": [],
            "schema_version": STATE_SCHEMA_VERSION}


def load_state() -> dict:
    if DATA_FILE.exists():
        state = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        state.setdefault("model_usage", [])
        return state
    return seed_state()


def save_state(state: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = DATA_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(DATA_FILE)


def migrate_state(state: dict) -> bool:
    if int(state.get("schema_version", 0)) >= STATE_SCHEMA_VERSION:
        return False
    for project in state.get("projects", []):
        previous = project.get("requirements", [])
        refreshed = refresh_evidence(previous, state.get("library", []))
        before = [(row.get("status"), row.get("reason"), [item.get("id") for item in row.get("evidence", [])]) for row in previous]
        after = [(row.get("status"), row.get("reason"), [item.get("id") for item in row.get("evidence", [])]) for row in refreshed]
        project["requirements"] = refreshed
        if before != after or (project.get("draft") and not project["draft"].get("chapters")):
            project["draft"] = None
    state["schema_version"] = STATE_SCHEMA_VERSION
    return True


STATE = load_state()
if migrate_state(STATE):
    save_state(STATE)


def public_state() -> dict:
    with LOCK:
        return json.loads(json.dumps(STATE, ensure_ascii=False))


def get_project(project_id: str) -> dict:
    item = next((p for p in STATE["projects"] if p["id"] == project_id), None)
    if item is None:
        raise ValueError("项目不存在")
    return item


class Handler(BaseHTTPRequestHandler):
    server_version = "BidPilot/1.0"

    def _send(self, body: bytes, content_type: str, status: int = 200, filename: str = "") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f"attachment; filename={filename}")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, value, status: int = 200) -> None:
        self._send(json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)

    def _input(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 15 * 1024 * 1024:
            raise ValueError("文件超过 15 MB 限制")
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            raise ValueError("请求 JSON 格式错误") from None

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/health":
                return self._json({"ok": True, "model_configured": bool(os.getenv("LLM_API_KEY")),
                                   "model": os.getenv("LLM_MODEL", "") if os.getenv("LLM_API_KEY") else ""})
            if path == "/api/state":
                return self._json(public_state())
            match = re.fullmatch(r"/api/projects/([\w-]+)/export", path)
            if match:
                with LOCK:
                    project = get_project(match.group(1))
                    if not project.get("draft"):
                        raise ValueError("请先生成标书初稿")
                    blob = export_docx(project)
                return self._send(blob, "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                  filename="bid-document-draft.docx")
            if path == "/":
                path = "/index.html"
            file_path = (WEB / path.lstrip("/")).resolve()
            if not file_path.is_relative_to(WEB.resolve()) or not file_path.is_file():
                return self._json({"error": "页面不存在"}, 404)
            mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
            return self._send(file_path.read_bytes(), mime + ("; charset=utf-8" if mime.startswith("text/") or mime == "application/javascript" else ""))
        except ValueError as exc:
            self._json({"error": str(exc)}, 400)
        except Exception as exc:
            self._json({"error": f"服务错误：{exc}"}, 500)

    def do_POST(self) -> None:
        self._mutate("POST")

    def do_PATCH(self) -> None:
        self._mutate("PATCH")

    def _mutate(self, method: str) -> None:
        path = urlparse(self.path).path
        try:
            payload = self._input()
            with LOCK:
                usage_operation = ""
                usage_project_id = ""
                if method == "POST" and path == "/api/projects":
                    filename = str(payload.get("filename", ""))
                    encoded = payload.get("content_base64", "")
                    if not filename or not encoded:
                        raise ValueError("请选择文件")
                    blob = base64.b64decode(encoded, validate=True)
                    if len(blob) > 10 * 1024 * 1024:
                        raise ValueError("文件超过 10 MB 限制")
                    text = read_document(filename, blob)
                    if len(text.strip()) < 30:
                        raise ValueError("文件未提取到足够文字；扫描件暂不支持")
                    requirements, analysis_mode, analysis_error = analyze_with_model(text, STATE["library"])
                    project = {"id": "p-" + uuid.uuid4().hex[:8], "name": str(payload.get("name") or Path(filename).stem)[:80],
                               "customer": str(payload.get("customer") or "待填写")[:80], "filename": Path(filename).name,
                               "text": text[:600000], "created_at": datetime.now().date().isoformat(), "synthetic": False,
                               "requirements": requirements, "analysis_mode": analysis_mode,
                               "analysis_error": analysis_error, "draft": None}
                    STATE["projects"].insert(0, project)
                    result = project
                    usage_operation, usage_project_id = "新建项目分析", project["id"]
                elif method == "POST" and path == "/api/library":
                    filename = str(payload.get("filename", ""))
                    encoded = payload.get("content_base64", "")
                    raw = str(payload.get("text", ""))
                    if encoded:
                        raw = read_document(filename, base64.b64decode(encoded, validate=True))
                    if len(raw.strip()) < 10:
                        raise ValueError("请输入或上传至少 10 个字的材料")
                    if looks_like_tender(raw):
                        raise ValueError("这份内容看起来是招标方的要求文件，不能作为投标企业证明材料。请上传企业的证书、项目案例、人员清单或服务承诺。")
                    item = {"id": "lib-" + uuid.uuid4().hex[:8], "name": str(payload.get("name") or Path(filename).stem or "新材料")[:100],
                            "type": str(payload.get("type") or "其他")[:30], "valid_until": str(payload.get("valid_until") or "")[:20],
                            "text": raw[:200000]}
                    STATE["library"].append(item)
                    project_id = str(payload.get("project_id") or "")
                    requirement_id = str(payload.get("requirement_id") or "")
                    if project_id:
                        project = get_project(project_id)
                        project["requirements"] = refresh_evidence(project.get("requirements", []), STATE["library"])
                        project["draft"] = None
                        matched_requirement = next((req for req in project["requirements"] if req["id"] == requirement_id), None)
                        result = {"material": item, "requirement": matched_requirement,
                                  "message": "材料已保存，当前项目已重新匹配"}
                    else:
                        result = item
                elif method == "POST" and path == "/api/evaluation/run":
                    # Gold labels describe the bundled baseline, not user-added material.
                    baseline_library = json.loads((SAMPLES / "library.json").read_text(encoding="utf-8"))
                    result = evaluate(baseline_library)
                    STATE["evaluation"] = result
                else:
                    match = re.fullmatch(r"/api/projects/([\w-]+)/(analyze|generate)", path)
                    review = re.fullmatch(r"/api/projects/([\w-]+)/requirements/(R\d+)", path)
                    if match and method == "POST":
                        project = get_project(match.group(1))
                        usage_project_id = project["id"]
                        if match.group(2) == "analyze":
                            usage_operation = "重新分析"
                            previous = {r["id"]: (r.get("review_status"), r.get("review_note")) for r in project.get("requirements", [])}
                            project["requirements"], project["analysis_mode"], project["analysis_error"] = analyze_with_model(project["text"], STATE["library"])
                            for req in project["requirements"]:
                                if req["id"] in previous:
                                    req["review_status"], req["review_note"] = previous[req["id"]]
                            project["draft"] = None
                            result = project["requirements"]
                        else:
                            usage_operation = "生成标书初稿"
                            project["draft"] = generate_draft(project)
                            result = project["draft"]
                    elif review and method == "PATCH":
                        project = get_project(review.group(1))
                        req = next((r for r in project["requirements"] if r["id"] == review.group(2)), None)
                        if req is None:
                            raise ValueError("要求不存在")
                        status = payload.get("review_status", "pending")
                        if status not in ("pending", "confirmed", "needs_work"):
                            raise ValueError("审核状态无效")
                        req["review_status"] = status
                        req["review_note"] = str(payload.get("review_note") or "")[:500]
                        result = req
                    else:
                        return self._json({"error": "接口不存在"}, 404)
                for event in pop_usage_events():
                    event["operation"] = usage_operation or "模型调用"
                    event["project_id"] = usage_project_id
                    STATE["model_usage"].append(event)
                save_state(STATE)
            return self._json(result)
        except (ValueError, ImportError) as exc:
            self._json({"error": str(exc)}, 400)
        except Exception as exc:
            self._json({"error": f"服务错误：{exc}"}, 500)


def main() -> None:
    port = int(os.getenv("PORT", "8765"))
    host = os.getenv("HOST", "127.0.0.1")
    print(f"BidPilot running at http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
