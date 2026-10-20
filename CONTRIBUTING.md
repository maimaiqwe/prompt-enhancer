# Contributing

感谢你愿意改进 Prompt Enhancer。提交改动前，请先确认问题属于本仓库的 Windows 热键程序，而不是某个 agent 自带的 Skill。

## 开发环境

- Windows 10/11
- Python 3.10+
- PowerShell 5.1+ 或 PowerShell 7+
- 不需要第三方 Python 依赖

## 提交前检查

```powershell
python test_enhance_hotkey.py
git diff --check
```

测试必须全部通过。涉及热键、剪贴板、窗口检测或看门狗的改动，还应说明本机手工验证结果和所用应用。

## Pull Request

1. 从 `main` 创建主题明确的分支。
2. 保持改动聚焦，避免混入格式化无关文件或本地运行产物。
3. 为新行为补充测试；修 Bug 时优先补回归测试。
4. 不提交 API Key、令牌、个人信息、`log.txt`、历史文件或编译产物。
5. 在 PR 中说明动机、实现方式、兼容性影响和验证步骤。

## 代码约定

- 优先使用 Python 标准库，保持安装零依赖。
- 保留 Windows 10/11 与 Python 3.10+ 兼容性。
- 用户可见错误应可操作，不输出真实密钥。
- 修改 `core/rules.md` 时，同步检查解析逻辑和回归测试。

## 安全问题

不要通过公开 Issue 报告安全漏洞。请按 [SECURITY.md](SECURITY.md) 中的私密渠道披露。

## License

提交贡献即表示你同意按本仓库的 [MIT License](LICENSE) 授权该贡献。
