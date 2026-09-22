# DSH 插件：建库方案与候选盘点（定稿）

> 本文件原在会话的本地 storages 下，2026-09-22 迁入本仓 `docs/`，成为唯一真源；对外表述已按仓规去掉客户产品名与账号标识，技术内容未改。


> 范围：只做**开发体系**相关的 DSH 插件；任务与进度、多智能体角色插件化不在本次范围。早前 v1/v2 草稿作废。
> 2026-09-21 按第三方审阅意见逐节处置；处置表、四问回答、事实核对见文末附录。

---

## 一、结论摘要

| 项 | 结论 |
| --- | --- |
| 仓 | `soia-team/soia-open-dsh-plugins`（public，已建并推送，`origin` 走 SSH） |
| 第 1 批（顺序 **2 → 1 → 3**） | 危险动作门禁、界面尺寸核对、质量门核对；不需前端、不依赖 npm |
| 第 2 批 / 第 3 批 | 文件哈希核对、技能触达核对 ／ 长任务实时视图（**需前端打包**） |
| 未排期（已登记） | 跨宿主门禁适配（Claude hooks / Codex approval），三端共用 `danger-patterns.json` |
| 不做 | MCP 入口、改技能仓、治理与角色、成本额度仪表 |
| npm | 保留组织 `<npm 组织>`（删 `soia`）；包名无 scope（`soia-dsh-*`）；发布前 registry 切回官方 |
| 分发 | git 源 `#path:packages/<pkg>`；`lib/` 随仓提交，CI 守卫防漂移 |
| 分支保护 | `main`、`dev` 均强制走 PR（直接 push 拒 `GH006`）；合并权白名单 |
| 已完成验收 | 插件 1：六道门 + 隔离 profile `active`（V1）+ 真实模型调用（V2/V4）；V3 未做 |
| 覆盖边界 | 插件 2 = **DSH 侧**门；Codex / Claude Code 未覆盖 |
| 头号风险 | 门禁**必须装进执行者的 profile** 才生效（未在真实派单链路验证） |
| 常驻成本 | 第 1 批合计 **≈320 token**（插件 1 实测 179，脚本口径 + CI 断言）；六个合计 ≈589 |

---

---

## 实施进展（2026-09-21 夜，截至 19:45）

| 包 | 代码 | 测试 | 配置层 | 加载 | 真实调用/界面 |
| --- | --- | --- | --- | --- | --- |
| `soia-dsh-tool-check-ui-size` | ✓ | ✓ 18 | ✓ | ✓ | ✓ 模型自选工具；✓ V3 与调用方夹具对拍（22px） |
| `soia-dsh-safe-tool-call-policy` | ✓ | ✓ 83 | ✓ | ✓ | ✓ 拦住 `rm -rf ~/.myapp/cache` |
| `soia-dsh-tool-check-quality-gates` | ✓ | ✓ 58 | ✓ | ✓ | ✓ 读本仓 `.dsh/gates.yml` 出门清单 |
| `soia-dsh-tool-check-file-hash` | ✓ | ✓ 34 | ✓ | ✓ | ✓ 返回 sha256（与本机 `shasum` 一致） |
| `soia-dsh-tool-check-skills` | ✓ | ✓ 70 | ✓ | ✓ | ✓ 读本会话日志（目录 15 技能，`unreported`） |
| `soia-dsh-client-ui-live-tasks` | ✓ | ✓ 65 | ✓ | ✓ | ✓ 「任务」页签与 对话/轨迹 同排 |

- 测试合计 **328 用例**；仓级 **八道门**（新增 `pnpm run typecheck:client`）全绿。
- **本机安装验证**：`scripts/verify-local-install.sh` 打 tarball → 装进一次性 profile → 六行全部命中 → 启动成功（可复跑，不碰 npm、不读凭据）。
- **npm 发布未执行**（按指示暂停）。
- 仍未做：`pluginInventory/list` 的 `fiberPhase` 证据（接口只走 WebSocket mux）；插件 6 页签只读、无操作按钮。

## 二、六个插件

### 插件 1：界面尺寸核对 ｜ `soia-dsh-tool-check-ui-size` ｜ id `tool-check-ui-size` ｜ 第 1 批

**界面**：无专属界面；调用时出现通用工具卡片（标题=工具名），「设置 → 插件」有一行。

**做什么**：量元素**真实渲染**的尺寸与位置，不读 CSS 声明。

**依据**：「CSS 声明正确 ≠ 实际几何正确」；「声明 `min-height27` 正确，但实测仍 34，板实测 27」（`docs/governance/goals/receipts/2026-09-16-unresolved-ledger.md`）。

**参考资产**：

| 类别 | 参考谁 | 参考什么 |
| --- | --- | --- |
| 自有资产（直接前身） | `apps/web/.../shellfix-computed-style.browser.mjs`（104 行） | 不复制、不调用——它写死单次任务的选择器与期望值 |
| 自有资产（判据） | `scripts/design_board_fit.cjs`、`design_controls_visible.cjs` | 第 1 批不搬，先只做测量 |
| 市场同类（差异） | `dsh-vision-toolkit`（★882） | 截图交视觉模型判断，给估计值；本插件读 DOM 精确值，不替代 |

**功能**：F1 `measure`＝实测几何 + 计算样式（`min/max-height`、`padding`、`font-size`、`line-height`、`box-sizing`）+ 可见性；F2 `compare`＝声明 vs 实测 + 差值；F3 `overflow_check`（含滚动容器豁免）；F4 `hit_test`（`elementFromPoint`）；F5 固定字段证据。**不做**截图视觉判断。

| # | 判据 | 不通过 |
| --- | --- | --- |
| V1 加载 | `--dump-config` 命中 `tool-check-ui-size`；一次性 profile 内 `pluginInventory/list` = `active` | 行在但非 active |
| V2 读数 | 声明 `min-height: 27px` → 实测 `34px`、`diff = 7px` | 报 27 |
| V3 对拍 | 同选择器与 `shellfix-computed-style.browser.mjs` 各自独立跑，读数一致 | 数字不一致 |
| V4 证据 | 字段固定 + URL + 时间戳，可被回执引用 | 字段缺 / 结构漂 |

**现状（2026-09-21，证据 `docs/verification.md`）**：V1 ✓／V2 ✓（34px、`diff.height = 7`；含一次真实模型调用——模型自选 `check_ui_size`、参数正确）／V4 ✓；V3 未做（待调用方给页面与选择器）。常驻 179 token（工具块 144 + 提示段 35；2026-09-21 瘦身 −25%，由 `pnpm run check-token-budget` 断言）。
**与 7.2 的差距**：V2 用缺陷形态夹具页，非调用方线上页。

**实现**：宿主工具；`src/host/measureElement` 纯函数（不依赖 DSH，MCP 入口复用）；`playwright-core ^1.63.0` + headless Chrome，路径按 `SOIA_CHROME_EXECUTABLE` 覆盖（厂商前缀），否则探测 Chrome/Chromium/Edge。无前端。字段与错误码见产出物表。

---

### 插件 2：工具调用安全策略 ｜ `soia-dsh-safe-tool-call-policy` ｜ id `safe-tool-call-policy` ｜ 第 1 批

**界面**：无专属界面；**拦到时**出现确认 / 拒绝交互，平时看不到。

**做什么**：DSH 执行命令 / 写文件**之前**检查，命中危险模式则拦下或要求确认。

**定位**：**DSH 侧可执行门**，拦"AI 调 DSH 工具"这一层。

| 项 | 结论 |
| --- | --- |
| 覆盖 | DSH 会话（`web`/`tui`/`headless` 装了即生效） |
| 不覆盖 | Codex / Claude Code / 其它宿主（不走 DSH 工具执行链，MCP 也拦不住）；已登记未排期 |
| 表述纪律 | 只写"DSH 会话中命中规则的命令被拦（附报文）"，不写"真库事故已解决" |
| 生效前提 | **必须装进执行者用的那个 profile** |

**依据**：「行为地雷…只以铁律形式续传，**无可执行门**」（`docs/handoffs/dsh-kickoff-prompt-2026-09-21.md`）；真库被迁三次（04:11、07:18、08:55:40，v15→v16，Owner 起床前 App 不可用）；token 进 `curl -H` argv。

**事故宿主**：三次迁真库的执行者都是 **dsh**（`executor-real-home-writes.md`：04:11／07:18／08:55:40，v15→v16；原文见附录事实问题 1）。审阅"不在 DSH 会话"不成立——`agent-roster` 指的是主控窗口在 Codex，非执行者宿主。

**清单来源**（→ 仓内 `danger-patterns.json`，每条带 `source`，三端共用）。**谁出清单**：v1 由我从下面三处提炼，**不需要调用方手写**；调用方只审这份 JSON（约十条，一屏读完）：

| 来源 | 已核条目 |
| --- | --- |
| `~/.claude/projects/<调用方项目>/memory/`（42 文件） | `executor-real-home-writes`、`failed-command-not-evidence`、`sentinel-self-match`、`concurrent-git-index`、`sha-from-command-output`、`mutation-full-compile`、`worktree-cleanup-rule` |
| `~/.codex/memories/MEMORY.md` Failures 段（5 段） | EBADPLATFORM、cached daemon URL 失效、CLI render success ≠ desktop interaction、visual revision dispatched before owner stops it、design logs bloated by base64/binary |
| `2026-09-16-unresolved-ledger.md` | 声明 27 / 实测 34 类几何欠账 |

| # | 命中 | 动作 | 出处 |
| --- | --- | --- | --- |
| R1 | 未设隔离环境变量就 import / 测试 / 迁移真实数据根 | `deny` | `executor-real-home-writes` |
| R2 | 凭据进 argv / 日志（`curl -H` 带 token） | `deny` | 泄露回归 |
| R3 | 失败命令或空输出当证据（`grep` 未引号中止、`ugrep` 报错） | `ask`（要 `exit=`） | `failed-command-not-evidence` |
| R4 | 并发检出上 `git stash` / `checkout` / `add -A` / 未用 `--only` 的 `commit` | `deny`/`ask` | `concurrent-git-index`（2026-09-12 卷走 3 个已 stage 文件） |
| R5 | 高影响动作未确认就派发（视觉改版、批量覆盖、装包/发布） | `ask` | Codex `MEMORY.md` §4 |
| R6 | 共享 checkout 上 `worktree remove --force` / `rm -rf` 未先查 claim/reviews | `ask` | `worktree-cleanup-rule`（丢 11 个冻结资产） |

**参考资产**：

| 类别 | 参考谁 | 参考什么 |
| --- | --- | --- |
| 官方同类策略插件 | `dsh-fs-observation-policy` | 读后写保护：拒绝 + 明确指示重新读取——"策略插件"的官方范式 |
| | `dsh-sandbox-policy` | 每次调用施加同一策略，且**在请求前把生效策略告知模型**（避免"为什么被拦"的困惑） |
| | `dsh-tool-call-timeout-policy`、`dsh-spill-policy` | 失败语义：策略自身出问题就**放行并保留原结果**，不制造新的失败面 |
| 自有资产 | 记忆区（R1–R6 的出处）、`scripts/check_home_isolation.py` | 规则来源；事后门保留，本插件是事前拦 |
| 市场同类（差异） | `dsh-approval-gate`（Flash 预判越界 + 人工确认 + 确认制学习）、`dsh-auto-mode`（官方沙箱内自动放行 + 越界分类） | 它们做"智能分类放行"；本插件做**从真实事故提炼的确定性规则 + 0 常驻 token**，清单可被调用方覆盖 |

**实现**：宿主钩子 `tools/pre-execute`（`deny`/`ask` + `ctx.approval`；最终拒绝用 `ctx.tools.guard()`）；常驻 **0**；清单可被调用方覆盖/追加；与 `check_home_isolation.py` = 事前拦 / 事后门；`ask` 优先于 `deny`，每条规则附合规写法。无前端。

**验收**：① 一次性 profile 跑命中 R1 的命令 → 被拦 + 报文；② 合规命令 → 放行；③ 每条规则正 / 反例各一在包内测试跑通；④ 结论只写"DSH 会话中被拦"。

---

### 插件 3：质量门核对 ｜ `soia-dsh-tool-check-quality-gates` ｜ id `tool-check-quality-gates` ｜ 第 1 批

**界面**：无专属界面，同插件 1（通用工具卡片）。

**做什么**：输出"这次改动该跑哪些门 + 每门要贴什么证据"。

**假设修正**：门很全（`verify_integration.sh`：15 Python/Docs + 7 domain + 6 web = **28 门**）、没人跑（当天 `GOAL_STATUS_CACHE: DRIFT`，drift=2）。本插件只输出"该跑什么 + 原始 EC"，不发明新门。

**依据**：「审核清单里没有这四个门」；「错误目录找 tsc 与重复基线测试」；`mutation-full-compile`（只编一半 → 测试照绿 → 误判"变异不红"）。

**输出**：`{changedFiles, requiredGates:[{id, command, reason, rawEvidenceRequired}], source, enforcement:"none"}`

**边界**：① **不阻止未跑门**（`enforcement` 恒为 `"none"`）；② 强制在调用方（pre-commit / CI required check），本插件不代管别人的 CI；③ 不内置任何项目的脚本名，读 `.dsh/gates.yml`。

| 顺带规则 | 判定 | 出处 |
| --- | --- | --- |
| 回执分列「适用技能」与「实际加载的技能」 | 缺列 → 不合格 | `execution-policy.md:60/236`、`dsh-kickoff-prompt:132` |
| 派单带「适用技能」段 | 缺段 → 提示 | 同上（`dispatch-applicable-skills`） |
| 变异测试全量编译 | 只编一半不算证据 | `mutation-full-compile` |

**参考资产**：

| 类别 | 参考谁 | 参考什么 |
| --- | --- | --- |
| 官方扩展点（**形态已定**） | `dsh-commands`、`dsh-command-goal` | 命令与其输出不进模型请求（0 常驻），但**只能由人在界面敲**——本项目不敲命令，故排除；本插件定为**工具**（模型自取，≈140） |
| 自有资产 | `scripts/impact_checklist.py`（752 行） | 薄包：它已从 `AGENTS.md`／`ci.yml`／`validation.md` 解析规则 |
| 市场同类 | 无直接同类（"门禁"类插件多是叙事流程或访问控制） | 这块没有现成替代 |

**实现**：宿主工具；包 `scripts/impact_checklist.py`（752 行，从 `AGENTS.md`/`ci.yml`/`validation.md` 解析规则）；常驻 ≈140；无前端。

---

### 插件 4：文件哈希核对 ｜ `soia-dsh-tool-check-file-hash` ｜ id `tool-check-file-hash` ｜ 第 2 批

**界面**：无专属界面，同插件 1。

**做什么**：对文件 / 产物算内容哈希留证，核对回执所写与实际是否一致。

**依据**：「主控两次凭记忆写 SHA 造出 **3 道假红**」；E3 核查「21 条中仅 4 条成立、14 条漂移、3 条不存在」「行号引用普遍漂移，按符号定位不按行号」。

**纪律**：只留路径 + 哈希 + 时间，不留内容、不留 base64 / 二进制片段（出处：Codex `MEMORY.md` §4）。

**参考资产**：

| 类别 | 参考谁 | 参考什么 |
| --- | --- | --- |
| 官方写文件姿势 | `dsh-atomic-write` | 临时 inode + 权限位 + 跨进程写锁；**证据文件也必须原子写**（半截文件会被当证据） |
| 官方产物语义 | `present`（`dsh-tool-present`） | 只登记路径、不复制内容 → 报告更适合"返回路径，让模型 present" |
| 自有资产 | 记忆 `sha-from-command-output`、E3 核查（21 条仅 4 条成立） | 规则来源与验收口径 |
| 市场同类（差异） | `dsh-better-edit`（哈希锚点编辑）、`dsh-web-file-uploader`（内容寻址去重） | 它们改编辑/上传链路；本插件只产出"可被回执引用的哈希清单" |

**实现**：宿主工具 + `tools/result` 观测；返回 `{files:[{path, algo:"sha256", hash, size}], generatedAt}`，可选写 `<evidenceDir>/hash-<ISO时间戳>.json`（默认不写）；常驻 ≈130；无前端。

---

### 插件 5：技能触达核对 ｜ `soia-dsh-tool-check-skills` ｜ id `tool-check-skills` ｜ 第 2 批

**界面**：无专属界面，同插件 1；面板可选（要面板才需前端打包）。

**做什么**：核对"该用的技能有没有用上；没用上的话，是哪一种病"。三份证据都在会话记录（`$DSH_HOME/sessions`）里：

| 证据 | 取会话的哪一段 | 判什么 |
| --- | --- | --- |
| ① 期望清单 | 任务书「适用技能」段（或调用方传入） | 该用谁 |
| ② 目录快照 | 宿主注入的技能目录（名称 + 截断描述） | 目录里到底有没有 |
| ③ 调用轨迹 | 本会话 `skill("<name>")` 的调用与返回 | 调了谁、几次 |

**判定（五态）**：

| verdict | 含义 | 该查什么 |
| --- | --- | --- |
| `ok` | 期望的都加载了 | — |
| `not_in_catalog` | 目录里就没有 | 技能装没装 / 扫描根对不对（装配问题） |
| `not_attempted` | 目录里有、没调 | 技能描述与触发词没命中任务措辞 |
| `wrong_pick` | 调了别的技能 | 相似技能歧义 → 改名或补区分描述 |
| `loaded_not_effective` | 加载了但交付没体现 | 技能内容没被执行（G0.0.4.39 的真问题） |

无期望清单时返回 `unreported`，不猜。

**为什么不是"找技能"插件**：DSH 没有检索这一步——宿主把"技能名 + 截断描述"目录注入上下文，模型按**精确名字**调 `skill("<name>")`（`dsh-tool-skill` 原话：*Call this with the exact skill name from the available skills list*）。所谓"找不对"落在 ②③ 两种病上，核对能定位；"帮忙找"另立候选（见候选表）。

**增量价值**：现成探针只数加载次数，测不出"该加载的没加载"，更分不出上面五种病；这是它相对 `skill_usage_probe.py`（3529 字节）的增量——只包一层收益≈0。

**依据**：G0.0.4.39「技能送达≠技能生效」；「此前 **18 个执行单均为 0 次加载**；修复后首个执行单加载 `soia-dev-implement-task` 2 次（可见数 1→16）」（`skill-history.md`）；「派单必须带「适用技能」段；回执分列「适用技能」与「实际加载的技能」」（`dsh-kickoff-prompt-2026-09-21.md:132`）。
**取证修正**：原计划"送达 10/10、加载 6/10，引自 `development-goal-graph.md`"——该文件无此数（`G0.0.4.39` 行只写 `ready`）；列**未独立核到**，不作判据。

**参考资产**：

| 类别 | 参考谁 | 参考什么 |
| --- | --- | --- |
| 官方数据源 | `dsh-tool-skill`（目录 + 精确名加载）、`dsh-skill-filesystem`（扫描根 / frontmatter / watch） | ②③ 的取数口径按它们的事件形状读，不猜 |
| 自有资产 | `scripts/skill_usage_probe.py`（3529 字节） | 计数口径沿用，另加差集与五态判定 |
| 市场同类（差异） | `dsh-skill-usage`（侧边栏徽章显示在用技能）、`dsh-skill-hub`（浏览/搜索/启停/诊断技能）、`dsh-capability-receipt`（实际加载技能的内容寻址凭证） | 都是"看得见 / 能搜"；**没人做"该加载的没加载"的差集与病因判定**——这就是本插件的位置。`dsh-skill-hub` 已覆盖"找技能"，这是候选 B 不做的第二个理由 |

**输出**：`{task:{applicableSkills, source}, catalog:{count, names[]}, calls:[{name, result}], verdict, missing[], sessionPath}`；可选写 `<evidenceDir>/skill-usage-<ISO时间戳>.md`。

**增量成本**：无新工具、**常驻不增**（≈140）——②③ 都已在会话记录里，只多读两段；任务书侧解析新增 1 文件（≈150 行）。无新依赖、无前端，不阻塞第 2 批。

**边界**：① 与插件 7 共用"枚举判定 + 证据指针"的写法，但**不合并成一个包**（技能 vs 插件，数据源与受众不同）；② 规则若只写在技能里而技能没被读，核对只能"看见"不能"提高"——要提高须宿主侧强制（会话启动注入 / 插件 3 判回执不合格）。

---

### 插件 6：长任务实时视图 ｜ `soia-dsh-client-ui-live-tasks` ｜ id `ui-live-tasks` ｜ 第 3 批

**界面**：✅ 唯一有专属界面——侧栏面板实时显示任务状态。

**做什么**：界面实时显示任务 / 会话的最后工具调用、最后事件、是否在跑；替代轮询日志脚本。

**依据**：

| 证据 | 内容 |
| --- | --- |
| `sentinel-self-match` | 哨兵 `pgrep -f` 匹配到自身、永不退出：2026-09-07 Owner 白等 1.5 小时；2026-09-12 又犯，三条哨兵挂死 1h47m–2h02m |
| `dispatch-throughput` 第 4 条 | 哨兵只盯一个 turn，会话进入下一回合即退出，看着像停了 |
| `liveness-evidence` | 判活要"进程 + CPU 时间 + 日志字节"三件套各取两次；事件流天然有 |

**过渡（插件 6 落地前）**：长任务派发优先用**宿主内置 subagent**，不用 `nohup` + 轮询日志。

**验收**：复现上述两次事故——① 单个 turn 结束后面板仍显示"在跑"；② 无"哨兵匹配自身"类自证循环（读事件流，不看进程名）。

**参考资产**：

| 类别 | 参考谁 | 参考什么 |
| --- | --- | --- |
| 官方同类面板 | `dsh-client-ui-jobs` | 读运行时 `jobsBySession` 镜像、**不发自己的 RPC**；触发器形态可参考（本仓最后选了「视图页签」而非 header 角落） |
| 官方构建 preset（**未发布**） | harness 仓 `packages/client/tsdown.client.ts` | 客户端产物的真实形态：`window.__ModuleLoader__.load({id, factory})` + 惰性 CJS + CSS module 编译；本仓 `scripts/build-client.mjs` 复刻了插件需要的那部分 |
| 客户端插槽契约 | `dsh-client-ui-conversation`（`conversation.view`）、`dsh-client-ui-session`（`useProjection` 是会话标准道具） | 视图页签注册形状 `{name, id, order, label, locale}` |
| 官方数据面（边界） | `dsh-jobs-local`、`dsh-tool-jobs` | jobs 注册表**只活在当前进程、不跨重启**；而我们的执行者是外部 CLI 进程，不在该注册表里 → 面板数据取自 `session/event`，与官方 jobs 面板**互补而非重复** |
| 自有资产 | `scripts/watch-dsh-turn-base.sh` | 被替代的轮询脚本（它只盯单个 turn） |
| 市场同类 | `dsh-dafeiyu`（桌面挂件实时显示 Agent 状态）、`dsh-solution-explorer`／`dsh-codex-ui`（客户端半先例） | 形态与打包方式参考 |

**实现（已落地）**：宿主半订阅 `session/event` + `agent/assistant-stream`，折叠成 `liveTask` 会话投影；客户端半注册进 **`conversation.view`**（与内置「对话 / 轨迹」同源插槽，`order: 20`），用官方原语 `StateDot`/`Tag`/`Pill` 渲染，只读。

**浏览器半产物（本次踩通的坑）**：`dsh-client-modules` 要求声明了 `dsh.client` 的包必须给出 `lib/client.js`，否则**宿主拒绝启动**（实测报文 `client bundles not found … lib/client.js`）。官方那份共享 Client preset 不发 npm，本仓用 `scripts/build-client.mjs` 复刻必需部分：打 CJS（react / JSX runtime / `@deepseek-ai/*` external）→ 包进 `window.__ModuleLoader__.load({ id, factory })`。客户端 `inject` 必须含 `sessions` + `uiConversation`（少一个，插槽标准道具 `useProjection` 装配不出来，表现为"bundle 加载了但什么都不渲染"）。样式不走 CSS module：`src/client/styles.ts` 自注入，类名 `lt-` 前缀。常驻 0 token。

---

### 贯穿约束：插件不绑定具体项目

源码、注释、文档、环境变量、示例不得出现客户产品名或某项目脚本名。

- 环境变量用厂商前缀：`SOIA_CHROME_EXECUTABLE`（原 旧的产品名前缀环境变量 已改）。
- 项目规则由调用方传入：插件 3 读 `.dsh/gates.yml`。
- 数据源用宿主通用面：插件 5 读 `$DSH_HOME/sessions`。
- 验收脚本同理：`scripts/smoke-dump-config.sh` 只依赖 `dsh` 与 profile。

**看不见 ≠ 没生效**：使用者是模型，不是你的眼睛——插件 2 的价值是某条命令被拦，插件 1 是拿到了实测数字。

### 常驻 token 成本

**常驻 = 工具块（模型工具表）+ 提示词段（系统提示词前缀）**，仅工具可见时计入。官方口径约 4 字符 ≈ 1 token；中文真实密度约为其 3 倍，两套一起看。

**形态四选一，前三种常驻 0**：钩子（全自动，模型看不到）／命令（人在界面敲，命令与其输出不进模型请求）／客户端半（界面渲染）／工具（模型自取，付下表这份钱）。插件 2、6 选 0 成本形态；**插件 1、3、4、5 都定为工具——命令形态排除，因为人不敲命令，能力必须由模型自取**。

| # | 插件 | 工具块 | 提示段 | 合计（DSH 口径） |
| --- | --- | --- | --- | --- |
| 1 | `check-ui-size` | 144（实测，瘦身后） | 35（英文，实测） | **179** |
| 2 | `safe-tool-call-policy` | 无 | 无 | **0**（纯钩子） |
| 3 | `check-quality-gates` | ≈140 | 无 | ≈140 |
| 4 | `check-file-hash` | ≈130 | 无 | ≈130 |
| 5 | `check-skills` | ≈140 | 无 | ≈140 |
| 6 | `client-ui-live-tasks` | 无 | 无 | **0**（纯客户端） |
| — | **第 1 批合计（1+2+3）** | — | — | **≈320** |
| — | **六个合计** | — | — | **≈589** |

按 3.6，每个包把声明值写进仓、CI 重算断言——这条已经落地：`scripts/token-budget.mjs` + `pnpm run check-token-budget`（含 CI 步骤），插件 1 声明的 179 是第一条基准线（PR #4，CI 绿）。口径说明：只算模型真正收到的投影（`name`+`description`+`parameters` 的 JSON + 提示段字符），早前手工估的 214/254 把整个注册定义都算了进去，已作废。

**七条纪律**（写进包 README 的 `Model Experience`）：

1. 提示段只放最小不可协商规则（≤3 行）；详细规范留在技能里按需加载。
2. 工具描述只写"是什么 + 何时用"；参数 `description` 用短语。
3. **能做成钩子的别做成工具**（模型需要主动调它吗？不需要 → 钩子）。
4. 模型可见的常驻文本一律英文；中文只留在给人看的文档与按需加载的技能。
5. 不用宿主界面的 token 估算选语言（它按 4 字符 ≈ 1 token，低估中文、高估英文）。
6. 每条常驻成本都要有 CI 断言。
7. 证据类插件只留路径 + 哈希 + 时间，不留内容。

### 产出物

**总规则**：三选一——工具返回值（JSON）／写文件／界面渲染；**默认不落盘**。只有要被回执引用的才写文件，且固定路径与字段。不写用户目录之外的位置，不碰 `$DSH_HOME/profiles/*`。

| # | 插件 | 形式 | 去向 | 字段 / 文件名 |
| --- | --- | --- | --- | --- |
| 1 | `check-ui-size`（已实现） | JSON，不落盘 | 会话记录 | 成功：`status/url/selector/measuredAt/matched/visible/rect{x,y,width,height}/computed{12 项}/viewport/expected/diff`；失败：`status:"error"/code`，`code ∈ {browser_missing, navigation_failed, element_not_found, evaluate_failed}` |
| 2 | `safe-tool-call-policy` | 决策 `allow`/`deny`/`ask` + 理由 | 宿主写进会话事件流 | 无文件 |
| 3 | `check-quality-gates` | JSON，不落盘 | 会话记录 | `{changedFiles, requiredGates[{id,command,reason,rawEvidenceRequired}], source, enforcement:"none"}` |
| 4 | `check-file-hash` | JSON；可选证据文件 | 调用方给的目录 | `{files:[{path,algo,hash,size}], generatedAt}`；`hash-<ISO时间戳>.json`；不含内容 |
| 5 | `check-skills` | JSON；可选报告 | 调用方给的目录 | `{task:{applicableSkills,source}, catalog:{count,names[]}, calls:[{name,result}], verdict, missing[], sessionPath}`；`skill-usage-<ISO时间戳>.md` |
| 6 | `client-ui-live-tasks` | 界面渲染 | 浏览器面板（`session/event`） | 无文件 |

**1、3 不落盘**：产出是一次读数，可重跑；落盘只造第二个真源。**4、5 允许写**：用途是留证，要被回执引用。

**落盘规范（插件 4/5 适用，照官方写法）**：

| 项 | 规则 | 出处 |
| --- | --- | --- |
| 位置 | 只写调用方给的目录；没给就**不写**（默认不落盘）。不写 `$DSH_HOME/profiles/*` | 本仓边界 |
| 命名空间 | 将来若需宿主级持久状态 → `$DSH_HOME/<plugin>/`，带版本目录 | 官方 `attachments/v1` |
| 写法 | **原子写**：临时文件 → `rename`；文件 0600、目录 0700；并发写同一文件要加锁 | `dsh-atomic-write`；`dsh-plugin-manager` 的 `.plugin-manager/logs/`（mkdtemp + 0600 + `wx` 独占） |
| 内容 | 只留路径 + 哈希 + 时间 + 固定字段；不写文件内容、不写 base64/二进制 | Codex `MEMORY.md` §4 |
| 交付 | 写完返回路径，由模型 `present` 声明为交付物（deliverables **只登记路径、不复制内容**） | `dsh-tool-present` |

**验收口径**：返回 JSON 的在 README 写全字段与错误码；写文件的写死目录参数、文件名格式、schema，并断言可解析（含"原子写"与权限位）。所有产出必须可被回执直接引用：固定字段 + 时间戳 + URL / 哈希。

已实现实例：`packages/check-ui-size/README.md`、`docs/verification.md`。

### 更远的候选（不做，仅登记）

| 候选 | 说明 | 暂缓原因 |
| --- | --- | --- |
| 画板对照 `artboard-parity` | 画板渲染结果 vs 实现截图 | 依赖插件 1 |
| 额度探针桥 | `quota_probe.py` 的订阅额度接进 DSH | `dsh-cost-meter` 已够用 |
| 原生拖动取证 | 真机行为自动取证 | 需 macOS 输入注入 |
| worktree 上下文显示 | 会话头显示 worktree / 分支 | 与治理线耦合 |
| 插件体检 `soia-dsh-tool-check-plugins` | 插件行加载状态 + 最近一次真实调用 | 与插件 5 对称（一个管技能、一个管插件），沿用"枚举判定 + 证据指针"写法 |
| **`find-skills` 工具（找技能）** | `find_skills(task)` 按任务措辞对技能目录排序返回候选（名称 + 命中理由） | **先不做**：目录本来就每请求都在上下文里，多搜一遍的收益要等插件 5 的 ② ③ 数据说话。它的独有优势是**破解循环依赖**——`soia-meta-find-skill` 本身是技能，技能没被加载就找不到技能；工具常驻工具表，永远可用。代价：常驻 ≈120–160 token |

---

## 三、建库规格

### 3.1 仓名与可见性

- **`soia-open-dsh-plugins`**（公开域 `soia-open-*` 规范；复数，因装多插件），**直接 public**。
- 不并入 `soia-open-skills` 元仓（技能市场入口，分发物不同），两仓 README 互链。

### 3.2 目录结构（pnpm monorepo）

```
soia-open-dsh-plugins/
├── AGENTS.md / AGENTS.en.md          # 双语工作规则（中文主 + 英文对照）
├── README.md / README.en.md / README.i18n.yaml
├── LICENSE(MIT) / SECURITY.md / CONTRIBUTING.md / CHANGELOG.md / THIRD_PARTY_NOTICES.md / BASELINE_VERSION
├── package.json / pnpm-workspace.yaml
├── tsconfig.json / tsconfig.tests.json
├── tsdown.config.ts                  # 构建
├── vitest.config.ts                  # 测试
├── .oxlintrc.json                    # lint
├── .npmrc                            # registry=https://registry.npmjs.org/（见 4.2）
├── .github/workflows/ci.yml
├── docs/                             # structure.md、verification.md
├── scripts/                          # 烟测 / 发布
└── packages/
    └── check-ui-size/                # 单用途插件 = 一个包（已实现；插件 2/3/… 同级新增）
        ├── package.json
        ├── cordis.patch.yml          # 宿主行：一行 insert
        ├── src/index.ts              # name / inject / apply + 工具注册
        ├── src/host/                 # 取数与判定（不依赖 DSH 的纯函数）
        ├── tests/{host,fixtures}/
        ├── lib/                      # 构建产物，随仓提交（git 安装靠它）
        └── README.md / README.en.md / README.i18n.yaml
```

文档树只在仓根 `docs/`，不在每个包里再建一套。

### 3.3 `package.json` 不变式（照官方 `docs/cookbook/adding-a-package.zh.md`）

| 字段 | 值 |
| --- | --- |
| `type` | `module` |
| `main` / `types` | `lib/index.js` / `lib/types/index.d.ts` |
| `exports["."]` | `{ types: "./lib/types/index.d.ts", default: "./lib/index.js" }` |
| `exports["./client"]` | `./lib/client.js`（仅当有浏览器半，即插件 6） |
| `files` | `lib/index.js`、`lib/types/**/*.d.ts`（+ 客户端产物）；不发 `src`、不发 sourcemap |
| `dsh.bundle.patch` | `./cordis.patch.yml` |
| `dsh.client` | `{ inject: […官方客户端包…], platform: "web" }`（仅插件 6） |
| `dsh.compatibility` | `{ dsh: ">=0.1.0-rc.8 <0.2.0", dshReleases: {…} }` |
| 依赖 | `@deepseek-ai/cordis` 同时进 peerDependencies 与 devDependencies（同范围）；每个 DSH peer 镜像到 devDependencies |

### 3.4 命名规范

| 层 | 规则 | 官方实例 |
| --- | --- | --- |
| npm 包名 | `@<scope>/dsh-<kind>-<name>`；工具类 `dsh-tool-*`，策略类 `*-policy`，客户端界面 `dsh-client-ui-*`，能力 `dsh-<capability>`、提供方 `dsh-<capability>-<mechanism>` | `dsh-tool-bash`、`dsh-sandbox-policy`、`dsh-client-ui-jobs`、`dsh-fs` / `dsh-fs-local` |
| entry id | 去掉 scope 与 `dsh-` 前缀；客户端包再去掉 `dsh-client-` | `dsh-tool-bash`→`tool-bash`；`dsh-client-ui-jobs`→`ui-jobs` |
| 中文名 | 面向人的叫法 | 界面尺寸核对、危险动作门禁 |

六个包用**无 scope + `soia-` 前缀**（不需要 npm 组织，避开 scoped 包收费与 `--access public`）：

| # | 功能 | npm 包名 | entry id | 工具名 |
| --- | --- | --- | --- | --- |
| 1 | 界面尺寸核对 | `soia-dsh-tool-check-ui-size` | `tool-check-ui-size` | `check_ui_size` |
| 2 | 危险动作门禁 | `soia-dsh-safe-tool-call-policy` | `safe-tool-call-policy` | —（钩子） |
| 3 | 质量门核对 | `soia-dsh-tool-check-quality-gates` | `tool-check-quality-gates` | `check_quality_gates` |
| 4 | 文件哈希核对 | `soia-dsh-tool-check-file-hash` | `tool-check-file-hash` | `check_file_hash` |
| 5 | 技能触达核对 | `soia-dsh-tool-check-skills` | `tool-check-skills` | `check_skills` |
| 6 | 长任务实时视图 | `soia-dsh-client-ui-live-tasks` | `ui-live-tasks` | —（客户端半） |

**派生链**：包名去 `soia-dsh-` → entry id → 插件名同 id → 工具名 = id 去 `tool-` 前缀（官方 `dsh-tool-bash` → `bash`）→ 段名 `tool:<工具名>`。已由包内测试逐条断言。
类与服务名按官方 17 个角色词表（`Controller`/`Store`/`Registry`/`Policy`/`Provider`…），不用 `Manager`/`Helper`。第 2 项用 `-policy` 而非 `-guard`：它返回 allow/deny/ask，与官方 `dsh-sandbox-policy`、`dsh-spill-policy` 同类。

### 3.5 文档要求

- README 三件套（`README.md` + `README.en.md` + `README.i18n.yaml`）。
- 官方门禁要求包 README 必须有 **`Model Experience`**（往模型上下文加了什么、token / KV cache 影响）与 **`Known Limitations and Deferred Work`**。
- 扩展点、配置、事件写在 README 前部。
- 根 `AGENTS.md` / `AGENTS.en.md` 同步维护，双语不一致按缺陷处理。

### 3.6 CI 与验收

```sh
pnpm install && pnpm run constraints && pnpm run typecheck && pnpm run lint && pnpm run build
pnpm run test && pnpm run verify:lib        # 提交的 lib/ 必须与源码一致
dsh --profile web --patch packages/<pkg>/cordis.patch.yml --dump-config | grep -q '<entry-id>'
```

CI 另加三项：

1. **隔离 profile 加载验收**：一次性 profile（`dsh --profile ci-smoke --from-default-profile web`）装包启动，查 `pluginInventory/list` = `active`；不用在用 profile。
2. **常驻 token 预算断言（已实现）**：每个包声明 `dsh.tokenBudget.resident`，`pnpm run check-token-budget` 从**构建产物**重算模型可见投影（≈4 字符 = 1 token），超声明值即红；缺声明也红。上限暂定 300/包、第 1 批合计 400。
3. **"钩子优先"检查项**：加工具时 PR 必须回答"为什么必须是模型可见工具，而不是钩子 / 客户端半"。

**三层验收**：① `--dump-config` 证明行进配置树；② `pluginInventory/list` 证明加载；③ 真调一次工具 / 触发一次拦截；④ 技能用插件 5 差集判定，不看加载次数；⑤ 尽量复现真实事故，做不到就写明"只复现形态、未复现线上页面"。

---

## 四、npm 与分发

### 4.1 npm 组织

| 项 | 决定 |
| --- | --- |
| 组织 | 保留 `<npm 组织>`（删 `soia`） |
| 本仓包名 | 无 scope 的 `soia-dsh-*`——发布不依赖组织 |
| 组织用途 | 保留命名空间：将来发私有包（$7/月）或需要 scope 时可用 |
| 费用 | $7/月是**私有包**价；公开包 Free，本仓只发公开包，不产生费用，也不需要 `--access public` |

⚠️ 无 scope 包名全局唯一、先到先得；改成 `@<npm 组织>/...` 等于换包名（已装方需重装）。定死不中途改。

### 4.2 registry

本机 `~/.npmrc` 指向淘宝镜像 `https://registry.npmmirror.com`，CLI 未登录官方 registry。

- 镜像只读，不能发布（实测 `npm org ls` 在镜像上 404）。
- 不改全局配置，**只在插件仓加项目级 `.npmrc`**：`registry=https://registry.npmjs.org/`。
- 发布：`npm login --registry https://registry.npmjs.org` → `npm publish --registry https://registry.npmjs.org`。

### 4.3 备用分发（不依赖 npm）

`dsh plugin --profile web add github:soia-team/soia-open-dsh-plugins`——前提是**把 `lib/` 提交进仓**（先例：`dsh-capability-receipt` 的 `lib/` 就是提交的）。代价：每次发版提交构建产物。

---

## 五、现在不做

| 不做 | 原因 |
| --- | --- |
| 任务与进度、多智能体角色插件化 | 不排期；治理线稳定后再评估 |
| 成本 / 额度仪表 | `dsh-cost-meter` 已够用 |
| 通用代码审查、记忆、worktree 管理、任务看板 | 与自研治理体系冲突，多一套账 |
| MCP 入口 | 等 DSH 侧验证有效后再做（第七节） |
| 跨宿主门禁适配 | **已登记、未排期**；落地前插件 2 表述限定"DSH 侧" |
| 改技能仓 | 第一版规则写在插件里；审阅建议"把 worktree 清理纪律写进技能"本次不采纳（本仓不放技能） |

---

## 六、执行顺序

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| 第 0 批 | 建仓 + 骨架 + CI + 烟测 | **已完成**（分支保护 + CI 绿 + 烟测） |
| 第 1 批 | **插件 2 → 1 → 3** | 不需前端。门禁先装（常驻 0、防不可逆损害）；插件 1 补 V3 与真页面复现；插件 3 包现有脚本 |
| 第 2 批 | 插件 4、插件 5（五态触达核对） | 真实痛点验证过再做；插件 5 增量：约 1 文件、无新依赖、常驻不增 |
| 第 3 批 | 插件 6（+ 面板增强） | **需前端打包**，最重；不提前。落地前用宿主内置 subagent 过渡 |
| 未排期 | 跨宿主门禁适配（共用 `danger-patterns.json`） | 清单随插件 2 在第 1 批落地；适配器另一条线 |

**依赖**：第 1 批不依赖 npm 与前端；第 2 批不依赖第 1 批代码（只共享 schema）；第 3 批依赖前端打包能力——提前它就必须同时引入前端构建链。

---

## 七、将来跨宿主（暂缓，仅备查）

**能力做一份、宿主各配一次**：取数核心只有一份（`src/host/measureElement`），DSH 插件入口与将来的 MCP 入口各包一层薄壳。

```
   ┌──────────────────────────────────────┐
   │  src/host/  取数核心（只维护这一份）    │
   └──────────────────┬───────────────────┘
        ┌─────────────┴─────────────┐
        ▼                           ▼
  DSH 插件入口                 MCP server 入口（stdio）
  apply(ctx) 注册工具           暴露同一函数
        ▼                           ▼
  profile 加一行              Codex config.toml / Claude mcpServers 各加一行
```

- **技能天然跨宿主**：`.agents/skills` 是真身，`.claude/skills`、`.codex/skills` 是指向它的软链，DSH 原生读该目录。
- **门禁类做不成 MCP**：MCP 只能把工具递给 AI，拦不住 AI 调宿主其它工具；故每宿主各写一份适配，**清单只维护一份**。

| 宿主 | 挂在哪 | 决策 | 状态 |
| --- | --- | --- | --- |
| DSH | `ctx.on('tools/pre-execute')` + `ctx.tools.guard()` | `allow` / `ask` / `deny` | **第 1 批做**（插件 2） |
| Claude Code | PreToolUse hook（按 matcher 配），读同一份 `danger-patterns.json` | 允许 / 阻止 + 理由 | 已登记，未排期 |
| Codex | approval 配置 + 同一份清单生成的规则片段 | 允许 / 询问 / 拒绝 | 已登记，未排期 |

排期未定前只说"**DSH 侧已拦**"。

---

## 八、待确认（只列未决项）

| # | 未决项 | 卡在哪 |
| --- | --- | --- |
| 1 | 插件 1 的 V3 对拍 + 线上真页面复现 | 需调用方给页面 URL 与选择器 |
| 2 | 跨宿主门禁适配（Claude hooks / Codex approval）落地 | 责任人与排期未定 |
| 3 | 常驻成本的**差分实测**（179 是字符估算，不是账单实测） | 需再跑一次不带插件的会话 |

已定事项不在本节：组织留 `<npm 组织>` 见 §一、§4.1；第 0 批完成情况见 §六；插件 1 已完成验收见 §二插件 1。

---

## 九、怎么知道是否生效

| 层 | 自动化 | 手段 |
| --- | --- | --- |
| 加载生效 | ✅ 有官方手段 | `--dump-config \| grep <entry-id>`；`pluginInventory/list` 看 `fiberPhase`；「设置 → 插件」页 |
| 功能有效 | ❌ 无通用手段 | 真实调用 + 证据：调一次工具 / 触发一次拦截，输出留档 |

社区目录 9329 条：`dsh-skill-scoreboard`／`dsh-capability-receipt` 管技能，`dsh-web-splash-loader` 偏启动诊断，`dsh-plugin-audit`／`dsh-plugin-vet` 是安全审计——**只有"加载状态"能自动化**。故登记插件体检（见候选表）。

---

## 十、界面功能插件（插件 6）

**结论**：能做，第三方已有先例（`dsh-codex-ui`、`dsh-solution-explorer`、`dsh-plugin-vscode-sidebar`、`dsh-code-ui`）。插件 6 属此类，前五个不是。

**排期**：按 §六 走——**第 3 批**（第 1 批三件不需前端打包，先拿"有没有用"的证据）。落地要配 `dsh.client` + 客户端半 + 客户端 tsdown preset。

**术语**：给 **DSH**（宿主：profile、插件树、工具注册表、事件）开发插件，不是给 **dsh-web**（官方 Web 界面 bundle，`@deepseek-ai/dsh-web-app` 等）开发；`dsh web` 只是启动 `web` profile 的入口，插件装进 profile 后 `web`/`tui`/`headless` 通用。

---

## 附：审阅意见处置（2026-09-21）

审阅文档 `第三方审阅意见（内部记录）`（169 行，DSH 主控窗口 审阅会话（id 从略））。原则：建议不等于指令；采纳项已并入正文，不采纳项给证据理由。审阅引用的行号对应 469 行版，按章节名定位。

| 节 | 处置 | 改在哪 | 不采纳的理由 |
| --- | --- | --- | --- |
| §2 肯定三点 | 接受 | — | — |
| §3.1 宿主盲区 | **部分采纳** | 插件 2、§一、§六、§七 | 采纳：写清只覆盖 DSH、列未覆盖宿主、适配提为独立登记条目、验收改"DSH 会话中被拦"。**不采纳其事实前提**（见事实问题 1） |
| §3.2 插件 3 假设 | **部分采纳** | 插件 3、产出物表 | 采纳：加 `rawEvidenceRequired`、写死 `enforcement:"none"`、并入三条规则。不采纳"插件 3 应挂 pre-commit / CI required check"——那是各项目自己仓里的决定 |
| §3.3 插件 6 提前 | **不采纳（提前）／采纳（过渡）** | 插件 6、§六 | ① Owner 已决定不提前（§十）；② 需引入 `dsh.client` + 客户端半 + 前端 tsdown preset。采纳其"先用宿主 subagent 过渡" |
| §3.4 清单来源 | **采纳** | 插件 2 | 清单从 Claude 记忆（42 条）、Codex Failures 段、未决账本提炼，落 `danger-patterns.json`、带 `source`、三端共用；并采纳 R4、R5 |
| §3.5 技能没被调用 | **部分采纳** | 插件 5、插件 3、产出物表 | 采纳：升级差集判定、回执两列缺失判不合格、记下循环依赖。不采纳"与插件 7 合并"——数据源与受众不同，合并只增耦合 |
| §4 六类事故 | 3 采纳 / 2 部分 / 1 不采纳 | 插件 2（R5·R6）、插件 3、插件 4 | 采纳：派单适用技能、假绿变异、设计日志 base64。部分：worktree 清理做成 R6（不采纳"写进技能"，本仓不放技能）。不采纳大盘局部改动 / 时间戳类——纯流程纪律，无可机器判定的数据面 |
| §6 批次建议 | **部分采纳** | §六 | 采纳第 1 批顺序 2 → 1 → 3；不采纳插件 6 提前 |
| §7 验收 7.1–7.5 | **全部采纳** | §3.6、产出物、插件 1 | — |
| §8 四问 | 逐条回答 | 见下 | — |

### 审阅第 8 节四问的回答

1. **跨宿主适配谁写、什么时候写？** 不承诺时间。清单随插件 2 在第 1 批落地、三端共用；两个适配器已登记、未排期、责任人待定。此前只说"DSH 侧已拦"。
2. **插件 1 只给测量值还是同时给判定？** 同时给判定，已实现：输出带 `expected` 与 `diff`（实测 `{"height":7}`）。不做"超阈值自动判失败"——阈值是调用方的标准。
3. **插件 6 提前影响骨架吗？** 会：需 `dsh.client` + `exports["./client"]` + 客户端半 + 客户端 tsdown preset，等于第 1 批引入第二套构建链。接受先用宿主 subagent 过渡。
4. **清单第一版是否用记忆区提炼？** 采用，来源已核实。欢迎提供"条目 + 出处"清单，会并进 `danger-patterns.json`；清单内不得出现凭据值。

### 审阅意见的事实问题（已核）

| # | 审阅原文 | 实测 | 结论 |
| --- | --- | --- | --- |
| 1 | §3.1「这些事故主要发生在 Codex / Claude Code 会话，不是 DSH 会话」 | `executor-real-home-writes.md`：2026-09-20 04:11 与 07:18「后端执行者（**dsh**）两次把真库从 v15 迁到 v16」，第三次同一 dsh 会话 | **不成立**，方向相反。`agent-roster` 讲的是**主控**在 Codex 窗口（执行者=luna/dsh/agy），主控窗口 ≠ 执行者宿主 |
| 2 | §1「Codex 会话区 947 个 rollout（6.0GB）」 | `find ~/.codex/sessions -type f` = 923 个 `*.jsonl`（+3 `.DS_Store`），`du -sh` = 3.8G | 数字不符，不影响 §3.4 结论 |
| 3 | §3.5「送达 10/10、实际加载 6/10」标注引自计划 | `development-goal-graph.md` 查不到此数；`G0.0.4.39` 行只写 `ready` | **未独立核到**，已降级为"不作判据"（原计划的引用错，审阅沿用） |
| 4 | 按行号引用计划（396 行、447 行等） | 审阅针对 469 行版 | 行号已漂，改按章节名 |
| — | 其余抽查 | 42 个记忆文件与 14 个具名条目、`skill-history.md` 的"18 个执行单 0 次加载"、`dsh-kickoff-prompt:132`、`verify_integration.sh` 28 门、Codex Failures 四段原句、`impact_checklist.py` 752 行、`skill_usage_probe.py` 3529 字节、`G0.0.4.39` 为 `ready` | **全部对得上** |
