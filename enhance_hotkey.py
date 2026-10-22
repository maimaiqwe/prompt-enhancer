#!/usr/bin/env python3
"""提示词一键增强（Windows 全局热键）

在 Codex / ChatGPT / 其他 Agent 窗口里按热键：选中或整段草稿 ->
调 DeepSeek 官方 API -> 原地替换为增强版。纯标准库，无需安装依赖。

用法:
    pythonw enhance_hotkey.py            常驻，监听热键
    python  enhance_hotkey.py --test "草稿"  只测接口，打印结果与耗时
    python  enhance_hotkey.py --clip     增强剪贴板内容并写回剪贴板（不动键盘）
"""
import argparse
import ctypes
import ctypes.wintypes as w
import hashlib
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "config.json")


def find_set_default_path():
    candidates = (
        os.path.abspath(os.path.join(BASE, "..", "core", "set_default.py")),
        os.path.abspath(os.path.join(BASE, "core", "set_default.py")),
    )
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return candidates[0]


SET_DEFAULT_PATH = find_set_default_path()


def find_core_path():
    candidates = (
        os.path.join(BASE, "core", "rules.md"),
        os.path.abspath(os.path.join(BASE, "..", "core", "rules.md")),
    )
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return candidates[0]


CORE_PATH = find_core_path()
LOG_PATH = os.path.join(BASE, "log.txt")
LAST_PATH = os.path.join(BASE, "last-enhanced.md")
ORIGINAL_PATH = os.path.join(BASE, "last-original.md")
HISTORY_PATH = os.path.join(BASE, "history.jsonl")
PID_PATH = os.path.join(BASE, "enhancer.pid")
STATE_PATH = os.path.join(BASE, "last-state.json")

DEFAULTS = {
    "gateway": "https://api.deepseek.com/chat/completions",
    "provider": "deepseek",
    "model": "deepseek-flash",
    "reasoning_effort": "none",
    "api_key_env": "DEEPSEEK_API_KEY",
    "hotkey": "ctrl+shift+alt+e",
    "allowed_processes": [
        "ChatGPT.exe",
        "codex.exe",
        "claude.exe",
        "DeepSeek Harness.exe",
        "Cursor.exe",
        "gemini.exe",
        "OpenCode.exe",
        "Windsurf.exe",
        "QoderCN.exe",
        "CodeBuddy.exe",
        "WorkBuddy.exe",
        "WorkBuddyAI.exe",
        "ZCode.exe",
        "Trae CN.exe",
        "codex-app-manager.exe",
        "idea64.exe",
    ],
    "max_tokens": 700,
    "max_tokens_base": 700,
    "max_tokens_standard": 900,
    "max_tokens_professional": 1200,
    "max_tokens_system": 1200,
    "temperature": 0.3,
    "timeout": 60,
    "select_all": True,
    "history_max_entries": 5,
    "history_max_bytes": 65536,
    "default_tier": "standard",
}

PROVIDERS = {
    "deepseek": {
        "gateway": "https://api.deepseek.com/chat/completions",
        "model": "deepseek-flash",
        "api_key_env": "DEEPSEEK_API_KEY",
        "auth": "bearer",
        "response_format": "openai",
        "pricing": "deepseek-flash",
    },
    "openai-compatible": {
        "gateway": "",
        "model": "",
        "api_key_env": "OPENAI_API_KEY",
        "auth": "bearer",
        "response_format": "openai",
        "pricing": None,
    },
}

TIER_ALIASES = {
    "base": "base",
    "基础": "base",
    "standard": "standard",
    "std": "standard",
    "标准": "standard",
    "轻量": "standard",
    "lite": "standard",
    "professional": "professional",
    "pro": "professional",
    "专业": "professional",
    "专家": "professional",
    "smart": "professional",
    "发布": "professional",
    "publish": "professional",
}
TIER_LABELS = {
    "base": "基础",
    "standard": "标准",
    "professional": "专业",
}
DEFAULT_TIERS = ("base", "standard", "professional")

USER_PREFIX = re.compile(r"^\s*(?:user|用户)\s*[:：]\s*", re.IGNORECASE)
SYSTEM_PREFIX = re.compile(r"^\s*(?:sys|system|系统)\s*[:：]\s*", re.IGNORECASE)
TIER_PREFIX = re.compile(
    r"^\s*(?:tier\s*[:：]\s*)?"
    r"(?P<tier>professional|pro|专业|专家|smart|base|基础|standard|std|标准|轻量|lite|发布|publish)"
    r"\s*(?:[:：]\s*|\s+)",
    re.IGNORECASE,
)
TIER_SIGNALS = re.compile(
    r"^(?:\s*(?:专业|pro|professional)\s*[:：]?\s+|"
    r"专业优化|专业增强|审查后改写)",
    re.IGNORECASE,
)
SWITCH_DEFAULT_RE = re.compile(
    r"^\s*\$p\s+(?:切换默认|默认|default|set-default)"
    r"(?:\s+(?P<tier>\S+))?\s*$",
    re.IGNORECASE,
)
SKILL_TOKEN = re.compile(r"(?<![\w$])\$(?P<name>[A-Za-z][A-Za-z0-9_-]*)")
ITER_BLOCK = re.compile(
    r"(?ms)^[ \t]*@iter\s*[:：][ \t]*(?P<body>.*)\Z"
)
SYSTEM_STRONG_SIGNALS = (
    "系统提示词",
    "系统指令",
    "角色设定",
    "角色定位",
    "你的角色是",
    "你是一名",
    "你是一个",
    "you are a",
    "you are an",
    "system prompt",
    "能力边界",
)
URL_PATTERN = re.compile(r"https?://[^\s<>'\"`]+", re.IGNORECASE)
WIN_PATH_PATTERN = re.compile(r"(?<![A-Za-z0-9])(?:[A-Za-z]:\\|\\\\)[^\s<>'\"`|]+")
UNIX_PATH_PATTERN = re.compile(r"(?<![\w/])/(?:[^\s<>'\"`/]+/)*[^\s<>'\"`/]+")
NUMBER_PATTERN = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w.])")
BASE_REQUESTING_PHRASES = (
    "发给我",
    "请提供",
    "请粘贴",
    "把文章发",
    "把内容发",
    "补充具体内容",
)


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", w.DWORD),
        ("flags", w.DWORD),
        ("hwndActive", w.HWND),
        ("hwndFocus", w.HWND),
        ("hwndCapture", w.HWND),
        ("hwndMenuOwner", w.HWND),
        ("hwndMoveSize", w.HWND),
        ("hwndCaret", w.HWND),
        ("rcCaret", w.RECT),
    ]

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

user32.OpenClipboard.argtypes = (w.HWND,)
user32.GetClipboardData.restype = ctypes.c_void_p
user32.GetWindowThreadProcessId.argtypes = (
    w.HWND,
    ctypes.POINTER(w.DWORD),
)
user32.GetWindowThreadProcessId.restype = w.DWORD
user32.GetGUIThreadInfo.argtypes = (
    w.DWORD,
    ctypes.POINTER(GUITHREADINFO),
)
user32.GetGUIThreadInfo.restype = w.BOOL
user32.SetClipboardData.argtypes = (w.UINT, ctypes.c_void_p)
user32.SetClipboardData.restype = ctypes.c_void_p
kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = (ctypes.c_void_p,)
kernel32.GlobalUnlock.argtypes = (ctypes.c_void_p,)
kernel32.OpenProcess.restype = ctypes.c_void_p
kernel32.OpenProcess.argtypes = (w.DWORD, w.BOOL, w.DWORD)

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
WH_KEYBOARD_LL = 13
WM_KEYDOWN, WM_KEYUP = 0x0100, 0x0101
WM_SYSKEYDOWN, WM_SYSKEYUP = 0x0104, 0x0105
VK_CONTROL, VK_SHIFT, VK_MENU = 0x11, 0x10, 0x12
VK_LWIN, VK_RWIN = 0x5B, 0x5C
VK_A, VK_C, VK_V = 0x41, 0x43, 0x56
VK_END = 0x23
KEYEVENTF_KEYUP = 0x0002
MOD_ALT, MOD_CONTROL, MOD_SHIFT = 0x0001, 0x0002, 0x0004
MOD_NOREPEAT = 0x4000
WM_HOTKEY = 0x0312
HOTKEY_ID = 0x5045  # "PE"


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", w.DWORD),
        ("scanCode", w.DWORD),
        ("flags", w.DWORD),
        ("time", w.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


LowLevelKeyboardProc = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, w.WPARAM, w.LPARAM)
user32.SetWindowsHookExW.argtypes = (ctypes.c_int, LowLevelKeyboardProc, ctypes.c_void_p, w.DWORD)
user32.SetWindowsHookExW.restype = ctypes.c_void_p
user32.CallNextHookEx.argtypes = (ctypes.c_void_p, ctypes.c_int, w.WPARAM, w.LPARAM)
user32.CallNextHookEx.restype = ctypes.c_ssize_t
user32.RegisterHotKey.argtypes = (w.HWND, ctypes.c_int, w.UINT, w.UINT)
user32.RegisterHotKey.restype = w.BOOL
user32.UnregisterHotKey.argtypes = (w.HWND, ctypes.c_int)
user32.UnregisterHotKey.restype = w.BOOL

_HOOK = None
_HOOK_PROC = None  # 必须留引用，否则回调被 GC 回收
_PROC_CACHE = {}
_ALLOW_CACHE = set()
_CLIP_GEN = {"n": 0}
_PIPELINE_LOCK = threading.Lock()
_LAST_CONFIG_ERROR = ""


def load_config():
    global _LAST_CONFIG_ERROR
    _LAST_CONFIG_ERROR = ""
    cfg = dict(DEFAULTS)
    cfg["allowed_processes"] = list(DEFAULTS["allowed_processes"])
    explicit_key_env = False
    explicit_gateway = False
    explicit_model = False
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                loaded = json.load(f)
            if not isinstance(loaded, dict):
                raise ValueError("config.json 顶层必须是对象")
            explicit_key_env = bool(str(loaded.get("api_key_env") or "").strip())
            explicit_gateway = bool(str(loaded.get("gateway") or "").strip())
            explicit_model = bool(str(loaded.get("model") or "").strip())
            cfg.update(loaded)
        except Exception as e:
            # 保留解析错误供 doctor 和热键流程 fail-closed。
            _LAST_CONFIG_ERROR = str(e)
            log("config.json 解析失败: %s" % e)
    provider = str(cfg.get("provider") or "deepseek").strip().lower()
    cfg["provider"] = provider
    provider_cfg = PROVIDERS.get(provider, PROVIDERS["deepseek"])
    cfg["_explicit_gateway"] = explicit_gateway
    cfg["_explicit_model"] = explicit_model
    if not explicit_gateway:
        cfg["gateway"] = provider_cfg["gateway"]
    if not explicit_key_env:
        cfg["api_key_env"] = provider_cfg["api_key_env"]
    if not explicit_model:
        cfg["model"] = provider_cfg["model"]
    return cfg


def config_problems(cfg):
    """返回包含解析状态在内的配置问题，供热键与 doctor 共用。"""
    problems = []
    if _LAST_CONFIG_ERROR:
        problems.append("config.json 解析失败: %s" % _LAST_CONFIG_ERROR)
    problems.extend(validate_config(cfg))
    return problems


def validate_config(cfg):
    """返回可直接展示的配置问题；空列表表示可启动。"""
    problems = []
    provider = str(cfg.get("provider") or "").strip().lower()
    if provider not in PROVIDERS:
        problems.append("provider 只能是 deepseek 或 openai-compatible")
    elif provider == "openai-compatible":
        if not cfg.get("_explicit_gateway"):
            problems.append("openai-compatible 必须显式配置 gateway")
        if not cfg.get("_explicit_model"):
            problems.append("openai-compatible 必须显式配置 model")
        gateway_host = urllib.parse.urlparse(
            str(cfg.get("gateway") or "").strip()
        ).hostname or ""
        if gateway_host == "deepseek.com" or gateway_host.endswith(".deepseek.com"):
            problems.append("openai-compatible 不能使用 DeepSeek 网关")
    gateway = str(cfg.get("gateway") or "").strip()
    if not gateway:
        problems.append("gateway 不能为空")
    else:
        try:
            parsed = urllib.parse.urlparse(gateway)
            if parsed.scheme != "https" or not parsed.netloc:
                problems.append("gateway 必须是非空 HTTPS 地址")
        except Exception:
            problems.append("gateway 不是有效 URL")
    if not str(cfg.get("model") or "").strip():
        problems.append("model 不能为空")
    if not str(cfg.get("api_key_env") or "").strip():
        problems.append("api_key_env 不能为空")
    allowed = cfg.get("allowed_processes")
    if not isinstance(allowed, list) or not allowed:
        problems.append("allowed_processes 必须是非空数组")
    elif not all(isinstance(item, str) and item.strip() for item in allowed):
        problems.append("allowed_processes 只能包含非空字符串")
    if cfg.get("default_tier") not in DEFAULT_TIERS:
        problems.append("default_tier 只能是 base、standard 或 professional")
    return problems


def provider_settings(cfg):
    provider = str(cfg.get("provider") or "deepseek").strip().lower()
    return PROVIDERS.get(provider, PROVIDERS["deepseek"])


def log(msg):
    line = "%s | %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass


def write_pid():
    payload = {
        "pid": os.getpid(),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "script_path": os.path.abspath(__file__),
    }
    try:
        with open(PID_PATH, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False)
            f.write("\n")
    except OSError:
        pass


def remove_pid():
    try:
        if os.path.exists(PID_PATH):
            with open(PID_PATH, encoding="utf-8") as f:
                raw = f.read().strip()
            try:
                payload = json.loads(raw)
                pid = str(payload.get("pid") or "")
            except (ValueError, TypeError):
                pid = raw
            if pid == str(os.getpid()):
                os.remove(PID_PATH)
    except OSError:
        pass


def instance_mutex_name():
    """由安装目录生成稳定锁名；不能使用 hash()，Python 每次启动都会随机化。"""
    digest = hashlib.sha256(os.path.abspath(BASE).encode("utf-8")).hexdigest()
    return "PromptEnhancerInstance_" + digest[:16]


# ---------- 剪贴板 ----------

def clip_get():
    if not user32.OpenClipboard(None):
        return None
    try:
        h = user32.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return None
        p = kernel32.GlobalLock(h)
        if not p:
            return None
        try:
            return ctypes.wstring_at(p)
        finally:
            kernel32.GlobalUnlock(h)
    finally:
        user32.CloseClipboard()


def clip_has_text():
    if not user32.OpenClipboard(None):
        return False
    try:
        return bool(user32.IsClipboardFormatAvailable(CF_UNICODETEXT))
    finally:
        user32.CloseClipboard()


def clip_set(text):
    if not user32.OpenClipboard(None):
        return False
    try:
        user32.EmptyClipboard()
        buf = ctypes.create_unicode_buffer(text)
        size = ctypes.sizeof(buf)
        h = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        if not h:
            return False
        p = kernel32.GlobalLock(h)
        ctypes.memmove(p, buf, size)
        kernel32.GlobalUnlock(h)
        return bool(user32.SetClipboardData(CF_UNICODETEXT, h))
    finally:
        user32.CloseClipboard()


# ---------- 键鼠 / 前台窗口 ----------

def key(vk, up=False):
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP if up else 0, 0)


def ctrl_key(vk):
    key(VK_CONTROL)
    key(vk)
    key(vk, True)
    key(VK_CONTROL, True)


def foreground_exe():
    """返回 (进程文件名, 完整路径, 窗口句柄, PID)。"""
    hwnd = user32.GetForegroundWindow()
    pid = w.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    h = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return "", "", hwnd, pid.value
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = w.DWORD(1024)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            path = buf.value
            return os.path.basename(path), path, hwnd, pid.value
    finally:
        kernel32.CloseHandle(h)
    return "", "", hwnd, pid.value


def focused_control_info():
    """一次轻量查询当前线程的焦点控件；失败时返回空信息。"""
    try:
        hwnd = user32.GetForegroundWindow()
        pid = w.DWORD()
        thread_id = user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not thread_id:
            return {"hwnd": 0, "focus": 0, "caret": 0, "caret_ok": False}
        gui_info = GUITHREADINFO()
        gui_info.cbSize = ctypes.sizeof(GUITHREADINFO)
        if not user32.GetGUIThreadInfo(thread_id, ctypes.byref(gui_info)):
            return {"hwnd": hwnd, "focus": 0, "caret": 0, "caret_ok": False}
        caret_ok = bool(
            gui_info.hwndCaret
            and (gui_info.rcCaret.right > gui_info.rcCaret.left)
            and (gui_info.rcCaret.bottom > gui_info.rcCaret.top)
        )
        return {
            "hwnd": hwnd,
            "focus": gui_info.hwndFocus,
            "caret": gui_info.hwndCaret,
            "caret_ok": caret_ok,
        }
    except Exception:
        return {"hwnd": 0, "focus": 0, "caret": 0, "caret_ok": False}


def process_parent(pid):
    now = time.time()
    if pid in _PROC_CACHE and now - _PROC_CACHE[pid][1] < 2.0:
        return _PROC_CACHE[pid][0]
    try:
        import subprocess

        flags = 0x08000000  # CREATE_NO_WINDOW
        out = subprocess.check_output(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_Process -Filter 'ProcessId=%d').ParentProcessId" % pid,
            ],
            text=True,
            timeout=2,
            creationflags=flags,
        ).strip()
        value = int(out) if out.isdigit() else 0
        _PROC_CACHE[pid] = (value, now)
        return value
    except Exception:
        return 0


def process_name(pid):
    now = time.time()
    key = ("name", pid)
    if key in _PROC_CACHE and now - _PROC_CACHE[key][1] < 2.0:
        return _PROC_CACHE[key][0]
    try:
        import subprocess

        flags = 0x08000000
        out = subprocess.check_output(
            [
                "tasklist.exe",
                "/FI",
                "PID eq %d" % pid,
                "/FO",
                "CSV",
                "/NH",
            ],
            text=True,
            timeout=2,
            creationflags=flags,
        ).strip()
        if out.startswith('"'):
            name = out.split('","', 1)[0].strip('"')
            _PROC_CACHE[key] = (name, now)
            return name
    except Exception:
        pass
    return ""


def window_owner(exe, allow=(), exe_path="", pid=0):
    """Electron/终端窗口可能落在辅助进程上，沿父链找真正的宿主。"""
    if not exe:
        return ""
    allow_set = {str(p).lower() for p in allow}
    if not allow_set:
        allow_set = _ALLOW_CACHE
    if exe.lower() in allow_set:
        return exe
    if exe_path and exe_path.lower() in allow_set:
        return exe_path
    now = time.time()
    cache_key = ("window", exe.lower(), pid)
    if cache_key in _PROC_CACHE:
        return _PROC_CACHE[cache_key][0]
    current = pid
    try:
        import subprocess

        out = subprocess.check_output(
            ["tasklist.exe", "/FI", "IMAGENAME eq " + exe, "/FO", "CSV", "/NH"],
            text=True,
            timeout=2,
            creationflags=0x08000000,
        )
        for line in out.splitlines():
            cols = [c.strip('"') for c in line.split('","')]
            if len(cols) >= 2 and cols[1].isdigit():
                current = int(cols[1])
                break
    except Exception:
        return exe
    seen = set()
    for _ in range(6):
        if not current or current in seen:
            break
        seen.add(current)
        parent = process_parent(current)
        if not parent:
            break
        name = process_name(parent)
        if name and name.lower() in allow_set:
            _PROC_CACHE[cache_key] = (name, now)
            return name
        current = parent
    _PROC_CACHE[cache_key] = (exe, now)
    return exe


def is_allowed_window(cfg):
    exe, exe_path, _, pid = foreground_exe()
    allow = [str(p).lower() for p in cfg["allowed_processes"]]
    if (exe or "").lower() in allow or (exe_path or "").lower() in allow:
        return exe, exe_path, pid, True
    owner = window_owner(exe, cfg["allowed_processes"], exe_path, pid)
    return owner, exe_path, pid, (owner or "").lower() in allow


def raise_process_priority():
    try:
        handle = kernel32.GetCurrentProcess()
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        kernel32.SetPriorityClass.argtypes = (ctypes.c_void_p, w.DWORD)
        kernel32.SetPriorityClass(handle, 0x00000080)  # HIGH_PRIORITY_CLASS
    except Exception:
        pass


# ---------- 增强 ----------

def load_core():
    """读取共享规则并按 [SECTION] 拆分，入口只组装所需部分。"""
    try:
        with open(CORE_PATH, encoding="utf-8") as f:
            raw = f.read()
    except OSError as e:
        raise RuntimeError("共享规则缺失或不可读：%s" % CORE_PATH) from e

    sections = {}
    current = None
    body = []
    for line in raw.splitlines():
        match = re.fullmatch(r"## \[([A-Z]+)\]", line.strip())
        if match:
            if current:
                sections[current] = "\n".join(body).strip()
            current = match.group(1)
            body = []
        elif current:
            body.append(line)
    if current:
        sections[current] = "\n".join(body).strip()
    for required in (
        "COMMON",
        "BASE",
        "STANDARD",
        "PROFESSIONAL",
        "SYSTEM",
        "ITERATE",
    ):
        if not sections.get(required):
            raise RuntimeError("共享规则缺少 [%s] 段" % required)
    return sections


def build_system_prompt(mode, iteration=False, iteration_request="", tier="standard"):
    sections = load_core()
    parts = [sections["COMMON"]]
    if mode == "system" or tier == "system":
        parts.append(sections["SYSTEM"])
    else:
        parts.append(sections[tier.upper()])
    if iteration:
        parts.append(sections["ITERATE"])
    prompt = "\n\n".join(part for part in parts if part)
    if iteration:
        request = (iteration_request or "").strip() or "仅做必要的保守改进，不改变原意。"
        prompt += (
            "\n\n<iteration_request>\n"
            + request
            + "\n</iteration_request>\n"
        )
    return prompt


def split_iteration_request(text):
    """从末尾提取 @iter: 块，返回 (正文, 迭代要求, 是否显式迭代)。"""
    match = ITER_BLOCK.search(text)
    if not match:
        return text, "", False
    return text[:match.start()].rstrip(), match.group("body").strip(), True


def parse_default_command(text):
    """解析 $p 默认/切换默认，返回档位；无档位返回空串，不是该命令返回 None。"""
    match = SWITCH_DEFAULT_RE.fullmatch((text or "").strip())
    if not match:
        return None
    raw_tier = match.group("tier")
    return resolve_default_tier(raw_tier) or "" if raw_tier else ""


def detect_mode(text):
    lowered = text.lower()
    for signal in SYSTEM_STRONG_SIGNALS:
        if signal in lowered:
            return "system"
    role_patterns = (
        r"你(?:是|担任|将作为).{0,30}(?:角色|助手|专家|审查员|评审员|工程师|老师)",
        r"你的(?:角色|身份|职责).{0,20}(?:是|为)",
    )
    for pattern in role_patterns:
        if re.search(pattern, text):
            return "system"
    return "user"


def detect_tier(text, default="standard"):
    if re.match(
        r"^\s*(?:sys|system|系统)\s*[:：]\s*",
        text,
        re.IGNORECASE,
    ):
        return "system"
    if TIER_SIGNALS.search(text):
        return "professional"
    return default


def strip_tier_prefix(text):
    match = TIER_PREFIX.match(text)
    if not match:
        return text, None
    word = match.group("tier").lower()
    return text[match.end():], TIER_ALIASES.get(word)


def parse_controls(text, default_tier="standard"):
    """解析开头的类型/档位前缀，返回正文、类型、档位与冲突说明。"""
    body = text
    explicit_mode = None
    explicit_tier = None

    while body.strip():
        type_match = USER_PREFIX.match(body) or SYSTEM_PREFIX.match(body)
        if type_match and explicit_mode is None:
            explicit_mode = (
                "system" if type_match.re is SYSTEM_PREFIX else "user"
            )
            body = body[type_match.end():]
            continue

        tier_match = TIER_PREFIX.match(body)
        if tier_match and explicit_tier is None:
            word = tier_match.group("tier").lower()
            explicit_tier = TIER_ALIASES.get(word)
            body = body[tier_match.end():]
            continue
        break

    auto_mode = detect_mode(body)
    mode = explicit_mode or auto_mode
    tier = explicit_tier or detect_tier(body, default_tier)
    conflict = None
    if mode == "system" and explicit_tier:
        conflict = "系统类型不能与基础、标准或专业档位同时使用"
    elif mode == "system":
        tier = "system"
    return {
        "body": body.strip(),
        "mode": mode,
        "tier": tier,
        "conflict": conflict,
    }


def protect_skills(text):
    tokens = []

    def replace(match):
        tokens.append(match.group(0))
        name = re.sub(r"[^A-Za-z0-9]", "_", match.group("name"))
        return "__PO_SKILL_%04d_%s__" % (len(tokens), name)

    protected = SKILL_TOKEN.sub(replace, text)
    return protected, tokens


def restore_skills(text, tokens):
    def replace(match):
        index = int(match.group(1)) - 1
        if 0 <= index < len(tokens):
            return tokens[index]
        return match.group(0)

    return re.sub(r"__PO_SKILL_(\d{4})_[A-Za-z0-9_]+__", replace, text)


def skill_placeholders(text):
    return sorted(re.findall(r"__PO_SKILL_\d{4}_[A-Za-z0-9_]+__", text))


def only_skill_tokens(text):
    """判断草稿除去 skill token 与空白后是否为空。"""
    stripped = SKILL_TOKEN.sub("", text or "")
    return not stripped.strip()


def literals(text):
    """提取必须原样保留的 URL、路径和数字，用于替换前安全检查。"""
    groups = []
    for pattern in (URL_PATTERN, WIN_PATH_PATTERN, UNIX_PATH_PATTERN, NUMBER_PATTERN):
        groups.extend(pattern.findall(text))
    return groups


def validate_output(source, output, mode, iteration, tokens, tier="standard"):
    problems = []
    if not (output or "").strip():
        return ["输出为空"]
    expected = skill_placeholders(source)
    actual = skill_placeholders(output)
    if expected != actual:
        problems.append("Skill token 不完整")
    if "__PO_SKILL_" in output and not expected:
        problems.append("出现未知 Skill 占位符")

    source_plain = restore_skills(source, tokens)
    output_plain = restore_skills(output, tokens)
    missing = []
    for item in literals(source_plain):
        if item not in output_plain and item not in missing:
            missing.append(item)
    if missing:
        preview = "、".join(missing[:3])
        problems.append("丢失关键内容：%s" % preview)

    if iteration:
        limit = max(len(source) * 1.6, len(source) + 200, 900)
        if len(output) > limit:
            problems.append("迭代后篇幅膨胀")
    elif mode == "system" and len(output) < len(source):
        problems.append("系统提示词异常变短")
    if tier == "base" and any(
        phrase in output for phrase in BASE_REQUESTING_PHRASES
    ):
        problems.append("基础档索要了原文没有的材料")
    if tier == "base":
        limit = max(len(source) * 1.5, len(source) + 120)
        if len(output) > limit:
            problems.append("基础档扩写了正文")
    if not iteration and tier == "standard":
        if re.search(r"(?m)^\s*(?:#{1,6}\s+|\*\*[^*]+\*\*\s*$|[-*+]\s+)", output):
            problems.append("标准档输出成了结构化内容")
    if not iteration and tier == "professional":
        headings = re.findall(r"(?m)^\*\*([^*]+)\*\*\s*$", output)
        required = {
            "任务目标",
            "背景与范围",
            "执行要求",
            "约束条件",
            "交付要求",
        }
        if not required.issubset(set(headings)):
            problems.append("专业档缺少五段固定标题")
    if not iteration and mode == "system":
        system_sections = (
            ("角色定位", ("角色定位", "你是", "你的角色", "担任")),
            ("核心目标", ("核心目标", "目标", "最重要")),
            ("工作原则", ("工作原则", "工作优先级", "优先级")),
            ("规则约束", ("规则与约束", "规则", "约束", "必须", "禁止")),
            ("能力边界", ("能力与知识边界", "能力边界", "知识边界", "不确定")),
            ("输入处理", ("输入处理", "信息不足", "澄清", "缺失")),
            ("输出规范", ("输出规范", "输出格式", "格式", "引用")),
            ("异常自检", ("异常处理", "自检", "失败", "冲突")),
        )
        matched = sum(
            1
            for _, signals in system_sections
            if any(signal in output for signal in signals)
        )
        if matched < 6:
            problems.append("系统提示词结构不完整")
    return problems


def mask_secrets(text):
    patterns = (
        (r"\bsk-[A-Za-z0-9_-]{16,}\b", "[REDACTED_KEY]"),
        (r"\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b", "[REDACTED_TOKEN]"),
        (r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{16,}", r"\1 [REDACTED]"),
        (r"(?i)\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]{8,}", r"\1=[REDACTED]"),
    )
    result = text
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result)
    return result


def save_text(path, text):
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text.rstrip() + "\n")
    except OSError:
        pass


def load_last_state():
    """读取上一版档位与模式；状态文件损坏时返回空状态。"""
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            state = json.load(f)
        if not isinstance(state, dict):
            return {}
        if state.get("tier") not in ("base", "standard", "professional", "system"):
            state.pop("tier", None)
        if state.get("mode") not in ("user", "system"):
            state.pop("mode", None)
        return state
    except (OSError, ValueError):
        return {}


def save_last_state(mode, tier):
    payload = {"mode": mode, "tier": tier}
    try:
        tmp = STATE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, STATE_PATH)
    except OSError as e:
        log("状态写入失败: %r" % e)


def append_history(record, cfg):
    record = dict(record)
    record["created_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    record["original"] = mask_secrets(record.get("original", ""))
    record["enhanced"] = mask_secrets(record.get("enhanced", ""))
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))

    max_entries = max(1, int(cfg.get("history_max_entries", 5)))
    max_bytes = max(4096, int(cfg.get("history_max_bytes", 65536)))

    try:
        rows = []
        if os.path.exists(HISTORY_PATH):
            with open(HISTORY_PATH, encoding="utf-8") as f:
                for raw in f:
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        rows.append(json.loads(raw))
                    except json.JSONDecodeError:
                        continue
        rows.append(record)
        rows = rows[-max_entries:]

        while rows:
            payload = "".join(
                json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                for row in rows
            )
            size = len(payload.encode("utf-8"))
            if size <= max_bytes:
                break
            rows.pop(0)

        with open(HISTORY_PATH, "w", encoding="utf-8") as f:
            f.write(payload)
        log(
            "history: entries=%d bytes=%d"
            % (len(rows), len(payload.encode("utf-8")))
        )
    except OSError as e:
        log("history write failed: %r" % e)


def clean(text):
    out = (text or "").strip()
    if out.startswith("```") and out.endswith("```"):
        out = out.strip("`")
        if "\n" in out:
            out = out.split("\n", 1)[1].rsplit("\n", 1)[0]
    for prefix in ("以下是", "优化结果如下", "修改后的内容", "改写结果", "增强结果"):
        if out.startswith(prefix):
            out = out.split("\n", 1)[-1].strip()
            break
    return out.strip()


def api_key(cfg):
    name = cfg.get("api_key_env") or "DEEPSEEK_API_KEY"
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError("环境变量 %s 未设置" % name)
    return value


def direct_urlopen(req, timeout):
    """官方 API 直连，避免继承失效的 HTTP(S)_PROXY 环境变量。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(req, timeout=timeout)


def usage_cost(usage):
    """按 DeepSeek 官方 Flash 空闲/高峰未命中价估算，仅作日志参考。"""
    if not usage:
        return None
    prompt = usage.get("prompt_tokens", 0)
    completion = usage.get("completion_tokens", 0)
    missed = usage.get("prompt_cache_miss_tokens", prompt)
    hit = usage.get("prompt_cache_hit_tokens", 0)
    return (missed * 1.0 + hit * 0.02 + completion * 4.0) / 1_000_000


def enhance(protected, cfg, mode="user", iteration=False, iteration_request="", tier="base"):
    provider = provider_settings(cfg)
    req_cfg = {
        "model": cfg["model"],
        "messages": [
            {
                "role": "system",
                "content": build_system_prompt(
                    mode, iteration, iteration_request, tier
                ),
            },
            {"role": "user", "content": protected},
        ],
        "max_tokens": (
            cfg.get("max_tokens_professional", 1200)
            if tier == "professional"
            else cfg.get("max_tokens_standard", cfg["max_tokens"])
            if tier == "standard"
            else cfg.get("max_tokens_system", 1200)
            if tier == "system"
            else cfg.get("max_tokens_base", cfg["max_tokens"])
        ),
        "temperature": cfg["temperature"],
    }
    if cfg.get("reasoning_effort"):
        req_cfg["reasoning_effort"] = cfg["reasoning_effort"]

    body = json.dumps(req_cfg, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        cfg["gateway"],
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key(cfg),
        },
        method="POST",
    )
    try:
        with direct_urlopen(req, timeout=cfg["timeout"]) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError("API HTTP %s: %s" % (e.code, detail)) from e
    except urllib.error.URLError as e:
        raise RuntimeError("API 连接失败: %s" % (e.reason,)) from e
    except TimeoutError as e:
        raise RuntimeError("API 请求超时") from e

    usage = payload.get("usage") or {}
    cost = usage_cost(usage) if provider.get("pricing") == "deepseek-flash" else None
    if usage:
        if cost is None:
            log(
                "tokens: prompt=%s completion=%s total=%s cached=%s cost=unknown"
                % (
                    usage.get("prompt_tokens", "?"),
                    usage.get("completion_tokens", "?"),
                    usage.get("total_tokens", "?"),
                    usage.get("prompt_cache_hit_tokens", 0),
                )
            )
        else:
            log(
                "tokens: prompt=%s completion=%s total=%s cached=%s est_yuan=%.6f"
                % (
                    usage.get("prompt_tokens", "?"),
                    usage.get("completion_tokens", "?"),
                    usage.get("total_tokens", "?"),
                    usage.get("prompt_cache_hit_tokens", 0),
                    cost,
                )
            )
    return extract_api_content(payload), usage


def extract_api_content(payload):
    """从 API 响应中取出可用文本，并拒绝空内容或截断结果。"""
    try:
        choice = payload["choices"][0]
        content = (choice.get("message") or {}).get("content")
    except (KeyError, IndexError, TypeError, AttributeError) as e:
        raise RuntimeError("API 响应结构异常") from e
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("API 未返回可用内容")
    if choice.get("finish_reason") == "length":
        raise RuntimeError("API 输出被截断，请调高对应档位 max_tokens")
    return content


# ---------- 常驻 / 热键 ----------

def parse_hotkey(spec):
    mods, vk = set(), None
    for part in str(spec).lower().split("+"):
        part = part.strip()
        if part in ("ctrl", "control"):
            mods.add("ctrl")
        elif part in ("alt", "menu"):
            mods.add("alt")
        elif part == "shift":
            mods.add("shift")
        elif part in ("win", "meta"):
            mods.add("win")
        elif part.startswith("f") and part[1:].isdigit() and 1 <= int(part[1:]) <= 24:
            vk = 0x70 + int(part[1:]) - 1
        elif len(part) == 1:
            vk = ord(part.upper())
    if vk is None:
        mods, vk = {"ctrl", "shift", "alt"}, 0x41
    return mods, vk


def mods_down():
    down = set()
    if user32.GetAsyncKeyState(VK_CONTROL) & 0x8000:
        down.add("ctrl")
    if user32.GetAsyncKeyState(VK_SHIFT) & 0x8000:
        down.add("shift")
    if (user32.GetAsyncKeyState(VK_MENU) | user32.GetAsyncKeyState(0xA4) | user32.GetAsyncKeyState(0xA5)) & 0x8000:
        down.add("alt")
    if (user32.GetAsyncKeyState(VK_LWIN) | user32.GetAsyncKeyState(VK_RWIN)) & 0x8000:
        down.add("win")
    return down


def wait_mods_released(timeout=1.2):
    """触发键还按着时注入 Ctrl+A 会变成同一组合键，先等用户松手。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not mods_down():
            return True
        time.sleep(0.02)
    # 松开事件丢失时只补抬起，不强行发 Ctrl+Shift 等组合键。
    for vk in (VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, 0xA4, 0xA5):
        key(vk, True)
    return False


def make_proc(events, req_mods, req_vk):
    state = {"vk_down": False}

    def proc(code, wparam, lparam):
        if code == 0 and wparam in (WM_KEYDOWN, WM_SYSKEYDOWN):
            kb = ctypes.cast(lparam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if kb.vkCode == req_vk and req_mods.issubset(mods_down()) and not state["vk_down"]:
                # 每次触发重新读取白名单，避免改配置后必须重启增强进程。
                _, _, _, allowed = is_allowed_window(load_config())
                if allowed:
                    log("检测到组合键: %s mods=%s" % (kb.vkCode, ",".join(sorted(mods_down()))))
                    state["vk_down"] = True
                    # 修饰键还按着时，抓取交给后台线程等待松手
                    events.put(("hotkey", True))
                return user32.CallNextHookEx(None, code, wparam, lparam)  # 不吞键
        elif code == 0 and wparam in (WM_KEYUP, WM_SYSKEYUP):
            kb = ctypes.cast(lparam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if kb.vkCode == req_vk:
                state["vk_down"] = False
        return user32.CallNextHookEx(None, code, wparam, lparam)

    return LowLevelKeyboardProc(proc)


def hotkey_thread(events, cfg):
    global _HOOK, _HOOK_PROC, _ALLOW_CACHE
    mods, vk = parse_hotkey(cfg["hotkey"])
    _ALLOW_CACHE = {p.lower() for p in cfg["allowed_processes"] if "\\" not in p}
    _HOOK_PROC = make_proc(events, mods, vk)
    _HOOK = user32.SetWindowsHookExW(WH_KEYBOARD_LL, _HOOK_PROC, None, 0)
    if not _HOOK:
        log("键盘钩子安装失败: %s" % ctypes.get_last_error())
        events.put(("status", "快捷键监听失败，见 log.txt"))
        return
    log("钩子就绪: %s" % cfg["hotkey"])
    msg = w.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))


def system_hotkey_thread(events, cfg):
    """RegisterHotKey 通道：不依赖低级钩子，也不会丢松开事件。"""
    msg = w.MSG()
    user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 0)  # 建立线程消息队列
    mods, vk = parse_hotkey(cfg["hotkey"])
    native_mods = 0
    if "alt" in mods:
        native_mods |= MOD_ALT
    if "ctrl" in mods:
        native_mods |= MOD_CONTROL
    if "shift" in mods:
        native_mods |= MOD_SHIFT
    native_mods |= MOD_NOREPEAT
    if not user32.RegisterHotKey(None, HOTKEY_ID, native_mods, vk):
        log("RegisterHotKey 失败: %s（回退低级钩子）" % ctypes.get_last_error())
        hotkey_thread(events, cfg)
        return
    log("系统热键已注册: %s" % cfg["hotkey"])
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
            _, _, _, allowed = is_allowed_window(load_config())
            if allowed:
                log("系统热键触发")
                events.put(("hotkey", True))
            else:
                log("系统热键触发但窗口不在白名单，静默跳过")
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))


def warm_process_cache():
    hotkey_cfg = load_config()
    while True:
        try:
            is_allowed_window(hotkey_cfg)
        except Exception:
            pass
        time.sleep(0.25)


def snapshot_selection(backup=None):
    """全选并复制输入框；重试时沿用第一次抓取前的剪贴板备份。"""
    if backup is None:
        backup = clip_get()
    elif clip_get() is not None:
        clip_set(backup)
    if not clip_set(""):
        log("剪贴板不可写，放弃本次增强")
        return backup, ""
    if load_config().get("select_all", True):
        ctrl_key(VK_A)
        time.sleep(0.05)
    ctrl_key(VK_C)
    draft = ""
    for _ in range(20):
        time.sleep(0.05)
        if clip_has_text():
            draft = clip_get() or ""
            if draft.strip():
                break
    return backup, draft


def prepare_draft(draft):
    """解析模式、迭代要求和 Skill token，返回可发送的草稿。"""
    body, iteration_request, explicit_iteration = split_iteration_request(draft)
    default_tier = load_config().get("default_tier", "standard")
    controls = parse_controls(body, default_tier)

    previous = ""
    try:
        with open(LAST_PATH, encoding="utf-8") as f:
            previous = f.read().rstrip("\r\n")
    except OSError:
        pass

    auto_iteration = bool(previous) and body.strip() == previous.strip()
    iteration = explicit_iteration or auto_iteration
    mode = controls["mode"]
    tier = controls["tier"]
    if iteration and not explicit_iteration:
        state = load_last_state()
        if state.get("mode"):
            mode = state["mode"]
        if state.get("tier"):
            tier = state["tier"]
    if tier == "system" and not controls["conflict"]:
        mode = "system"

    return {
        "body": controls["body"],
        "iteration_request": iteration_request,
        "explicit_iteration": explicit_iteration,
        "mode": mode,
        "tier": tier,
        "auto_iteration": auto_iteration,
        "iteration": iteration,
        "conflict": controls["conflict"],
    }


def _worker(cfg, events, hwnd0, backup, draft, restore_clip=True):
    keep_clip = False
    out = None
    try:
        if not draft.strip():
            log("草稿为空，放弃")
            events.put(("failure", "输入框没抓到内容，检查是否有草稿"))
            return
        log("抓到草稿 %d 字" % len(draft))

        prepared = prepare_draft(draft)
        body = prepared["body"]
        if prepared.get("conflict"):
            log("类型/档位冲突：%s" % prepared["conflict"])
            events.put(("failure", prepared["conflict"]))
            return
        if not body.strip():
            log("草稿为空或只剩元指令，放弃")
            events.put(("failure", "没有可增强的提示词正文"))
            return

        previous = ""
        try:
            with open(LAST_PATH, encoding="utf-8") as f:
                previous = f.read().rstrip("\r\n")
        except OSError:
            pass
        iteration = prepared.get("iteration", False)
        if prepared["explicit_iteration"] and not previous:
            log("@iter: 无上一版，放弃")
            events.put(("failure", "没有可迭代的上一版，已保留当前文本"))
            return

        mode = prepared["mode"]
        tier = prepared["tier"]
        label = "迭代" if iteration else ("系统" if mode == "system" else "增强")
        label = TIER_LABELS.get(tier, "系统") + ("迭代" if iteration else "增强")
        protected, tokens = protect_skills(body)
        events.put(("status", "%s中… %d 字" % (label, len(body))))
        t0 = time.time()
        usage = {}
        try:
            raw, usage = enhance(
                protected,
                cfg,
                mode=mode,
                iteration=iteration,
                iteration_request=prepared["iteration_request"],
                tier=tier,
            )
        except Exception as e:
            print("增强失败：%s" % e, file=sys.stderr)
            log("增强失败: %r" % e)
            events.put(("failure", "增强失败：%s" % e))
            return 1
        out = clean(raw)
        problems = validate_output(
            protected, out, mode, iteration, tokens, tier
        )
        if not out:
            events.put(("failure", "模型没返回内容"))
            return

        if problems:
            reason = "；".join(problems)
            log("结果未通过保护检查：%s" % reason)
            events.put(
                (
                    "failure",
                    "%s未通过保护检查，已保留原文本%s"
                    % (label, ("：" + reason) if len(reason) <= 36 else ""),
                )
            )
            return

        out = restore_skills(out, tokens)
        save_text(ORIGINAL_PATH, draft)
        save_text(LAST_PATH, out)
        save_last_state(mode, tier)
        append_history(
            {
                "mode": mode,
                "tier": tier,
                "iteration": iteration,
                "iteration_request": prepared["iteration_request"],
                "original": draft,
                "enhanced": out,
                "tokens": usage.get("total_tokens", 0),
            },
            cfg,
        )
        if not clip_set(out):
            log("写入剪贴板失败")
            events.put(("failure", "结果已生成，但写入剪贴板失败"))
            return

        # 提示窗可能抢了焦点，粘贴前把目标窗口拉回前台
        user32.SetForegroundWindow(hwnd0)
        time.sleep(0.12)
        _, _, hwnd_now, _ = foreground_exe()
        if hwnd_now != hwnd0:
            keep_clip = True
            events.put(
                ("failure", "焦点已切换，结果留在剪贴板（%d 字）" % len(out))
            )
            log("焦点变化，跳过粘贴")
            return
        time.sleep(0.05)
        ctrl_key(VK_V)
        time.sleep(0.25)
        log("已粘贴到原窗口")
        events.put(
            (
                "status",
                "%s完成 %.1fs · %d→%d 字 · Ctrl+Z 可撤销"
                % (label, time.time() - t0, len(draft), len(out)),
            )
        )
        log("增强完成 %.1fs %d->%d 字" % (time.time() - t0, len(draft), len(out)))
    except Exception as e:
        log("失败: %r" % e)
        events.put(("failure", "失败：%s" % e))
    finally:
        if restore_clip and backup is not None and not keep_clip:
            time.sleep(0.3)
            current = clip_get()
            if current is None or current == out or not current.strip():
                clip_set(backup)  # 只还原自己留下的剪贴板，避免覆盖用户新复制


def run_pipeline(cfg, events, use_keys=True, _locked=False):
    if not _locked:
        if not _PIPELINE_LOCK.acquire(blocking=False):
            log("已有增强流程进行中，忽略重复触发")
            return
        try:
            return run_pipeline(cfg, events, use_keys, True)
        finally:
            _PIPELINE_LOCK.release()
    time.sleep(0.05)
    exe, _, hwnd0, _ = foreground_exe()
    log("触发: 前台=%s hwnd=%s" % (exe or "?", hwnd0))
    # RegisterHotKey 是主通道，白名单也必须在每次触发时读取最新配置。
    hotkey_cfg = load_config()
    problems = config_problems(hotkey_cfg)
    if problems:
        message = "配置无效，未读取或发送草稿：" + "；".join(problems)
        log(message)
        events.put(("failure", message))
        return
    owner, _, _, allowed = is_allowed_window(hotkey_cfg)
    if use_keys and not allowed:
        log("跳过：前台窗口是 %s（不在白名单）" % (owner or exe or "?"))
        events.put(
            ("failure", "当前窗口是 %s，不在白名单，已跳过" % (owner or exe or "?"))
        )
        return

    if use_keys:
        focus = focused_control_info()
        log(
            "焦点: hwnd=%s focus=%s caret=%s"
            % (focus["hwnd"], focus["focus"], focus["caret"])
        )
        if not focus["focus"] and not focus["caret_ok"]:
            log("焦点信息不可用，回退为白名单窗口抓取")
        # RegisterHotKey 触发时修饰键通常还按着；先等松开再发 Ctrl+A/Ctrl+C。
        wait_mods_released()
        time.sleep(0.03)
        focus = focused_control_info()
        if not focus["focus"] and not focus["caret_ok"]:
            log("松开修饰键后焦点信息仍不可用，继续按白名单和抓取结果回退")
        backup, draft = snapshot_selection()
        if not draft.strip():
            log("首次抓取为空，重试全选复制")
            backup, draft = snapshot_selection(backup)
        if not draft.strip():
            log("未抓到文本，判定当前焦点不是可编辑输入框")
            events.put(
                (
                    "failure",
                    "当前焦点不在可编辑输入框，未找到可增强的文本",
                )
            )
            return
        default_tier = parse_default_command(draft)
        if default_tier is not None:
            try:
                if default_tier:
                    events.put(("set_default", default_tier))
                else:
                    events.put(("choose_default", True))
            finally:
                if backup is not None:
                    clip_set(backup)
            return
        if only_skill_tokens(draft):
            if backup is not None:
                clip_set(backup)
            events.put(
                (
                    "failure",
                    "只有 Skill 调用，没有可增强的正文",
                )
            )
            return
        def start_worker():
            try:
                _worker(hotkey_cfg, events, hwnd0, backup, draft, True)
            except Exception as e:
                log("工作线程异常: %r" % e)
                events.put(("failure", "失败：%s" % e))

        threading.Thread(target=start_worker, daemon=True).start()
        return

    backup = clip_get()
    _worker(hotkey_cfg, events, hwnd0, backup, backup or "", False)


def resolve_default_tier(value):
    value = str(value or "").lower()
    mapped = TIER_ALIASES.get(value)
    if mapped == "professional" and value not in (
        "professional",
        "pro",
        "专业",
    ):
        return None
    if mapped == "standard" and value not in (
        "standard",
        "std",
        "标准",
    ):
        return None
    return mapped


def set_default_tier(tier):
    """通过共享设置脚本持久化默认档，失败时抛异常。"""
    if tier not in DEFAULT_TIERS:
        raise ValueError("默认档只能是基础、标准或专业")
    import subprocess

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    result = subprocess.run(
        [sys.executable, SET_DEFAULT_PATH, tier, "--json"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
        creationflags=0x08000000,
        env=env,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "设置失败").strip()
        raise RuntimeError(detail[:200])
    return json.loads(result.stdout)


def toast_loop(events, cfg):
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    box = {"win": None, "after": None}
    picker = {"win": None, "after": None}

    def show(text, seconds=2.6):
        hide_default_picker()
        if box["win"] is not None:
            try:
                box["win"].destroy()
            except tk.TclError:
                pass
        win = tk.Toplevel(root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        try:
            win.attributes("-disabled", True)  # Windows: 不吃焦点、不响应点击
        except tk.TclError:
            pass
        win.configure(bg="#111111")
        tk.Label(
            win, text=text, bg="#111111", fg="#f2f2f2",
            font=("Microsoft YaHei UI", 10), padx=14, pady=8,
        ).pack()
        win.update_idletasks()
        sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
        win.geometry("+%d+%d" % (sw // 2 - win.winfo_width() // 2, int(sh * 0.16)))
        box["win"] = win
        if box["after"]:
            root.after_cancel(box["after"])
        box["after"] = root.after(int(seconds * 1000), hide)

    def hide():
        if box["win"] is not None:
            try:
                box["win"].destroy()
            except tk.TclError:
                pass
            box["win"] = None

    def hide_default_picker():
        if picker["win"] is not None:
            try:
                picker["win"].destroy()
            except tk.TclError:
                pass
            picker["win"] = None
        if picker["after"]:
            root.after_cancel(picker["after"])
            picker["after"] = None

    def cancel_default():
        hide_default_picker()
        show("已取消切换默认档")

    def apply_default(tier):
        try:
            result = set_default_tier(tier)
            hide_default_picker()
            show("默认档已切换为%s" % result["label"])
        except Exception as e:
            hide_default_picker()
            show("设置默认档失败：%s" % e, seconds=5)

    def choose_default():
        if picker["win"] is not None:
            try:
                picker["win"].destroy()
            except tk.TclError:
                pass
            picker["win"] = None
        win = tk.Toplevel(root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        win.configure(bg="#111111")
        tk.Label(
            win, text="选择默认档位", bg="#111111", fg="#f2f2f2",
            font=("Microsoft YaHei UI", 10), padx=14, pady=7,
        ).pack(fill="x")
        for index, (tier, label) in enumerate(
            (
                ("base", "1  基础"),
                ("standard", "2  标准"),
                ("professional", "3  专业"),
            ),
            start=1,
        ):
            button = tk.Button(
                win,
                text=label,
                anchor="w",
                bg="#1d1d1d",
                fg="#f2f2f2",
                activebackground="#2a2a2a",
                activeforeground="#ffffff",
                relief="flat",
                font=("Microsoft YaHei UI", 10),
                padx=18,
                pady=5,
                command=lambda value=tier: apply_default(value),
            )
            button.pack(fill="x", padx=8, pady=(0, 4))
        tk.Label(
            win, text="数字键选择 · Esc 取消", bg="#111111", fg="#9c9c9c",
            font=("Microsoft YaHei UI", 8), padx=10, pady=4,
        ).pack(fill="x")
        win.update_idletasks()
        sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
        win.geometry(
            "+%d+%d" % (sw // 2 - win.winfo_width() // 2, int(sh * 0.16))
        )
        picker["win"] = win
        win.bind("<Escape>", lambda _event: cancel_default())
        win.bind("1", lambda _event: apply_default("base"))
        win.bind("2", lambda _event: apply_default("standard"))
        win.bind("3", lambda _event: apply_default("professional"))
        win.focus_force()

    def poll():
        try:
            while True:
                kind, payload = events.get_nowait()
                if kind == "hotkey":
                    threading.Thread(
                        target=run_pipeline, args=(cfg, events, True), daemon=True
                    ).start()
                elif kind == "status":
                    show(payload)
                elif kind == "failure":
                    show(str(payload), seconds=5)
                elif kind == "choose_default":
                    choose_default()
                elif kind == "set_default":
                    if payload in DEFAULT_TIERS:
                        apply_default(payload)
                    else:
                        show("默认档只能是基础、标准或专业", seconds=5)
        except queue.Empty:
            pass
        root.after(120, poll)

    threading.Thread(target=system_hotkey_thread, args=(events, cfg), daemon=True).start()
    threading.Thread(target=warm_process_cache, daemon=True).start()
    root.after(120, poll)
    root.mainloop()


def standalone_listener(events, cfg):
    """在独立进程里监听，避免 Tk/Windows 应用消息循环影响低级钩子。"""
    listener = os.path.join(BASE, "listener.py")
    if not os.path.exists(listener):
        return False
    try:
        import subprocess

        log("启动独立监听进程")
        subprocess.Popen(
            [sys.executable.replace("pythonw.exe", "python.exe"), listener],
            cwd=BASE,
            creationflags=0x08000000,
        )
        return True
    except Exception as e:
        log("独立监听启动失败: %r" % e)
        return False


def parse_cli_args(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", metavar="DRAFT", help="只调接口，打印增强结果")
    ap.add_argument(
        "--doctor",
        action="store_true",
        help="检查 Python、配置、白名单、API Key 和网关，不发起模型请求",
    )
    ap.add_argument(
        "--mode",
        choices=("auto", "user", "system", "iterate"),
        default="auto",
        help="增强模式；iterate 使用上一版并支持 @iter:",
    )
    ap.add_argument(
        "--tier",
        choices=("auto", "base", "standard", "professional", "system"),
        default="auto",
        help="增强档位；system 为独立系统提示词类型",
    )
    ap.add_argument("--clip", action="store_true", help="增强剪贴板内容并写回")
    return ap.parse_args(argv)


def run_doctor(cfg):
    """输出可操作的环境检查结果；不打印 API Key。"""
    problems = config_problems(cfg)
    key_env = str(cfg.get("api_key_env") or "")
    key_set = bool(os.environ.get(key_env, "").strip())
    gateway = str(cfg.get("gateway") or "")
    try:
        parsed = urllib.parse.urlparse(gateway)
        gateway_ok = parsed.scheme == "https" and bool(parsed.netloc)
    except Exception:
        gateway_ok = False
    checks = [
        ("python", True, "%d.%d" % sys.version_info[:2]),
        ("config", not problems, "OK" if not problems else "；".join(problems)),
        (
            "api_key",
            key_set,
            "%s 已设置" % key_env if key_set else "%s 未设置" % key_env,
        ),
        (
            "allowed_processes",
            isinstance(cfg.get("allowed_processes"), list)
            and bool(cfg["allowed_processes"]),
            ", ".join(str(item) for item in cfg.get("allowed_processes", [])),
        ),
        ("gateway", gateway_ok, gateway or "(empty)"),
    ]
    for name, ok, detail in checks:
        print("[%s] %s: %s" % ("OK" if ok else "FAIL", name, detail))
    return 0 if all(ok for _, ok, _ in checks) else 1


def configure_console():
    """兼容非 UTF-8 控制台，避免中文输出导致 CLI 直接失败。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not reconfigure:
            continue
        try:
            reconfigure(errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


def main():
    configure_console()
    args = parse_cli_args()
    cfg = load_config()
    if args.doctor:
        return run_doctor(cfg)
    if args.test:
        default_tier = parse_default_command(args.test)
        if default_tier is not None:
            if not default_tier:
                print(
                    "交互选择默认档只支持热键；CLI 请指定基础、标准或专业",
                    file=sys.stderr,
                )
                return 2
            try:
                result = set_default_tier(default_tier)
                print("默认档已切换为%s" % result["label"])
                return 0
            except Exception as e:
                print("设置默认档失败：%s" % e, file=sys.stderr)
                return 1
        problems = config_problems(cfg)
        if problems:
            print("配置无效：%s" % "；".join(problems), file=sys.stderr)
            return 1
        prepared = prepare_draft(args.test)
        if prepared.get("conflict"):
            print("类型/档位冲突：%s" % prepared["conflict"], file=sys.stderr)
            return 2
        body = prepared["body"]
        mode = prepared["mode"]
        tier = prepared["tier"]
        iteration = prepared.get("iteration", False)
        if args.tier != "auto":
            if args.tier == "system":
                mode = "system"
                tier = "system"
            else:
                tier = args.tier
                if mode == "system":
                    print("系统类型不能与档位同时使用", file=sys.stderr)
                    return 2
        if args.mode in ("user", "system"):
            if args.mode == "system" and tier != "system":
                print("系统类型不能与档位同时使用", file=sys.stderr)
                return 2
            mode = args.mode
            iteration = False
        elif args.mode == "iterate":
            iteration = True
        if iteration:
            try:
                with open(LAST_PATH, encoding="utf-8") as f:
                    previous = f.read().rstrip("\r\n")
            except OSError:
                previous = ""
            if not previous:
                print("没有可迭代的上一版", file=sys.stderr)
                return 2
            if not prepared["explicit_iteration"]:
                body = previous
        protected, tokens = protect_skills(body)
        t0 = time.time()
        try:
            raw, usage = enhance(
                protected,
                cfg,
                mode=mode,
                iteration=iteration,
                iteration_request=prepared["iteration_request"],
                tier=tier,
            )
        except Exception as e:
            print("增强失败：%s" % e, file=sys.stderr)
            return 1
        out = clean(raw)
        problems = validate_output(
            protected, out, mode, iteration, tokens, tier
        )
        if problems:
            print("未通过保护检查：%s" % "；".join(problems), file=sys.stderr)
            return 3
        print(restore_skills(out, tokens))
        print("\n[%.1fs | %s]" % (time.time() - t0, cfg["model"]), file=sys.stderr)
        return 0
    if args.clip:
        events = queue.Queue()
        run_pipeline(cfg, events, use_keys=False)
        while not events.empty():
            print(events.get())
        return 0
    # 同一安装目录只允许一个常驻实例，避免重复热键钩子造成并发增强。
    instance_mutex = kernel32.CreateMutexW(None, False, instance_mutex_name())
    if not instance_mutex or ctypes.get_last_error() == 183:
        log("已有增强实例运行，当前进程退出")
        if instance_mutex:
            kernel32.CloseHandle(instance_mutex)
        return 0
    write_pid()
    try:
        raise_process_priority()
        toast_loop(queue.Queue(), cfg)
    finally:
        remove_pid()
        kernel32.CloseHandle(instance_mutex)
    return 0


if __name__ == "__main__":
    sys.exit(main())
