# Prompt Enhancer

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4.svg)](#快速开始)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB.svg)](#快速开始)

一个面向 Windows 的全局热键提示词增强器：不经过对话，直接把当前输入框里的草稿替换为更清晰、更完整、更可执行的提示词。

## 项目范围

本仓库是独立的 Windows 热键程序，包含：

- 全局热键与白名单窗口检测
- 基础、标准、专业和系统提示词四类增强
- DeepSeek 官方 API 调用
- 再次优化、`@iter:` 迭代要求与 Skill token 保护
- 默认档切换和本地配置

输入框中的 `$p 切换默认` 是本程序支持的本地命令，用于切换默认档位。本仓库**不包含** Codex 对话中的提示词增强 Skill；如果你的 agent 另有 `$p` Skill，请分别管理，不要把两者视为同一个组件。

## 快速开始

**前置条件**：Windows 10/11、Python 3.10+（含 `pythonw.exe`）、DeepSeek 官方 API Key。

1. 获取源码：在 GitHub 页面选择 **Code -> Download ZIP**，或执行：

```powershell
git clone https://github.com/qwe3120695033/prompt-enhancer.git
cd prompt-enhancer
```

2. 设置 API Key（用户环境变量，不写入仓库）：

```powershell
[Environment]::SetEnvironmentVariable('DEEPSEEK_API_KEY', '<your-key>', 'User')
```

3. 安装并启动。右键 `install.ps1`，选择“使用 PowerShell 运行”；或执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

项目只使用 Python 标准库，不需要 `pip install`。安装器会编译轻量看门狗、创建登录启动项，并只在检测到白名单 agent 时启动增强服务。

卸载运行中的服务和启动项（保留配置、日志与 Key）：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

## 用法

1. 正常情况下安装器已经启动看门狗；若没有，双击 `run.cmd` 启动轻量看门狗（无窗口）。
2. 在支持窗口的输入框里写好草稿。
3. 光标放在输入框任意位置，按 **Ctrl+Shift+Alt+A** -> 顶部弹一条状态 -> 等待模型返回后，输入框全文被替换成增强版。

看门狗只在检测到白名单 agent 时才启动增强服务；全部 agent 关闭 8 秒后自动停止。快捷键只在白名单窗口里拦截；在别的软件里这个组合键照常可用。

### 档位

- 默认 `标准`：输出一段 80～220 字的高密度提示词，按任务自适应展开。复验类覆盖问题标注、判断依据、修改建议、完整成品、检查清单和修改对照；文章优化类覆盖原意保持、结构/表达/衔接改进、完整修改版和主要优化点。
- `base:` / `基础:`：基础整理，只轻度理顺文字、补标点和分段，不扩写任务；保留 Markdown 列表、表格、段落空行、行内代码与围栏代码块的结构和缩进。该档在本地确定性处理，不调用模型。
- `standard:` / `标准:`：显式使用标准档。
- `pro:` / `专业:`：专业增强，输出五段结构化提示词；短任务可回退 2～3 个自然段。
- `系统:` / `sys:`：独立系统提示词类型，使用八段框架，不能与档位前缀同时使用。
- 输入以 `专业优化`、`专业增强`、`审查后改写` 开头时自动使用专业档；`复验并优化` 仍使用当前默认档。

例如输入 `帮我把这个文章继续优化`，标准档会输出类似下面的提示词：

```text
请帮我继续优化这篇文章，在保持原意和核心观点不变的前提下，改进文章的逻辑结构、语言表达和段落衔接，使其更加流畅易读、重点突出。如有需要，请直接给出修改后的完整版本，并简要说明主要优化点。
```

### 用户 / 系统提示词

默认自动判断强系统信号，例如“系统提示词、系统指令、角色设定、角色定位、你是一名、你的角色是、能力边界”等；单独的“你是”或普通句中的“必须/禁止”不会触发系统类型。

判断不准时在输入框开头强制指定，标记不会进入最终结果：

```text
sys: 你是一名代码审查员，必须优先指出安全问题
user: 帮我写一篇产品介绍
```

也支持中文 `系统：` / `用户：`。

### 切换默认档

输入框去掉空白后只写 `$p 切换默认`，按 `Ctrl+Shift+Alt+A`，会弹出 `1 基础 / 2 标准 / 3 专业` 选择框；数字键或鼠标选择，`Esc` 取消。选择后只修改本地 `config.json`，不改输入框内容。

也可以把其中一行发给 agent：

```text
$p 默认 标准
$p 切换默认 专业
```

默认档切换成功后会显示“默认档已切换为标准”约 2.6 秒，并持久保存；之后普通输入不带前缀，直接按热键就会用新默认档。

`系统`不能设为默认档；它始终是独立类型。

CLI 也支持持久切换，例如 `python enhance_hotkey.py --test "$p 默认 标准"`；无档位的 `$p 切换默认` 需要弹窗，仅支持热键入口。

### 再次优化

- 增强完成后，**保留结果不动，再按一次热键**：自动迭代上一版，只补缺口。
- 想改变迭代方向或细节：在末尾另起一行写 `@iter: <要求>`，例如：

```text
请帮我优化这篇文章，保留原意，改进结构和表达。
@iter: 更严格，补验收标准，不要扩写
```

`@iter:` 只对本次迭代生效，不会原样进入最终提示词。当前文本被手动改过后，仍可用 `@iter:` 强制从当前版本继续。

### Skill 调用保护

- **热键输入框**：独立出现的 `$find-skills` 等 Skill token 会原样保留，只增强周围自然语言；整段只有 Skill token 时提示补充需求。
- **本地切换命令**：整段只有 `$p 切换默认` 时，热键会打开档位选择框，不会把这条命令发给模型。
- **对话 Skill**：Codex 等宿主中的 `$p` Skill 不属于本仓库；它是否会展开，由对应宿主的 Skill 配置决定。

### 撤销与历史

替换后可直接用 `Ctrl+Z` 撤销；同时：

- `last-original.md`：本次替换前的完整原文。
- `history.jsonl`：最近 5 次结构化记录，总量不超过 64 KiB，超出后自动轮转；明显密钥会脱敏。
- `last-enhanced.md`：最近一次增强结果，用于识别“再次优化”。

实际替换耗时受网络与模型状态影响。本机先前三次短草稿实测约 **1.2~1.6 秒**，仅作量级参考，不作为固定延迟承诺。

若输入焦点在增强过程中切换，程序不会强行粘贴，结果会留在剪贴板。若首次抓取为空，程序会重试一次；仍为空时顶部提示“输入框没抓到内容”，草稿不会被替换。

## 接入 DeepSeek 官方 API

- 网关：`https://api.deepseek.com/chat/completions`
- 模型：`deepseek-flash`
- 密钥：只从用户环境变量 `DEEPSEEK_API_KEY` 读取，**不写入任何文件**
- 思考：`reasoning_effort=none`。实测开启思考会多花约 430 输出 tokens、慢约 2 秒

设置密钥（只需一次，值不要贴进 git）：

```powershell
[Environment]::SetEnvironmentVariable('DEEPSEEK_API_KEY', '<your-key>', 'User')
```

设置环境变量后，请重新打开终端或 agent，使新进程读到最新值。

## 隐私与数据流

- 只有按热键时，当前输入框草稿才会发送到你配置的 API 网关；本程序没有自建中转服务器。
- 热键只读取当前输入框内容，不读取 agent 的聊天历史、项目文件或 Codex 记忆。
- `log.txt`、`history.jsonl`、`last-original.md` 和 `last-enhanced.md` 可能包含草稿文本；它们已被 `.gitignore` 排除，但不会自动加密。
- 程序会脱敏明显的 API Key、token、password 等字段，但不能保证识别所有敏感信息。请勿对不允许发送给第三方的机密内容使用云模型增强。

## 配置（config.json）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `model` | `deepseek-flash` | 官方还有 `deepseek-v4-pro`，约贵 3.4~4.5 倍 |
| `reasoning_effort` | `none` | 设为 `high` 等会重新开启思考，显著增加费用 |
| `hotkey` | `ctrl+shift+alt+a` | 支持 `ctrl/alt/shift/win` + 字母或 `f1`~`f24` |
| `allowed_processes` | 见配置 | 只在这些窗口生效，防误替换 |
| `max_tokens` | 700 | 基础档输出上限，不是实际计费量 |
| `max_tokens_standard` | 900 | 标准档输出上限 |
| `max_tokens_professional` | 1200 | 专业档输出上限，避免结构化提示词被截断 |
| `max_tokens_system` | 1200 | 系统档输出上限，八段框架通常需要更多余量 |
| `select_all` | `true` | 按热键时自动全选整个输入框，无需手动 `Ctrl+A` |
| `history_max_entries` | 5 | 历史保留条数 |
| `history_max_bytes` | 65536 | 历史文件总大小上限（字节） |
| `default_tier` | `standard` | 当前默认档；可写 `base/standard/professional`，也可用 `$p 切换默认` 修改 |

提示词规则位于 `core/rules.md`。调用日志与 token 数写入本地 `log.txt`，不会提交到 Git。

## 成本参考（官方 Flash）

本机先前实测短草稿示例：400 输入 + 56 输出 = 456 tokens；实际用量随输入和档位变化。

| 场景 | 每次 | 1000 次 |
| --- | ---: | ---: |
| 空闲、缓存未命中 | 约 0.00062 元 | 约 0.62 元 |
| 高峰、缓存未命中 | 约 0.00125 元 | 约 1.25 元 |
| 空闲、缓存命中 | 约 0.00023 元 | 约 0.23 元 |

高峰为工作日 9:00-12:00、14:00-18:00（不含法定节假日）。
以上为本机历史实测数据，采集于 2026-10-20；实际价格、缓存命中率和用量会随模型与官方计费规则变化，请以调用时的官方账单为准。

## 测试

```powershell
python enhance_hotkey.py --test "帮我把这个文章继续优化"
python enhance_hotkey.py --tier system --test "你是一名代码审查员"
python enhance_hotkey.py --mode iterate --test @'
全文
@iter: 更严格
'@
python enhance_hotkey.py --clip
python test_enhance_hotkey.py
```

测试套件不访问真实 API，也不需要 `DEEPSEEK_API_KEY`。GitHub Actions 会在 Windows 上运行同一组回归测试。

## 换机器 / 其他 agent

把整个目录复制到新机器，设置 `DEEPSEEK_API_KEY` 后直接双击 `run.cmd`；需要登录自启时运行 `install.ps1`。

## 生命周期

- 开机：只启动 `watchdog.exe`，约 20~25 MB；不启动 Python 增强服务。
- 打开 ChatGPT/Codex/OpenCode/WorkBuddy/ZCode/Trae/IDEA：看门狗启动 `enhance_hotkey.py`。
- 关闭全部 agent：等待 8 秒后按 `enhancer.pid` 停止增强服务，并删除 PID 文件。

## 手动启停

- 启动自动管理：双击 `run.cmd`，或运行 `install.ps1 -NoStartup`。
- 只停止自动管理：按完整路径结束 `watchdog.exe`。已启动的增强服务不会因此自动退出。
- 彻底停止：先结束 `watchdog.exe`，再按 `enhancer.pid` 精确结束对应 `pythonw.exe`，最后删除 PID 文件。

> 注意：生命周期中的“开机”实际指**登录 Windows 后**通过 Startup 目录启动，并非系统开机阶段的服务。

## License

本项目采用 [MIT License](LICENSE)。欢迎提交 Issue 和 Pull Request，参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。
