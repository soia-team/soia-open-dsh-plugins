---
description: "DSH host tool package that computes sha256 content hashes for files or directories and records them, so a receipt's claimed artifact can be checked against the actual bytes."
kind: "package-bundle"
---

# soia-dsh-tool-check-file-hash

A DSH host tool package that computes **content hashes** (sha256) for files or directories and puts "what the receipt says" and "what is actually there" into one citable record.

[中文](README.md)

## What this package does

A receipt can name a file, a size and a version while the bytes on disk are something else entirely. A declaration is not a result: a digest read from the file itself is the one field of a record that cannot be asserted without reading it.

So this package does three things:

- accepts files or directories (directories are walked recursively) and hashes every selected **regular file** with sha256;
- returns the absolute path, algorithm, digest and byte size per file, plus the aggregate byte count;
- when a record is wanted, writes the same report **atomically** into a `0600` JSON evidence file.

The record holds paths, digests and sizes only: **it never contains file content, never base64, never a binary excerpt** — the schema has no field a file body could travel in.

It does not guess and does not hand back half an answer: a path that does not exist, an explicitly passed path that is not a regular file, or a file that cannot be read all return a typed failure naming that path, instead of a short list that looks complete.

## Install

Not yet on npm; install from the git source (`lib/` is committed, so the installed package works without a local build):

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-file-hash'
dsh --profile <profile-name> --dump-config   # configuration layer only; no service is started
```

Once published to npm, the same slot takes the package name: `dsh plugin --profile <profile-name> add soia-dsh-tool-check-file-hash`.

`cordis.patch.yml` contributes exactly one `insert` row: `id: tool-check-file-hash`, `name: soia-dsh-tool-check-file-hash`. The package registers no prompt section, and its runtime needs nothing but Node builtins.

## Tool contract

### `check_file_hash`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `paths` | string[] | yes | Files or directories to hash; a directory is walked recursively |
| `evidenceDir` | string | no | Directory for the evidence file; **omit it and nothing is written** |

Success (`status: "ok"`) returns:

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

| Field | Meaning |
|---|---|
| `files[].path` | Absolute path (a relative input is resolved against the process working directory) |
| `files[].algo` | Always `"sha256"`; this package speaks one algorithm |
| `files[].hash` | Lowercase hex digest of the file content |
| `files[].size` | Byte count from `stat`, taken before hashing |
| `generatedAt` | When the report was assembled, ISO 8601 |
| `totalBytes` | Sum of `files[].size` |
| `evidencePath` | **Present only when `evidenceDir` was given and the write succeeded** |
| `evidenceError` | **Present only when `evidenceDir` was given and the write failed**: `{ "code": "evidence_write_failed", "message": "…" }`; the hashes above are returned unchanged |

Failure (`status: "error"`) returns `code`, `message` and the offending `path`:

```json
{
  "status": "error",
  "code": "not_found",
  "message": "no such file or directory: /abs/path/missing.bin",
  "path": "/abs/path/missing.bin"
}
```

| `code` | Meaning |
|---|---|
| `not_found` | The path does not exist (or a parent of it is not a directory) |
| `not_a_file` | An explicitly passed path is neither a regular file nor a directory (character device, socket, …) |
| `unreadable` | The path exists but cannot be listed, opened or read (permissions, I/O error, symlink loop) |
| `evidence_write_failed` | The evidence file could not be written; **it does not replace the result** — it appears as `evidenceError.code` on the successful result, because losing the record must not lose the measurements |

Selection rules:

- **Directories are walked recursively**; the result is **de-duplicated** (a path passed twice keeps one row) and **sorted ascending** by absolute path, so two runs over the same selection can be compared line by line.
- During the walk: **symlinked files** are hashed through their target; **symlinked directories are not followed** (a cycle has no finite walk); sockets, FIFOs and devices are **skipped** — they have no finite bytes to read.
- An **explicitly passed** path is stricter: neither a regular file nor a directory is `not_a_file`, never a silent skip.
- **Fail fast**: any bad path fails the whole call and names that path; no partial list is returned, because a short list looks exactly like a complete one.
- An empty directory (or a selection that matches nothing) returns `status: "ok"`, `files: []`, `totalBytes: 0`: that means "no regular file in this selection", not an error.
- A cancelled call rejects with the cancellation reason instead of returning a code: being cancelled is not a property of the files.

## Evidence file (write contract)

When `evidenceDir` is given:

| Item | Contract |
|---|---|
| Directory parameter | `evidenceDir`; **nothing is written when it is omitted**, and no `evidencePath` appears in the result |
| File name | `<evidenceDir>/hash-<ISO timestamp>.json`, where the timestamp is the report's own `generatedAt` with every `:` replaced by `-`, e.g. `hash-2026-09-21T07-14-03.812Z.json` (legal on Windows, macOS and Linux) |
| File permissions | `0600` (owner read/write, no group or other bits) |
| Directory permissions | An evidence directory this package **creates** is `0700`; a directory that **already exists** is used as it is and never re-chmoded — the caller may have pointed at a shared location on purpose |
| Atomic write | A random-suffix sibling is created exclusively (`wx`, mode 0600) in the same directory, then `fs.rename`d onto the final name; a reader sees either no file or the complete record, no temporary file survives success or failure, and an existing record with the same name is replaced whole rather than truncated |
| Durability | No `fsync`: atomicity is promised, crash durability is not (the same boundary the host's atomic-write primitive states) |
| Content | The JSON of the returned value (including `evidencePath` itself, indented by 2 spaces, one trailing newline); its fields are exactly `status` / `files[]` / `generatedAt` / `totalBytes` / `evidencePath` |
| Never content | **Under no circumstances file content, base64 or a binary excerpt** |

Name collision: two calls inside the same millisecond derive the same file name, and the later write replaces the earlier one (`rename` semantics).

## Design notes

- **Shape**: host tool only; no browser half, no client bundle, no `dsh.client` declaration, no prompt section.
- **Layering**: the pure core lives in `src/host/hash.ts` (list files, hash, assemble the report), the atomic write in `src/host/evidence.ts`, and the shared types in `src/shared/types.ts`; none of them imports anything from DSH, so another host wrapper (an MCP server, for instance) can reuse them. `src/index.ts` only registers and wires two lines.
- **Side-effect registration**: the tool registers on the plugin fiber and unregisters when it is disposed. The module holds no host state.
- **Dependencies**: `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` are peers provided by the host; the runtime needs no third-party package (Node builtins only), so `package.json` declares no `dependencies`.
- **Streamed reads**: a file is read as a stream rather than buffered, so an artifact larger than memory still hashes.
- **Cancellation**: the tool forwards `exec.signal`; an abort interrupts the directory walk and destroys the in-flight stream.
- **Why not the host's atomic-write package**: that library is not resolvable from a plugin; the write follows the same posture here (exclusively created sibling + `rename` + caller-stated mode) to keep the runtime dependency set empty.
- **Naming**: npm name `soia-dsh-tool-check-file-hash` (the official `dsh-tool-*` shape with the `soia-` prefix), entry id `tool-check-file-hash`.
- **Extension points**: registers no `tools/pre-execute` or `tools/post-execute` policy hook, listens to no events, and exposes no configuration schema.

## Configuration and events

None. The package reads no configuration and emits no events.

## License

MIT. See the repository root [`LICENSE`](../../LICENSE).

## Model Experience

### The `check_file_hash` tool schema

#### What the model sees

The registered tool name `check_file_hash`, one required string-array parameter `paths`, one optional string parameter `evidenceDir`, and the verbatim text below:

##### Verbatim tool description

```markdown
Hash files or directories with sha256 and report paths, digests and sizes, to check a receipt's claimed artifact against the actual bytes. Pass evidenceDir to record the report as a JSON file.
```

Parameter descriptions (verbatim):

```markdown
paths: Files or directories to hash
evidenceDir: Directory for the evidence file (none: do not write)
```

The model-facing tool catalog is generated by the host from the registered schema; this repository produces no such catalog, so there is no catalog anchor to cite here.

#### Token effect

Fixed. While the tool is visible, its name, description and two-parameter schema enter every assembly. **Measured: the model-visible projection (the JSON of `name` + `description` + `parameters`) is 499 characters, 125 tokens at the host token-meter's fixed density (≈4 characters per token); `pnpm run check-token-budget` recomputes it from the built artifact and compares it with `dsh.tokenBudget.resident` in `package.json` (125), failing CI when exceeded.** The package registers no prompt section and appends no retained or dynamic context. A scope that hides the tool removes this contribution entirely.

#### KV Cache effect

Prefix-stable. Every field is a constant string, the package rewrites no tool block of its own, and no existing prefix loses reuse. The prefix changes only when this package's manifest changes those strings, or when another provider changes the tool's visibility or ordering — neither of which this package owns.

## Known Limitations and Deferred Work

- **One file at a time.** Hashing is sequential so the failure path is deterministic, the number of open files stays bounded, and the report does not depend on scheduling order; a very large tree gets no parallelism and no progress reporting.
- **Not a snapshot.** `size` comes from the `stat` taken before hashing and the content comes from the stream read afterwards: if another writer changes the file mid-call, the two can describe different versions. There is no `O_NOFOLLOW` handle pinning, no mtime re-check and no retry.
- **Content hash only.** No mtime, no permission bits, no owner, no inode, no directory structure; it is not a full file fingerprint or a change audit.
- **Traversal makes trade-offs.** Symlinked directories are not followed, and sockets, FIFOs and devices met during a walk are skipped silently; the report carries no `skipped` list to check against.
- **Evidence names collide within one millisecond.** The timestamp is millisecond-precision, so a second write in the same millisecond replaces the first whole — no append, no error.
- **A pre-existing evidence directory is not narrowed.** Only directories this package creates are `0700`; a caller-supplied existing directory keeps its mode (deliberate: this package does not re-permission someone else's shared directory).
- **Atomicity is not crash durability.** The write does not `fsync`; a power loss or a killed process can lose the last write, but cannot leave a half-written record.
- **Compatibility is unverified.** The `dsh.compatibility.dsh` range `>=0.1.0-rc.8 <0.2.0` follows ecosystem convention; under strict node-semver semantics that range does **not** match prereleases (such as `0.1.5-rc.2` or `0.1.6-alpha.2`), because a prerelease needs a comparator on the same tuple. The peer dependencies therefore enumerate the published prereleases one by one.
- **Verification depth (honest account)**: the package's 34 tests cover the hashing core, the evidence writer and the registration wiring, including permission bits, atomicity, the absence of file content, and the write-failure path that still returns hashes. **Not done**: a load check in a throwaway profile and a real model-initiated call — both are repository-root gates and were not run here (the `--dump-config` smoke check reaches this package through the root script). The committed `lib/index.js` was rebuilt with the exact option set the root `tsdown.config.ts` generates per package, and is **byte-identical** to that build (sha256 compared).
