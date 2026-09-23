#!/usr/bin/env bash
#
# Local install verification — no npm registry involved.
#
# Packs every package with `npm pack`, installs the resulting tarballs into a
# throwaway DSH profile under a separate DSH_HOME, and then proves three layers:
#
#   1. installed   — pnpm resolved the tarballs into the profile
#   2. composed    — every package's patch row reaches `--dump-config`
#   3. loadable    — the profile boots, which the host refuses to do when a
#                    plugin in the tree fails to apply (including a declared
#                    client bundle that is missing)
#
# It never touches the live `web` profile, never reads a credential, and never
# talks to a registry.
#
# Usage:
#   bash scripts/verify-local-install.sh                 # all packages
#   HOME_DIR=/tmp/x PROFILE=demo bash scripts/verify-local-install.sh
#
# Exit codes: 0 every layer passed, 1 a layer failed, 2 a precondition failed.

set -euo pipefail

DSH_BIN="${DSH_BIN:-dsh}"
PROFILE="${PROFILE:-local-verify}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

DSH_HOME_DIR="${HOME_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/dsh-local-verify.XXXXXX")}"
TARBALL_DIR="${TARBALL_DIR:-${DSH_HOME_DIR}/tarballs}"
mkdir -p "${TARBALL_DIR}"

export DSH_HOME="${DSH_HOME_DIR}"
echo "verify-local-install: DSH_HOME=${DSH_HOME} profile=${PROFILE}"

# ── 1. pack ────────────────────────────────────────────────────────────────
packages=()
for manifest in $(find "${repo_root}/packages" -maxdepth 2 -name package.json | sort); do
  dir="$(dirname "${manifest}")"
  name="$(sed -n 's/.*"name": "\([^"]*\)".*/\1/p' "${manifest}" | head -1)"
  [ -n "${name}" ] || continue
  ( cd "${dir}" && npm pack --pack-destination "${TARBALL_DIR}" >/dev/null 2>&1 )
  tarball="${TARBALL_DIR}/${name}-$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "${manifest}" | head -1).tgz"
  [ -f "${tarball}" ] || { echo "verify-local-install: pack failed for ${name}" >&2; exit 1; }
  packages+=("${tarball}")
done
echo "verify-local-install: packed ${#packages[@]} package(s) into ${TARBALL_DIR}"

# ── 2. install into a throwaway profile ────────────────────────────────────
"${DSH_BIN}" "${PROFILE}" --from-default-profile web --dump-config >/dev/null
"${DSH_BIN}" plugin --profile "${PROFILE}" add "${packages[@]}" >/dev/null
echo "verify-local-install: installed ${#packages[@]} tarball(s) into profile ${PROFILE}"

# ── 3. composed ────────────────────────────────────────────────────────────
dump="$(mktemp)"
trap 'rm -f "${dump}"' EXIT
"${DSH_BIN}" --profile "${PROFILE}" --dump-config >"${dump}" 2>&1

status=0
for tarball in "${packages[@]}"; do
  base="$(basename "${tarball}")"
  name="${base%-*}"                      # strip the version segment
  entry="${name#soia-dsh-}"
  entry="${entry#client-}"
  if grep -q -A2 "id: ${entry}$" "${dump}"; then
    echo "verify-local-install: ✓ composed ${entry}"
  else
    echo "verify-local-install: ✗ ${entry} is absent from the composed config" >&2
    status=1
  fi
done

# ── 4. loadable ────────────────────────────────────────────────────────────
# A boot is the cheapest honest "loaded" signal available without the Web
# socket mux: the host aborts when the plugin tree fails to apply, and a client
# package whose declared bundle is missing aborts it too.
boot_log="$(mktemp)"
"${DSH_BIN}" "${PROFILE}" --port 0 --no-open >"${boot_log}" 2>&1 &
boot_pid=$!
for _ in $(seq 1 30); do
  grep -q "dsh web: http" "${boot_log}" && break
  grep -q "plugin tree failed to load" "${boot_log}" && break
  sleep 1
done
if grep -q "dsh web: http" "${boot_log}"; then
  echo "verify-local-install: ✓ the profile booted (plugin tree applied)"
else
  echo "verify-local-install: ✗ boot failed:" >&2
  sed -n '1,12p' "${boot_log}" >&2
  status=1
fi
kill "${boot_pid}" 2>/dev/null || true
wait "${boot_pid}" 2>/dev/null || true
rm -f "${boot_log}"

if [ "${status}" -eq 0 ]; then
  echo "verify-local-install: OK — packed, installed, composed and booted from local tarballs"
else
  echo "verify-local-install: FAILED" >&2
fi
exit "${status}"
