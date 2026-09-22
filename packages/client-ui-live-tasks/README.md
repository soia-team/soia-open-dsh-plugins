---
description: "DSH Web 面板：实时显示当前会话的任务状态——最后一次工具调用、最后一个事件、是否还在跑；宿主侧折叠，客户端只读投影，不发自己的 RPC。"
kind: "package-bundle"
---

# soia-dsh-client-ui-live-tasks

在 Web 界面实时显示**当前会话**的任务状态：最后一次工具调用、最后一个事件、是否还在跑。用它替代「轮询日志文件看任务跑到哪了」的做法——状态由宿主从会话事件流折叠出来，页面直接读。

[English](README.en.md)

## 这个包做什么

一轮任务进行中时，人真正会问的是四个问题：**现在在干什么**、**都干过什么**、**什么时候干的**、**结果怎么样**。这四件事都已经在会话日志里，只是没有一处把它们摊开给你看。

本包把 `session/event` 与 `agent/assistant-stream` 折成一个小状态对象（`LiveTaskState`），在会话视图区注册一个只读页签「任务」——与内置的「对话 / 轨迹」同排（`conversation.view`，`order: 20`）：

面板按**模块**组织，每个模块只回答一个问题：

| 模块 | 内容 |
|---|---|
| **概览** | 卡片网格：状态、位置（`#1 · 第 2 步`）、工具调用数、失败数（有失败时标红） |
| **正在跑** | 每个在飞调用一行：状态点 + 工具名 + 参数摘要（命令 / 路径 / `选择器 @ 页面`）+ 已跑秒数 |
| **动作日志** | 五列表格：**时间** · **工具** · **干了什么** · **耗时** · **结果**；带「全部 N / 只看失败 N」筛选，失败行标红 |
| **最近动静** | 最多三条人话短句：`模型回复`、`bash 返回`、`处理结束`…… 传输记账类事件不进这一行 |

模块边界就是设计本身：每个模块有自己的文案键前缀（`overview.*` / `running.*` / `log.*` / `recent.*`）和自己的空态，可以单独阅读、翻译或移除。

**失败判定认两层信号。** 宿主层的 `isError`，以及工具在**成功返回里**自报的失败（本生态的惯例是 `{"status":"error","code":…}`）。这条是实测踩出来的：一次页面加载失败与一次文件不存在都曾显示成「完成」、失败计数为 0。

段落文案随宿主语言切换（`liveTasks` 命名空间，中英键集由 `Record<LiveTaskKey, string>` 钉住）。工具名与事件类型**故意不翻译**：它们是协议标识符，改写会掩盖"到底是哪个工具在跑"。

### 面板不显示什么

- **助手流式文本的进度**。它来自 `agent/assistant-stream`，是进程内帧、不落日志，因此无法跨投影线路传输；它只存在于宿主侧的 `ctx.liveTasks`。面板不会显示一个恒为 0 的假进度条。
- **工具返回的完整内容**。结果列只有首行摘要（JSON 结果会折成 `key=value` 短句），全文去对话记录里看。
- **完整历史**。动作日志是有上限的窗口（最近 8 次调用 / 最近 6 条事件），不是审计记录。
- **后台任务（jobs）**。那是官方 `dsh-client-ui-jobs` 的范围，见下。
- **任何写操作**。面板是纯只读的，不能取消、不能重试。

## 与官方 `dsh-client-ui-jobs` 的边界

两者看名字像，覆盖的东西不重叠，是互补关系：

| | `dsh-client-ui-jobs`（官方） | 本包 |
|---|---|---|
| 数据源 | 进程内 `ctx.jobs` 注册表，经 `jobsBySession` 镜像 | 会话事件流（`session/event`）+ 进程内模型流 |
| 管理对象 | **后台任务**：显式 `run_in_background` 起的工作 | **会话任务状态**：当前 turn 在做什么 |
| 生命周期 | 注册表**不跨重启**；进程重启后列表清空，而对话记录里那些 `run_in_background` 卡片还在 | 折的是**持久日志**；重启后宿主重新折叠，状态仍在（投影缓存只影响冷读速度） |
| 外部 CLI 进程 | **不在其中**——外部 CLI 进程不是进程内 job，注册表看不见它 | 只要它由本会话的工具调用发起，`tool/call` 与 `tool/result` 就都在日志里，因此**看得见** |
| 时间维度 | 每个 job 的起止与耗时 | 最后一次工具调用与最后一个事件 |

一个会话可以完全没有 job，却正在长时间跑一个前台工具——那时 jobs 面板不出现，本包有内容。反过来，后台 job 跑着而当前 turn 已经空闲——那时本包显示「空闲」，jobs 面板显示运行中。两个面板都已经挂上时，顺序是 jobs（`order: 20`）在前、本包（`order: 30`）在后。

## 安装

尚未发布到 npm。git 源安装见 [CONTRIBUTING.md](../../CONTRIBUTING.md)；`cordis.patch.yml` 只贡献一行 `insert`：`id: ui-live-tasks`、`name: soia-dsh-client-ui-live-tasks`。

> **当前状态：两个产物都还不可交付。** `lib/client.js` 不存在；`lib/index.js` 存在，但是**过期产物**——它由根侧构建在源码定稿之前产出，提交前必须重建。原因与证据见 [客户端半的构建状态](#客户端半的构建状态)。本包现在可交付的是**源码、类型产物与测试**，不是一份可安装的插件。

## 数据来源与推导

### 一个纯函数，两侧同跑

`src/shared/live-task-state.ts` 是全部推导逻辑，形态是一个 reducer：

```ts
reduceLiveTask(state: LiveTaskState, observation: LiveTaskObservation): LiveTaskState
```

它 **不 import 任何东西**——不 import DSH 类型、不读时钟、不碰全局。因此它可以被单元测试完全覆盖（`tests/shared/live-task-state.test.ts`，33 个用例），也保证宿主半与浏览器半**折出同一个对象**，不会各写一份而漂移。

排序契约写在模块头部：durable 事件按 `seq` 排序，`seq` 不大于已折入最高值的观察一律丢弃（重复帧与陈旧回放都走这条路，直接返回同一个 state 引用，不产生任何下游工作）；文本增量没有 `seq`，只对当前打开的 `(turn, step)` 生效，且 `time` 不能倒退。

### 宿主半

`src/index.ts` 注册两个东西：

1. **`ctx.liveTasks`**（`src/host/live-task-store.ts`）——宿主侧活体面。它订阅 `session/event`、`agent/assistant-stream` 与 `session/disposed`，按会话保存状态，提供 `read()` / `snapshot()` / `onChanged()`。
2. **`liveTask` 投影单元**（`src/host/live-task-projection.ts`）——`ctx.sessionProjections` 上的一个 projection unit。注册表每提交一个 `session/event` 就驱动它一次，把整值镜像进页面。

为什么走投影而不是自己开一条 RPC：官方 `dsh-session-projection` 就是为「客户端要看到宿主算出来的每会话当前状态，又不重放日志」准备的缝。注册表负责订阅、水位、变更通知与快照，本包只贡献一个纯折叠加两个 schema。浏览器半因此**不需要任何自己的请求**——它读的座位是标准 slot kit 本来就递给它的。

投影的 client 视图是宿主状态的**真子集**：`streamedTextLength` 与 `streamedAt` 两个只被瞬时帧推动的字段留在宿主，不上线路。一个恒为 0 的字段送到前端，只会诱使面板把它当成有意义的信号。

`agent/assistant-stream` 的 `chunk` 帧不带 `turn`/`step`（只有 `start` 帧带），因此 store 记住每个会话当前 attempt 的位置；叫不出名字的 attempt 的 chunk 直接丢弃——重连会丢瞬时进度，不会丢持久状态。

### 浏览器半

`src/client/index.ts` 注册字典与会话头部 action；`src/client/LiveTasksAction.tsx` 通过 slot 标准道具里的 `useProjection('liveTask')` 读值并渲染。`undefined` 表示**能力缺席**（宿主单元没挂载，或还没有快照携带这个键），此时渲染为「什么都没有」，而不是编一个空状态。

## 浏览器半怎么构建

**`lib/client.js` 由 `scripts/build-client.mjs` 产出，形态与官方一致，且已在真实 profile 里加载并渲染过。**

官方那份共享客户端 preset（harness 仓 `packages/client/tsdown.client.ts`）不发 npm，所以本仓复刻了插件真正需要的那部分：用 tsdown 打成 CommonJS（`react`、`react/jsx-runtime`、`@deepseek-ai/*` 全部 external），再把函数体包进 `window.__ModuleLoader__.load({ id, factory: (require) => … })`，`module`/`exports` 在工厂内部创建、末尾 `return module.exports`。

| 检查 | 结果 |
|---|---|
| `pnpm run build:client` | ✅ 产出 `lib/client.js`（约 19 KB，`require("react/jsx-runtime")` 与 `require("@deepseek-ai/dsh-client-ui-primitives")`，无 ESM 残留）|
| 客户端类型检查 | ✅ `pnpm run typecheck:client` 0 错误 |
| 加载 | ✅ 一次性 profile 启动成功；`dsh-client-modules` 在声明的客户端产物缺失时会拒绝启动，所以"能启动"即"产物可组合" |
| 渲染 | ✅ 真实会话里「任务」页签与 对话/轨迹 同排渲染，无页面错误；动作日志显示工具名、参数、时间与结果 |

**样式不走 CSS module。** preset 里的 lightningcss 管线只为一张布局骨架样式表不值得引入，`src/client/styles.ts` 直接注入一个带 `data-plugin-css="ui-live-tasks"` 的 `<style>`，类名统一 `lt-` 前缀以免与页面通用类名相撞。

**客户端 `inject` 必须带上 `sessions` 与 `uiConversation`。** 插槽标准道具 `useProjection` 由注入的服务装配而成；少一个，产物会正常加载却什么都不渲染——这是实际踩过一次的坑，见 [docs/verification.md](../../docs/verification.md)。

### 投影只由已提交事件驱动

面板里的每个字段都能在持久日志里找到出处，重启页面或重启宿主后重新折叠会得到同样的值；代价是瞬时帧推动的字段（流式文本长度）永远到不了页面。

## 设计说明

- **形态**：客户端 bundle 包（`dsh.client` + `exports["./client"]`）+ 宿主侧投影贡献者。不注册工具、不加提示词段、不写消息内容，因此 `dsh.tokenBudget.resident` 为 0。
- **分层**：`src/shared/` 零依赖、两侧同跑；`src/host/` 是 Node 侧订阅与 schema；`src/client/` 是浏览器侧渲染。三段分开是为了让浏览器 bundle 不会混进只在 Node 能跑的东西。仓结构见 [docs/structure.md](../../docs/structure.md)。
- **命名派生**：npm 包名 `soia-dsh-client-ui-live-tasks`，entry id 与插件名 `ui-live-tasks`（去掉 `soia-dsh-client-`），投影键 `liveTask`。客户端面的派生跟官方走：官方 `@deepseek-ai/dsh-client-ui-jobs` 在 Web 组合的 `cordis.patch.yml` 里就是 `id: ui-jobs`。每一步都由 `tests/host/index.test.ts` 的 `name derivation` 用例钉住。
- **依赖**：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-session-projection` 声明为 peer，由宿主提供；`zod` 是本包的运行时依赖，用来在注册表边界校验状态与视图（官方投影单元同做法）。
- **注册即副作用**：两个监听器、投影单元、服务都注册在插件 fiber 上，插件释放时一起注销；模块内不持有跨插件的可变状态。
- **扩展点**：不注册策略钩子、不提供配置 schema、不发出自己的事件。

## 配置与事件

无配置项。本包不发出自己的 Cordis 事件；`ctx.liveTasks.onChanged(listener)` 是宿主侧的进程内订阅，不是事件总线上的事件。

## 许可

MIT。版权行见仓库根 [`LICENSE`](../../LICENSE)。

## Model Experience

None, as this package registers no tool, contributes no prompt section, and adds no message content; it folds session events into a read-only projection for a human-facing Web panel.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`ctx.liveTasks` 目前没有任何消费者。** 它存在的理由是 `agent/assistant-stream` 是进程内帧、投影线路载不动，所以需要一个宿主侧落点；但仓内没有第二个包读它。它现在是给诊断与后续宿主消费者准备的面，不是被验证过的能力。
- **面板看不到流式文本进度。** 见上文「面板不显示什么」。想让页面也看到进度，需要一条能把瞬时帧送到浏览器的线路，而投影注册表按契约只由已提交事件驱动。
- **动作日志在全新会话里看不到。** 没有活动时这个页签根本不渲染（实测：新会话的视图条里没有「任务」），所以 `view.empty` 这一分支在真实会话里不可达，只有单测覆盖。

- **投影键是进程级的，不是每会话能力信号。** 任何一个预设注册了 `liveTask`，每个会话的快照里都会出现这个键；面板读的是值，不是键的存在与否（官方 `dsh-session-projection` README 把这条列为该注册表自身的限制）。
- **只有最新状态，没有历史。** 折叠只保留「现在」：上一个 turn 的工具调用会被下一个 `turn/start` 重置；动作日志是"最近 8 次调用"的窗口，不是审计记录。
- **流式帧（`agent/assistant-stream`）在本机 Web profile 下接不上。** 该事件用 agent 作用域派发，本包因此改为在 `session/event` 上懒挂到 `ctx.agents` 找回的 agent；实测 `agents.list()` 始终为空（面板「运行状况」显示 `已接管 agent 0 / 注册表可见 0`）。**面板可见内容不依赖这条通道**——每个字段都来自持久事件；受影响的只有"数据更新"的新鲜度会以持久事件为准。计数器把这条限制直接摆在用户面前，而不是让它表现为"看起来正常"。
- **结束原因是协议词，不是本地化文案。** 面板原样显示 `completed` / `aborted` / `error` 等 `TurnEndReason.kind`；理由是未知的。转成人类措辞需要一份随协议增长的映射表，当前没有做。
- **瞬时文本增量的重复帧会重复计数。** 文本增量没有序号，只按 `time` 与当前步骤筛；同一毫秒内的真实增量都会计入，而重放的瞬时帧也会。这是显示层的计数偏差，且会被该步骤的 durable `assistant/message` 归零，不影响任何其他字段。
- **`streamedTextLength` 只在宿主可用。** 它衡量「模型正在写」，但客户端半读不到；宿主消费者要自己判断这个字段的用途。
- **兼容性只在本机验证过。** `dsh.compatibility.dsh` 的范围 `>=0.1.0-rc.8 <0.2.0` 是生态惯例写法；按 node-semver 的严格语义，该范围不匹配预发布版，peer 依赖因此逐个列举了已发布的预发布版本。加载与渲染是在维护者本机的一次性 profile + 演示 profile 上验证的（`--dump-config` 组合行、内置插件清单页显示「已启用」、真实会话渲染），**不是**在客户环境里验证的。
