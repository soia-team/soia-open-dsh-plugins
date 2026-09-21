# soia-open-dsh-plugins

公开 DSH 插件仓：`soia-dsh-*` 宿主插件（bundle）。客户不共享维护者的机器、账号和私有 profile；仓名不触发 SOIA 产品 proposal/board 流程。

## 边界

- 本仓只放 **DSH 插件包**：一个包 = 一份组合包（bundle）＝ `package.json` 的 `dsh.bundle` + `cordis.patch.yml` + 宿主侧入口。不放技能、不放产品源码、不放私有脚本副本；技能真源在技能仓，本仓按需只读。
- 插件只通过 `packages/<pkg>/cordis.patch.yml` 的一行 `insert` 生效。不改写、不代管用户的 `$DSH_HOME/profiles/*` 与 `$DSH_HOME/cordis.patch.yml`；验收用 `--dump-config` 或一次性 profile，不拿在用 profile 当试验田。
- 不提交秘密、账号标识、私有 config/.env、机器绝对路径或家庭/健康/财务等上下文；示例用占位符。凭据留在官方登录态/密钥存储，不复制到普通日志。
- **骨架包必须如实标注占位能力**：注册了工具不等于实现了能力。未实现的入口写进包 README 的 `Known Limitations and Deferred Work`，并在返回值和注释里写明状态，不写成已完成。
- 包名、entry id、类/服务角色名按官方三层命名语法与角色词表选取；不使用 `Manager`、`Helper` 这类含糊名。
- 已授权局部修改与相关验证连续完成，保留他人改动；派发、提交/合并、发布、安装、权限与重要删除各守本次授权，不从完成自检推导后续授权。

## 按需入口

- 验收证据登记在 [docs/verification.md](docs/verification.md)；新增包时读 [docs/structure.md](docs/structure.md)（结构、命名派生、新增清单）、官方「添加 workspace 包」清单与 `packages/check-ui-size/`（本仓参考实现）；不批量复制模板。
- 改工具 schema、执行约定、输出渲染或策略钩子时读官方「工具编写参考」；只改文案不加载。
- 每个包 README 必须按官方约定收尾：`Model Experience`（这个包往模型上下文里加了什么、token 与 KV cache 影响）与 `Known Limitations and Deferred Work`。两节缺一即视为包未完成。
- `package.json` 的不变式（`type: module`、`main`/`types` 指向 `lib/`、`exports["."]`、`files` 白名单、`dsh.bundle.patch`、`dsh.compatibility`、peer 与 dev 同范围）以官方清单为准；`pnpm-workspace.yaml` 是包清单的唯一机器真源，根 README 的包列表跟随它。
- 分发、安装与发版查 [CONTRIBUTING.md](CONTRIBUTING.md) 对应章节；不批量读全部文档。

## 验证

纯文案改动检查差异、链接与双语一致性；行为改动运行受影响测试。提交前执行下列门禁：

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test
pnpm run verify:lib                        # 提交的 lib/ 与源码一致
bash scripts/smoke-dump-config.sh
```

- `scripts/smoke-dump-config.sh` 只做 `--dump-config` 组合验证：不启动服务、不装依赖。**注意它有已知写行为**——DSH 会把 profile 根 `cordis.yml` 按模板重写一遍（内容逐字节不变，实测 sha256 稳定、不含被测行），`cordis.patch.yml`/`package.json`/`pnpm-lock.yaml` 不受影响。它证明**配置树里有这一行**，不证明插件被加载，也不证明工具可用。
- 「装了 ≠ 加载了 ≠ 能用」是三种状态：`--dump-config` 证明第一层，加载与实际调用各需独立证据。骨架包在拿到后两层证据前只报占位状态。
- 缺依赖且环境安装已获准时才安装；不把 `pnpm install` 当成自检的隐含前提，也不借测试执行未获准的联网、付费或机器改动。

## Git 与发布

- 远端：`soia-team/soia-open-dsh-plugins`（public），本地 `origin` 走 SSH（HTTPS 推送在本机不稳）。首次上线已获当次授权并完成；此后推送到 `main`/`dev` 仍守下面的分支与发布规则。
- 新分支默认从正式 `main` 开，PR 显式指向 `dev`；合并需审查通过与本次许可。
- 普通开发不直接 push `main`/`dev`。`dev` 带 `-SNAPSHOT`，`main` 保持正式版。
- 正式发布须当次明确授权：定稿 PR → `dev`/CI，核对 `main` 是 `dev` 祖先及实际合并冲突，再仅快进 `main`、tag/Release、重开 SNAPSHOT。
- 发布到 npm 前确认 registry 与包名归属；本仓包名无 scope，不需要 `--access public`。不把 SNAPSHOT 版本交给客户端。
- `main` 不接收 PR；只有上述已授权、CI 与祖先检查通过的正式发布快进可推进 `main`。
