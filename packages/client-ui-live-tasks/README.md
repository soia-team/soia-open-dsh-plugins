---
description: "DSH Web 面板：实时显示当前会话的任务状态——最后一次工具调用、最后一个事件、是否还在跑；宿主侧折叠，客户端只读投影，不发自己的 RPC。"
kind: "package-bundle"
---

# soia-dsh-client-ui-live-tasks

在 Web 界面实时显示**当前会话**的任务状态：最后一次工具调用、最后一个事件、是否还在跑。用它替代「轮询日志文件看任务跑到哪了」的做法——状态由宿主从会话事件流折叠出来，页面直接读。

[English](README.en.md)

## 这个包做什么

一轮任务进行中时，人最想知道的三个事实是：**还在跑吗**、**最后调用了什么工具**、**最后一个事件是什么**。这三件事都已经在会话日志里，只是没有一处把它们摊开给你看。

本包把 `session/event` 与 `agent/assistant-stream` 折成一个小状态对象（`LiveTaskState`），在会话头部放一个只读面板：

- **触发按钮**：一个状态点加一个短标签。有工具在飞时标签就是工具名（`bash`），否则是「运行中」或「空闲」。会话没有任何事件时整个控件不渲染。
- **弹层**（点击展开，Esc 或点外部关闭）：

| 行 | 内容 |
|---|---|
| 状态 | `等待工具结果` / `运行中` / `已结束` / `空闲` |
| 回合 / 步骤 | 当前打开的 turn 与 step 编号，没有则为「无」 |
| 最后工具调用 | 工具名 + `进行中` / `已完成` / `失败` |
| 本轮工具调用数 | 当前 turn 内已发起的调用数 |
| 最后事件 | 事件类型，工具事件再附工具名 |
| 结束原因 | 上一个 turn 的 `TurnEndReason.kind`，如 `completed`、`aborted`、`error` |

### 面板不显示什么

- **助手流式文本的进度**。它来自 `agent/assistant-stream`，是进程内帧、不落日志，因此无法跨投影线路传输；它只存在于宿主侧的 `ctx.liveTasks`。面板不会显示一个恒为 0 的假进度条。
- **工具的参数与结果内容**。这里只给「谁在跑」，内容去对话记录里看。
- **历史回合**。只有最新状态，没有回合列表，也没有耗时统计。
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

## 客户端半的构建状态

**`lib/client.js` 还没有产出。源码已经通过类型检查。** 两句都要看，少看一句就会误判本包的状态。

已经拿到的证据（对照时间 2026-09-21 17:55；工作区同时被并行任务改动，事实以该时刻为准）：

| 检查 | 结果 |
|---|---|
| `pnpm --filter soia-dsh-client-ui-live-tasks run build:types` | ✅ 通过；同时跑宿主与客户端两个 program，产出 `lib/types/**/*.d.ts`，其中 `lib/types/client/index.d.ts` 正是 `exports["./client"].types` 声明的路径 |
| 客户端半类型检查 | ✅ `tsc -p tsconfig.client.json --noEmit` 0 错误 |
| `pnpm vitest run packages/client-ui-live-tasks` | ✅ 65 个用例通过 |
| `pnpm exec oxlint packages/client-ui-live-tasks` | ✅ 0 warning 0 error |
| `lib/index.js`（宿主 bundle） | ⚠️ 存在但**过期**：187,588 字节，根侧构建于 17:44:01，早于本包源码此后若干次修复 |
| `lib/client.js` | ❌ **不存在** |
| 真实加载与界面渲染 | ❌ **从未发生** |

### 类型检查能过，靠的是什么

客户端半之所以能被类型检查，是因为并行任务已经跑过一次 `pnpm install`，把本包 `devDependencies` 里的 `react`、`@types/react` 与 `@deepseek-ai/dsh-client-*` 装进了工作区。

单包编译必须**显式加载它扩展的契约**。官方 monorepo 有一个客户端聚合 tsconfig，所有客户端包在同一个 program 里，`declare module` 增补自动生效；本包只编译自己，所以 `src/client/index.ts` 顶部有四个 `import type {} from '@deepseek-ai/dsh-client-*/client'`，分别带来 SlotMap 条目（ui-conversation）、会话标准道具 `useProjection`/`useSession`（ui-session）、`ctx.slots`（ui-renderer）与 `ctx.locale`（locale）。它们全是类型导入，浏览器 bundle 不会因此多一个运行时依赖。

**一处必须说清的偏差。** `@deepseek-ai/dsh-client-ui-renderer` 是 `ctx.slots` 的唯一声明来源，但它**不在工作区 pnpm store 里**。为了跑通这次类型检查，本包在 `node_modules/@deepseek-ai/dsh-client-ui-renderer` 放了一份手抄副本（同一版本的已发布包，并把它的 `cordis` 指回工作区实例——否则声明会合并到另一个 `Context` 上）。这份副本在 `.gitignore` 覆盖范围内、不进仓；它的正规等价物是主控把该依赖加入后跑一次 `pnpm install`（本包 manifest 已声明该依赖）。**「0 错误」这个结论依赖那份手抄副本**；换成 pnpm 正规安装后结论应当不变，但那一次复跑要由主控完成。

### 真正还缺的那一步

**共享客户端 tsdown preset 不在本仓，也没有发布到 npm。** 官方包在 `package.json` 的注释里点名它（`packages/client/tsdown.client.ts`），`dsh-client-modules` 的 README 把它列为「Development 期间为 `lib/client.js` 盖章」的那一步。它负责本包完全没有的能力：把 ESM 入口包成 `window.__ModuleLoader__.load({ id, factory: (require) => … })` 的惰性 CJS 工厂、把 `*.module.css` 编译成哈希类名加样式注入、把 `react` / `react/jsx-runtime` 与 `dsh.client.external` 解析成 `require(...)`、以及在所有分块写完后给入口盖 revision。没有它，`lib/client.js` 无法产出可用的文件。

关于根 `tsdown.config.ts` 新增的 browser 分支：它按 `packages/*/src/client/index.tsx` 发现条目，而本包的客户端入口是 `src/client/index.ts`，因此不会被它选中。**本包不去迎合这个分支**：`platform: 'browser'` 的普通 ESM bundle 不是 `dsh-client-modules` 服务的形态——官方包的 `lib/client.js` 全文包在 `window.__ModuleLoader__.load({ id, factory: (require) => … })` 里，宿主把文件原样作为脚本发给页面，页面的 facade 靠这次 `load()` 调用注册工厂。普通 ESM bundle 会被加载，然后什么都不注册。正确做法是补上共用 preset，而不是把入口改名去换一个格式错误的产物。

### 宿主产物是过期的

`lib/index.js` 是**根侧构建**的产物，不是本包自证的：根 `tsdown.config.ts` 已改为按 `packages/*/src/index.ts` 自动发现条目，所以宿主半会被构建出来。它必须重建——CI 的 `verify:lib` 会重新构建再与提交的 `lib/` 比对，过期即红。本包按任务约束没有跑根级构建，因此也没有自行重建它。

同一次构建还暴露一个根侧口径问题：bundle 有 187 KB，因为 `zod`（本包 `dependencies` 里的运行时依赖）被**内联**进了产物，而根配置的 `deps.neverBundle` 只覆盖 `/^@deepseek-ai\//` 与 `playwright-core`。已核实的边界：`@deepseek-ai/cordis` 保持 external；`@deepseek-ai/dsh-session` 只以 `import type` 出现、运行时被擦除，所以产物里没有对应的外部导入。

### 根侧已经关掉的一条

根 `tsconfig.json` 现在带有 `"exclude": ["packages/*/src/client/**"]`（并行任务已加）。这正是单包客户端源码需要的位置：客户端半由各包自己的 `tsconfig.client.json` 覆盖，根 program 不再用宿主选项（无 DOM、无 `jsx`）去编译它。因此根 `pnpm run typecheck` 不会再因本包客户端源码报 TS2307。

**这些缺口没有被绕过**：本包没有为了让检查变绿而删掉客户端源码，也没有伪造一个手工拼的 `lib/client.js`。浏览器半的类型层面已经站住，但它**没有构建、没有加载、没有渲染过**，任何「界面上应该能看见」的说法目前都没有证据。

### 面板的可见范围只由投影决定

投影只由**已提交的会话事件**驱动。这意味着面板里的每个字段都能在持久日志里找到出处，重启页面或重启宿主后重新折叠会得到同样的值；代价是瞬时帧推动的字段（见上）永远到不了页面。

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

- **`lib/client.js` 没有产出，宿主产物是过期的。** 客户端源码已通过类型检查，但共享客户端 preset 缺席使 bundle 无法产出；宿主 bundle 由根侧构建产生、且早于源码定稿。证据到哪一层见上文 [客户端半的构建状态](#客户端半的构建状态)。这是本包最大的缺口：源码与类型产物在仓里，可安装、可信任的产物不在。
- **`ctx.liveTasks` 目前没有任何消费者。** 它存在的理由是 `agent/assistant-stream` 是进程内帧、投影线路载不动，所以需要一个宿主侧落点；但仓内没有第二个包读它。它现在是给诊断与后续宿主消费者准备的面，不是被验证过的能力。
- **面板看不到流式文本进度。** 见上文「面板不显示什么」。想让页面也看到进度，需要一条能把瞬时帧送到浏览器的线路，而投影注册表按契约只由已提交事件驱动。
- **投影键是进程级的，不是每会话能力信号。** 任何一个预设注册了 `liveTask`，每个会话的快照里都会出现这个键；面板读的是值，不是键的存在与否（官方 `dsh-session-projection` README 把这条列为该注册表自身的限制）。
- **只有最新状态，没有历史。** 折叠只保留「现在」：上一个 turn 的工具调用会被下一个 `turn/start` 重置，回合列表与耗时统计都不在本包范围内。
- **结束原因是协议词，不是本地化文案。** 面板原样显示 `completed` / `aborted` / `error` 等 `TurnEndReason.kind`；理由是未知的。转成人类措辞需要一份随协议增长的映射表，当前没有做。
- **瞬时文本增量的重复帧会重复计数。** 文本增量没有序号，只按 `time` 与当前步骤筛；同一毫秒内的真实增量都会计入，而重放的瞬时帧也会。这是显示层的计数偏差，且会被该步骤的 durable `assistant/message` 归零，不影响任何其他字段。
- **`streamedTextLength` 只在宿主可用。** 它衡量「模型正在写」，但客户端半读不到；宿主消费者要自己判断这个字段的用途。
- **兼容性未经实测。** `dsh.compatibility.dsh` 的范围 `>=0.1.0-rc.8 <0.2.0` 是生态惯例写法；按 node-semver 的严格语义，该范围不匹配预发布版，peer 依赖因此逐个列举了已发布的预发布版本。本包**没有在任何 profile 里加载过**：既没有 `--dump-config` 的配置层证据，也没有 `pluginInventory/list` 的加载证据，更没有一次真实的界面渲染。
