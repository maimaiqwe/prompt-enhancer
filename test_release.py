#!/usr/bin/env python3
"""Build and validate the three release packages without touching user state."""
import hashlib
import os
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FORBIDDEN = (
    "__pycache__",
    ".pyc",
    ".pyo",
    "log.txt",
    "watchdog.log",
    "history.jsonl",
    "last-enhanced.md",
    "last-original.md",
    "last-state.json",
    "enhancer.pid",
    "pythonw.path",
    "watchdog.exe",
    ".prompt-enhancer-installed",
)


def build(output):
    command = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        os.path.join(HERE, "build-release.ps1"),
        "-Version",
        "test",
        "-OutputDir",
        output,
    ]
    subprocess.run(command, check=True, cwd=HERE)


def names(path):
    with zipfile.ZipFile(path) as archive:
        return sorted(archive.namelist())


def assert_content(path, required):
    entries = names(path)
    for name in required:
        if name not in entries:
            raise AssertionError("%s missing %s" % (path, name))
    for name in entries:
        lowered = name.lower()
        for blocked in FORBIDDEN:
            if blocked.lower() in lowered:
                raise AssertionError("%s contains forbidden %s" % (path, name))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        build(tmp)
        skill = os.path.join(tmp, "prompt-enhancer-skill-vtest.zip")
        hotkey = os.path.join(tmp, "prompt-enhancer-hotkey-windows-vtest.zip")
        bundle = os.path.join(tmp, "prompt-enhancer-bundle-vtest.zip")
        sums = os.path.join(tmp, "SHA256SUMS.txt")
        for path in (skill, hotkey, bundle, sums):
            if not os.path.isfile(path):
                raise AssertionError("missing build output: %s" % path)

        assert_content(
            skill,
            [
                "install.ps1",
                "skills/prompt-enhancer/SKILL.md",
                "skills/prompt-enhancer/references/rules.md",
                "skills/prompt-enhancer/scripts/set_default.py",
                "skills/p/SKILL.md",
            ],
        )
        assert_content(
            hotkey,
            [
                "install.ps1",
                "enhance_hotkey.py",
                "watchdog.cs",
                "config.json",
                "core/rules.md",
                "core/set_default.py",
            ],
        )
        assert_content(
            bundle,
            [
                "install.ps1",
                "enhance_hotkey.py",
                "core/rules.md",
                "skills/prompt-enhancer/SKILL.md",
                "skills/p/SKILL.md",
            ],
        )

        with open(os.path.join(HERE, "core", "rules.md"), "rb") as source:
            core = source.read()
        for path in (skill, hotkey, bundle):
            with zipfile.ZipFile(path) as archive:
                bundled = (
                    "skills/prompt-enhancer/references/rules.md"
                    if path != hotkey
                    else "core/rules.md"
                )
                if archive.read(bundled) != core:
                    raise AssertionError("%s has stale rules" % path)

        lines = open(sums, encoding="utf-8").read().splitlines()
        if len(lines) != 3:
            raise AssertionError("SHA256SUMS.txt must contain three lines")
        for line in lines:
            digest, name = line.split("  ", 1)
            path = os.path.join(tmp, name)
            with open(path, "rb") as f:
                actual = hashlib.sha256(f.read()).hexdigest()
            if actual != digest:
                raise AssertionError("bad checksum for %s" % name)
    print("RELEASE_TEST_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
