# 仓结构

一页说明：文件放哪里、名字怎么来、加一个新包要动哪些地方。

## 根目录

根目录的文件按用途分四组，组内不要混放：

| 组 | 文件 | 说明 |
| --- | --- | --- |
| **规则与文档** | `AGENTS.md` / `AGENTS.en.md`、`README.md` / `README.en.md`、`CONTRIBUTING.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.md`、`CHANGELOG.md`、`BASELINE_VERSION`、`LICENSE`、`docs/` | 给人看；中文为主，关键文档双语 |
| **构建与检查** | `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、`tsconfig.tests.json`、`tsdown.config.ts`、`vitest.config.ts`、`.oxlintrc.json`、`.npmrc` | 工具链；`.npmrc` 把 registry 指到官方，避免用镜像发布 |
| **自动化** | `.github/workflows/ci.yml`、`scripts/` | CI 与本地烟测脚本 |
| **包** | `packages/<pkg>/` | 每个插件一个目录；清单真源是 `pnpm-workspace.yaml` |

`.gitignore` 忽略 `node_modules/` 与 `dist/`。

**例外：`packages/*/lib/` 进仓**。原因是分发路径决定的——pnpm 默认拦截依赖的构建脚本，`git:` 安装不会构建，所以包里必须有已构建的入口，否则 `main: lib/index.js` 指向一个不存在的文件，装上也加载不了。`pnpm run verify:lib`（CI 同样步骤）会重新构建并断言提交的产物与源码一致，源码改了而产物没跟着提交会直接红。走 npm 发布后这条约束仍然保留，不影响发布产物。

## 一个包的内部

以 `packages/check-ui-size/` 为参考实现：

```
packages/<pkg>/
├── package.json           manifest：dsh.bundle.patch、dsh.compatibility、files 白名单、peer
├── cordis.patch.yml       插入 profile 配置树的那一行（唯一生效入口）
├── tsconfig.json          build:types 用：rootDir src → outDir lib/types
├── README.md / README.en.md / README.i18n.yaml
│                          交付文档，收尾必须是 Model Experience 与
│                          Known Limitations and Deferred Work；sidecar 记双语哈希
├── src/
│   ├── index.ts           宿主入口：注册工具与提示词段，只做接线
│   ├── host/              宿主侧内部实现（Node 环境）
│   ├── shared/            两侧都可用的代码与类型
│   └── client/            （需要时）浏览器半：只放 UI，构建为 lib/client.js
└── tests/
    ├── host/              镜像 src/host
    ├── shared/            镜像 src/shared
    ├── client/            镜像 src/client
    └── fixtures/          测试夹具（页面、样本数据）
```

三段式的理由：宿主半与浏览器半的运行环境不同，共享代码必须显式放进 `shared/`，否则浏览器 bundle 里会混进只在 Node 能跑的东西（反向同理）。

**浏览器半（客户端半）**：只有需要往 Web 界面画东西的插件才有。加了它就要在 manifest 声明 `dsh.client`、导出 `./client`、构建出 `lib/client.js`——这三件事缺一，界面上就不会出现任何东西。多数工具类插件不需要它。

## 名字怎么来（一条派生链，不是四个独立名字）

一个插件携带四个名字，**只有第一个是选出来的，其余都是派生的**：

| 名字 | 规则 | 本例 |
| --- | --- | --- |
| npm 包名 | `soia-dsh-` + 类型（`tool-` / `client-ui-` / `<能力>-policy`）+ 常用词描述 | `soia-dsh-tool-check-ui-size` |
| entry id | 包名去掉 `soia-dsh-` 前缀（即官方 id 形态） | `tool-check-ui-size` |
| 插件名 `export const name` | 与 entry id 相同 | `tool-check-ui-size` |
| 工具名 | entry id 去掉 `tool-` 类前缀，连字符换下划线（官方 `dsh-tool-bash` → `bash`） | `check_ui_size` |
| 提示词段名 | `tool:` + 工具名（官方 `dsh-tool-bash` 注册 `tool:bash`） | `tool:check_ui_size` |

**每条派生都由 `tests/host/index.test.ts` 的 `name derivation` 用例断言**，所以改名时不可能只改一半：改了包名而没改 id、或改了 id 而没改工具名，测试会红。

为什么要派生而不是四处写成同一个字符串：官方约定里 npm 包名是全局命名空间的（需要厂商前缀防重名），而 entry id 是 profile 内的句柄（官方一律短形态，如 `dsh-tool-bash` → `tool-bash`）。两者作用域不同，因此不同名——但关系是确定的、可机械校验的。

## 相关文档

- [建库方案与候选盘点](plugin-plan.md)：六个插件的定位、验收口径、批次与处置记录（本仓的唯一真源）。
- [验收记录](verification.md)：实际跑过的验证与结论。
- [插件健康度](plugin-health.md)：怎么判断一个插件好与坏、准与不准；`scripts/plugin-scorecard.mjs` 的口径说明。
- [任务面板设计](panel-design.md)：`ui-live-tasks` 的信息架构与刻意不做的事。

## 加一个新包

1. 新建 `packages/<pkg>/`，按上面的内部结构铺文件；`package.json` 的 `files` 白名单**必须包含 `cordis.patch.yml`**，否则发布出去的包里没有 patch，装上也生效不了。
2. `tsdown.config.ts` 会**自动发现**入口（`src/index.ts` 主机半、`src/client/index.tsx` 浏览器半），不需要手写条目；有浏览器半的包另放一个 `tsconfig.client.json`。
3. 在根 `README.md` 的包列表加一行（形态 + 常驻 token）；`pnpm-workspace.yaml` 用通配符，无需改动。
4. 名字按上面的派生链取，并在包内测试里断言。
5. 在 `package.json` 声明 `dsh.tokenBudget.resident`，否则预算门判红。
6. 跑八道门：`pnpm run typecheck && pnpm run typecheck:client && pnpm run lint && pnpm run build && pnpm run test && pnpm run verify:lib && pnpm run check-token-budget && pnpm run smoke`。

## 依赖与锁文件放在哪

**依赖声明属于各个包，锁文件属于工作区根。** 这是有意的分工，不是没收拾干净：

| 东西 | 位置 | 为什么 |
| --- | --- | --- |
| `dependencies` / `peerDependencies` / `devDependencies` | 各包自己的 `package.json` | 发布出去的是包，npm 按**这个**文件给消费者装依赖；根 manifest 不进 tarball |
| 解析结果（`pnpm-lock.yaml`） | 仓根**唯一一份** | pnpm workspace 的默认约定：一次 `pnpm install` 解全仓，CI 只缓存一份，跨包版本不会漂 |
| 链接（`node_modules`） | 根 + 各包内（pnpm 生成，gitignore） | pnpm 已经给每个包建立了自己的依赖视图；手建的软链会被下一次 `pnpm install` 覆盖 |
| 构建产物 `lib/` | 各包自己的 `lib/`，**随仓提交** | git 源安装不构建，产物必须在仓里（见 `docs/verification.md` 的空壳事故） |
| 宿主提供的包（`@deepseek-ai/*`） | peer + dev 同范围 | 由宿主提供，不能内联进产物；`tsdown` 的 `neverBundle` 兜底 |

不采用"每包一份 lockfile"（pnpm 的 `shared-workspace-lockfile=false`）：那会让依赖版本按包各自漂移、CI 要装 N 次、评审要读 N 份 diff，而收益只是"单包目录能独立安装"——这个需求由**发布到 npm** 满足：消费者拿到的是 `package.json` 声明的依赖，与我们的锁文件无关。

## 验证口径

「装了 ≠ 加载了 ≠ 能用」是三种状态，各需独立证据：

| 状态 | 证据 | 谁覆盖 |
| --- | --- | --- |
| 配置层有这一行 | `dsh --profile <p> --patch <pkg>/cordis.patch.yml --dump-config` 里能 grep 到 id | `pnpm run smoke`（默认覆盖全部包） |
| 插件被加载 | 一次性 profile 里 `pluginInventory/list` 该行 `fiberPhase: active` | 尚未自动化（该接口走 WebSocket mux，无现成 CLI） |
| 真的能用 | 真实调用一次工具，输出符合包 README 的契约 | 包内测试覆盖核心；活 profile 调用尚未做 |

烟测有**已知写行为**：`--dump-config` 会把 profile 根 `cordis.yml` 按模板重写（内容逐字节不变、不含被测行），profile 自己的 `cordis.patch.yml` 与 lockfile 不动。不要拿在用的 profile 当试验田。
