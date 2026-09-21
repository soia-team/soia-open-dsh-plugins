---
description: "DSH 宿主工具包：从真实页面读出一个界面元素的实测尺寸与盒模型样式，并可与声明的期望值比对。"
kind: "package-bundle"
---

# soia-dsh-tool-check-ui-size

DSH 宿主工具包：用真实浏览器量出一个界面元素的**实测尺寸**，用来对治「CSS 声明正确、实际几何不正确」。

[English](README.en.md)

## 这个包做什么

声明值不等于结果。画板写 `min-height: 27px`，按钮仍可能渲染成 34px——行高、内边距或超大子元素都会盖过它。只看声明会通过，只有布局后的盒子说的是实话。

本包因此打开一个真实浏览器、读取 `getBoundingClientRect()` 与 `getComputedStyle()`，返回可复现、可进回执的数字；需要比对时再给出与期望值的**带符号差值**。

它不猜：没有浏览器、页面打不开、选择器匹配不到任何元素时，返回带错误码的失败，而不是一个编出来的测量值。

## 安装

尚未发布到 npm；用 git 源安装（`lib/` 随仓提交，装完即可用）：

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-ui-size'
dsh --profile <profile-name> --dump-config   # 先只验证配置层，不启动服务
```

发布到 npm 后用包名：`dsh plugin --profile <profile-name> add soia-dsh-tool-check-ui-size`。

`cordis.patch.yml` 只贡献一行 `insert`：`id: tool-check-ui-size`，`name: soia-dsh-tool-check-ui-size`。

浏览器解析顺序：调用参数 → 环境变量 `SOIA_CHROME_EXECUTABLE` → 常见安装位置（macOS 的 Chrome / Chromium / Edge，Linux 的 `google-chrome` / `chromium`）。包依赖 `playwright-core`，**不下载浏览器**；找不到可执行文件时返回 `browser_missing`，不会静默改用别的浏览器。

## 工具契约

### `check_ui_size`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 要打开的页面地址，如 `http://127.0.0.1:5173/` |
| `selector` | string | 是 | 目标元素的 CSS 选择器 |
| `expectedHeight` | number | 否 | 期望高度（CSS 像素），来自画板或规格 |
| `expectedWidth` | number | 否 | 期望宽度（CSS 像素） |

成功（`status: "ok"`）返回：

```json
{
  "status": "ok",
  "url": "http://127.0.0.1:5173/",
  "selector": "#submit",
  "measuredAt": "2026-09-21T07:14:03.812Z",
  "matched": 1,
  "visible": true,
  "rect": { "x": 24, "y": 118, "width": 96, "height": 34 },
  "computed": {
    "width": 96, "height": 34,
    "minWidth": 0, "minHeight": 27, "maxWidth": null, "maxHeight": null,
    "paddingTop": 0, "paddingBottom": 0,
    "fontSize": 14, "lineHeight": 34,
    "boxSizing": "border-box", "display": "inline-flex"
  },
  "viewport": { "width": 1280, "height": 720 },
  "expected": { "height": 27 },
  "diff": { "height": 7 }
}
```

- `rect` 取自 `getBoundingClientRect()`，是**布局后的真实盒子**；`computed` 里的 `minHeight` 等是声明侧的取值。两者并列正是这个工具的用处：上例声明 27、实测 34。
- `diff` 只在传了 `expected*` 时出现，等于 `实测 - 期望`，保留 3 位小数。
- `matched` 是选择器命中的元素个数；几何值始终取**第一个**命中元素。
- `visible` 在 `display:none`、`visibility:hidden` 或尺寸为 0 时为 `false`。

失败（`status: "error"`）返回 `code` 与 `message`：

| `code` | 含义 |
|---|---|
| `browser_missing` | 找不到可执行的 Chrome/Chromium；设 `SOIA_CHROME_EXECUTABLE` 可解决 |
| `navigation_failed` | 页面加载失败（地址不通、超时） |
| `element_not_found` | 选择器没有命中任何元素 |
| `evaluate_failed` | 页面已打开但读取几何失败 |

导航与等待选择器的默认预算都是 15 秒。

## 系统提示词

本包注册一个提示词段，`name` 为 `tool:check_ui_size`，`order` 为 `3200`（内建工具段占 1000–3100，SDK 工具段从 5000 起）。内容是两条英文规则：改完 UI 的验收要附实测尺寸；声明与实测不一致时以实测为准并说明差异来自哪一层。**常驻文本刻意用英文**——它按请求计费，同样内容英文的真实 token 成本约为中文的三分之一；给人看的中文说明留在本 README 与技能里。原文见下方 Model Experience。

## 设计说明

- **形态**：宿主工具 + 系统提示词段；无浏览器半，无客户端 bundle，不注册 `dsh.client`。
- **分层**：测量逻辑在 `src/host/measure.ts`，两侧共用的类型在 `src/shared/types.ts`，都不 import 任何 DSH 类型，可被别家宿主的外壳（例如 MCP server）复用；`src/index.ts` 只做注册与接线。未来若要加浏览器半，放 `src/client/`。仓结构见 [docs/structure.md](../../docs/structure.md)。
- **副作用注册**：工具与提示词段都注册在插件 fiber 上，插件释放时自动注销。模块内不持有宿主状态。
- **依赖**：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-system-prompt` 都声明为 peer，由宿主提供；`playwright-core` 是本包的运行时依赖，构建时保持 external，不内联进产物。
- **命名**：npm 包名 `soia-dsh-tool-check-ui-size`（工具类，官方 `dsh-tool-*` 形态加 `soia-` 前缀），entry id `tool-check-ui-size`。
- **扩展点**：不注册 `tools/pre-execute`、`tools/post-execute` 等策略钩子，不监听事件，也不提供配置 schema。

## 配置与事件

无。本包当前不读取任何配置项，也不发出任何事件。

## 许可

MIT。版权行见仓库根 [`LICENSE`](../../LICENSE)。

## Model Experience

### `check_ui_size` 工具的 schema

#### What the model sees

注册的工具名 `check_ui_size`、两个必填字符串参数 `url`/`selector`、两个可选数值参数 `expectedHeight`/`expectedWidth`，以及下面这段逐字描述：

##### Verbatim tool description

```markdown
Read one UI element's rendered size and box styles from a page URL, to check declared CSS against real geometry. Pass expectedHeight or expectedWidth for signed differences.
```

面向模型的工具目录由宿主从注册的 schema 生成；本仓不产出生成的工具目录，因此这里没有可引用的目录锚点。

#### Token effect

固定。只要该工具可见，名称、描述与四个参数的 schema 就进入每一次组装。**实测：模型可见投影（`name` + `description` + `parameters` 的 JSON）574 字符，按宿主 token-meter 的固定密度（≈4 字符 1 token）约 144 token；由 `pnpm run check-token-budget` 从构建产物重算，并与 `package.json` 的 `dsh.tokenBudget.resident`（179 = 144 + 段 35）比较，超标即红。** 早前手工估算的 214 token 用的是更宽口径（把整个注册定义都算进去），已由脚本口径取代。本包不追加保留式或动态上下文；把工具隐藏的作用域会整体移除这份贡献。

2026-09-21 瘦身记录：描述 257 → 173 字符（去掉错误码说明——失败时结果里自带 `status: "error"` 与 `code`，模型读得到），四个参数描述合计 182 → 94 字符；工具块 198 → 144、提示段 40 → 35，常驻 238 → 179。

#### KV Cache effect

前缀稳定。所有字段都是常量字符串，本包自身不改写工具块，也不会让已有前缀失去复用。前缀只在两种情况下变化：本包 manifest 改动了这些字符串，或另一个提供方改变了工具的可见性或顺序——两者都不属于本包所有。

### `tool:check_ui_size` 提示词段

#### What the model sees

一个静态提示词段，`name` 为 `tool:check_ui_size`，`order` 为 3200，全文如下：

##### Verbatim section text

```markdown
UI acceptance needs a check_ui_size measurement, not CSS alone.
Measurement wins on disagreement; name the layer (layout, font, box model).
```

#### Token effect

固定。**实测：139 字符、全 ASCII —— 按宿主固定密度约 35 token，真实分词成本与之一致（英文两者同值）。** 同内容的早期中文版是 93 字符，宿主估算只有 23 token，但按中文真实分词约 68 token：**宿主估算按字符数算，会低估中文、高估英文，选语言要看真实计费而不是界面数字。** 不插值、不设上限、不保留逐轮上下文。部署或预设注册同名段会将其遮蔽；空段不贡献任何内容。

#### KV Cache effect

系统提示词前缀的仅追加增长。文本是模块级常量，连续组装渲染出完全相同的内容，本包自身不会使缓存复用失效。前缀只在本包源码文本随新版本变化，或部署、预设遮蔽该段时改变——后者归调用方所有，不属本包。

## Known Limitations and Deferred Work

- **每次调用启动一个浏览器。** 没有跨调用复用浏览器或页面，一次测量约 0.5–1 秒；批量测量同一页面时这是纯开销。
- **只测量第一个命中元素。** `matched` 会报告命中总数，但几何值只取第一个；逐元素核对需要多调用几次，或等一个 `all` 选项。
- **还没有溢出检查与命中测试。** 子元素是否越出容器、元素是否真的点得到，都还没有注册成能力；仓内既有的 `scripts/design_board_fit.cjs`、`scripts/design_controls_visible.cjs` 各自独立，本包不调用也不复制它们。
- **不写证据文件。** 返回值是可引用的结构化 JSON，但本包不落盘到证据目录；需要留档时由调用方保存输出。
- **没有截图与视觉比对。** 本包只读数值，不做像素比对，也不把图交给视觉模型——那是视觉类插件的能力范围。
- **兼容性未经实测。** `dsh.compatibility.dsh` 的范围 `>=0.1.0-rc.8 <0.2.0` 是生态惯例写法；按 node-semver 的严格语义，该范围**不匹配预发布版**（如 `0.1.5-rc.2`、`0.1.6-alpha.2`），预发布版本需要同 tuple 的比较器才能满足。peer 依赖因此逐个列举了已发布的预发布版本。本包已在 **DSH `0.1.6-alpha.2`** 上验过加载（见下条）；`dshReleases` 映射等其他版本有证据后再补。
- **复核深度。** 仓库测试覆盖测量核心（含真实浏览器用例）。**加载已实测**：独立 `DSH_HOME` 的一次性 profile 里用 git 源安装，`pluginInventory/list` 报 `fiberPhase: active`。**真实模型调用已实测（2026-09-21）**：模型自己选中 `check_ui_size`、传对三个参数，拿到实测 34px 与 `diff.height = 7`（当时用的是瘦身前的描述文本；瘦身后尚未复跑）。逐条证据见 [docs/verification.md](../../docs/verification.md)。
