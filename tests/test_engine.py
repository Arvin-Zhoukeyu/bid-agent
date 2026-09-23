import json
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from config import load_env
from engine import SAMPLES, _chat_completion, _llm_bid_content, analyze, analyze_with_model, evaluate, export_docx, extract_requirements, generate_draft, pop_usage_events, refresh_evidence


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library = json.loads((SAMPLES / "library.json").read_text(encoding="utf-8"))

    def test_extract_and_trace_source(self):
        source = (SAMPLES / "tender_government.txt").read_text(encoding="utf-8")
        rows = extract_requirements(source)
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[0]["id"], "R01")
        self.assertIn("营业执照", rows[0]["source"])
        self.assertGreater(rows[0]["line"], 1)

    def test_evidence_gap_and_action(self):
        source = (SAMPLES / "tender_government.txt").read_text(encoding="utf-8")
        rows = analyze(source, self.library)
        by_phrase = lambda phrase: next(r for r in rows if phrase in r["text"])
        self.assertEqual(by_phrase("7×24小时")["status"], "supported")
        self.assertEqual(by_phrase("三个政务")["status"], "gap")
        self.assertEqual(by_phrase("2026年10月20日")["status"], "action")
        self.assertEqual(by_phrase("季度安全巡检")["evidence"][0]["id"], "lib-backup")

    def test_supplement_material_closes_gap_and_enters_draft(self):
        source = (SAMPLES / "tender_government.txt").read_text(encoding="utf-8")
        requirements = analyze(source, self.library)
        certificate = next(row for row in requirements if "信息系统项目管理师" in row["text"])
        self.assertEqual(certificate["status"], "gap")
        supplemented = self.library + [{"id": "lib-pm-certificate", "name": "项目负责人证书",
                                        "type": "资质", "valid_until": "2029-12-31",
                                        "text": "项目负责人张明具备信息系统项目管理师证书，证书编号PM20260001。"}]
        refreshed = refresh_evidence(requirements, supplemented)
        certificate = next(row for row in refreshed if "信息系统项目管理师" in row["text"])
        self.assertEqual(certificate["status"], "supported")
        self.assertEqual(certificate["evidence"][0]["id"], "lib-pm-certificate")
        draft = generate_draft({"name": "测试项目", "requirements": refreshed}, use_model=False)
        section = next(row for row in draft["sections"] if row["requirement_id"] == certificate["id"])
        self.assertEqual(section["status"], "supported")
        self.assertEqual(section["evidence_name"], "项目负责人证书")

    def test_tender_document_cannot_be_used_as_company_evidence(self):
        source = "1. 投标人须提供近三年不少于三个政务信息化运维类项目案例。"
        mistaken_material = [{"id": "lib-wrong", "name": "招标文件", "type": "资质", "valid_until": "",
                              "text": "采购单位：某中心\n项目编号：ZB-01\n供应商资格要求\n投标人须提供近三年不少于三个政务信息化运维类项目案例。"}]
        row = analyze(source, mistaken_material)[0]
        self.assertEqual(row["status"], "gap")
        self.assertEqual(row["evidence"], [])

    def test_draft_never_claims_gap_compliance(self):
        source = (SAMPLES / "tender_campus.txt").read_text(encoding="utf-8")
        project = {"name": "校园数据项目", "customer": "采购单位", "requirements": analyze(source, self.library)}
        draft = generate_draft(project)
        self.assertEqual(len(draft["sections"]), 9)
        self.assertEqual(draft["document_title"], "校园数据项目 投标文件初稿")
        self.assertGreaterEqual(len(draft["categories"]), 3)
        self.assertEqual([chapter["title"] for chapter in draft["chapters"]],
                         ["项目概述", "技术与服务方案", "项目实施方案", "项目团队", "服务与质量保障"])
        self.assertTrue(draft["commercial"]["项目报价"].startswith("【待补充】"))
        self.assertTrue(draft["material_gaps"])
        for section in draft["sections"]:
            self.assertIn(section["response_status"], ("完全响应", "待确认", "材料缺失"))
            if section["status"] == "gap":
                self.assertIn("材料缺口", section["response"])
        project["draft"] = draft
        document = export_docx(project)
        self.assertTrue(document.startswith(b"PK"))
        self.assertGreater(len(document), 30000)
        from docx import Document
        rendered = Document(io.BytesIO(document))
        headings = [paragraph.text for paragraph in rendered.paragraphs if paragraph.style.name.startswith("Heading")]
        for title in ("一、项目概述", "二、技术与服务方案", "三、项目实施方案", "四、项目团队",
                      "五、服务与质量保障", "六、类似项目案例", "七、招标要求响应表",
                      "八、商务响应", "九、附件与证明材料", "十、材料缺口清单"):
            self.assertIn(title, headings)

    def test_evaluation_has_heldout_failure(self):
        report = evaluate(self.library)
        self.assertEqual(report["project_count"], 8)
        self.assertEqual(report["gold_count"], 74)
        self.assertEqual(report["matched_count"], 69)
        self.assertEqual(report["false_supported_count"], 4)
        self.assertLess(report["end_to_end_accuracy"], report["requirement_recall"])
        self.assertTrue(any(e["type"] == "要求遗漏" for e in report["errors"]))
        self.assertTrue(any(e["type"] == "错误判为有依据" for e in report["errors"]))

    def test_provider_usage_is_recorded_without_prompt_text(self):
        pop_usage_events()
        reply = json.dumps({"choices": [{"message": {"content": "OK"}}],
                            "usage": {"prompt_tokens": 80, "completion_tokens": 20, "total_tokens": 100}}).encode()
        with patch.dict(os.environ, {"LLM_API_KEY": "test-key"}), patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value = io.BytesIO(reply)
            self.assertEqual(_chat_completion([{"role": "user", "content": "private prompt"}]), "OK")
        events = pop_usage_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["total_tokens"], 100)
        self.assertNotIn("private prompt", str(events))

    def test_configured_model_extracts_verified_source_line(self):
        sample = "技术要求\n（一）平台须支持多源数据接入。\n"
        reply = '[{"line":2,"quote":"平台须支持多源数据接入。","category":"技术要求"},' \
                '{"line":9,"quote":"虚构要求","category":"技术要求"}]'
        with patch.dict("os.environ", {"LLM_API_KEY": "test-key"}), patch("engine._chat_completion", return_value=reply):
            rows, mode, error = analyze_with_model(sample, self.library)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["line"], 2)
        self.assertEqual(rows[0]["status"], "supported")
        self.assertIn("模型抽取", mode)
        self.assertEqual(error, "")

    def test_model_failure_falls_back_and_reports_it(self):
        sample = "1. 须提供有效营业执照。"
        with patch.dict("os.environ", {"LLM_API_KEY": "test-key"}), patch("engine._chat_completion", side_effect=TimeoutError("timeout")):
            rows, mode, error = analyze_with_model(sample, self.library)
        self.assertEqual(len(rows), 1)
        self.assertEqual(mode, "离线规则分析")
        self.assertIn("模型抽取失败", error)

    def test_env_file_loads_without_overriding_existing_values(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text("# local config\nLLM_API_KEY='file-key'\nLLM_MODEL=qwen3.5-plus-2026-04-20\nOTHER_SECRET=ignored\n", encoding="utf-8")
            with patch.dict(os.environ, {"LLM_MODEL": "preselected"}, clear=True):
                load_env(path)
                self.assertEqual(os.environ["LLM_API_KEY"], "file-key")
                self.assertEqual(os.environ["LLM_MODEL"], "preselected")
                self.assertNotIn("OTHER_SECRET", os.environ)

    def test_qwen_request_uses_non_thinking_json_mode(self):
        reply = json.dumps({"choices": [{"message": {"content": '{"requirements":[]}'}}]}).encode()
        settings = {"LLM_API_KEY": "test-key", "LLM_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "LLM_MODEL": "qwen3.5-plus-2026-04-20"}
        with patch.dict(os.environ, settings), patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value = io.BytesIO(reply)
            result = _chat_completion([{"role": "user", "content": "JSON"}], json_mode=True)
            request = urlopen.call_args.args[0]
            body = json.loads(request.data)
        self.assertEqual(result, '{"requirements":[]}')
        self.assertEqual(body["model"], settings["LLM_MODEL"])
        self.assertFalse(body["enable_thinking"])
        self.assertEqual(body["response_format"], {"type": "json_object"})

    def test_bid_prompt_rejects_new_numbers_and_price(self):
        rows = [{"id": "R01", "text": "提供7×24小时服务", "source": "1. 提供7×24小时服务",
                 "category": "技术要求", "status": "supported",
                 "evidence": [{"excerpt": "提供7×24小时故障受理", "name": "服务说明", "type": "产品方案"}]}]
        reply = json.dumps({"chapters": {"project_overview": {"项目背景": "项目采用1套平台"}},
                            "responses": [{"id": "R01", "text": "提供7×24小时受理，5分钟恢复"}],
                            "commercial": {"商务条款响应": "按要求执行", "项目报价": "100元"}}, ensure_ascii=False)
        with patch.dict(os.environ, {"LLM_API_KEY": "test-key"}), patch("engine._chat_completion", return_value=reply) as call:
            result = _llm_bid_content({"name": "测试项目", "customer": "采购单位"}, rows)
        self.assertEqual(call.call_count, 1)
        self.assertNotIn("R01", result["responses"])
        self.assertTrue(result["commercial"]["项目报价"].startswith("【待补充】"))
        system_prompt = call.call_args.args[0][0]["content"]
        self.assertIn("专业的投标文件生成 Agent", system_prompt)
        self.assertIn("材料缺口清单", system_prompt)


if __name__ == "__main__":
    unittest.main()
