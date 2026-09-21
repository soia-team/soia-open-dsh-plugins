# soia-open-dsh-plugins

SOIA 公开 DSH 插件仓：面向 DeepSeek Harness（DSH）的宿主插件，按官方组合包（bundle）规格构建。

[English](README.en.md)

## 这个仓是什么

每个包都是一份 **DSH 组合包**：一个 npm 包，携带一个 `cordis.patch.yml` 配置层，向 profile 的配置树插入一行插件。装进 profile 后，这一行声明的能力在会话里生效。

本仓的三个事实边界：

- **只放插件**。不放技能、不放产品源码、不放私有脚本；技能真源在技能仓，本仓只按需引用。
- **不改用户 profile**。插件只贡献自己的那一行；`$DSH_HOME/profiles/*` 与 `$DSH_HOME/cordis.patch.yml` 归用户所有。
- **占位就说占位**。未实现的入口只注册骨架、不假装有实现；真实缺口写在包 README 的 `Known Limitations and Deferred Work`。

## 包列表

| 包 | entry id | 形态 | 常驻 token | 说明 |
|---|---|---|---|---|
| [`soia-dsh-tool-check-ui-size`](packages/check-ui-size/README.md) | `tool-check-ui-size` | 工具 + 提示段 | 179 | 从真实页面读出一个元素的实测尺寸与盒模型样式，并可与声明的期望值比对。 |
| [`soia-dsh-safe-tool-call-policy`](packages/safe-tool-call-policy/README.md) | `safe-tool-call-policy` | 纯钩子 | **0** | 在命令与文件写入真正执行前匹配危险模式，命中则要求确认或拒绝，并给出一句合规做法。 |
| [`soia-dsh-tool-check-quality-gates`](packages/check-quality-gates/README.md) | `tool-check-quality-gates` | 工具 | 145 | 把「这次改了哪些文件」按调用方自己的门配置映射成必跑的门与每门要贴回的原始证据；只出清单，不阻止未跑门。 |
| [`soia-dsh-tool-check-file-hash`](packages/check-file-hash/README.md) | `tool-check-file-hash` | 工具 | 125 | 对文件或目录算 sha256 内容哈希并留证，核对回执里写的产物与实际字节是否一致。 |
| [`soia-dsh-tool-check-skills`](packages/check-skills/README.md) | `tool-check-skills` | 工具 | 130 | 核对一个会话日志里「该用的技能到底有没有被加载」，没被用上时判定是哪一种病。 |
| [`soia-dsh-client-ui-live-tasks`](packages/client-ui-live-tasks/README.md) | `ui-live-tasks` | 客户端半 | **0** | Web 面板：实时显示当前会话的任务状态；宿主侧折叠，客户端只读投影，不发自己的 RPC。 |

常驻 token 由 [`scripts/token-budget.mjs`](scripts/token-budget.mjs) 从构建产物重算，并与各包 `package.json` 的 `dsh.tokenBudget.resident` 比对（`pnpm run check-token-budget`），超标即红。六个包合计 **579 token**。

包清单的唯一机器真源是 [`pnpm-workspace.yaml`](pnpm-workspace.yaml)；上表跟随它。

## 安装

尚未发布到 npm registry；当前用 **git 源**安装（`lib/` 已随仓提交，所以装完即可用，不需要在本地构建）：

```bash
# 单包（monorepo 子目录用 #path: 指定）
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-ui-size'

# 验证：先看配置层，再看加载
dsh --profile <profile-name> --dump-config | grep -A2 'id: tool-check-ui-size'
```

发布到 npm 之后，同一安装位换成包名即可：`dsh plugin --profile <profile-name> add soia-dsh-tool-check-ui-size`。

安装须先明确目标 profile 与范围；不要拿在用 profile 试装。可安装性以包发布后的实际产物为准。

## 本地开发

```bash
pnpm install          # 首次准备 workspace
pnpm run build        # tsdown 构建各包到 lib/（产物进仓，见 docs/structure.md）
pnpm run typecheck    # tsc 检查源码与测试
pnpm run lint         # oxlint
pnpm run test         # vitest
pnpm run smoke        # 只读验证：patch 行真的进了配置树
```

`pnpm run smoke` 等价于 [`scripts/smoke-dump-config.sh`](scripts/smoke-dump-config.sh)：不启动服务、不装依赖。**它有已知写行为**——`--dump-config` 会把 profile 根 `cordis.yml` 按模板重写一遍（内容逐字节不变、不含被测行），profile 自己的 `cordis.patch.yml` 与 lockfile 不动。可用环境变量覆盖默认值：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `DSH_BIN` | `dsh` | DSH 可执行文件 |
| `DSH_PROFILE` | `web` | 用于取基线配置的 profile 名 |
| `PACKAGE` | `check-ui-size` | 要验证的包目录名 |

## 验证口径

「装了 ≠ 加载了 ≠ 能用」是三种状态，各需独立证据：

1. `--dump-config` 证明 patch 行进了配置树——本仓 `pnpm run smoke` 覆盖这一层。
2. `pluginInventory/list` 里 entry 为 `active` 证明插件被加载。
3. 真实调用一次工具、输出符合预期，才证明能用。

第 2、3 层需要在一次性 profile 中完成，不在本仓的只读烟测范围内。

## 仓库结构

**完整结构、命名派生规则与"加一个新包"的清单见 [docs/structure.md](docs/structure.md)、[docs/verification.md](docs/verification.md)**（一页）。下面是速览：

```
AGENTS.md / AGENTS.en.md        仓级规则（中文 / English）
docs/structure.md               仓结构、命名派生、新增包清单
packages/<pkg>/                 一个包 = 一份组合包
  package.json                  含 dsh.bundle 与 dsh.compatibility
  cordis.patch.yml              插入 profile 配置树的那一行
  src/index.ts                  宿主入口（只接线）
  src/host/ src/shared/         宿主侧实现与两侧共用代码
  src/client/                   需要时：浏览器半
  tests/host/ tests/shared/     vitest 单测，镜像 src 的分段
  README.md / README.en.md      包文档，收尾为 Model Experience 与
                                Known Limitations and Deferred Work
  README.i18n.yaml              双语配对记录
scripts/smoke-dump-config.sh    只读配置层烟测
.github/workflows/ci.yml        装依赖 → typecheck → lint → build → test → 烟测
```

## 参与与安全

- 贡献流程、命名、包不变式与发版见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 漏洞报告方式与范围见 [SECURITY.md](SECURITY.md)。
- 第三方代码与引用登记见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可

[MIT](LICENSE)，版权行 `Copyright (c) 2026 soia-team`。
