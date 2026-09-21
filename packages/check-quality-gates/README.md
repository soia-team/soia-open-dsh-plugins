---
description: "DSH 宿主工具包：把「这次改了哪些文件」按调用方自己的门配置映射成必跑的质量门与每门要贴回的原始证据；只输出清单，不阻止未跑门。"
kind: "package-bundle"
---

# soia-dsh-tool-check-quality-gates

DSH 宿主工具包：给定**这次改了哪些文件**，按**调用方配置**算出该跑哪些质量门、每门必须贴回什么原始证据。

[English](README.en.md)

## 这个包做什么

「改完该跑哪些门」这件事，靠记忆迟早会漏：改了源码忘了类型检查、动了测试忘了跑用例、只改了文档又把全部门跑一遍。本包把这份判断从模型记忆里挪进配置：调用方在 `.dsh/gates.yml` 里写清「什么样的改动需要哪道门、跑什么命令、跑完贴回什么原始证据」，工具只做一件事——拿改动文件列表去匹配，返回清单。

三条边界，写在最前面：

- **不内置任何项目的脚本、路径或证据格式。** 每道门都来自配置；本包源码、示例、测试里没有调用方的命令名。
- **只输出清单，不阻止未跑门。** 返回值里 `enforcement` 恒为 `"none"`，含义是「本工具不判你是否跑了门，也不因为你没跑而拦你」。拦不拦是调用方策略层的事。
- **不执行任何门。** 不跑命令、不校验证据是否已贴回、不读写 git。改动文件列表由调用方传入。

## 安装

尚未发布到 npm；用 git 源安装（`lib/` 随仓提交，装完即可用）：

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-quality-gates'
dsh --profile <profile-name> --dump-config   # 先只验证配置层，不启动服务
```

发布到 npm 后用包名：`dsh plugin --profile <profile-name> add soia-dsh-tool-check-quality-gates`。

`cordis.patch.yml` 只贡献一行 `insert`：`id: tool-check-quality-gates`，`name: soia-dsh-tool-check-quality-gates`。

## 工具契约

### `check_quality_gates`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `changedFiles` | string[] | 是 | 本次任务改动的文件路径，相对工作区 |
| `configPath` | string | 否 | 配置路径；相对 `cwd` 解析。不给就向上找最近的 `.dsh/gates.yml` |
| `cwd` | string | 否 | 工作目录；默认是宿主进程的当前目录 |

### 输出 schema

返回值恒为下面六个字段，成功与失败同一形状（失败时 `requiredGates` 为空、`error` 非空，见下节）：

```json
{
  "changedFiles": ["README.md", "packages/app/src/index.ts"],
  "requiredGates": [
    {
      "id": "typecheck",
      "command": "pnpm run typecheck",
      "reason": "TypeScript sources changed.",
      "rawEvidenceRequired": "Raw exit code plus the first failing diagnostic line."
    }
  ],
  "source": "/workspace/.dsh/gates.yml",
  "enforcement": "none",
  "unmatched": ["README.md"],
  "error": null
}
```

示例输出对应的配置只声明了 `typecheck` 一道门；实际渲染是 `JSON.stringify(value, null, 2)` 的 JSON 文本。

| 字段 | 类型 | 说明 |
|---|---|---|
| `changedFiles` | string[] | 规范化后的请求文件：去空白、`\` 折成 `/`、去掉开头 `./`、去重、排序 |
| `requiredGates` | object[] | 至少被一个改动文件命中的门，**按配置文件里的顺序**返回；同一道门被多个文件命中只出现一次 |
| `requiredGates[].id` / `.command` / `.reason` / `.rawEvidenceRequired` | string | 原样来自配置，逐字返回，便于回执直接引用 |
| `source` | string | 实际使用的配置文件绝对路径；没有可用配置时为 `"<not found>"` |
| `enforcement` | `"none"` | 常量。本工具只输出清单，不阻止未跑门 |
| `unmatched` | string[] | 没有任何门命中的改动文件，去重排序；**不静默丢弃** |
| `error` | string \| null | 无法产出清单时的一行可读说明；成功时为 `null` |

### 错误行为

配置缺失、读不出或非法时**不抛异常、不返回半成品**：`requiredGates` 为空、所有改动文件进 `unmatched`、`error` 给一句可读说明。

| 情况 | `source` | `error` 形态 |
|---|---|---|
| 从 `cwd` 向上没找到配置 | `"<not found>"` | `No gate config found: no .dsh/gates.yml in <cwd> or any parent directory.` |
| `configPath` 指向的路径不存在或不是普通文件 | `"<not found>"` | `No gate config found at <path>.` |
| 文件在，但读失败（例如权限） | 该路径 | `Could not read gate config at <path>: <原因>.` |
| YAML 语法或字段非法 | 该路径 | `Invalid gate config at <path>: <原因>.`（语法错误带 `(line N)`） |

其余可读错误（均为一句英文，直接可引用）：

- `config root: expected a mapping` / `config root: unknown key "x" (allowed: gates)`
- `gates[0]: missing required key "command"`
- `gates[0].when.paths: must be a non-empty list of glob strings`
- `gates[0]: unknown key "whenn" (allowed: id, command, reason, rawEvidenceRequired, when)`
- `duplicate gate id "typecheck" (gates[0] and gates[2])`
- `unexpected indentation (line 9)` / `tab characters are not allowed in indentation (line 3)` / `duplicate key "id" (line 2)`

## 配置格式（`.dsh/gates.yml`）

查找规则：给了 `configPath` 就用它（相对 `cwd` 解析）；否则从 `cwd` 起逐级向上找 `.dsh/gates.yml`，直到文件系统根，**取最近的一个**（更近的配置优先于父目录的）。

### 配置 schema

```yaml
gates:                          # 必填：门列表；顺序就是返回顺序
  - id: typecheck               # 必填：门标识，同一文件内唯一，重复即报错
    command: pnpm run typecheck # 必填：调用方要跑的命令（本工具只贴回，不执行）
    reason: TypeScript sources changed.        # 必填：为什么这类改动需要这道门
    rawEvidenceRequired: Raw exit code plus the first failing diagnostic line.  # 必填：跑完必须贴回的原始证据
    when:                       # 必填：命中条件
      paths: ["packages/**/src/**", "src/**"]  # 必填：非空 glob 列表；任一命中即该门必跑
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `gates` | list | 是 | 门列表；`gates: []` 合法（表示没有门），整个文件为空则报错 |
| `gates[].id` | string | 是 | 非空；同一文件内唯一 |
| `gates[].command` | string | 是 | 非空。本包不解析、不执行、不做存在性检查 |
| `gates[].reason` | string | 是 | 非空 |
| `gates[].rawEvidenceRequired` | string | 是 | 非空。本包不校验证据是否真的贴回 |
| `gates[].when` | mapping | 是 | 目前只有一个键 |
| `gates[].when.paths` | list\<string\> | 是 | 非空、元素非空；匹配见下节 |

**未知键一律报错**（`whenn:` 这类拼写错误不会静默通过）。配置**不内置默认值**：没有内置门、没有内置路径、没有环境变量开关。

### glob 语义

`when.paths` 的每个模式都是**整路径锚定、区分大小写**的 glob，匹配前会把文件路径与模式都规范化（`\` → `/`、去掉开头 `./`、合并重复 `/`）。

| 写法 | 含义 |
|---|---|
| `**` | 跨 `/` 的任意片段；`**/` 可匹配零个片段，所以 `a/**/b` 也匹配 `a/b` |
| `*` | 单个片段内任意字符，不跨 `/` |
| `?` | 单个片段内恰好一个字符 |
| 其他字符 | 字面量（含正则元字符，如 `.`、`+`、`(`） |

不支持的写法：花括号展开、`[abc]` 字符类、`!` 取反都当字面量处理，因此实际上匹配不到任何正常路径；`\` 也不能当转义符——匹配前它已被折成 `/`（Windows 分隔符）。`src/**` **不**匹配 `src` 本身——目录不是文件，请用 `src/**` 匹配其下的文件。

### 配置解析的子集

配置由包内自带的极简 YAML 子集解析器读取（**零运行时依赖**）：块映射、块序列、`- key: value` 条目、标量流式序列（`[a, b]`）、单/双引号标量、注释与空行、一行可选的 `---`。

子集之外一律**带行号报错，绝不猜**：缩进里的 Tab、锚点/别名/标签/指令、块标量（`|`、`>`）、流式映射（`{a: b}`）、嵌套流式集合、多行纯标量、重复键。

## 设计说明

- **形态**：宿主工具；无浏览器半、无客户端 bundle，不注册 `dsh.client`。
- **分层**：纯逻辑在 `src/host/`——`gates.ts`（解析 → 匹配 → 排序去重 → 组装）、`glob.ts`（最小 glob）、`yaml.ts`（最小 YAML 子集），契约类型在 `src/shared/types.ts`，都不 import 任何 DSH 类型，可被别家宿主的外壳（例如 MCP server）复用；只有 `src/host/config-file.ts` 读文件系统。`src/index.ts` 只做注册与接线。仓结构见 [docs/structure.md](../../docs/structure.md)。
- **依赖**：`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools` 都是 peer，由宿主提供；**没有任何运行时依赖**，所以产物可原样打包。
- **副作用注册**：工具注册在插件 fiber 上，插件释放时自动注销；模块内不持有宿主状态。
- **不做的事**：不注册提示词段（模型可见常驻文本为 0），不注册 `tools/pre-execute`、`tools/post-execute` 等策略钩子，不监听事件，不写文件，不读 git。
- **命名**：npm 包名 `soia-dsh-tool-check-quality-gates`（官方 `dsh-tool-*` 形态加 `soia-` 前缀），entry id `tool-check-quality-gates`，工具名 `check_quality_gates`。

## 配置与事件

本包不读取插件自身的配置项（`.dsh/gates.yml` 是**调用数据**，由工具参数与查找规则决定，不是插件配置），不发出任何事件。

## 许可

MIT。版权行见仓库根 [`LICENSE`](../../LICENSE)。

## Model Experience

### `check_quality_gates` 工具的 schema

#### What the model sees

注册的工具名 `check_quality_gates`、一个必填字符串数组参数 `changedFiles`、两个可选字符串参数 `configPath`/`cwd`，以及下面这段逐字描述：

##### Verbatim tool description

```markdown
Map the files changed in a task to the quality gates the caller's config requires, with the raw evidence each gate must return. Report only: enforcement is "none", so an unrun gate is never blocked.
```

面向模型的工具目录由宿主从注册的 schema 生成；本仓不产出生成的工具目录，因此这里没有可引用的目录锚点。

#### Token effect

固定。**实测：模型可见投影（`name` + `description` + `parameters` 的 JSON）578 字符 —— `name` 19 + `description` 198 + `parameters` 317 —— 按宿主 token-meter 的固定密度（≈4 字符 1 token）向上取整为 145 token。本包不注册提示词段，提示段成本为 0，故 `dsh.tokenBudget.resident` = 145 = 145 + 0。** 包内 `tests/host/index.test.ts` 从注册后的定义重算这个数并与 manifest 比对（不等即红）；`pnpm run check-token-budget` 再从构建产物独立复算一遍。描述刻意用英文并压到两句：它按请求计费，用法细节由模型读参数 schema、失败信息读返回值里的 `error`。

#### KV Cache effect

前缀稳定。名称、描述与三个参数的 schema 都是常量字符串，本包不改写工具块，也不会让已有前缀失去复用。前缀只在本包 manifest 改动这些字符串，或另一个提供方改变了工具的可见性与顺序时变化——两者都不属于本包所有。工具**结果**（门清单）逐次不同，但它是会话内容而非常驻前缀，不影响前缀缓存。

### 提示词段

无。本包注册 0 个系统提示词段：门清单是按需查询的结果，不是值得每轮付费的规则。

## Known Limitations and Deferred Work

- **门清单的正确性完全取决于配置。** 本包不做「配置是否覆盖了全部风险」的判断：没写进 `paths` 的目录只会出现在 `unmatched` 里，不会被补上默认门。`unmatched` 是提示，不是门禁。
- **不执行、不校验证据。** 不跑 `command`，不检查返回的原始证据是否真的贴回、是否够「原始」。`enforcement: "none"` 是返回值里的常量，调用方若要把「未跑门」变成阻断，得自己接策略层。
- **不读 git。** `changedFiles` 由调用方传入，本包不调用 git、不读 diff、不认 `.gitignore`；传错清单就会得到与事实不符的门清单（工具无从校验）。
- **查找不设边界。** 从 `cwd` 一直向上找到文件系统根，不停止于 `.git` 或家目录；极端情况下会命中仓库之外的 `.dsh/gates.yml`。要确定性就用 `configPath`。
- **glob 是最小子集。** 无花括号展开、字符类、取反与转义；匹配区分大小写、按整路径锚定；不认目录（`src/**` 不匹配 `src`）。
- **YAML 也是最小子集。** 锚点、块标量、流式映射、嵌套流式集合、多行纯标量都会被拒绝（带行号），不是被解析。用这些写法的配置需要改写成块风格。正则表达式式的「宽松解析」被刻意排除：看不懂的配置宁可报错，也不产出一份看似正常却漏门的清单。
- **配置没有版本号与继承。** 没有 `schemaVersion`、没有 `include`/`extends`、没有门的分组或依赖关系；多工作区要共享门只能各自复制配置。
- **没有配置缓存与 watch。** 每次调用都重新查找、读取、解析配置文件；大仓库高频调用时这是重复 IO（配置文件很小，实际开销可忽略）。
- **构建产物由根侧构建产生。** 根 `tsdown.config.ts` 按目录自动发现宿主入口（有 `src/index.ts` 即入列），本包不需要改根配置；`lib/index.js` 由根侧 `pnpm run build` 生成并随仓提交（`pnpm run verify:lib` 校验它与源码一致）。工作区里若缺这个文件，`pnpm run check-token-budget` 会报缺产物，git 源安装会装出没有入口文件的空壳。
- **未做加载与活调用验收。** 仓内测试覆盖核心逻辑（含真实临时目录端到端调用），但**尚未**在一次性 profile 上做 `--dump-config` 烟测、`pluginInventory/list` 加载验收或真实模型调用；这三层证据按 [docs/structure.md](../../docs/structure.md) 的口径各自独立，需单独补。
