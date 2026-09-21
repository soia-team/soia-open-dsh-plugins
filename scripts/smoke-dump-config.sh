#!/usr/bin/env bash
#
# Read-only smoke check: prove that a package's `cordis.patch.yml` row really
# reaches the composed DSH configuration tree.
#
# It layers the package patch on top of an existing profile and runs
# `dsh --dump-config`, then greps for the entry id. It does NOT start a service
# and does NOT install anything.
#
# Known write behaviour to expect: `--dump-config` rewrites the profile root
# `cordis.yml` from its template. The content is byte-identical (measured, and it
# never contains the probed row); the profile's own `cordis.patch.yml`,
# `package.json` and lockfile are untouched.
#
# What this proves: the configuration layer contains the row.
# What this does NOT prove: that the plugin loaded, or that its tool works.
#
# Overridable environment:
#   DSH_BIN      DSH executable             (default: dsh)
#   DSH_PROFILE  profile used for the dump  (default: web)
#   PACKAGE      package directory name     (default: check-ui-size)
#   ENTRY_ID     entry id to look for       (default: read from cordis.patch.yml)
#
# Exit codes:
#   0  the entry row is present in the composed config
#   1  the entry row is missing
#   2  a precondition failed (no CLI, no patch file, dump failed)

set -euo pipefail

DSH_BIN="${DSH_BIN:-dsh}"
DSH_PROFILE="${DSH_PROFILE:-web}"
PACKAGE="${PACKAGE:-check-ui-size}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
patch_file="${repo_root}/packages/${PACKAGE}/cordis.patch.yml"

if ! command -v "${DSH_BIN}" >/dev/null 2>&1; then
  echo "smoke: DSH executable '${DSH_BIN}' not found on PATH" >&2
  echo "smoke: install the DSH CLI or point DSH_BIN at it" >&2
  exit 2
fi

if [[ ! -f "${patch_file}" ]]; then
  echo "smoke: patch file not found: ${patch_file}" >&2
  exit 2
fi

# Read the entry id from the patch instead of duplicating it in this script.
entry_id="${ENTRY_ID:-$(sed -n 's/^[[:space:]]*-[[:space:]]*id:[[:space:]]*//p' "${patch_file}")}"
entry_id="${entry_id%%$'\n'*}"
if [[ -z "${entry_id}" ]]; then
  echo "smoke: no 'id:' row found in ${patch_file}" >&2
  exit 2
fi

echo "smoke: package=${PACKAGE} entry=${entry_id} profile=${DSH_PROFILE}"
echo "smoke: dumping the composed config (read-only; no service is started)"

dump_file="$(mktemp)"
trap 'rm -f "${dump_file}"' EXIT

if ! "${DSH_BIN}" --profile "${DSH_PROFILE}" --patch "${patch_file}" --dump-config >"${dump_file}" 2>&1; then
  echo "smoke: '${DSH_BIN} --profile ${DSH_PROFILE} --dump-config' failed; first lines follow" >&2
  sed -n '1,40p' "${dump_file}" >&2
  echo "smoke: profile '${DSH_PROFILE}' must already exist; this check never creates one" >&2
  exit 2
fi

if ! grep -q -A2 "id: ${entry_id}$" "${dump_file}"; then
  echo "smoke: FAIL — entry '${entry_id}' is absent from the composed config tree" >&2
  exit 1
fi

grep -A2 "id: ${entry_id}$" "${dump_file}"
echo "smoke: OK — the patch row reached the composed config tree"
echo "smoke: note — configuration layer only; loading and a real tool call are separate evidence"
