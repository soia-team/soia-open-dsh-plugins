# soia-open-dsh-plugins

Public DSH plugin repository: `soia-dsh-*` host plugins (bundles). Users do not
share the maintainers' machines, accounts, or private profiles; the repository
name does not trigger the SOIA product proposal/board process.

## Boundaries

- This repository holds **DSH plugin packages only**: one package = one bundle =
  the `dsh.bundle` entry in `package.json` + `cordis.patch.yml` + the host-side
  entry module. It holds no skills, no product source, and no copies of private
  scripts; the skill repositories are the source of truth for skills and are
  read on demand only.
- A plugin takes effect only through the single `insert` row in
  `packages/<pkg>/cordis.patch.yml`. Never rewrite or take ownership of a user's
  `$DSH_HOME/profiles/*` or `$DSH_HOME/cordis.patch.yml`. Verify with
  `--dump-config` or a throwaway profile; never experiment on a profile in use.
- Never commit secrets, account identifiers, private config/.env files, machine
  absolute paths, or family/health/financial context; use placeholders in
  examples. Credentials stay in the official login state or the OS key store and
  are never copied into ordinary logs.
- **A skeleton package must state its placeholder status honestly.** Registering
  a tool is not implementing a capability. Unimplemented entry points belong in
  the package README's `Known Limitations and Deferred Work`, and the returned
  value plus source comments must carry the same status. Never describe a
  placeholder as finished.
- Choose package names, entry ids, and class/service role names by the official
  three-layer naming grammar and the official role vocabulary; do not use vague
  names such as `Manager` or `Helper`.
- Finish an authorized local change together with its relevant verification and
  preserve other people's work. Dispatching, committing/merging, releasing,
  installing, permission changes, and destructive deletion each require their
  own authorization for this task; never derive the next authorization from a
  passing self-check.

## On-demand entry points

- When adding a package, read the official "adding a workspace package"
  checklist and `packages/check-ui-size/` (this repository's reference
  implementation); do not copy templates in bulk.
- When changing a tool schema, execution contract, output rendering, or policy
  hook, read the official tool-authoring reference; a wording-only change does
  not load it.
- Every package README must end with the official sections: `Model Experience`
  (what the package contributes to model context, plus token and KV cache
  effects) and `Known Limitations and Deferred Work`. A package missing either
  section is incomplete.
- The `package.json` invariants (`type: module`, `main`/`types` pointing into
  `lib/`, `exports["."]`, the `files` allowlist, `dsh.bundle.patch`,
  `dsh.compatibility`, and identical peer/dev ranges) follow the official
  checklist. `pnpm-workspace.yaml` is the single machine source of truth for the
  package list; the root README package table follows it.
- For distribution, installation, and release questions, read the matching
  section of [CONTRIBUTING.md](CONTRIBUTING.md); do not read every document.

## Verification

For a wording-only change, check the diff, links, and bilingual consistency; for
a behavior change, run the affected tests. Run the following gates before
committing:

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test
bash scripts/smoke-dump-config.sh
```

- `scripts/smoke-dump-config.sh` performs a read-only `--dump-config` check: it
  starts no service and writes no profile. It proves **the composed config tree
  contains the row**; it does not prove the plugin loaded, and it does not prove
  the tool works.
- "Installed != loaded != usable" are three distinct states: `--dump-config`
  proves the first, while loading and a real call each need their own evidence.
  A skeleton package reports placeholder status until the latter two exist.
- Install dependencies only when they are missing and the environment install is
  authorized; do not treat `pnpm install` as an implicit precondition of a
  self-check, and do not use tests to perform unauthorized network, paid, or
  machine-changing work.

## Git and release

- This repository is currently a **local skeleton with no remote**. Going online
  requires explicit authorization for that occasion: confirm the repository
  name, visibility, and hosting location before creating the remote. These rules
  do not decide that for you.
- New branches start from the released `main` by default, and pull requests
  target `dev` explicitly; merging requires review and authorization for that
  occasion.
- Ordinary development never pushes `main`/`dev` directly. `dev` carries a
  `-SNAPSHOT` suffix; `main` stays on the released version.
- A formal release requires explicit authorization for that occasion: finalize
  the PR to `dev`/CI, confirm `main` is an ancestor of `dev` and check the actual
  merge conflicts, then fast-forward `main` only, tag/Release, reopen the
  SNAPSHOT, and finish the pin work.
- Before publishing to npm, confirm the registry and package-name ownership.
  Package names here have no scope, so `--access public` is unnecessary. Never
  hand a SNAPSHOT version to users.
- `main` accepts no pull requests; only an authorized release fast-forward that
  passed CI and the ancestor check may advance `main`.
