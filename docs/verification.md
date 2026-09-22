# 验证记录

按时间倒序记录**实际跑过**的验证：命令、环境、观察到的结果。只记真实执行过的，不记计划。

---

## 2026-09-22 · 逐插件活会话验收（含负例），并因此修掉两条规则误伤

**方法**：一次性 profile（六包都在）启动 DSH Web，用无头浏览器驱动**真实模型会话**，每条断言都从会话记录里取原文核对，不靠模型自述。

| 包 | 验的负例/正例 | 会话记录里的原文 | 结论 |
| --- | --- | --- | --- |
| 插件 1 | 瘦身描述后模型是否仍自选该工具；第二个页面两个选择器 | `check_ui_size` → `#card` rect 320×180 diff 0；`#pill` rect **108** vs 声明 88 → **diff +20**（`box-sizing: content-box`） | ✓ 仍被自选，且判定分层正确 |
| 插件 2 | 凭据进 argv | `curl -H "Authorization: Bearer sk-…"` → 返回 R2 原文（凭据会进 shell history / 进程表 / 会话日志）| ✓ 拦下 |
| 插件 2 | **误伤 1**：`git rev-parse …; git status --short; git stash list` | 被 ask，理由原文是 git-danger | ✗ 规则已修（`git stash` 未看子命令）|
| 插件 2 | **误伤 2**：`lsof … 2>/dev/null \|\| echo …; curl … \| head -1` | 被 ask，理由是 failure-as-evidence | ✗ 规则已修（把 `\|\|` 兜底当成丢弃错误）|
| 插件 2 | 修复后复跑两条探针 | 探针放行并返回真实输出；`grep -rn TODO src 2>/dev/null \| head` 仍被拦 | ✓ 一放一拦都对 |
| 插件 3 | 坏配置（YAML 未闭合） | `error: "Invalid gate config at /tmp/…/broken-gates.yml: …"`，`requiredGates: []`、文件进 `unmatched` | ✓ 可读报错，不崩 |
| 插件 4 | 落盘证据文件 | 返回 `evidencePath`；文件 `hash-2026-09-22T01-29-30.865Z.json` **权限 0600**、内容与返回值同构 | ✓ |
| 插件 5 | 带期望清单 | `verdict: not_attempted`、`missing: [soia-dev-implement-task, soia-dev-review-code]`、`catalog.count: 15`、`calls: []` | ✓ 真数据上分清了"目录里有但没加载" |
| 插件 6 | 空状态 | 全新会话里 **「任务」页签根本不渲染** → `view.empty` 分支在真实会话中不可达，仅单测覆盖 | ⚠️ 记录在案 |

**这次验收的价值**：两条误伤都是"按自己的心智模型写单测"永远发现不了的——第一条把只读查询当写操作，第二条把 `||` 兜底当丢弃错误；它们都在真实命令上才暴露。修复后两条真命令已固化为回归用例（包内 85 用例）。

## 2026-09-21 · 插件 6 的浏览器半：构建、加载、并按官方插槽渲染

**背景**：`dsh-client-modules` 要求声明了 `dsh.client` 的包必须提供 `lib/client.js`，否则**宿主拒绝启动**
（实测报文：`plugin tree failed to load: … client-modules: client bundles not found … lib/client.js`）。
官方那份共享 Client preset（harness 仓 `packages/client/tsdown.client.ts`）不发 npm，因此本仓自己复刻了插件需要的那部分。

| 步 | 做法 | 结果 |
| --- | --- | --- |
| 产物形态 | `scripts/build-client.mjs`：tsdown 打 CJS（react / JSX runtime / `@deepseek-ai/*` external）→ 包进 `window.__ModuleLoader__.load({ id, factory })` | `lib/client.js` 10.3 KB，`require("react")` / `require("react/jsx-runtime")`，无残留 ESM |
| 样式 | 不走 CSS module：`src/client/styles.ts` 自注入 `<style data-plugin-css="ui-live-tasks">`，类名 `lt-` 前缀 | 实测注入成功（DOM 里有该 style 标签） |
| 激活 | 客户端 `inject` 补 `sessions` + `uiConversation`（少一个，插槽标准道具 `useProjection` 就装配不出来，表现为"bundle 加载了但什么都不渲染"） | 组件开始渲染 |
| 位置 | 注册进 `conversation.view`（「对话 / 轨迹」同源插槽），`order: 20`、`label: () => t('view.tab')` | 界面页签行出现 **对话 ｜ 轨迹 ｜ 任务** |
| 视觉 | 渲染改用官方原语 `StateDot` / `Tag` / `Pill`，本地样式只留布局骨架 | 与内置视图同一套 token 与主题 |

**活会话证据**：切到「任务」页签，看到状态点 + Tag「等待工具结果」+ Pill「#1 · 步骤 1」+ 三行事实（本轮工具调用数 / 最后工具调用 / 最后事件），值来自宿主折叠的持久事件流；页面无错误。截图见夜战报告第 4 节。

**仍未做**：页签目前只读，没有操作按钮（暂停/取消/跳转）；`pluginInventory/list` 的 `fiberPhase` 仍未取到（WebSocket mux）。

## 2026-09-21 · 本机安装验证（六个包，全部走本地 tarball，不碰 npm）

**做法**：`npm pack` 六个包 → 装进一次性 `DSH_HOME` + 一次性 profile（由 shipped `web` 模板生成）→ 逐层验证。
脚本：`scripts/verify-local-install.sh`（可复跑，不读凭据、不连 registry、不碰在用 profile）。

| 层 | 手段 | 结果 |
| --- | --- | --- |
| 装得上 | 6 个 tarball 装进 profile | ✓ 6/6 |
| 行到位 | `--dump-config` 逐个 grep entry id | ✓ `tool-check-ui-size`、`safe-tool-call-policy`、`tool-check-quality-gates`、`tool-check-file-hash`、`tool-check-skills`、`ui-live-tasks` |
| **能加载** | 启动 profile（`--port 0 --no-open`） | ✓ 启动成功，打印 `dsh web: http://…` |

**为什么"启动成功"算加载证据**：宿主在插件树上任何一环 apply 失败时会拒绝启动——实测见过两种：
`plugin tree failed to load: … client-modules: client bundles not found … lib/client.js`（插件 6 的浏览器半产物缺失时），
以及 loader entry 应用失败。所以一个能启动的 profile 说明这六个包都通过了 apply。

**界面证据（同一批包，另一个装好凭据的 profile）**：见 `~/.dsh/storages/dsh-plugins-night-report-20260921.html` 第 4 节——
四个工具在活会话里可见、`check_file_hash` 真跑、门禁拦住 `rm -rf ~/.myapp/cache`、`check_quality_gates` / `check_skills` 真跑、
插件 6 的面板在会话头部显示并可展开。

**仍未做**：`pluginInventory/list` 的 `fiberPhase: active`（该接口走 WebSocket mux，没有现成 CLI 入口；本脚本用"能否启动"替代）。

## 2026-09-21 · 活会话界面验收（插件 2/3/4/5 在同一会话里真跑）

**做法**：把五个包 `npm pack` 出的 tarball 装进一次性 profile `plugins-demo`（沿用真实 `$DSH_HOME` 以复用登录态，未复制凭据），
起 DSH Web（`--port 0`），用无头浏览器驱动**真实模型会话**并截图。截图见 `~/.dsh/storages/dsh-plugins-night-report-20260921.html`。

| # | 验的是 | 观察到的 | 结论 |
| --- | --- | --- | --- |
| 1 | 四个工具在活会话里可见 | 问"有没有这四个工具"，模型回答"有有有有" | 加载 + 模型可见 ✓ |
| 2 | `check_file_hash` 真跑 | 工具卡片显示调用 `{"paths":["/etc/hosts"]}`；返回 `sha256 5ee9028da1fca4e94c71d36c88e0e1695d7557087ff331fb2ec0f9c499fa84f2`、`size 9009` | 工具正确 ✓（与本机 `shasum -a 256` 逐字符一致） |
| 3 | 门禁拦截 | 让模型执行 `rm -rf ~/.myapp/cache`；界面显示 `Bash — Error: the user rejected tool "bash"`，模型自述"没有执行删除，也没有绕过" | 策略钩子拦住 ✓ |
| 4 | `check_quality_gates` | 传入改动文件 + cwd，返回本仓 `.dsh/gates.yml` 映射出的门清单（`enforcement: "none"`） | 真跑 ✓（并因此给本仓补了 `.dsh/gates.yml`） |
| 5 | `check_skills` | 读本会话日志：`catalog.count 15`、`called: []`、`verdict: "unreported"`（未给期望清单时不猜） | 真跑 ✓ |

**顺带抓到的真实缺陷（正是插件 4 存在的理由）**：`check_file_hash` 返回的哈希是对的，但模型在**回答里转抄时漏了一个 `e`**
（写成 `5e9028…`）。工具无误，错在"凭手抄写哈希"——回执必须引用工具输出，不能重打一遍。

**仍未验的**：插件 6（长任务实时视图）的界面——浏览器半产物 `lib/client.js` 缺失（需要官方未发布的共享 Client tsdown preset），
所以这一批没有它的可看界面；宿主半有测试但与界面无关。

## 2026-09-21 · 插件 1 的 V3 对拍（真实页面来自调用方应用）

**为什么测**：V3 要求"同一个选择器，本插件读数与调用方既有夹具的读数一致（各自独立跑，互不调用）"。此前卡在"没有真实页面与选择器"。

**材料（调用方应用，只读使用）**

- 页面：`http://127.0.0.1:5173/#/desk/settings/navigation-map`（源码 dev 服务）与 `http://127.0.0.1:4173/#/desk/settings/navigation-map`（同一应用 `dist` 的 `vite preview`）
- 选择器：`.shell-rail-footer .shell-avatar`；期望宽度 **22px**，取自调用方既有夹具
  `apps/web/tests/platform/shell/shellfix-computed-style.browser.mjs` 的断言
- 两边前置条件对齐：同 localStorage 预置（locale + shell preferences）、同视口（1440×900 与 1280×720 各跑一遍）、同 colorScheme

**结果**

| 环境 | 我们的工具（`measureElement`） | 调用方夹具的测量代码 | 一致？ |
| --- | --- | --- | --- |
| 源码 dev 服务（5173） | **22px**（rect 22×22，`diff.width = 0`） | **22px** | ✅ |
| `dist` 预览（4173） | **26px** | **26px** | ✅ |

**结论**：工具读数与调用方夹具的**测量方法**在同一页面、同一选择器、同一条件下**完全一致**；两个环境读数不同（22 vs 26）是**构建新鲜度**问题——那份 `dist` 落后于源码（同一页面标题字号也读出 22px 而夹具断言 37px）。

**附带发现（只作证据，未改对方仓任何文件）**：调用方那份夹具脚本**当前自身跑不过**——在 dev 服务上执行它，断言 `the rail must render database rows` 失败，因为 `.shell-rail-item` 在当前源码里已不存在。该文件头部自己记录了同类的"曾经静默死过一次"的历史，所以这条要按"夹具可能未跟上源码"复查，而不是当作本工具的失败。

**复现**：对比脚本在 `/tmp/dsh-ops/v3/`（`compare.ts` / `compare-dev.ts` / `reference.mjs` / `reference-dev.mjs`）；两个临时服务用后即停，调用方仓 `git status` 无本次改动。

## 2026-09-21 · 插件 1 真实模型调用验收（模型自己选中了这个工具）

**为什么测**：包内测试只能证明工具函数对，证明不了"模型在真实会话里会选中它、参数传对、并且读的是渲染结果而不是 CSS 声明"这条链路。此前这条一直是未验证项。

**测试案例**：`packages/check-ui-size/tests/fixtures/min-height-mismatch.html`（复制到仓外 `/tmp/dsh-cui-accept/`）。

- `#btn` 声明 `min-height: 27px`，子元素 `.child` 是 `height: 34px`，flex 容器被撑到 **34px**；
- 这正是"只读 CSS 的检查器会报 27 并通过"的形态，只有量渲染盒子才发现；
- 任务只给 URL + 选择器 + 期望值 27px，不提示用哪个工具、不给做法。

**方法**：一次性 profile `check-ui-size-eval`（由 shipped `headless` 模板生成，`dsh check-ui-size-eval --from-default-profile headless`），插件按已发布 git 源装入（`github:soia-team/soia-open-dsh-plugins#path:packages/check-ui-size`），工作目录在仓外。**在用的 `web` profile 未被触碰**；凭据一直留在 `$DSH_HOME`，没有复制或读取凭据文件。

| # | 观察项 | 实测 |
| --- | --- | --- |
| 1 | 真的加载了 | 装配树含 `- id: tool-check-ui-size` / `name: soia-dsh-tool-check-ui-size`；profile 内 `lib/index.js` 存在、`playwright-core` 已装、`import()` 通过 ✓ |
| 2 | 模型 / 会话 | `deepseek-flash`（`deepseek-official`）；`session-87b49cd9-4512-4825-85ff-e4b5bbebd15d`，cwd `/private/tmp/dsh-cui-accept` |
| 3 | 工具选择 | 先 `read` 读 fixture，第二步**自己选中 `check_ui_size`**（callId `call_01_fV0jxqGSRsGfO4pJgsab9731`）✓ |
| 4 | 传参 | `{"url":"file:///tmp/dsh-cui-accept/min-height-mismatch.html","selector":"#btn","expectedHeight":27}`：三个参数都对，期望值是模型自己从任务里提取的 ✓ |
| 5 | 工具返回 | `rect` 10×34、`computed.height` 34、`computed.minHeight` 27、`diff.height` 7、`status` ok、`viewport` 1280×720、`measuredAt` 2026-09-21T08:29:55.178Z |
| 6 | 模型结论 | 34px ≠ 27px、**高出 7px**；归因正确（子元素撑高、`box-sizing: border-box`、padding 为 0），并指出要改内容/尺寸约束而不是调 padding ✓ |
| 7 | 额度 | wall 11.6s；turn 1 两步：input 7854+626、output 361+561、cacheRead 640+**8832**、total 8855+10019 = **18894 tokens**（第 2 步命中缓存，说明工具块与提示段进了可缓存前缀） |
| 8 | 只读性 | 仓内 `git status --short` 为空；fixture sha256 前后一致（`469f1c6a…`）——模型没有改任何文件 ✓ |

**这次验收确认与仍未测的**：

- 确认：面对"实测渲染高度"，模型会主动调用 `check_ui_size`，参数无需人补，且拿到的是渲染值 34 而不是声明值 27。
- **未测：常驻成本的差分实测**。「工具 214 + 提示段 40 = 254 tokens」仍是按字符估算；做差分要再跑一次不带插件的会话，本次只获授权一次调用。
- 未测：`#ghost`（`display:none`）与其他视口未在真实会话里覆盖（包内测试覆盖）。
- 残留物：一次性 profile `~/.dsh/profiles/check-ui-size-eval` 与验收会话记录未删（保留作证据）。

**复现**（会再花一次模型额度）：

```bash
dsh check-ui-size-eval --from-default-profile headless --dump-config    # 建一次性 profile（免费）
dsh plugin --profile check-ui-size-eval add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-ui-size'
dsh --profile check-ui-size-eval --json "<任务文本>"                     # 花额度
```

## 2026-09-21 · 分支保护实测：`main` 与 `dev` 都必须走 PR

**为什么测**：此前 `main` 没有 PR 要求，一次已授权发布用 `git push origin dev:main` 快进成功——说明当时"必须走 PR"只是文档约定，不是远端强制。本轮把两分支都改成强制并经实测确认。

**环境**：macOS；`gh` 以 `mianba` 登录（org owner + 仓 admin）；仓 `soia-team/soia-open-dsh-plugins`。

| # | 验的是什么 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | 配置写入（两分支同一份 payload） | `gh api -X PUT repos/soia-team/soia-open-dsh-plugins/branches/{main,dev}/protection --input protection.json` | 200；`required_pull_request_reviews`、`restrictions` 同时生效 ✓ |
| 2 | 读回校验 | `GET .../branches/{main,dev}/protection` | 两分支一致：PR 必须（approvals=0、dismiss_stale=true）、`enforce_admins=true`、状态检查 `Typecheck, lint, build, test, DSH smoke`（strict）、线性历史、禁强推、禁删分支、会话未解决不得合并 ✓ |
| 3 | 白名单读回 | `GET .../protection/restrictions/{users,teams,apps}` | users=`mianba`；teams/apps 为空 ✓ |
| 4 | **本人直接 push `dev`**（真推，非 dry-run） | `git push origin tmp-protection-test:dev` | `remote: error: GH006: Protected branch update failed for refs/heads/dev.` / `- Changes must be made through a pull request.` / `! [remote rejected] (protected branch hook declined)` ✓ |
| 5 | **本人直接 push `main`** | `git push origin tmp-protection-test:main` | 同上，`refs/heads/main`，同样被拒 ✓ |
| 6 | 远端未被改动 | `GET .../git/ref/heads/{main,dev}` | 两分支都仍是 `69f09be45ca20db02643c9950214a321c58490cc`（测试提交 `fb9ecf1` 未落库）✓ |

**顺带确认的负结果（重要）**：`git push --dry-run` **不触发服务端钩子**——同一条推送加 `--dry-run` 时输出 `69f09be..fb9ecf1 tmp-protection-test -> main`，看起来会成功。所以 dry-run 不能当分支保护证据，只有真推的被拒报文算。

**当前仍未验证 / 已知缺口**：

- **组织级 ruleset 未读到**：`GET orgs/soia-team/rulesets` 返回 404，token 缺 `admin:org` scope。仓级 rulesets 为空（`GET /repos/.../rulesets` → `[]`），但组织级是否存在、是否叠加限制，本项证据未独立核到。
- **第二人复核未开启**：`required_approving_review_count = 0`，仓内只有 `mianba` 一个协作者，PR 发起人技术上可自合并。要第二人复核需再加一个有写权限的账号（并加入两分支 `restrictions`），再把 count 提到 1。
- **组织默认仓库权限是 `write`**：新加入的 org member 会自动获得本仓写权限，实际闸门因此是分支 `restrictions` 名单，而不是组织成员身份。

## 2026-09-21 · 插件 1 首次加载验收（配置层 → 安装 → 加载）

**环境**：macOS / Apple Silicon；DSH `0.1.6-alpha.2`；用**独立 `DSH_HOME=/tmp/dsh-smoke-home`**，全程未触碰在用的 `~/.dsh`（验收后确认 3080 实例与其 profile 目录均无变化）。

| # | 验的是什么 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | 配置层：patch 行进配置树 | `dsh --profile web --dump-config \| grep -A2 'id: tool-check-ui-size'` | `- id: tool-check-ui-size` / `name: soia-dsh-tool-check-ui-size` ✓ |
| 2 | git 源安装可用（`lib/` 随仓提交） | `dsh plugin --profile web add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-ui-size'` | 安装成功；包内 `lib/index.js` 存在（git 安装不构建，靠提交的产物） ✓ |
| 3 | profile 自动接线 | 读 `profiles/web/package.json` | `dsh.profile.bundles` 增加 `soia-dsh-tool-check-ui-size` ✓ |
| 4 | **插件真的被加载** | 启动 `dsh web --port 0`，带 token 认证后调 `pluginInventory/list` | `{"entryId":"include:tool-check-ui-size","moduleName":"soia-dsh-tool-check-ui-size","enabled":true,"fiberPhase":"active"}` ✓ |
| 5 | 收尾 | 关闭该实例；核对在用实例 | 3080 实例仍在运行（HTTP 401 = 需认证，符合预期）；`~/.dsh/profiles/` 未新增任何 profile ✓ |

**顺带确认的负结果（同样重要）**：未提交 `lib/` 时，同一条 git 安装会装出一个 **没有入口文件**的包（`main: lib/index.js` 不存在）——这正是较早版本 `dsh-context` 装成空壳的同一类问题。这也解释了为什么 `packages/*/lib` 必须随仓提交，以及为什么要有 `pnpm run verify:lib` 守卫。

## 2026-09-21 · CI 首次全绿（GitHub Actions）

**结果**：`CI` workflow（`Typecheck, lint, build, test, DSH smoke`）在 `main` 上 **success**，耗时 52s（run 35576119854，commit 94fa4a8）。

前三次失败与根因（都已修，记下来避免重犯）：

| 次 | 失败步骤 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1–3 | 准备一次性 profile | workflow 用 `@deepseek-ai/dsh@^0.1.0-rc.8` 装 CLI，而 npm 的预发布规则让该范围只解析到 `0.1.0-rc.8`——那个版本的 CLI **不接受 `--from-default-profile`** | CLI 钉到实测过的 `0.1.6-alpha.2`，烟测放进隔离 `DSH_HOME` |
| 4 | test | Ubuntu runner 有 Chrome，但容器里默认沙箱 + `/dev/shm` 限制让 `launch()` 卡住，两个浏览器用例 5s 超时 | 检测到 `CI` 时关沙箱并加 `--disable-dev-shm-usage`；vitest 超时 5s → 30s |

**当时仍未验证的（2026-09-21 追记：下面两条已过时，就地标注，不删历史判断）**：

- ~~真实模型调用~~ → **已补测**：见本文件顶部「插件 1 真实模型调用验收」——模型自己调用了 `check_ui_size`，传参正确，拿到渲染值 34、差值 7。
- **跨 DSH 版本**：仍未做，只在 `0.1.6-alpha.2` 上验过；有第二个版本的证据后再补。
- ~~CI 本身尚未在 GitHub Actions 上真跑过~~ → **已过时**：本条记录的正是 Actions 上的绿色运行（run 35576119854）；后续 PR #1、#2 的 CI 也都在 Actions 上跑过。
