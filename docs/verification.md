# 验证记录

按时间倒序记录**实际跑过**的验证：命令、环境、观察到的结果。只记真实执行过的，不记计划。

---

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

**本次仍未验证的**：

- **真实模型调用**：没有让模型真的调一次 `check_ui_size`（要花模型额度）。工具行为由包内测试覆盖，含 4 个真实浏览器用例（其中一个正是 `min-height: 27px` 声明、实测 34px、差值 7 的场景），但"模型在会话里成功调用"这条链路仍是独立证据、尚未取得。
- **跨 DSH 版本**：只在 `0.1.6-alpha.2` 上验过；`dshReleases` 映射等有第二个版本证据后再补。
- **CI 本身**：`.github/workflows/ci.yml` 尚未在 GitHub Actions 上真跑过（本地跑的是同样的六道门）。
