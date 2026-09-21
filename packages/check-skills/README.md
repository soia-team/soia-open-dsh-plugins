---
description: "DSH 宿主工具包：核对一个会话日志里「该用的技能到底有没有被加载」，没被用上时判定是哪一种病。"
kind: "package-bundle"
---

# soia-dsh-tool-check-skills

DSH 宿主工具包：读一个会话的落盘日志，核对**期望的技能有没有真的被加载**；没被加载时，说清是哪一类失败。

[English](README.en.md)

## 这个包做什么

技能机制有一个容易被跳过的环节：宿主在首个请求前注入一份**技能目录**（技能名 + 截断描述），模型随后自己决定要不要用 `skill("<精确名字>")` 把全文拉进来——**中间没有检索步骤，也没有强制**。于是「仓库里装了技能」和「这次任务真的用了技能」是两件事，后者会静默地不成立。

本包读会话日志、回答三个问题：

1. 这次会话拿到的技能目录里有**哪些**技能？
2. 期望的技能里，**哪些**被真的调用了？
3. 没被调用的，**是哪一种**问题——装配、选择，还是加载后没接上？

它只依据日志里写下的事实判定，不根据「任务看起来像该用某个技能」推断。

## 安装

尚未发布到 npm；用 git 源安装（`lib/` 随仓提交，装完即可用）：

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-skills'
dsh --profile <profile-name> --dump-config   # 先只验证配置层，不启动服务
```

发布到 npm 后用包名：`dsh plugin --profile <profile-name> add soia-dsh-tool-check-skills`。

`cordis.patch.yml` 只贡献一行 `insert`：`id: tool-check-skills`，`name: soia-dsh-tool-check-skills`。

本包是只读审计：**只读**会话日志，不写入 `$DSH_HOME` 下任何东西。唯一的写入是调用方显式传 `evidenceDir` 时的证据文件。

## 工具契约

### `check_skills`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionPath` | string | 否 | 会话日志路径；不给则取 `$DSH_HOME/sessions` 下最近修改的一个 |
| `applicableSkills` | string[] | 否 | 本次任务的期望技能名；不给则判定为 `unreported` |
| `evidenceDir` | string | 否 | 落盘 markdown 证据报告的目录 |

三个参数都可省略，每种省略都有确定答案：最近的会话、不判定、不落盘。

成功（`status: "ok"`）返回：

```json
{
  "status": "ok",
  "task": { "applicableSkills": ["alpha-protocol"], "source": "argument" },
  "catalog": { "count": 16, "names": ["find-skills", "alpha-protocol"], "present": true, "called": ["alpha-protocol"] },
  "calls": [
    { "name": "alpha-protocol", "turn": 1, "step": 1, "seq": 16, "ok": true, "usedAfterLoad": true }
  ],
  "verdict": "ok",
  "missing": [],
  "sessionPath": "/path/to/session.v3.jsonl.zstd"
}
```

| 字段 | 含义 |
|---|---|
| `task.applicableSkills` | 规范化后的期望清单（去空白、去重、保序） |
| `task.source` | `"argument"`（调用方给了清单）或 `"none"` |
| `catalog.count` / `catalog.names` | 本会话**生效**目录的技能数与名字 |
| `catalog.present` | 日志里有没有目录事件。`false` = 没有，和「目录存在但为空」是两件不同的事实 |
| `catalog.called` | 本会话实际 `skill()` 过的技能名（去重、按首次调用顺序） |
| `calls[]` | 每个被调用技能一条记录；同名多次加载只保留**最后一次**（判定看最后一次的后续） |
| `calls[].ok` | 该次加载是否真的拿到了技能正文 |
| `calls[].usedAfterLoad` | 该次加载之后，日志里是否还有**非 `skill`** 的工具调用 |
| `verdict` | 五态之一，或 `unreported`；多个期望时取**最严重**的一个 |
| `missing` | 非 `ok` 的期望技能名，按入参顺序 |

失败（`status: "error"`）返回 `code` 与 `message`：

| `code` | 含义 |
|---|---|
| `zstd_unsupported` | 当前 Node 没有 `zlib.zstdDecompressSync`；读 `.jsonl.zstd` 需要 Node ≥ 22.15 |
| `session_not_found` | 指定的路径不存在，或目录里没有会话文件 |
| `sessions_dir_missing` | `$DSH_HOME/sessions` 不存在 |
| `sessions_dir_empty` | 会话根下没有任何会话文件 |
| `session_unreadable` | 文件存在但读不了（权限等） |
| `session_empty` | 文件长度为 0 |
| `session_decompress_failed` | zstd 解不开（不是 zstd 数据、或整体结构损坏） |

`verdict` 是**逐技能判定取最严重**的结果，严重度排序（大到小）：`not_in_catalog` > `wrong_pick` > `not_attempted` > `loaded_not_effective` > `ok`。装配问题盖过选择问题，选择问题盖过「加载后没接上」——因为修复动作就在这个顺序上。`unreported` 是独立状态，不参与排序。

## 五态判据

判定顺序是固定的，**先判目录、再判调用、最后判后续**。顺序本身是契约：一个从没被提供过的技能不能被判成「模型没去调」，那是把装配问题算到模型头上。

| verdict | 判据（逐条按序求值，命中即停） |
|---|---|
| `not_in_catalog` | 日志里没有目录事件，**或**生效目录里没有这个名字 → 装配问题 |
| `not_attempted` | 在目录里，但本会话没有任何一次 `skill()` 调用它；**或**唯一的调用以 `isError: true` 失败（失败 = 正文没进来，等同没加载成功） |
| `wrong_pick` | 在目录里，没被调用，**且**本会话调用过别的技能 |
| `loaded_not_effective` | 加载成功，但该次加载之后**没有任何非 `skill` 的工具调用** |
| `ok` | 加载成功，且该次加载之后至少有一个非 `skill` 的工具调用 |
| `unreported` | 调用方没给期望清单，不做任何判定，`missing` 为空 |

### `loaded_not_effective` 的保守判定（重要）

这个判定**只在自己那句话能被日志直接证伪时才给出**。具体地，判据就是上面那一行字面意思：

- 只看「该次成功加载之后，日志里还有没有**别的工具**调用」。有 → `ok`。
- 后续的 **`skill` 调用不算证据**：连续加载两个技能不能证明第一个被用了。
- 除此之外**一律归入 `ok`**。本包不看模型说了什么、不看回答长度、不判断交付物是否真的体现了技能内容——那些都需要猜，猜错就是假指控。

**已知代价（实测）**：在本机 `~/.dsh/sessions` 下 **342 个真实会话、212 次 `skill()` 加载**上跑一遍，**成功加载后没有后续工具调用的次数是 0**。也就是说 `loaded_not_effective` 在真实数据上几乎不会触发——它只在「加载完就停手」这种明确情形下才会出现。这是刻意的：宁可漏判，不可误判。要更细的判定（例如核对加载后的调用是否落在技能声明的流程上）需要语义比对，不在本包范围，见 Known Limitations。

## 取数：会话事件的真实形状

会话落盘在 `$DSH_HOME/sessions/<cwd 编码>/<session-id>/session.v3.jsonl.zstd`。本包依赖的事件形状**全部读自真实会话文件**，不是推测：

| 读什么 | 事件 | 关键字段 |
|---|---|---|
| 技能目录 | `type: "user/message"` | `data.source.kind === "skill-catalog"`；`data.source.entries[] = { name, description }` |
| 技能调用 | `type: "tool/call"` | `data.name === "skill"`；`data.arguments` 是**字符串**，形如 `"{\"name\": \"<技能名>\"}"`；`data.callId` 用于配对结果 |
| 调用结果 | `type: "tool/result"` | `data.message.content[0]` 是 `tool-result` 块：`toolCallId` 配对调用，`isError` 表示失败，失败时 `content[0].text` 形如 `Error: skill "<名>" is unknown or no longer available` |
| 后续工具调用 | `type: "tool/call"` | `data.name` 为任意非 `skill` 的工具名 |

形状来源（2026-09-21 只读核对）。下面的 `<cwd-key>` 是会话路径的第一层目录名——宿主把会话 `cwd` 里的路径分隔符换成 `-` 得来的键。这里隐去它，是为了不把机器用户名与工作区路径写进公开仓；会话 id 原样保留，配合本机 `$DSH_HOME/sessions` 仍能定位到同一份文件：

- **目录事件**取自 `$DSH_HOME/sessions/<cwd-key>/session-87b49cd9-4512-4825-85ff-e4b5bbebd15d/session.v3.jsonl.zstd`（该样本目录仅 1 个技能 `find-skills`）；同一形状在另外 **338 个**会话里复核过，字段一致。
- **调用与结果事件**取自 `$DSH_HOME/sessions/<cwd-key>/session-664cf104-a08e-49e0-8a71-659f743697ea/session.v3.jsonl.zstd`（目录 16 项、1 次成功加载）。
- **失败结果**取自 `$DSH_HOME/sessions/<cwd-key>/session-2bf09eca-b73b-4d53-96d9-0b8be7691121/session.v3.jsonl.zstd`（目录 1 项 `find-skills`，两次调用均 `isError: true`）。
- **多份目录替换**取自 `$DSH_HOME/sessions/<cwd-key>/session-1b679f2c-224d-4556-9ca6-33d997bd2506/session.v3.jsonl.zstd`（3 份目录事件，`seq` 13 / 201 / 415，条目数 5 / 88 / 94，后两份 `source.update === true`）。

上面这些取数结论都用 `zstd -d` 命令行独立复核过，与本包输出逐项一致。

### 解码器能力探测（为什么不是 `import { zstdDecompressSync }`）

`node:zlib` 的 zstd API 不是所有 Node 版本都有（Node 22 是 22.15.0 起）。本包**不写静态具名导入**，而是 `import * as zlib from 'node:zlib'` 之后从命名空间上取这个函数。原因是失败时机不同：

- **静态具名导入**在模块**实例化**阶段就抛 `SyntaxError: The requested module 'node:zlib' does not provide an export named 'zstdDecompressSync'`——整个宿主入口加载失败，本包承诺的 `zstd_unsupported` 可读错误码**根本没机会产生**，因为模块永远跑不完求值。本仓 CI 跑 Node 22，这条差异是实际会踩到的。
- **命名空间读取**在缺这个导出时只是得到 `undefined`，于是调用时返回 `zstd_unsupported`，插件本身照常加载、其它工具面不受影响。纯文本 `.jsonl` 会话在任何版本上都能读；只有读 `.jsonl.zstd` 才需要 22.15+。

这一条由 `tests/host/session.test.ts` 的源码级断言钉住（不用「模块能加载」来证明——失败恰恰发生在任何代码运行之前）。

### 两个物理事实（都踩过）

1. **容器是「多帧拼接」，不是单帧。** 写出端每批追加一个可独立解码的 zstd 帧。`node:zlib` 的 `zstdDecompressSync` **只解第一帧**，对真实文件直接调用只会拿到 session 头——看起来「会话是空的」。本包按帧魔数 `28 B5 2F FD` 定位每一帧、逐帧解码再拼接。最后一个不完整的帧（追加被中断留下的尾巴）会被丢弃，前面的内容照常返回。
2. **记录不一定有换行。** 早期 generation 一行一条记录，之后的 generation 追加时**不写分隔换行**。只按 `\n` 切会把一整批记录粘成一行、整行 `JSON.parse` 失败。本包两种都接受：按行切之后，对拿不准的行用 `JSON.parse` 报出的位置逐个取出完整 JSON 值。

目录事件采用**最后一份生效**，不做并集：替换目录是「完整替换」，空目录是一次真实的「退掉所有旧名字」，把历史目录并起来会看到早就退休的技能。

解析失败的行走**计数丢弃**，不修复、不猜测：`data` 形状不对的目录事件会被整条跳过，让更早的可用目录继续生效。

## 落盘证据（可选）

传了 `evidenceDir` 时写一份 markdown 报告，路径为 `<evidenceDir>/skill-usage-<ISO时间戳>.md`（时间戳里的 `:` 与 `.` 去掉，以便做文件名；报告内保留完整 ISO 时间）。

写入遵守与仓内其它包相同的原子写规范：

- 先写同目录下的临时文件 `skill-usage-<时间戳>.md.tmp`，再 `rename` 到最终名。同目录 rename 是原子的，读者不会看到半份报告。
- 临时文件以 `mode: 0600` 创建（仅属主可读写）。
- 任何失败路径都删掉临时文件，**不留残留文件**。
- 报告本身写失败**不推翻审计结论**：返回值仍是 `status: "ok"`，带原有的 `verdict`，另加 `evidenceError` 说明落盘失败的原因；成功时给 `evidencePath`。

## 设计说明

- **形态**：宿主工具；无提示词段，无浏览器半，无客户端 bundle，不注册 `dsh.client`。
- **分层**：解压与解析在 `src/host/session.ts`；目录/调用/判定/报告都是纯函数，在 `src/host/skills.ts`；`src/index.ts` 只注册工具。除 peer 提供的 DSH 类型外，它们只 import `node:` 内置模块，可被别家宿主的外壳（例如 MCP server）复用；共享类型在 `src/shared/types.ts`。仓结构见 [docs/structure.md](../../docs/structure.md)。
- **依赖**：`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools` 都声明为 peer，由宿主提供。本包**无运行时第三方依赖**，只用 `node:fs` / `node:zlib` / `node:path` / `node:os`。
- **命名**：npm 包名 `soia-dsh-tool-check-skills`（工具类，官方 `dsh-tool-*` 形态加 `soia-` 前缀），entry id `tool-check-skills`，工具名 `check_skills`。
- **扩展点**：不注册 `tools/pre-execute`、`tools/post-execute` 等策略钩子，不监听事件，也不提供配置 schema。

## 配置与事件

无。本包当前不读取任何配置项，也不发出任何事件。

## 许可

MIT。版权行见仓库根 [`LICENSE`](../../LICENSE)。

## Model Experience

### `check_skills` 工具的 schema

#### What the model sees

注册的工具名 `check_skills`、三个**全部可选**的参数 `sessionPath` / `applicableSkills` / `evidenceDir`，以及下面这段逐字描述：

##### Verbatim tool description

```markdown
Audit a session log for whether the expected skills were loaded before the work started, and why not when they were not.
```

面向模型的工具目录由宿主从注册的 schema 生成；本仓不产出生成的工具目录，因此这里没有可引用的目录锚点。

#### Token effect

固定。只要该工具可见，名称、描述与三个参数的 schema 就进入每一次组装。**实测：模型可见投影（`name` + `description` + `parameters` 的 JSON）517 字符，按宿主 token-meter 的固定密度（≈4 字符 1 token）为 `ceil(517/4) = 130` token；由 `pnpm run check-token-budget` 从构建产物重算，并与 `package.json` 的 `dsh.tokenBudget.resident`（130）比较，超标即红。** 本包**不注册提示词段**，所以常驻成本就是工具块本身，没有第二项要相加。

参数描述刻意压到最短（三段合计 134 字符）：三个参数都可省略，且每种省略的语义在返回值里自解释（`source: "none"`、`sessionPath` 回显实际读的文件），不需要在常驻文本里再讲一遍。

#### KV Cache effect

前缀稳定。所有字段都是常量字符串，本包自身不改写工具块，也不会让已有前缀失去复用。前缀只在两种情况下变化：本包 manifest 改动了这些字符串，或另一个提供方改变了工具的可见性或顺序——两者都不属于本包所有。

### 本包不贡献提示词段

`check_skills` 是一个**事后审计**工具，不是模型在任务中该遵循的规则：它要核对的恰恰是「模型自己有没有加载技能」，把「记得加载技能」写进常驻提示词既不能强制加载，又要在每个请求上付费。因此本包只注册工具，`apply` 不调用 `ctx.systemPrompt.section`，`inject` 只声明 `['tools']`。派生链也到此为止：没有 `tool:` 段名可推。

## Known Limitations and Deferred Work

- **`loaded_not_effective` 几乎不会触发。** 判据只认「成功加载后没有任何非 `skill` 工具调用」。实测 342 个真实会话、212 次加载中命中 0 次。这是**刻意的保守**：宁漏判不误判。想提高灵敏度需要语义比对（例如核对加载后的工具调用是否落在技能声明的流程上），那是另一个能力，本包不做。
- **只审计 `skill` 工具这一条加载路径。** 用户在输入里打 `/技能名` 时，宿主以 `source.kind === "skill-invocation"` 直接把正文注入当步，**不经过 `skill` 工具**。本包**当前完全忽略**这类事件（既不读也不计入已加载），所以一次纯 `/name` 触发会被判成 `not_attempted`——这是假阴性，不是「模型没加载」。修这个需要把注入事件并入「已加载」的来源，属未完成项。
- **判定不了「加载对了但理解错了」。** 本包只证明技能正文进了上下文，不证明模型按它做了事。判据里的「后续工具调用」是**存在性**证据，不是相关性证据。
- **`$DSH_HOME/sessions` 的扫描深度有限。** 默认递归 4 层、只认 `session` 开头的 `*.jsonl.zstd` / `*.jsonl`。更深或非默认命名的会话需要显式传 `sessionPath`。
- **损坏的会话只能尽力而为。** 解析失败的记录**计数丢弃但不报错**（当前返回值里还没有暴露这个计数——`malformedLineCount` 在内部结构里，未上浮到结果）。最后一个不完整的 zstd 帧被丢弃，`truncatedTail` 同样没上浮。要区分「会话确实没加载技能」和「日志被截断所以看不到」，需要把这两个计数加进返回值。
- **兼容性未经实测。** `dsh.compatibility.dsh` 的范围 `>=0.1.0-rc.8 <0.2.0` 是生态惯例写法；按 node-semver 的严格语义，该范围**不匹配预发布版**，peer 依赖因此逐个列举了已发布的预发布版本。本包**尚未在活 profile 里验证过加载**（`pluginInventory/list` 报 `fiberPhase: active` 这一步没做），也没做过模型发起的真实调用。
- **zstd 用例在旧 Node 上是跳过而不是通过。** zstd 相关的测试用 `it.skipIf` 在缺少 `zstdCompressSync` 的 Node 上跳过（本仓 CI 跑 Node 22，需要 22.15+ 才会执行）。所以「测试全绿」在 22.15 以下并不等于 zstd 路径被验证过；本地是在 Node 26.9.0 上实测全部执行的。
- **取数结论的样本偏差。** 上面的事件形状来自本机 `~/.dsh/sessions` 的 342 个会话，全部由同一版本的 DSH 写出。DSH 换 generation（例如出现 `session.v4.jsonl.zstd`）时形状可能变，届时应重跑取数核对而不是沿用本页结论。
