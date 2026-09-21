# 验证记录

按时间倒序记录**实际跑过**的验证：命令、环境、观察到的结果。只记真实执行过的，不记计划。

---

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
