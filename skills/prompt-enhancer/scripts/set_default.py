#!/usr/bin/env python3
"""Set or show the prompt-enhancer default tier for standalone Skill installs."""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
REPO_CONFIG = os.path.join(REPO_ROOT, "config.json")
REPO_WRITER = os.path.join(REPO_ROOT, "core", "set_default.py")
SHARED_ROOT = os.path.abspath(os.path.join(HERE, ".."))
SHARED_CONFIG = os.path.join(SHARED_ROOT, "hotkey", "config.json")
SHARED_WRITER = os.path.join(SHARED_ROOT, "core", "set_default.py")
ALIASES = {
    "base": "base",
    "基础": "base",
    "standard": "standard",
    "std": "standard",
    "标准": "standard",
    "professional": "professional",
    "pro": "professional",
    "专业": "professional",
}
LABELS = {"base": "基础", "standard": "标准", "professional": "专业"}


def appdata_state_path():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "prompt-enhancer", "default-tier.txt")


def normalize(value):
    return ALIASES.get(str(value or "").strip().lower())


def config_writer():
    for config, writer in (
        (REPO_CONFIG, REPO_WRITER),
        (SHARED_CONFIG, SHARED_WRITER),
    ):
        if os.path.isfile(config) and os.path.isfile(writer):
            return config, writer
    return "", ""


def show_default():
    config, _ = config_writer()
    if config:
        with open(config, encoding="utf-8") as f:
            cfg = json.load(f)
        tier = normalize(cfg.get("default_tier")) or "standard"
    else:
        try:
            with open(appdata_state_path(), encoding="utf-8") as f:
                tier = normalize(f.read()) or "standard"
        except OSError:
            tier = "standard"
    return {"ok": True, "tier": tier, "label": LABELS[tier]}


def write_standalone(tier):
    path = appdata_state_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    previous = show_default()
    if previous["tier"] == tier:
        return {
            "ok": True,
            "tier": tier,
            "label": LABELS[tier],
            "changed": False,
        }
    if os.path.exists(path):
        backup = path + ".bak-" + time.strftime("%Y%m%d-%H%M%S")
        with open(path, "rb") as source, open(backup, "wb") as target:
            target.write(source.read())
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(tier + "\n")
    os.replace(tmp, path)
    return {
        "ok": True,
        "tier": tier,
        "label": LABELS[tier],
        "changed": True,
    }


def external_write(writer, tier):
    result = subprocess.run(
        [sys.executable, writer, tier, "--json"],
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15,
        creationflags=0x08000000,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "设置失败").strip())
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("tier", nargs="?")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--show", action="store_true")
    args = parser.parse_args()

    if args.show:
        result = show_default()
    else:
        tier = normalize(args.tier)
        if not tier:
            message = "默认档只能是基础、标准或专业"
            if args.json:
                print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
            else:
                print(message, file=sys.stderr)
            return 2
        try:
            _, writer = config_writer()
            result = external_write(writer, tier) if writer else write_standalone(tier)
        except Exception as e:
            message = "写入默认档失败：%s" % e
            if args.json:
                print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
            else:
                print(message, file=sys.stderr)
            return 1

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print("默认档为%s" % result["label"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
