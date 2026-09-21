# 验证记录

按时间倒序记录**实际跑过**的验证：命令、环境、观察到的结果。只记真实执行过的，不记计划。

---

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
