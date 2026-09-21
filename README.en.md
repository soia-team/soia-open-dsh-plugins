# soia-open-dsh-plugins

SOIA's public DSH plugin repository: host plugins for DeepSeek Harness (DSH),
built to the official bundle specification.

[中文](README.md)

## What this repository is

Every package is a **DSH bundle**: an npm package carrying a `cordis.patch.yml`
configuration layer that inserts one plugin row into a profile's composed
configuration. Once installed into a profile, the capabilities declared by that
row are live in a session.

Three boundary facts define this repository:

- **Plugins only.** No skills, no product source, no private scripts. The skill
  repositories are the source of truth for skills; this repository references
  them on demand only.
- **No user profile is modified.** A plugin contributes its own row and nothing
  else; `$DSH_HOME/profiles/*` and `$DSH_HOME/cordis.patch.yml` belong to the
  user.
- **A placeholder says it is a placeholder.** A skeleton package registers an
  entry point without pretending to implement the capability, and records the
  gap under `Known Limitations and Deferred Work` in its README.

## Packages

| Package | Entry id | Status | Description |
|---|---|---|---|
| [`soia-dsh-tool-check-ui-size`](packages/check-ui-size/README.en.md) | `tool-check-ui-size` | **Skeleton placeholder** | Measures an element's actual geometry. It currently registers only the tool and a short system-prompt rule; no local measurement backend is wired up yet. |

[`pnpm-workspace.yaml`](pnpm-workspace.yaml) is the single machine source of
truth for the package list; the table above follows it.

## Installation

This repository publishes to no registry yet and offers no installation steps
today. Once a package is published, installation goes through the DSH CLI into a
named profile:

```bash
dsh plugin --profile <profile-name> add soia-dsh-tool-check-ui-size
dsh --profile <profile-name> --dump-config   # verify the layer only, do not start
```

Decide the target profile and the scope of the installation first; never test an
install against a profile in use. Installability is defined by the actual
published artifact.

## Local development

```bash
pnpm install          # prepare the workspace once
pnpm run build        # build each package to lib/ with tsdown
pnpm run typecheck    # type-check sources and tests with tsc
pnpm run lint         # oxlint
pnpm run test         # vitest
pnpm run smoke        # read-only check that the patch row reaches the config tree
```

`pnpm run smoke` runs [`scripts/smoke-dump-config.sh`](scripts/smoke-dump-config.sh),
which is read-only: it starts no service and modifies no profile. Environment
variables override its defaults:

| Variable | Default | Purpose |
|---|---|---|
| `DSH_BIN` | `dsh` | The DSH executable |
| `DSH_PROFILE` | `web` | Profile name used to obtain the baseline config |
| `PACKAGE` | `check-ui-size` | Package directory to verify |

## Verification standard

"Installed != loaded != usable" are three states, each needing its own evidence:

1. `--dump-config` proves the patch row reached the composed configuration —
   `pnpm run smoke` covers this layer.
2. An entry showing `active` in `pluginInventory/list` proves the plugin loaded.
3. One real tool call with the expected output proves it is usable.

Layers 2 and 3 require a throwaway profile and are outside this repository's
read-only smoke check.

## Repository layout

```
AGENTS.md / AGENTS.en.md        Repository rules (Chinese / English)
packages/<pkg>/                 One package = one bundle
  package.json                  Carries dsh.bundle and dsh.compatibility
  cordis.patch.yml              The row inserted into a profile's config tree
  src/                          Host-side entry module
  tests/                        vitest unit tests
  README.md / README.en.md      Package docs, ending with Model Experience and
                                Known Limitations and Deferred Work
  README.i18n.yaml              Bilingual pairing record
scripts/smoke-dump-config.sh    Read-only configuration-layer smoke check
.github/workflows/ci.yml        install -> typecheck -> lint -> build -> test -> smoke
```

## Contributing and security

- Contribution flow, naming, package invariants, and releases:
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Vulnerability reporting and scope: [SECURITY.md](SECURITY.md).
- Third-party code and reference registry:
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE), copyright line `Copyright (c) 2026 soia-team`.
