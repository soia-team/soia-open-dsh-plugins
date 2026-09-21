---
description: "DSH 宿主工具包：对文件或目录算 sha256 内容哈希并留证，用来核对回执里写的产物与实际字节是否一致。"
kind: "package-bundle"
---

# soia-dsh-tool-check-file-hash

DSH 宿主工具包：对文件或目录算出 sha256 **内容哈希**，把「回执里写的」和「实际是什么」放在同一份可引用的记录里。

[English](README.en.md)

## 这个包做什么

回执可以写出文件名、大小和版本，而磁盘上的字节完全是另一回事。声明不是结果：只有从文件本身读出来的摘要无法被"写"出来，所以它是回执里唯一无法凭空断言的字段。

本包因此做三件事：

- 接受文件或目录（目录递归），把选中的**普通文件**逐个算出 sha256；
- 返回绝对路径、算法、摘要与字节数，以及这次的汇总字节数；
- 需要留档时，把同一份报告**原子写入**一个 0600 的 JSON 证据文件。

记录里只有路径、摘要和大小：**任何情况下都不含文件内容，不含 base64，也不含二进制片段**——schema 里没有能装内容的字段。

它不猜，也不给半份结果：路径不存在、显式传入的不是普通文件、或者读不动，都返回带错误码的失败并指名是哪个路径，而不是一份看起来完整的短清单。

## 安装

尚未发布到 npm；用 git 源安装（`lib/` 随仓提交，装完即可用）：

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-file-hash'
dsh --profile <profile-name> --dump-config   # 先只验证配置层，不启动服务
```

发布到 npm 后用包名：`dsh plugin --profile <profile-name> add soia-dsh-tool-check-file-hash`。

`cordis.patch.yml` 只贡献一行 `insert`：`id: tool-check-file-hash`，`name: soia-dsh-tool-check-file-hash`。本包不注册提示词段，运行时依赖只有 Node 内置模块。

## 工具契约

### `check_file_hash`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `paths` | string[] | 是 | 要哈希的文件或目录；目录会被递归展开 |
| `evidenceDir` | string | 否 | 证据文件目录；**不传就不落盘** |

成功（`status: "ok"`）返回：

```json
{
  "status": "ok",
  "files": [
    {
      "path": "/abs/path/artifact.bin",
      "algo": "sha256",
      "hash": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      "size": 3
    }
  ],
  "generatedAt": "2026-09-21T07:14:03.812Z",
  "totalBytes": 3,
  "evidencePath": "/abs/path/evidence/hash-2026-09-21T07-14-03.812Z.json"
}
```

| 字段 | 含义 |
|---|---|
| `files[].path` | 绝对路径（相对路径按进程工作目录解析） |
| `files[].algo` | 固定 `"sha256"`，本包只讲这一种算法 |
| `files[].hash` | 文件内容的小写十六进制摘要 |
| `files[].size` | 哈希之前 `stat` 到的字节数 |
| `generatedAt` | 报告组装时刻，ISO 8601 |
| `totalBytes` | `files[].size` 之和 |
| `evidencePath` | **只在给了 `evidenceDir` 且写成功时出现** |
| `evidenceError` | **只在给了 `evidenceDir` 但写失败时出现**：`{ "code": "evidence_write_failed", "message": "…" }`，此时上面的哈希结果照常返回 |

失败（`status: "error"`）返回 `code`、`message` 与出错的 `path`：

```json
{
  "status": "error",
  "code": "not_found",
  "message": "no such file or directory: /abs/path/missing.bin",
  "path": "/abs/path/missing.bin"
}
```

| `code` | 含义 |
|---|---|
| `not_found` | 路径不存在（或路径的某一级不是目录） |
| `not_a_file` | 显式传入的路径既不是普通文件也不是目录（字符设备、套接字等） |
| `unreadable` | 路径存在但列不动、打不开或读不了（权限、I/O 错误、符号链接成环） |
| `evidence_write_failed` | 证据文件写不进去；**它不会取代结果**，而是作为成功结果上的 `evidenceError.code` 出现，因为留证失败不该丢掉测量结果 |

选择规则：

- **目录递归展开**，结果**去重**（同一路径传两次只留一行）并按绝对路径**升序排序**，所以同一选择重复跑两次可以逐行比对。
- 递归时：**符号链接指向的文件**按目标内容哈希；**符号链接指向的目录不跟进**（成环的目录没有有限遍历）；套接字、FIFO 和设备文件**跳过**——它们没有有限的字节可读。
- **显式传入**的路径更严格：既不是普通文件也不是目录就直接 `not_a_file`，不会被静默跳过。
- **快速失败**：任何一个路径出错就整体失败并指名该路径，不返回半份清单——一份短的清单看起来和完整清单一模一样。
- 空目录（或没有选中任何文件）返回 `status: "ok"`、`files: []`、`totalBytes: 0`：这是"这个选择里没有普通文件"，不是错误。
- 调用被取消时按取消原因 reject，不返回错误码：取消不是文件的属性。

## 留证文件（落盘规范）

给了 `evidenceDir` 时：

| 项 | 规范 |
|---|---|
| 目录参数 | `evidenceDir`；**不传就不写任何文件**，返回值里也不会出现 `evidencePath` |
| 文件名 | `<evidenceDir>/hash-<ISO 时间戳>.json`，时间戳取报告自己的 `generatedAt`，其中每个 `:` 换成 `-`，例如 `hash-2026-09-21T07-14-03.812Z.json`（Windows / macOS / Linux 都合法） |
| 文件权限 | `0600`（owner 读写，无 group/other 位） |
| 目录权限 | 本包**新建**的证据目录是 `0700`；**已存在**的目录按原样使用，不会被重新 chmod——调用方可能故意指向共享位置 |
| 原子写 | 同目录下以随机后缀 `wx` 独占创建临时文件（0600）→ `fs.rename` 覆盖到最终名；读方只会看到"没有文件"或"完整记录"，成功或失败都不留临时文件，同名旧记录被整体替换而不是被截断 |
| 持久性 | 不调用 `fsync`：承诺原子性，不承诺崩溃持久性（与官方原子写原语的边界一致） |
| 内容 | 返回值的 JSON（含 `evidencePath` 本身，缩进 2 空格、末尾一个换行），字段就是上面的 `status` / `files[]` / `generatedAt` / `totalBytes` / `evidencePath` |
| 不含内容 | **任何情况下都不含文件内容、不含 base64、不含二进制片段** |

同名冲突：同一毫秒内的两次调用会算出同一个文件名，后写的整体替换先写的（`rename` 语义）。

## 设计说明

- **形态**：宿主工具，无浏览器半，无客户端 bundle，不注册 `dsh.client`，也不注册提示词段。
- **分层**：纯函数核心在 `src/host/hash.ts`（列文件、算哈希、组装结果），原子写在 `src/host/evidence.ts`，两侧共用的类型在 `src/shared/types.ts`；三者都不 import 任何 DSH 类型，可被别家宿主的外壳（例如 MCP server）复用。`src/index.ts` 只做注册与两行接线。
- **副作用注册**：工具注册在插件 fiber 上，插件释放时自动注销。模块内不持有宿主状态。
- **依赖**：`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools` 声明为 peer，由宿主提供；运行时不需要任何第三方包（只有 Node 内置模块），因此 `package.json` 没有 `dependencies`。
- **流式读取**：文件按流读取而不是整块读入内存，产物比内存大也能算。
- **取消**：工具调用转发 `exec.signal`，取消会中断目录遍历、并在读取中用流销毁中止当前文件。
- **证据文件不借用官方原语**：宿主自带的原子写包不在插件的解析范围内；这里按同样的姿势（独占创建的兄弟临时文件 + `rename` + 调用方指定权限位）自行实现，保持零运行时依赖。
- **命名**：npm 包名 `soia-dsh-tool-check-file-hash`（工具类，官方 `dsh-tool-*` 形态加 `soia-` 前缀），entry id `tool-check-file-hash`。
- **扩展点**：不注册 `tools/pre-execute`、`tools/post-execute` 等策略钩子，不监听事件，也不提供配置 schema。

## 配置与事件

无。本包当前不读取任何配置项，也不发出任何事件。

## 许可

MIT。版权行见仓库根 [`LICENSE`](../../LICENSE)。

## Model Experience

### `check_file_hash` 工具的 schema

#### What the model sees

注册的工具名 `check_file_hash`、一个必填字符串数组参数 `paths`、一个可选字符串参数 `evidenceDir`，以及下面的逐字文本：

##### Verbatim tool description

```markdown
Hash files or directories with sha256 and report paths, digests and sizes, to check a receipt's claimed artifact against the actual bytes. Pass evidenceDir to record the report as a JSON file.
```

参数描述（逐字）：

```markdown
paths: Files or directories to hash
evidenceDir: Directory for the evidence file (none: do not write)
```

面向模型的工具目录由宿主从注册的 schema 生成；本仓不产出生成的工具目录，因此这里没有可引用的目录锚点。

#### Token effect

固定。只要该工具可见，名称、描述与两个参数的 schema 就进入每一次组装。**实测：模型可见投影（`name` + `description` + `parameters` 的 JSON）499 字符，按宿主 token-meter 的固定密度（≈4 字符 1 token）为 125 token；`pnpm run check-token-budget` 从构建产物重算并与 `package.json` 的 `dsh.tokenBudget.resident`（125）比较，超标即红。** 本包不注册提示词段，也不追加保留式或动态上下文；把工具隐藏的作用域会整体移除这份贡献。

#### KV Cache effect

前缀稳定。所有字段都是常量字符串，本包自身不改写工具块，也不会让已有前缀失去复用。前缀只在两种情况下变化：本包 manifest 改动了这些字符串，或另一个提供方改变了工具的可见性或顺序——两者都不属于本包所有。

## Known Limitations and Deferred Work

- **逐文件串行哈希。** 为了失败路径确定、打开文件数有界、报告不受调度顺序影响，本包一次只读一个文件；超大目录树没有并行度，也没有进度回报。
- **不是快照。** `size` 来自哈希前的 `stat`，内容来自随后的流式读取：如果算的过程中有别的写入者修改文件，两者可能来自不同版本。本包不做 `O_NOFOLLOW` 句柄固定、不做 mtime 复核，也不重试。
- **记录里只有内容哈希。** 没有 mtime、权限位、属主、inode，也没有目录树结构；需要完整文件指纹或变更审计时不适用。
- **遍历有取舍。** 符号链接指向的目录不跟进；递归中遇到的套接字、FIFO 和设备文件被静默跳过，报告里没有 `skipped` 清单可以核对。
- **证据文件名同一毫秒会撞名。** 时间戳精确到毫秒；同毫秒的第二次写入会整体替换第一次，不追加、不报错。
- **已存在的证据目录不会被收窄权限。** 只有本包新建的目录才是 0700；调用方指定的已有目录保持原样（这是有意的，避免误改共享目录）。
- **原子性不等于崩溃持久性。** 写入不调用 `fsync`；断电或进程被杀时，可能丢的是最后一次写入，而不是留下半份文件。
- **兼容性未经实测。** `dsh.compatibility.dsh` 的范围 `>=0.1.0-rc.8 <0.2.0` 是生态惯例写法；按 node-semver 的严格语义，该范围**不匹配预发布版**（如 `0.1.5-rc.2`、`0.1.6-alpha.2`），预发布版本需要同 tuple 的比较器才能满足，peer 依赖因此逐个列举了已发布的预发布版本。
- **验证深度（如实）**：包内 34 个测试覆盖哈希核心、证据写入与注册接线（含权限位、原子性、不含正文、写成失败仍返回哈希）。**尚未做**：装进一次性 profile 的加载验证、真实模型调用验证——这两层属于本仓根侧门禁，本次未跑（`--dump-config` 烟测可由根脚本覆盖到本包）。提交的 `lib/index.js` 用根 `tsdown.config.ts` 给每个包生成的同一组选项重建过，产物与根构建**逐字节一致**（已实测 sha256 相同）。
