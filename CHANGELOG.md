# Changelog

本仓按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 组织条目，版本号遵循
SemVer。正式发版时由发版流程把 `Unreleased` 下的条目定稿到对应版本，并与 Release 同源。

## [Unreleased]

### Added

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

### Known gaps

- 尚未在真实 profile 中做加载验收与真实调用验收，`--dump-config` 只覆盖配置层。
- `check_ui_size` 每次调用启动一个浏览器，且只测量选择器命中的第一个元素；溢出检查、命中测试、
  证据落盘、截图比对都还没有。
- 尚未发布到任何 registry；`CONTRIBUTING.md` 的发布章节目前不可执行。
