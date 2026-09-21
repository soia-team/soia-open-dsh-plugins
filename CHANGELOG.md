# Changelog

本仓按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 组织条目，版本号遵循
SemVer。正式发版时由发版流程把 `Unreleased` 下的条目定稿到对应版本，并与 Release 同源。

## [Unreleased]

### Added

- 五个新插件包（合计新增 310 个测试用例）：
  - `packages/safe-tool-call-policy/`（`soia-dsh-safe-tool-call-policy`）：宿主策略钩子，按
    `danger-patterns.json` 的六条规则在命令/写入执行前 `ask` 或 `deny`，并给一句合规做法；
    调用方可用 `.dsh/policy.yml` 覆盖。**不注册工具、不加提示词段 → 常驻 0 token。**
  - `packages/check-quality-gates/`（`soia-dsh-tool-check-quality-gates`）：按调用方
    `.dsh/gates.yml` 把改动文件映射成必跑的门与每门要贴回的原始证据；只出清单，不阻止未跑门。
  - `packages/check-file-hash/`（`soia-dsh-tool-check-file-hash`）：sha256 内容哈希清单，可选落盘
    （原子写、0600、只留路径与哈希，不写内容）。
  - `packages/check-skills/`（`soia-dsh-tool-check-skills`）：核对会话日志里"该用的技能有没有被加载"，
    五态判定（`not_in_catalog` / `not_attempted` / `wrong_pick` / `loaded_not_effective` / `ok`）。
  - `packages/client-ui-live-tasks/`（`soia-dsh-client-ui-live-tasks`）：Web 面板实时显示会话任务状态；
    宿主侧投影 + 客户端只读视图，不注册工具（常驻 0 token）。
- **常驻 token 预算门** `scripts/token-budget.mjs` + `pnpm run check-token-budget`：从构建产物重算模型可见
  投影（`name`+`description`+`parameters` + 提示词段），与各包 `dsh.tokenBudget.resident` 比对，超标即红。
  六个包当前合计 **579 token**。
- `scripts/publish-packages.mjs`：向官方 registry 发布，先 dry-run 体检 tarball（是否含 `lib/index.js`、
  `cordis.patch.yml`），且不读取/打印任何凭据值。
- `scripts/verify-npm-install.sh`：在一次性 `DSH_HOME` + 一次性 profile 里安装已发布包并逐行核对 patch。

### Changed

- `scripts/smoke-dump-config.sh` 默认覆盖**全部**包（`PACKAGE=all`），entry id 仍从各自的
  `cordis.patch.yml` 读取；CI 里写死的单包覆盖随之下线。
- `tsdown.config.ts` 的入口从手写列表改为**按文件系统自动发现**（`src/index.ts` 主机半、
  `src/client/index.tsx` 浏览器半）：漏加一个包不再静默不构建。
- 根 `tsconfig.json` / `tsconfig.tests.json` 排除 `packages/*/src/client/**`，浏览器半改由各包
  `tsconfig.client.json`（JSX + DOM）单独检查。
- `check_ui_size` 的常驻文本瘦身：描述 257 → 173 字符、参数描述合计 182 → 94 字符、提示段 160 → 139 字符，
  常驻 **238 → 179 token**（工具块 198 → 144）。

### Fixed

- `packages/check-ui-size/README.i18n.yaml` 的双语 blob 哈希重新登记（改文案时漏刷过）。
- 预算脚本的桩宿主补成 Proxy：钩子型插件（`ctx.on`）与注册 cordis Service 的包（`ctx.reflect.provide`）
  都能在门里加载，不再因未知宿主 API 让门误红。

- 建立仓库骨架：workspace 根（`package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、
  `tsconfig.tests.json`、`tsdown.config.ts`、`vitest.config.ts`、`.oxlintrc.json`）。
- 建立仓级规则与文档：`AGENTS.md` / `AGENTS.en.md`、`README.md` / `README.en.md`、
  `CONTRIBUTING.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.md`、MIT `LICENSE`。
- 建立 CI（`.github/workflows/ci.yml`）：装依赖 → typecheck → lint → build → test →
  DSH 只读烟测。
- 建立 `scripts/smoke-dump-config.sh`：用 `dsh --dump-config` 证明 patch 行进了配置树，
  不启动服务、不改任何 profile。
- 新增第一个插件包 `packages/check-ui-size/`（`soia-dsh-tool-check-ui-size`）：
  注册 `check_ui_size` 工具与一小段系统提示词规则。

### Added

- `docs/structure.md`：仓结构、名字派生规则、"加一个新包"清单与验证口径，一页说清。
- 名字派生断言（`tests/host/index.test.ts` 的 `name derivation`）：把 包名 → entry id → 插件名 →
  工具名 → 提示词段名 的每一步都钉死，改名不可能只改一半。
- 包内三段式目录：`src/{index.ts,host/,shared/}` 与 `tests/{host/,fixtures/}`，`src/client/`
  预留给浏览器半（与优秀插件 dsh-context 的 host/client/shared 分段一致）。

### Fixed

- **CI 三次失败的原因**：workflow 用 `@deepseek-ai/dsh@^0.1.0-rc.8` 装 CLI，而 npm 的预发布规则让该范围只解析到
  `0.1.0-rc.8`——那个版本的 CLI 不接受 `--from-default-profile`。已把 CLI 钉到实测过的 `0.1.6-alpha.2`，
  并把烟测放在隔离的 `DSH_HOME` 下跑。
- 环境变量 `SOIADECK_CHROME_EXECUTABLE` 改名为 **`SOIA_CHROME_EXECUTABLE`**：本仓插件是通用开发工具，
  不带客户产品名。仓规则同步新增"插件不绑定具体项目"的边界。

### Changed

- 提示词段名从 `tool:check-ui-size` 改为 **`tool:check_ui_size`**：官方形态是 `tool:` + 工具名
  （`dsh-tool-bash` 注册 `tool:bash`），类前缀只属于包名。
- `check_ui_size` 从骨架占位落为真实实现：用 `playwright-core` 驱动系统 Chrome，读取
  `getBoundingClientRect()` 与 `getComputedStyle()`，返回实测尺寸、盒模型样式与
  `实测 - 期望` 的带符号差值；失败返回 `browser_missing` / `navigation_failed` /
  `element_not_found` / `evaluate_failed` 四种错误码，不返回编造的测量值。
- 测量逻辑与宿主接线分层：核心在 `src/core/measure.ts`，不 import DSH 类型，可被别家宿主复用。
- 构建产物扩展名修正为 `lib/index.js`（tsdown 默认输出 `.mjs`，与 manifest 的 `main` 不一致）。
- `playwright-core` 保持 external，产物 11.22 kB，不内联浏览器驱动。
- 修正 `scripts/smoke-dump-config.sh` 对写行为的描述：`--dump-config` 会重写 profile 根
  `cordis.yml`（内容不变），原文"不改 profile"不成立。

### Verified

- 首次加载验收通过：独立 `DSH_HOME` 的一次性 profile + git 源安装，
  `pluginInventory/list` 报 `fiberPhase: active`（证据见 `docs/verification.md`）。
- 确认 git 安装必须随仓提交 `lib/`：未提交时同一条安装会装出没有入口文件的空壳。

### Known gaps

- **真实模型调用**尚未验证；`--dump-config` 只覆盖配置层，加载与实际调用各需独立证据。
- CI 尚未在 GitHub Actions 上真跑过（本地跑了同样的六道门）。
- `check_ui_size` 每次调用启动一个浏览器，且只测量选择器命中的第一个元素；溢出检查、命中测试、
  证据落盘、截图比对都还没有。
- 尚未发布到任何 registry；`CONTRIBUTING.md` 的发布章节目前不可执行。
