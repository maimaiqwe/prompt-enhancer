# prompt-enhancer

提示词增强器：把口语草稿改写成结构清晰、约束完整、可直接发给 AI 的提示词。同一份规则真源同时服务三个入口——DeepSeek Harness（DSH）输入框里的插件按钮、Windows 全局热键，以及任何 agent 对话里可用的 `$p` Skill。

## 仓库结构

| 目录 | 内容 |
|---|---|
| `core/rules.md` | **规则唯一真源**。四档位（基础 / 标准 / 专业 / 系统）的措辞、保真底线、输出纪律全在这里，热键层与 DSH 插件共用 |
| `dsh-plugin/` | DSH 插件（TypeScript，双半区：宿主导出 `lib/index.js`、浏览器导出 `lib/client.js`）。fork 自 [`rongxingda/dsh-prompt-enhance`](https://github.com/rongxingda/dsh-prompt-enhance) 0.2.7（Apache-2.0） |

热键层运行版位于 `MEMORY\skills\prompt-enhancer\hotkey\`（`Ctrl+Shift+Alt+A`，白名单 15 个进程，不含 `DeepSeek Harness.exe`——DSH 内改用插件自带热键）。

npm 与市场上有近名包：上游 `dsh-prompt-enhance`（rongxingda）、第三方 `dsh-prompt-enhancer`；本仓库发布包是 `dsh-prompt-enhance-cn`，认准全名。

## 三个入口的分工

- **DSH 插件**：输入框 ✨ 左侧的档位胶囊（基 / 标 / 专 / 系）+ 「结合上下文」开关，点 ✨ 或按 `Ctrl+Shift+Alt+A` 原地增强，预览面板可回填 / 复制 / 撤销。
- **Windows 热键**：在任何其它白名单客户端的输入框里按 `Ctrl+Shift+Alt+A`，走同一套档位规则。
- **对话 Skill**：`$p` / `$prompt-enhancer` 在装了这两个 skill 的 agent 对话里直接调用（档位前缀、`@iter:` 迭代、默认档切换）。

三个入口共用 `core/rules.md`，所以规则改一次，三处同时生效。

## dsh-plugin 开发

```bash
cd dsh-plugin
npm install --registry=https://registry.npmjs.org   # npmmirror 上 @deepseek-ai/* 太旧
npm run typecheck
npm test
npm run build              # 规则生成校验 + tsc + esbuild 双半区
```

改了 `core/rules.md` 要先 `npm run gen:tiers` 重新生成 `src/generated/tier-rules.ts`；`npm run build` 里的 `--check` 会在生成物落后时失败。

改完生效方式：客户端半区刷新页面，宿主半区重启 DSH。

本机 desktop profile 已正式依赖 npm 包 `dsh-prompt-enhance-cn`（pnpm 按依赖恢复），`install:profile` / `verify:profile` 已废弃——脚本检测到该依赖会直接退出。本机验证插件改动须发布新版并升级依赖，或临时手拷 `node_modules/dsh-prompt-enhance-cn`（下次 pnpm install 会还原为发布版）。

## 许可证

dsh-plugin 沿用上游 Apache-2.0（见 `dsh-plugin/LICENSE`）。
