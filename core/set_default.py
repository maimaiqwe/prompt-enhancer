#!/usr/bin/env python3
"""持久化提示词增强默认档，供热键和 $p 共用。"""
import argparse
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def find_config_path():
    candidates = (
        os.path.abspath(os.path.join(HERE, "..", "hotkey", "config.json")),
        os.path.abspath(os.path.join(HERE, "..", "config.json")),
    )
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return candidates[0]


def find_backup_dir():
    shared_config = os.path.abspath(
        os.path.join(HERE, "..", "hotkey", "config.json")
    )
    if os.path.isfile(shared_config):
        return os.path.abspath(
            os.path.join(
                HERE, "..", "..", "..", "projects", "_tools", "backups"
            )
        )
    return os.path.abspath(os.path.join(HERE, "..", "backups"))


CONFIG_PATH = find_config_path()
BACKUP_DIR = find_backup_dir()
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


def normalize(value):
    return ALIASES.get(str(value or "").strip().lower())


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("config.json 顶层必须是对象")
    return data


def backup_config():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = os.path.join(BACKUP_DIR, "prompt-enhancer-set-default-%s.json" % stamp)
    if os.path.exists(target):
        return target
    shutil.copy2(CONFIG_PATH, target)
    return target


def write_config(cfg):
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(tmp, encoding="utf-8") as f:
        parsed = json.load(f)
    if parsed.get("default_tier") != cfg["default_tier"]:
        raise ValueError("配置校验失败")
    os.replace(tmp, CONFIG_PATH)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("tier", nargs="?")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    tier = normalize(args.tier)
    if not tier:
        message = "默认档只能是基础、标准或专业"
        if args.json:
            print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
        else:
            print(message, file=sys.stderr)
        return 2

    try:
        cfg = load_config()
        if cfg.get("default_tier") == tier:
            result = {
                "ok": True,
                "tier": tier,
                "label": LABELS[tier],
                "changed": False,
            }
        else:
            backup_config()
            cfg["default_tier"] = tier
            write_config(cfg)
            result = {
                "ok": True,
                "tier": tier,
                "label": LABELS[tier],
                "changed": True,
            }
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
        print("默认档已切换为%s" % result["label"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
