#!/usr/bin/env bash
#
# Install the **published** packages from the official npm registry into a
# throwaway DSH profile under a separate DSH_HOME, then prove that every patch
# row reaches the composed configuration tree.
#
# Why a separate DSH_HOME: the live `web` profile is never a test bed. This
# script also never reads credentials; it only uses the caller's npm login state
# through pnpm, and the registry is forced explicitly because this machine's
# `~/.npmrc` points at a read-only mirror.
#
# Usage:
#   bash scripts/verify-npm-install.sh                      # all packages
#   bash scripts/verify-npm-install.sh soia-dsh-tool-check-ui-size
#
# Environment:
#   DSH_BIN      DSH executable (default: dsh)
#   HOME_DIR     throwaway DSH home (default: mktemp -d)
#   PROFILE      profile name inside that home (default: npm-verify)
#   REGISTRY     npm registry to install from (default: https://registry.npmjs.org)
#
# Exit codes: 0 all rows present, 1 a row is missing, 2 a precondition failed.

set -euo pipefail

DSH_BIN="${DSH_BIN:-dsh}"
REGISTRY="${REGISTRY:-https://registry.npmjs.org}"
PROFILE="${PROFILE:-npm-verify}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

packages=("$@")
if [[ ${#packages[@]} -eq 0 ]]; then
  while IFS= read -r manifest; do
    name="$(sed -n 's/.*"name": "\([^"]*\)".*/\1/p' "${manifest}" | head -1)"
    [[ -n "${name}" ]] && packages+=("${name}")
  done < <(find "${repo_root}/packages" -maxdepth 2 -name package.json | sort)
fi

if [[ ${#packages[@]} -eq 0 ]]; then
  echo "verify-npm-install: no packages found in ${repo_root}/packages" >&2
  exit 2
fi

HOME_DIR="${HOME_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/dsh-npm-verify.XXXXXX")}"
export DSH_HOME="${HOME_DIR}"
echo "verify-npm-install: DSH_HOME=${DSH_HOME} profile=${PROFILE} registry=${REGISTRY}"
echo "verify-npm-install: packages: ${packages[*]}"

# A fresh profile from the shipped template; --dump-config keeps it non-interactive.
"${DSH_BIN}" "${PROFILE}" --from-default-profile web --dump-config >/dev/null

# Install from the official registry, not from the machine-wide mirror.
export npm_config_registry="${REGISTRY}"
for pkg in "${packages[@]}"; do
  echo "verify-npm-install: installing ${pkg}"
  "${DSH_BIN}" plugin --profile "${PROFILE}" add "${pkg}" >/dev/null
done

dump_file="$(mktemp)"
trap 'rm -f "${dump_file}"' EXIT
"${DSH_BIN}" --profile "${PROFILE}" --dump-config >"${dump_file}" 2>&1

status=0
for pkg in "${packages[@]}"; do
  entry="${pkg#soia-dsh-}"
  entry="${entry#client-}"
  if grep -q -A2 "id: ${entry}$" "${dump_file}"; then
    echo "verify-npm-install: ✓ ${pkg} → entry ${entry}"
  else
    echo "verify-npm-install: ✗ ${pkg} → entry ${entry} NOT in the composed config" >&2
    status=1
  fi
done

if [[ ${status} -eq 0 ]]; then
  echo "verify-npm-install: OK — every published package installed and composed"
  echo "verify-npm-install: note — configuration layer only; loading needs a booted session"
else
  echo "verify-npm-install: FAILED" >&2
fi
exit "${status}"
