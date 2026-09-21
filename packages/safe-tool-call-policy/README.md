---
description: "DSH 宿主策略包：在命令与文件写入真正执行之前匹配危险模式，命中则要求确认或拒绝，并给出一句合规做法。不注册工具、不加提示词段。"
kind: "package-bundle"
---

# soia-dsh-safe-tool-call-policy

DSH 宿主策略包：**在执行之前**检查一次工具调用，命中危险模式就要求确认（`ask`）或拒绝（`deny`），并附带一句「如何合规地做同一件事」的建议。

[English](README.en.md)

## 这个包做什么

模型发起的命令与文件写入在执行前经过两道宿主钩子。本包把调用压成一行可匹配文本，对着危险模式清单逐条匹配，然后只做两件事之一：

- **要求确认**（`ask`）：走 `tools/pre-execute` 瀑布，由宿主的审批通道决定是否放行；没有审批通道的部署会退化成官方语义的拒绝。
- **拒绝**（`deny`）：走 `ctx.tools.guard()`。guard 是单调的、没有 allow 结果，所以**后面的监听器无法把已下的拒绝改回允许**。

两条都带同一句话格式的原因与合规做法，模型看得到，人也能照做。

它**不注册任何工具，也不加提示词段**：常驻模型上下文为零 token（`dsh.tokenBudget.resident: 0`）。唯一的模型可见文本是「被拦下的那次调用」自己结果里的一行原因。

## 安装

尚未发布到 npm；用 git 源安装（`lib/` 随仓提交，装完即可用）：

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/safe-tool-call-policy'
dsh --profile <profile-name> --dump-config   # 先只验证配置层，不启动服务
```

发布到 npm 后用包名：`dsh plugin --profile <profile-name> add soia-dsh-safe-tool-call-policy`。

`cordis.patch.yml` 只贡献一行 `insert`：`id: safe-tool-call-policy`，`name: soia-dsh-safe-tool-call-policy`。本包不需要任何配置项，也不需要环境变量。

## 危险模式清单（第一版）

清单真源是包根的 [`danger-patterns.json`](danger-patterns.json)，随包发布（在 `files` 白名单里）。

| id | 命中什么 | 动作 | 出处 |
|---|---|---|---|
| `data-root-write` | 写入真实应用数据根：`~/.<app>`、`$HOME/.<app>` 这类 home 点目录，或 `/etc`、`/var/lib`、`/usr/local`、`/Library`、`/System` 这类系统数据路径 | `deny` | `memory:executor-real-home-writes` |
| `secret-in-argv` | 命令行里出现凭据字面量：`Authorization:` 头、`--token=` / `--api-key=` / `--password=` 形态、JWT、常见 token 前缀、`-p<密码>` | `deny` | `memory:secret-in-argv` |
| `failure-as-evidence` | 未加引号的 `--include=*` glob、`ugrep`、或把首段错误丢弃的 `2>/dev/null` 管道 | `ask` | `memory:failed-command-not-evidence` |
| `git-danger` | 共享检出上的 `git stash` / `git checkout` / `git add -A` / 未用 `--only <pathspec>` 的 `git commit` | `ask` | `memory:concurrent-git-index` |
| `high-impact-action` | 装包发布与大面积破坏：`npm publish`、`rm -rf` 指向根/家目录/通配/上级目录、`git worktree remove --force`、`rsync --delete`、整文件重定向覆盖样式表 | `ask` | `codex-memory:failures` |
| `destructive-cleanup` | `git worktree remove --force`，或 `rm -rf` 指向含 `worktree` 的路径 | `ask` | `memory:worktree-cleanup-rule` |

每条规则的字段固定为 `{ id, tool, pattern, action, reason, remedy, source }`：`tool` 是 `bash` / `write` / `edit` / `*`，`pattern` 是 JS 正则，`reason` 与 `remedy` 是各一句英文（模型可见），`source` 记录真实出处。

**匹配的是哪一段文本**：`bash` 匹配命令行；`write` / `edit` 匹配 `"<工具名> <file_path>"`（工具名充当写入动词），**不匹配写入内容**；其它工具压成空文本，不参与匹配。

**优先级**：一次调用可能同时命中多条（`rm -rf ~/.app` 既是 home 数据写入又是大面积 `rm -rf`）。先按严重度取 `deny` > `ask`，同级按规则顺序取第一条。上例的结果是 `deny`，规则 `data-root-write`。

## 项目覆盖

项目可以用 `<项目根>/.dsh/policy.yml`（或 `.dsh/policy.json`）**追加、覆盖、禁用**规则。两个文件同时存在时以 `policy.yml` 为准；两个都不存在时用内置清单。项目根取会话工作目录（无会话时为进程 cwd）。

```yaml
# .dsh/policy.yml
disable:                     # 按 id 移除，优先级最高
  - failure-as-evidence
rules:
  - id: no-prod-db           # 新 id → 追加
    tool: bash
    pattern: "psql\\s+-h\\s+prod\\b"
    action: deny
    reason: This command connects to the production database.
    remedy: Use the staging DSN from the environment instead.
    source: project:.dsh/policy.yml
  - id: high-impact-action   # 已有 id → 就地替换（可以放松为 ask，也可以换成项目措辞）
    tool: bash
    pattern: "\\b(?:npm|pnpm)\\s+publish\\b"
    action: ask
    reason: Publishing is a project-gated action here.
    remedy: Run the release workflow instead of publishing by hand.
  - id: git-danger           # 或者直接退役一条内置规则
    action: allow
```

生效顺序：先应用 `rules`（同 id 就地替换、新 id 追加），再应用 `disable`——所以 `disable` 永远赢。

`.yml` 走本包自带的**严格子集**读取器（块映射、`- ` 块序列、纯量/单引号/双引号、JSON 或裸逗号列表、整行与行尾注释）；块标量、锚点、别名、标签、多文档、重复键都不支持，遇到即报错。需要完整 YAML 时用 `.json`：JSON 是这套子集的子集。

**失败语义一律放行**，并且都写进宿主日志（`ctx.logger.warn`，前缀 `safe-tool-call-policy:`）：

| 情况 | 结果 |
|---|---|
| 项目没有配置文件 | 用内置清单 |
| 项目配置文件读不出、解析不了、顶层形状不对 | **全部规则停用**（放行全部调用）+ 说明原因的日志 |
| 文件能读但某一条规则不可用（缺字段、动作/工具未知、正则编译失败、id 不是 kebab-case） | 只丢那一条 + 日志，其余规则照常生效 |
| 内置清单本身读不出（安装损坏） | 全部规则停用 + 日志 |
| 评估过程抛出任何异常 | 放行该调用 + 日志 |

配置损坏时**不回退到内置清单**是有意的：项目可能正是在放松或禁用那几条内置规则，回退会造出一个用户没有要求的新失败面。

## 设计说明

- **形态**：纯宿主策略钩子，与官方 `dsh-spill-policy`、`dsh-tool-call-timeout-policy` 同形——导出 `name` / `inject` / `apply`，`inject` 只有 `tools`，不注册服务、不注册工具、不加提示词段、没有客户端 bundle。
- **分层**：纯匹配器 `src/shared/evaluate.ts`（`evaluateCall(call, rules)`，无 I/O、无 DSH 依赖）、类型 `src/shared/types.ts`、原因渲染 `src/shared/reason.ts`；Node 侧 `src/host/`（调用适配、文档解析、YAML 子集、文件加载）；`src/index.ts` 只做钩子接线与项目根解析。仓结构见 [docs/structure.md](../../docs/structure.md)。
- **副作用注册**：`tools/pre-execute` 监听器与 guard 都注册在插件 fiber 上（guard 用 `ctx.effect`），插件释放时自动注销。
- **依赖**：`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools` 只声明为 peer（同时镜像到 dev），由宿主提供，构建时保持 external。本包没有任何运行时依赖——连 YAML 也是自带子集读取器，所以离线可测、无 lockfile 追加。
- **一次性读盘**：每次受检调用都会读一次内置清单与项目配置，没有缓存；这样改配置立即生效，代价是每次调用两次小文件读。

## 配置与环境变量

- **cordis 行内配置**：无。本包不实现 `Config`，插件行不需要（也不接受）配置项。
- **环境变量**：无。本包不读任何 `SOIA_*` 变量。
- **项目级配置**：`<项目根>/.dsh/policy.yml` 或 `.dsh/policy.json`，格式见上。

## 许可

MIT。版权行见仓库根 [`LICENSE`](../../LICENSE)。

## Model Experience

### 被拦下调用上的一句话原因

#### What the model sees

本包不往系统提示词、工具表或任何常驻上下文里加东西。模型唯一会读到的本包文本，是**它自己那一次被拦下的调用**的结果里的一行（`ask` 决议的 `reason`，或 guard 返回的拒绝原因）。渲染模板只有一种：

##### Verbatim reason line

```markdown
<规则 reason> <规则 remedy> (safe-tool-call-policy rule: <规则 id>)
```

以 `git-danger` 为例：

```markdown
This git command mutates shared checkout state — stash, checkout, add -A, or a commit that stages whatever is already in the index — so it can pick up another worker's in-progress changes. Do the same operation against explicit paths (git commit --only <pathspec>) or in a separate worktree, and leave the shared index untouched. (safe-tool-call-policy rule: git-danger)
```

项目覆盖里的 `reason` / `remedy` 会替换这段文本；`rule id` 用项目自己填的 id。

#### Token effect

**常驻为 0**：没有工具 schema，也没有提示词段，`dsh.tokenBudget.resident` 声明 0，`pnpm run check-token-budget` 从构建产物重算也是 0。

**单次代价**：只有被拦下的那次调用会多出这一行。实测六条内置规则的渲染长度 361–480 字符，按宿主 token-meter 的固定密度（≈4 字符 1 token）约 91–120 token；最长的是 `failure-as-evidence`（480 字符 ≈ 120 token）。放行的调用不增加任何文本。

#### KV Cache effect

仅追加。这行文本进的是**工具结果**，不是系统提示词、工具表或运行时上下文快照，所以可复用的请求前缀不受影响；不同规则给不同文本也不会让已有前缀失效。本包自身不持有任何逐轮上下文。

## Known Limitations and Deferred Work

- **匹配是正则启发式，不理解意图。** 字符串里提到 `rm -rf ~/.app`（例如 `echo` 一段说明）、或者只是把这类路径当参数传给不写盘的命令，都可能命中；反向也有漏网：非内置清单里的写入方式不会被识别。命中只代表「值得看一眼」，不代表「一定是危险动作」。
- **`write` / `edit` 只看目标路径，不看写入内容。** 把一个含 `rm -rf /` 的脚本写进文件不会被拦——本包不读文件内容（读了会把文档正文里的示例也当成命中）。
- **只认 `bash` / `write` / `edit`。** 其它命令工具（如 PowerShell 工具）与自定义工具压成空文本，不参与匹配；`tool: "*"` 也只覆盖这三种。
- **「并发检出上」无法用正则判断。** `git-danger` 对所有 `git stash` / `git checkout` / `git add -A` / 未带 `--only` 的 `git commit` 都问一次；`git checkout -b` 明确排除，`git stash list` 仍会被问到。
- **「工作目录之外」用固定清单近似。** `data-root-write` 的系统路径分支只覆盖 `/etc`、`/var/lib`、`/var/db`、`/usr/local`、`/Library`、`/System`，没有按调用 cwd 做真正的相对比较（那需要把规则从纯正则升级成带路径语义的判定）。
- **「视觉改版」只能靠批量覆盖代理识别。** 目前只有「整文件重定向覆盖样式表」这一种信号（`> x.css`），改设计稿、调布局这类动作没有任何信号；真正的视觉影响判断不在正则能力范围内。
- **`~/.local/bin` 是有意放行的**：`install … ~/.local/bin/<工具>` 是常规安装动作。代价是 `~/.local` 下的其它路径只能靠 `.local` 之后的点目录形态命中。
- **每次受检调用读两次盘。** 内置清单与项目配置都不缓存，配置改动即时生效；按项目根缓存（以及文件监听）尚未实现。
- **配置损坏 = 放行，且只有日志这一个信号。** 没有把「策略已停用」推给模型或界面的通道，操作者只有宿主日志可看；而且每次都重新读盘、每次都记一条 `warn`，配置一直坏着就会每次都刷一条。是否要在结果里附提示、或把日志降成「每个项目根只报一次」，尚未决定。
- **YAML 只支持子集。** `.yml` 的读取器只认文档里演示的形状；块标量、锚点、flow mapping、多文档都会直接报错（然后按上面的失败语义放行）。完整 YAML 支持如果要加，需要引一个解析器依赖，本版刻意不引。
- **插件行内配置未实现。** 项目只能通过 `.dsh/policy.yml` 覆盖，不能在 profile 的插件行里传规则；多项目共享一份 profile 时，规则按会话工作目录分别解析。
- **`deny` 不短路其它插件的 `ask`。** guard 在所有 `tools/pre-execute` 监听器之后运行，所以另一条插件先提出的确认仍可能弹给用户，随后才被本包拒绝；结果正确（拒绝优先），但用户可能白确认一次。
- **加载与真实调用尚未实测。** 本版有单测（83 例）与三份聚焦检查（vitest / oxlint / build:types）背书，但**没有**在真实 DSH 会话里装进 profile 跑过：`--dump-config` 层的证据、`fiberPhase: active` 的加载证据、一次真实的 `ask` / `deny` 调用证据都还没有，也没有登记到 [docs/verification.md](../../docs/verification.md)。
- **兼容性未经实测。** `dsh.compatibility.dsh` 的范围 `>=0.1.0-rc.8 <0.2.0` 是生态惯例写法；按 node-semver 的严格语义，该范围不匹配预发布版，所以 peer 依赖逐个列举了已发布的预发布版本。本包的类型与扩展点按 DSH `0.1.6-alpha.2` 的声明编写。
