#!/usr/bin/env python3
"""Prompt Enhancer 无网络回归测试。"""
import importlib.util
import json
import os
import queue
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE_PATH = os.path.join(HERE, "enhance_hotkey.py")
SPEC = importlib.util.spec_from_file_location("enhance_hotkey", MODULE_PATH)
EH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EH)

_TEST_LOG_DIR = None
_ORIGINAL_LOG_PATH = None


def setUpModule():
    global _TEST_LOG_DIR, _ORIGINAL_LOG_PATH
    _ORIGINAL_LOG_PATH = EH.LOG_PATH
    _TEST_LOG_DIR = tempfile.TemporaryDirectory()
    EH.LOG_PATH = os.path.join(_TEST_LOG_DIR.name, "test.log")


def tearDownModule():
    EH.LOG_PATH = _ORIGINAL_LOG_PATH
    _TEST_LOG_DIR.cleanup()


class SkillProtectionTests(unittest.TestCase):
    def test_empty_output_is_rejected(self):
        self.assertEqual(
            EH.validate_output("原文", " \n\t", "user", False, []),
            ["输出为空"],
        )

    def test_protects_every_skill_token(self):
        text = "$find-skills 帮我找 skill，再用 $p 处理"
        protected, tokens = EH.protect_skills(text)
        self.assertEqual(tokens, ["$find-skills", "$p"])
        self.assertEqual(protected.count("__PO_SKILL_"), 2)
        self.assertEqual(EH.restore_skills(protected, tokens), text)

    def test_only_skill_tokens_detection(self):
        self.assertTrue(EH.only_skill_tokens(" $find-skills $p "))
        self.assertFalse(EH.only_skill_tokens("$find-skills 帮我找技能"))
        self.assertFalse(EH.only_skill_tokens("$p 切换默认"))

    def test_placeholder_has_no_hyphen(self):
        protected, _ = EH.protect_skills("$find-skills hi")
        self.assertNotIn("-skills", protected)
        self.assertRegex(protected, r"^__PO_SKILL_0001_find_skills__ hi$")

    def test_missing_token_is_rejected(self):
        source, tokens = EH.protect_skills("$find-skills 帮我找")
        problems = EH.validate_output(source, "帮我找", "user", False, tokens)
        self.assertIn("Skill token 不完整", problems)

    def test_literals_are_preserved(self):
        source, tokens = EH.protect_skills(
            "检查 Z:\\fixture\\a.txt 和 https://example.com/a?b=1，数量 3"
        )
        problems = EH.validate_output(source, source, "user", False, tokens)
        self.assertEqual(problems, [])

    def test_base_rejects_material_request(self):
        source, tokens = EH.protect_skills("帮我把这个文章继续优化")
        problems = EH.validate_output(
            source,
            "请把文章发给我，我再帮你优化。",
            "user",
            False,
            tokens,
            "base",
        )
        self.assertIn("基础档索要了原文没有的材料", problems)

    def test_standard_rejects_structured_output(self):
        problems = EH.validate_output(
            "请优化文章",
            "**任务目标**\n优化文章。",
            "user",
            False,
            [],
            "standard",
        )
        self.assertIn("标准档输出成了结构化内容", problems)

    def test_professional_requires_five_headings(self):
        problems = EH.validate_output(
            "请优化文章",
            "请优化文章。",
            "user",
            False,
            [],
            "professional",
        )
        self.assertIn("专业档缺少五段固定标题", problems)

    def test_system_requires_complete_structure(self):
        problems = EH.validate_output(
            "你是一名审查员",
            "你是审查员，请审查。",
            "system",
            False,
            [],
            "system",
        )
        self.assertIn("系统提示词结构不完整", problems)

    def test_base_cleanup_is_deterministic(self):
        self.assertEqual(
            EH.base_cleanup("  帮我把这个文章继续优化  "),
            "请帮我把这个文章继续优化。",
        )
        self.assertEqual(
            EH.base_cleanup("第一句话。第二句话"),
            "第一句话。第二句话。",
        )

    def test_base_transform_uses_body_and_preserves_skills(self):
        prepared = EH.prepare_draft("base: $find-skills 帮我把这个文章继续优化")
        out = EH.base_transform(prepared["body"])
        self.assertNotIn("base:", out.lower())
        self.assertIn("$find-skills", out)
        self.assertIn("这个文章", out)

    def test_base_prefix_without_body_is_empty(self):
        self.assertEqual(EH.prepare_draft("base:")["body"], "")
        self.assertEqual(EH.prepare_draft("基础：")["body"], "")

    def test_base_cleanup_preserves_trailing_fence(self):
        text = "请检查这段代码：\n```python\nprint('a  b')\n```"
        self.assertEqual(EH.base_cleanup(text), text)

    def test_base_cleanup_preserves_untyped_fence(self):
        text = "复验一下\n```\n帮我把这个文章继续优化\n```"
        out = EH.base_cleanup(text)
        self.assertIn("```\n帮我把这个文章继续优化\n```", out)
        self.assertNotIn("帮我把这个文章继续优化。", out)

    def test_base_cleanup_preserves_paragraphs_and_nested_list_indent(self):
        text = "第一段\n\n第二段\n\n- 第一项\n  - 子项咋样"
        out = EH.base_cleanup(text)
        self.assertIn("第一段\n\n第二段", out)
        self.assertIn("  - 子项怎么样", out)

    def test_base_cleanup_does_not_split_punctuation_into_new_lines(self):
        self.assertEqual(EH.base_cleanup("第一句话。第二句话"), "第一句话。第二句话。")

    def test_base_cleanup_preserves_table_lines(self):
        text = "| 名称 | 值 |\n| --- | --- |\n| 甲 | 3 |"
        out = EH.base_cleanup(text)
        self.assertIn("| --- | --- |", out)
        self.assertTrue(out.endswith("| 甲 | 3 |"), out)

    def test_base_cleanup_preserves_fenced_and_inline_code(self):
        text = (
            "  说明  这里用 `foo  bar`。\r\n"
            "```python\r\n"
            "if True:  \r\n"
            "    print('a  b')  # 代码。不要改\r\n"
            "```\r\n"
            "下一句话"
        )
        out = EH.base_cleanup(text)
        self.assertIn("`foo  bar`", out)
        self.assertIn(
            "```python\r\nif True:  \r\n"
            "    print('a  b')  # 代码。不要改\r\n```",
            out,
        )
        self.assertIn("下一句话。", out)


class ParsingTests(unittest.TestCase):
    def test_default_tier_is_standard(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_last = EH.LAST_PATH
            EH.LAST_PATH = os.path.join(tmp, "last.md")
            try:
                self.assertEqual(EH.prepare_draft("帮我写篇文章")["tier"], "standard")
                self.assertEqual(EH.prepare_draft("pro: 复验并优化")["tier"], "professional")
                self.assertEqual(EH.prepare_draft("base: 帮我写篇文章")["tier"], "base")
                self.assertEqual(EH.prepare_draft("基础 帮我写篇文章")["tier"], "base")
                self.assertEqual(EH.prepare_draft("标准: 帮我写篇文章")["tier"], "standard")
            finally:
                EH.LAST_PATH = old_last

    def test_tier_prefix_is_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_last = EH.LAST_PATH
            EH.LAST_PATH = os.path.join(tmp, "last.md")
            try:
                result = EH.prepare_draft("pro: 复验并优化")
                self.assertEqual(result["body"], "复验并优化")
                self.assertEqual(result["tier"], "professional")
                self.assertEqual(
                    EH.prepare_draft("专业：帮我写篇文章")["body"], "帮我写篇文章"
                )
            finally:
                EH.LAST_PATH = old_last

    def test_legacy_tiers_map_to_four_tiers(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_last = EH.LAST_PATH
            EH.LAST_PATH = os.path.join(tmp, "last.md")
            try:
                self.assertEqual(EH.prepare_draft("专家: 帮我写篇文章")["tier"], "professional")
                self.assertEqual(EH.prepare_draft("smart: 帮我写篇文章")["tier"], "professional")
                self.assertEqual(EH.prepare_draft("轻量: 帮我写篇文章")["tier"], "standard")
                self.assertEqual(EH.prepare_draft("发布: 帮我写篇文章")["tier"], "professional")
            finally:
                EH.LAST_PATH = old_last

    def test_system_type_conflicts_with_tier(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_last = EH.LAST_PATH
            EH.LAST_PATH = os.path.join(tmp, "last.md")
            try:
                result = EH.prepare_draft("系统: 专业 你是一名审查员")
                self.assertEqual(result["mode"], "system")
                self.assertIn("不能与", result["conflict"])
            finally:
                EH.LAST_PATH = old_last

    def test_strong_system_signal_only(self):
        self.assertEqual(EH.detect_mode("你是一名 Java 审查员"), "system")
        self.assertEqual(EH.detect_mode("如果必须这样做，也请说明禁止原因"), "user")
        self.assertEqual(EH.detect_mode("你是文章里的一个人物"), "user")

    def test_switch_default_command(self):
        self.assertIsNotNone(EH.SWITCH_DEFAULT_RE.fullmatch("$p 切换默认"))
        self.assertIsNotNone(EH.SWITCH_DEFAULT_RE.fullmatch("$p 切换默认 专业"))
        self.assertIsNotNone(EH.SWITCH_DEFAULT_RE.fullmatch("$p 切换默认 系统"))
        self.assertEqual(EH.parse_default_command("$p 切换默认 系统"), "")
        self.assertEqual(EH.resolve_default_tier("基础"), "base")
        self.assertEqual(EH.resolve_default_tier("标准"), "standard")
        self.assertEqual(EH.resolve_default_tier("专家"), None)
        self.assertEqual(
            EH.parse_default_command("$p 切换默认 专业"), "professional"
        )
        self.assertEqual(EH.parse_default_command("$p 默认 标准"), "standard")
        self.assertEqual(EH.parse_default_command("$p 默认 系统"), "")
        self.assertEqual(EH.parse_default_command("$p 切换默认"), "")
        self.assertIsNone(EH.parse_default_command("普通草稿"))

    def test_short_iteration_can_expand_without_false_positive(self):
        source = "复验并优化"
        output = (
            "**任务目标**\n\n"
            + "优化当前方案并保持原意。" * 12
            + "\n\n**背景与范围**\n\n"
            + "范围以用户提供的方案为限。" * 12
            + "\n\n**执行要求**\n\n"
            + "逐项核对并修正问题。" * 12
            + "\n\n**约束条件**\n\n"
            + "不得改变核心事实和否定约束。" * 12
            + "\n\n**交付要求**\n\n"
            + "输出完整成品和修改说明。" * 12
        )
        self.assertNotIn(
            "迭代后篇幅膨胀",
            EH.validate_output(source, output, "user", True, [], "professional"),
        )

    def test_hotkey_falls_back_when_focus_probe_is_empty(self):
        old = (
            EH.foreground_exe,
            EH.is_allowed_window,
            EH.focused_control_info,
            EH.wait_mods_released,
            EH.snapshot_selection,
            EH._worker,
        )
        captured = []
        try:
            EH.foreground_exe = lambda: ("codex.exe", "codex.exe", 101, 202)
            EH.is_allowed_window = lambda cfg: ("codex.exe", "", "", True)
            EH.focused_control_info = lambda: {
                "hwnd": 101,
                "focus": 0,
                "caret": 0,
                "caret_ok": False,
            }
            EH.wait_mods_released = lambda: None
            EH.snapshot_selection = lambda backup=None: ("backup", "草稿")
            EH._worker = lambda *args: captured.append(args)
            EH.run_pipeline({}, queue.Queue(), True)
            for _ in range(20):
                if captured:
                    break
                time.sleep(0.02)
            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0][4], "草稿")
        finally:
            (
                EH.foreground_exe,
                EH.is_allowed_window,
                EH.focused_control_info,
                EH.wait_mods_released,
                EH.snapshot_selection,
                EH._worker,
            ) = old

    def test_switch_default_restores_clipboard(self):
        old = (
            EH.foreground_exe,
            EH.is_allowed_window,
            EH.focused_control_info,
            EH.wait_mods_released,
            EH.snapshot_selection,
            EH.clip_set,
        )
        restored = []
        try:
            EH.foreground_exe = lambda: ("codex.exe", "codex.exe", 101, 202)
            EH.is_allowed_window = lambda cfg: ("codex.exe", "", "", True)
            EH.focused_control_info = lambda: {
                "hwnd": 101,
                "focus": 101,
                "caret": 101,
                "caret_ok": True,
            }
            EH.wait_mods_released = lambda: None
            EH.snapshot_selection = lambda backup=None: ("原剪贴板", "$p 切换默认")
            EH.clip_set = lambda value: restored.append(value) or True
            events = queue.Queue()
            EH.run_pipeline({}, events, True)
            self.assertEqual(events.get_nowait(), ("choose_default", True))
            self.assertEqual(restored, ["原剪贴板"])
        finally:
            (
                EH.foreground_exe,
                EH.is_allowed_window,
                EH.focused_control_info,
                EH.wait_mods_released,
                EH.snapshot_selection,
                EH.clip_set,
            ) = old

    def test_documented_cli_argument_order(self):
        self.assertEqual(
            EH.parse_cli_args(
                ["--mode", "system", "--test", "你是一名审查员"]
            ).test,
            "你是一名审查员",
        )
        self.assertEqual(
            EH.parse_cli_args(
                ["--mode", "iterate", "--test", "全文"]
            ).mode,
            "iterate",
        )

    def test_concurrent_hotkeys_do_not_capture_twice(self):
        old = (
            EH.foreground_exe,
            EH.is_allowed_window,
            EH.focused_control_info,
            EH.wait_mods_released,
            EH.snapshot_selection,
            EH._worker,
        )
        captures = []
        try:
            EH.foreground_exe = lambda: ("codex.exe", "codex.exe", 101, 202)
            EH.is_allowed_window = lambda cfg: ("codex.exe", "", 202, True)
            EH.focused_control_info = lambda: {
                "hwnd": 101,
                "focus": 101,
                "caret": 101,
                "caret_ok": True,
            }
            EH.wait_mods_released = lambda: None

            def snapshot(backup=None):
                time.sleep(0.12)
                captures.append(backup)
                return "backup", "草稿"

            EH.snapshot_selection = snapshot
            EH._worker = lambda *args: None
            events = queue.Queue()
            threads = (
                threading.Thread(
                    target=EH.run_pipeline, args=({}, events, True)
                ),
                threading.Thread(
                    target=EH.run_pipeline, args=({}, events, True)
                ),
            )
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            time.sleep(0.2)
            self.assertEqual(len(captures), 1)
        finally:
            (
                EH.foreground_exe,
                EH.is_allowed_window,
                EH.focused_control_info,
                EH.wait_mods_released,
                EH.snapshot_selection,
                EH._worker,
            ) = old

    def test_iteration_inherits_previous_tier(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_last, old_state = EH.LAST_PATH, EH.STATE_PATH
            EH.LAST_PATH = os.path.join(tmp, "last.md")
            EH.STATE_PATH = os.path.join(tmp, "last-state.json")
            try:
                with open(EH.LAST_PATH, "w", encoding="utf-8") as f:
                    f.write("上一版内容\n")
                EH.save_last_state("user", "professional")
                result = EH.prepare_draft("上一版内容")
                self.assertTrue(result["auto_iteration"])
                self.assertEqual(result["tier"], "professional")
                switched = EH.prepare_draft("标准: 上一版内容")
                self.assertEqual(switched["tier"], "standard")
            finally:
                EH.LAST_PATH, EH.STATE_PATH = old_last, old_state

    def test_default_tier_controls_unprefixed_input(self):
        old_loader = EH.load_config
        try:
            EH.load_config = lambda: {
                "default_tier": "professional",
                "max_tokens": 700,
            }
            with tempfile.TemporaryDirectory() as tmp:
                old_last = EH.LAST_PATH
                EH.LAST_PATH = os.path.join(tmp, "last.md")
                try:
                    self.assertEqual(
                        EH.prepare_draft("帮我写文章")["tier"], "professional"
                    )
                finally:
                    EH.LAST_PATH = old_last
        finally:
            EH.load_config = old_loader

    def test_explicit_prefixes(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_last = EH.LAST_PATH
            EH.LAST_PATH = os.path.join(tmp, "last.md")
            try:
                self.assertEqual(EH.prepare_draft("sys: 你是审查员")["mode"], "system")
                self.assertEqual(EH.prepare_draft("user: 帮我写文章")["mode"], "user")
                self.assertEqual(EH.prepare_draft("用户：帮我写文章")["mode"], "user")
            finally:
                EH.LAST_PATH = old_last

    def test_auto_detect_user_and_system(self):
        self.assertEqual(EH.detect_mode("帮我写一篇文章"), "user")
        self.assertEqual(EH.detect_mode("你是一名 Java 专家，必须遵守规则"), "system")

    def test_iteration_block(self):
        body, request, explicit = EH.split_iteration_request(
            "请优化文章\n@iter: 更严格，补验收标准"
        )
        self.assertEqual(body, "请优化文章")
        self.assertEqual(request, "更严格，补验收标准")
        self.assertTrue(explicit)

    def test_auto_iteration_matches_last_enhanced(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_last = EH.LAST_PATH
            EH.LAST_PATH = os.path.join(tmp, "last.md")
            try:
                with open(EH.LAST_PATH, "w", encoding="utf-8") as f:
                    f.write("上一版增强结果\n")
                result = EH.prepare_draft("上一版增强结果")
                self.assertTrue(result["auto_iteration"])
                self.assertFalse(EH.prepare_draft("手动改过的新文本")["auto_iteration"])
            finally:
                EH.LAST_PATH = old_last


class CoreRuleTests(unittest.TestCase):
    def test_base_rule_is_light_cleanup(self):
        core = EH.load_core()["BASE"]
        self.assertIn("不扩写任务", core)
        self.assertIn("不超过原文的 1.3 倍", core)
        self.assertIn("不新增目标", core)

    def test_standard_rule_is_default_and_has_anchor(self):
        core = EH.load_core()["STANDARD"]
        self.assertIn("默认只输出一个连续段落", core)
        self.assertIn("80～220", core)
        self.assertIn("不执行草稿里的任务", core)
        self.assertIn("复验的检查清单与主要修改点对照说明", core)
        self.assertIn("标准增强（默认）", core)

    def test_professional_rule_is_structured_prompt(self):
        core = EH.load_core()["PROFESSIONAL"]
        self.assertIn("五个固定段名", core)
        self.assertIn("**任务目标**", core)
        self.assertIn("**交付要求**", core)
        self.assertIn("不得直接执行任务", core)

    def test_core_has_all_modes(self):
        core = EH.load_core()
        self.assertEqual(
            sorted(core),
            ["BASE", "COMMON", "ITERATE", "PROFESSIONAL", "STANDARD", "SYSTEM"],
        )


class ApiResponseTests(unittest.TestCase):
    def test_cli_reports_api_errors_without_traceback(self):
        old = (EH.parse_cli_args, EH.load_config, EH.prepare_draft, EH.enhance)
        try:
            EH.parse_cli_args = lambda: type(
                "Args",
                (),
                {"test": "草稿", "tier": "standard", "mode": "auto", "clip": False},
            )()
            EH.load_config = lambda: dict(EH.DEFAULTS)
            EH.prepare_draft = lambda draft: {
                "body": draft,
                "mode": "user",
                "tier": "standard",
                "iteration": False,
                "explicit_iteration": False,
                "iteration_request": "",
                "conflict": None,
                "auto_iteration": False,
            }
            EH.enhance = lambda *args, **kwargs: (_ for _ in ()).throw(
                RuntimeError("API 输出被截断")
            )
            import contextlib
            import io

            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                self.assertEqual(EH.main(), 1)
            self.assertIn("增强失败：API 输出被截断", stderr.getvalue())
        finally:
            (
                EH.parse_cli_args,
                EH.load_config,
                EH.prepare_draft,
                EH.enhance,
            ) = old

    def test_tier_token_limits(self):
        cfg = dict(EH.DEFAULTS)
        captured = []

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps(
                    {
                        "choices": [
                            {
                                "message": {"content": "增强结果"},
                                "finish_reason": "stop",
                            }
                        ]
                    }
                ).encode("utf-8")

        old_urlopen, old_key = EH.urllib.request.urlopen, EH.api_key
        try:
            EH.urllib.request.urlopen = lambda req, timeout: (
                captured.append(json.loads(req.data.decode("utf-8"))) or Response()
            )
            EH.api_key = lambda cfg: "test-key"
            EH.enhance("草稿", cfg, tier="system")
            EH.enhance("草稿", cfg, tier="professional")
            EH.enhance("草稿", cfg, tier="standard")
            EH.enhance("草稿", cfg, tier="base")
        finally:
            EH.urllib.request.urlopen, EH.api_key = old_urlopen, old_key
        self.assertEqual(
            [item["max_tokens"] for item in captured],
            [1200, 1200, 900, 700],
        )

    def test_extracts_content(self):
        payload = {
            "choices": [
                {
                    "message": {"content": "增强后的提示词"},
                    "finish_reason": "stop",
                }
            ]
        }
        self.assertEqual(EH.extract_api_content(payload), "增强后的提示词")

    def test_rejects_broken_response(self):
        for payload in ({}, {"choices": []}, {"choices": None}):
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(RuntimeError, "API 响应结构异常"):
                    EH.extract_api_content(payload)

    def test_rejects_empty_and_non_string_content(self):
        for content in (None, "", "   ", {"text": "x"}):
            payload = {
                "choices": [
                    {
                        "message": {"content": content},
                        "finish_reason": "stop",
                    }
                ]
            }
            with self.subTest(content=content):
                with self.assertRaisesRegex(RuntimeError, "API 未返回可用内容"):
                    EH.extract_api_content(payload)

    def test_rejects_truncated_output(self):
        payload = {
            "choices": [
                {
                    "message": {"content": "被截断的提示词"},
                    "finish_reason": "length",
                }
            ]
        }
        with self.assertRaisesRegex(RuntimeError, "API 输出被截断"):
            EH.extract_api_content(payload)


class HistoryTests(unittest.TestCase):
    def test_history_rotates_by_count_and_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_history = EH.HISTORY_PATH
            EH.HISTORY_PATH = os.path.join(tmp, "history.jsonl")
            cfg = {"history_max_entries": 3, "history_max_bytes": 4096}
            try:
                for i in range(5):
                    EH.append_history(
                        {
                            "mode": "user",
                            "iteration": False,
                            "original": "原文%d" % i,
                            "enhanced": "增强%d" % i,
                        },
                        cfg,
                    )
                with open(EH.HISTORY_PATH, encoding="utf-8") as f:
                    rows = [json.loads(line) for line in f if line.strip()]
                self.assertEqual(len(rows), 3)
                self.assertEqual(rows[-1]["original"], "原文4")
                self.assertLessEqual(os.path.getsize(EH.HISTORY_PATH), 4096)
            finally:
                EH.HISTORY_PATH = old_history

    def test_secrets_are_masked(self):
        text = "\n".join(
            ("key " + "sk-" + "testfixture1234567890 ", "token=testfixture")
        )
        masked = EH.mask_secrets(text)
        self.assertNotIn("sk-" + "testfixture1234567890", masked)
        self.assertNotIn("testfixture", masked)


class StateTests(unittest.TestCase):
    def test_last_state_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_state = EH.STATE_PATH
            EH.STATE_PATH = os.path.join(tmp, "last-state.json")
            try:
                EH.save_last_state("system", "system")
                self.assertEqual(
                    EH.load_last_state(), {"mode": "system", "tier": "system"}
                )
            finally:
                EH.STATE_PATH = old_state


class DefaultWriterTests(unittest.TestCase):
    def test_cli_default_command_uses_writer(self):
        calls = []
        old = (EH.set_default_tier, EH.prepare_draft, EH.parse_cli_args)
        try:
            EH.set_default_tier = lambda tier: (
                calls.append(tier)
                or {"label": "标准", "tier": tier}
            )
            EH.prepare_draft = lambda draft: (_ for _ in ()).throw(
                AssertionError("default command must not invoke prepare_draft")
            )
            EH.parse_cli_args = lambda: type(
                "Args",
                (),
                {"test": "$p 默认 标准", "tier": "auto", "mode": "auto", "clip": False},
            )()
            self.assertEqual(EH.main(), 0)
            self.assertEqual(calls, ["standard"])
        finally:
            EH.set_default_tier, EH.prepare_draft, EH.parse_cli_args = old

    def test_set_default_writer_backs_up_and_persists(self):
        candidates = (
            os.path.abspath(os.path.join(HERE, "..", "core", "set_default.py")),
            os.path.abspath(os.path.join(HERE, "core", "set_default.py")),
        )
        writer_path = next((path for path in candidates if os.path.isfile(path)), "")
        self.assertTrue(writer_path, "set_default.py not found")
        spec = importlib.util.spec_from_file_location(
            "set_default",
            writer_path,
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(os.path.isfile(module.CONFIG_PATH))
        shared_config = os.path.abspath(
            os.path.join(os.path.dirname(writer_path), "..", "hotkey", "config.json")
        )
        expected_backup = (
            module.BACKUP_DIR
            if os.path.isfile(shared_config)
            else os.path.abspath(
                os.path.join(os.path.dirname(writer_path), "..", "backups")
            )
        )
        self.assertEqual(module.BACKUP_DIR, expected_backup)
        with tempfile.TemporaryDirectory() as tmp:
            config_path = os.path.join(tmp, "config.json")
            backup_dir = os.path.join(tmp, "backups")
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump({"default_tier": "standard"}, f)
            old_config, old_backup = module.CONFIG_PATH, module.BACKUP_DIR
            module.CONFIG_PATH, module.BACKUP_DIR = config_path, backup_dir
            try:
                cfg = module.load_config()
                cfg["default_tier"] = "professional"
                module.backup_config()
                module.write_config(cfg)
                with open(config_path, encoding="utf-8") as f:
                    self.assertEqual(json.load(f)["default_tier"], "professional")
                self.assertEqual(len(os.listdir(backup_dir)), 1)
            finally:
                module.CONFIG_PATH, module.BACKUP_DIR = old_config, old_backup


if __name__ == "__main__":
    unittest.main(verbosity=2)
