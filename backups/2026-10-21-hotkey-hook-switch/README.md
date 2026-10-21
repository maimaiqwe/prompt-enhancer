# 备份说明

- 源文件：`enhance_hotkey.py`（修改前原样，2026-10-21，改 `system_hotkey_thread` → `hotkey_thread` 前留档）
- 来源：`E:\aaaWorkspace\WorkSpace\MEMORY\skills\prompt-enhancer\hotkey\enhance_hotkey.py`
- 备份副本：`enhance_hotkey.py.bak`（本目录，改前逐字节拷贝；真源按 AGENTS.md §3 备份到
  `E:\aaaWorkspace\WorkSpace\MEMORY\projects\_tools\backups\hotkey-hook-switch-20261021\enhance_hotkey.py`）
- 修改内容：仅 `:1957` 一行，热键监听从 RegisterHotKey（全局独占）换成低级钩子（不吞键），实现 DSH 插件与 Windows 热键层共用同一组合键 ctrl+shift+alt+a。
- 回滚：把本目录 `enhance_hotkey.py` 拷回原路径即可。
