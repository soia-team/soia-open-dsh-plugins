# 贡献到 soia-open-dsh-plugins

本仓只发布面向 DeepSeek Harness（DSH）的宿主插件包。开始前先读
[`AGENTS.md`](AGENTS.md)；新增包时读官方「添加 workspace 包」清单，改工具行为时读官方
「工具编写参考」。

## 1. 新增一个包

```bash
mkdir -p packages/<package-dir>/src packages/<package-dir>/tests
```

以 [`packages/check-ui-size/`](packages/check-ui-size) 为参考实现逐文件对齐：它的
`package.json`、`cordis.patch.yml`、`src/index.ts`、`tests/`、README 三件套构成本仓包的最小完整形状。

一个包必须同时具备：

| 文件 | 作用 |
|---|---|
| `package.json` | 声明 `dsh.bundle.patch`、`dsh.compatibility`、`exports`、`files` 白名单与依赖 |
| `cordis.patch.yml` | 唯一的生效入口：向配置树插入一行 |
| `src/index.ts` | 导出 `name`、`inject`、`apply` |
| `tests/` | 至少一个可运行的单测 |
| `README.md` / `README.en.md` | 包文档，收尾必须是 `Model Experience` 与 `Known Limitations and Deferred Work` |
| `README.i18n.yaml` | 双语配对记录 |
| `tsconfig.json` | 让根 `pnpm run typecheck` 覆盖该包 |

## 2. 命名

官方一条能力有三个名字，规则各不相同：

| 层 | 规则 | 本仓示例 |
|---|---|---|
| npm 包名 | 无 scope + `soia-` 前缀，形态跟随官方 `dsh-<kind>-<name>` | `soia-dsh-tool-check-ui-size` |
| entry id | 去掉 `dsh-` 前缀（客户端包去掉 `dsh-client-`） | `tool-check-ui-size` |
| 中文名 | 面向人的叫法，写进文档标题 | 元素实测 |

类与服务的角色名按官方角色词表选取（`Controller`／`Store`／`Registry`／`Runtime`／
`Resolver`／`Policy`／`Provider` 等），不使用 `Manager`、`Helper` 这类含糊名；单例 ctx key
用单数，注册表类服务用复数。

## 3. package.json 不变式

| 字段 | 值 |
|---|---|
| `type` | `module` |
| `main` / `types` | `lib/index.js` / `lib/types/index.d.ts` |
| `exports` | 只导出 `.`，`types` 指向 `./lib/types/index.d.ts`，`default` 指向 `./lib/index.js` |
| `files` | 白名单，只发构建产物，不发 `src`、不发 sourcemap |
| `dsh.bundle.patch` | `./cordis.patch.yml` |
| `dsh.compatibility` | `{ "dsh": ">=0.1.0-rc.8 <0.2.0" }` |
| 依赖 | `@deepseek-ai/cordis` 同时进 peer 与 dev，且**范围相同**；每个 DSH peer 都镜像到 dev |

## 4. cordis.patch.yml

只有一种形态，一行一条：

```yaml
- insert:
    - id: <entry-id>
      name: <npm-package-name>
```

`name` 用包名而不是源码相对路径，Node 的模块解析才能找到已安装代码。不要在这里写用户配置
默认值之外的机器相关值。

## 5. README 与双语

包 README 以官方两节收尾，顺序固定：

- `## Model Experience` —— 这个包往模型上下文里加了什么。每个直接、条件、上限、生命周期
  或辅助的上下文条目用一个 H3，包含三个有序 H4 字段：`What the model sees`、`Token effect`、
  `KV Cache effect`。引用包自己拥有的稳定文本时，用带标题的 H5 加 `markdown` 围栏原样粘贴。
- `## Known Limitations and Deferred Work` —— 消费方可见的缺口、后果与维护者约束。

骨架包如实写占位状态：注册了工具不等于实现了能力。中文文档用中文标点，英文文档纯英文，两侧
内容对应；只改一侧视为未完成。

## 6. 本地验证

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test
bash scripts/smoke-dump-config.sh
```

`scripts/smoke-dump-config.sh` 只做 `--dump-config` 只读检查：不启动服务、不写 profile。
它证明配置树里有这一行，不证明插件被加载，也不证明工具可用。完整验收口径见
[README.md](README.md#验证口径)。

只报告实际运行过的验证：「静态检查通过」「真实调用通过」「已提交」「已发布」是四种不同状态。

## 7. 提交 PR

- 从短期 `feat/`、`fix/` 或 `chore/` 分支向 `dev` 提 PR；不直接 push `dev`/`main`。
- PR 说明目标、行为变化、文件布局、验证证据与残余风险。
- 新增或删除包时更新根 `README.md`、`README.en.md` 与 `pnpm-workspace.yaml`。
- 不把发布、远端创建、npm 组织变更混入普通功能 PR。

### 分支保护（远端已启用，不是口头约定）

| 规则 | `main` | `dev` |
| --- | --- | --- |
| 禁止强推 / 禁止删除 | ✅ | ✅ |
| 要求线性历史 | ✅ | ✅ |
| 规则对管理员同样生效 | ✅ | ✅ |
| CI 检查（`Typecheck, lint, build, test, DSH smoke`）必须通过 | ✅ | ✅ |
| 必须走 PR | ❌ 刻意不要求 | ✅（批准数 0，允许自合并） |

`main` 不要求 PR 是刻意的：按本仓规则，`main` 只接收已授权的正式发布快进推送，不接收功能 PR。
`dev` 的批准数设为 0 同样是刻意的——单维护者仓库里要求批准会把合并锁死；"合并需审查通过"是人的流程门，
不是 GitHub 门。

## 8. 分发与发布

**当前分发方式：git 源**（`lib/` 随仓提交，所以装完即可用）：

```bash
dsh plugin --profile <profile> add 'github:soia-team/soia-open-dsh-plugins#path:packages/<pkg>'
```

因此 `packages/*/lib` 必须在每次改源码时重新构建并提交，`pnpm run verify:lib`（CI 同款）会拦住忘记的情况。

**发布到 npm 尚未执行**，需要当次明确授权：确认 registry（本机默认指向镜像，发布前须切官方）与包名归属后
才执行。发布前确认包内不含 SNAPSHOT 版本，且 `files` 白名单实际覆盖运行所需产物。
