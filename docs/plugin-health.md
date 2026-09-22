# 插件健康度：怎么判断一个插件是好是坏、准是不准

这份文档回答一个问题：**凭什么说一个插件"行"？** 它是 `scripts/plugin-scorecard.mjs` 的口径说明，也是"哪些结论还没有证据"的清单。

## 一、先把"好"拆成可证伪的维度

"好"不是一件事。一个插件可能**加载了但结论错**、**结论对但太贵**、**便宜但坏了不吭声**。因此每个维度都必须能说清"用什么证据可以推翻它"：

| 维度 | 要回答的问题 | 证伪手段 | 当前状态 |
| --- | --- | --- | --- |
| 加载 | 宿主真的装了它吗 | 一次性 profile 启动成功（宿主拒绝加载失败的插件树）+ 内置插件清单 | ✓ 六包「已启用」 |
| 代价 | 每次请求花多少常驻 token | `check-token-budget` 的实测数字 | ✓ 179/0/145/125/130/0 |
| 判据质量 | 规则误报、漏报各多少 | 46 条真实命令的语料，正反两侧都钉住 | ✓ 命中 20 / 放行 26 |
| 结论正确性 | 输出与**独立来源**是否一致 | 哈希 vs `shasum`；几何 vs 期望值；门清单 vs 手算期望 | ✓ 五项活会话验收 |
| 失败可见性 | 坏了会不会伪装成成功 | 结果是否带机器可读 `status`/`code`；失败路径用例占比 | ✓ 见记分卡 |
| 自检 | 运行时能否自证"我还准不准" | 每包发布健康服务（可被诊断面/测试读取）；插件 6 另有面板计数 | ✓ 六包都有 |
| 边界诚实 | 声明的限制是否与实际一致 | README `Known Limitations`（双语条目数一致由测试强制） | ⚠️ 靠人工核对 |

## 二、一条命令复算

```bash
node scripts/plugin-scorecard.mjs          # 人读表格
node scripts/plugin-scorecard.mjs --json   # 机器读
SOIA_LIVE_ACCEPTANCE=1 node scripts/acceptance-live.mjs   # 结论正确性（花 token）
```

记分卡**只报事实、不下判断**：读不出来的格子写"未测"，不写一个看起来舒服的估计。

## 三、这些数字**不能**证明什么

- **常驻便宜 ≠ 判据有用。** token 预算只说明"不占上下文"，判据好坏要看语料的误报/漏报。
- **用例多 ≠ 覆盖失败路径。** 所以旁边给了失败路径用例占比；占比低就是提示。
- **「失败形态」是源码形态检查**：说明"有地方放失败码"，不等于每条路径都填了。行为那半由失败路径用例覆盖。
- **一次活会话验收 ≠ 长期正确。** 它证明"在这个宿主版本、这个模型、这批输入下结论对"；宿主或模型变了要重跑。
- **最终判断权在使用者。** 面板与工具只能保证"事实 + 可追溯"；"这个结果是否足以支撑决定"是人来判断的。

## 四、当前缺口（如实登记）

| 缺口 | 影响 | 下一步 |
| --- | --- | --- |
| ~~插件 1–5 没有运行时自检~~ **已完成** | — | 六包各自发布健康服务（`calls` / `failures` / `lastCallAt` / `lastFailureAt` + 包内专有计数），快照冻结、随插件生命周期注销 |
| ~~准确率没有长期曲线~~ **已完成** | — | 每次 `acceptance-live` 追加一行历史（逐项通过/失败、耗时、token），记分卡读出最近 10 次通过率与逐项稳定性 |
| ~~误报率只在语料上测~~ **已测（见下）** | — | 下一步：按回放结果收窄规则（见第八节的两类误报） |
| 插件 6 的流式帧通道未接通 | 「运行状况」里的帧数恒为 0 | 见 README Known Limitations；面板已把它显示出来 |

## 五、为什么"准确"必须对照独立来源

自证不算证据。所以验收里每一项都找一个**外部oracle**：

| 插件 | oracle |
| --- | --- |
| 文件哈希 | 脚本自己用 `crypto` 算一遍，比对工具返回值 |
| 尺寸核对 | fixture 的声明值与渲染值都是已知的，工具必须同时给出两者与差值 |
| 门清单 | 期望的门由人从 `.dsh/gates.yml` 手算 |
| 技能核对 | 会话日志里的技能目录与调用记录 |
| 门禁规则 | 真实命令语料：该拦的必须拦、不该拦的必须放行 |

## 六、真实流量回放（2026-09-22 首次结果）

`node scripts/policy-replay.mts` 把**历史会话里模型真实执行过的 bash 命令**喂给已发布的规则，离线、不花 token。首次结果：

| 指标 | 数值 |
| --- | --- |
| 扫描会话 | 409 个 |
| bash 调用 | 24,052 次（去重 23,630 条） |
| 放行 | 21,214 条 |
| 命中 | **2,416 条（10%）** |

| 规则 | 命中 | 最高频命中片段 |
| --- | --- | --- |
| `failure-as-evidence`（ask） | 2,054 | `--include=*` **×776**、`grep -rn … 2>/dev/null \|` ×4 |
| `git-danger`（ask） | 239 | `git checkout` ×109、`git commit` ×85、`git add -A` ×28、`git stash` ×15 |
| `data-root-write`（deny） | 68 | `cp ~/.soiadeck` ×45（真实数据根，属真阳性）、少量来自 heredoc 正文 |
| `secret-in-argv`（deny） | 24 | `Authorization: Bearer ***` ×7、`-token …` ×9 |
| `destructive-cleanup`（ask） | 16 | worktree 强删（真阳性） |
| `high-impact-action`（ask） | 15 | 部分来自 heredoc 正文 |

**两类需要收窄的误报（证据在手，尚未改）**：

1. **引号与 heredoc 正文里的文本被当成命令**。样本里 `cat > /tmp/x.mjs <<'EOF' … 'git commit' …` 被判成 git 危险：那段文本是被**写入文件**的，不是执行的。要收窄就得区分"会被执行的内容"（`bash -c "…"`、heredoc 管道给 shell）与"只被写入的内容"，不能一刀切删引号。
2. **`failure-as-evidence` 的 `--include=*` 分支太吵**：776 条命中意味着现实里每 30 条命令就有 1 条会弹审批。它的声明危害（shell 先展开 glob）成立，但作为 `ask` 的代价可能高于收益——要么降级为提醒、要么只在"结果被当作证据"的场景里拦。

> 判读提示：本节的数字是**量的下界**——规则只跑 bash，写类工具（`write`/`edit`）未回放；且命中不等于误报，必须人工看样本。

## 七、自检与历史：两个已补上的缺口

**运行时自检（每包一个健康服务）**：`packages/*/src/host/health.ts` 定义 `<Pkg>HealthSnapshot` 与一个 cordis `Service`，被 `apply` 创建、随插件卸载注销。统一字段是 `calls` / `failures` / `lastCallAt` / `lastFailureAt`，另有包内专有计数：

| 包 | 服务名 | 专有计数 |
| --- | --- | --- |
| `check-file-hash` | `checkFileHashHealth` | `evidenceWrites` |
| `check-quality-gates` | `checkQualityGatesHealth` | `configErrors` |
| `check-ui-size` | `checkUiSizeHealth` | `measured` |
| `check-skills` | `checkSkillsHealth` | `sessionsRead` / `decodeFailures` |
| `safe-tool-call-policy` | `safeToolCallPolicyHealth` | `matches`（按规则 id） |

快照是**冻结**的：读到的数字不会随后续调用变化。为什么不加一个"健康"工具？那会让模型为一次自检付常驻 token；而这些计数本来就是给宿主与诊断面看的。

**准确率历史**：`SOIA_LIVE_ACCEPTANCE=1 node scripts/acceptance-live.mjs` 每轮追加一行到 `$DSH_HOME/acceptance-history.jsonl`（可用 `SOIA_ACCEPTANCE_HISTORY` 覆盖），记录逐项通过/失败、耗时与 token。记分卡读最近 10 次给出**整轮通过率**与**逐项通过率**——只跑单项的轮次单独统计，不会被算成整轮通过。

## 八、`Known Limitations` 为什么也算健康指标

一个插件的"坏"常常不是算错，而是**它以为自己在做一件它做不到的事**。限制清单是这种错的第一道闸：

- 双语两侧的条目数由 `tests/scripts/readme-pair.test.ts` 强制一致——**这条测试是被一次真实漂移逼出来的**：英文侧曾比中文侧少一条，还留着一条已被推翻的旧声明（"`lib/client.js` 未产出"），而 `README.i18n.yaml` 的哈希记录对此毫无反应——哈希只能证明"这侧没变过"，不能证明"两侧一致"。
- 面板上的「运行状况」是同一思路的运行时版本：**把"我不知道"也显示出来**，而不是让它看起来正常。
