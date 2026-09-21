# THIRD_PARTY_NOTICES

> Last updated: 2026-09-21
> This table is currently empty. License values, once recorded, are metadata
> snapshots; recheck the upstream source before reuse.

## Bundled or copied third-party code

No third-party source code, vendor bundle, or vendored script is copied into
this repository at this time.

| Upstream | License snapshot | Used by | Relationship |
|---|---|---|---|
| _(none yet)_ | — | — | — |

## When to fill this table

Add a row as part of the same change that introduces the dependency, when the
change does any of the following:

1. **Copies code or a script** from another project into this repository, even
   partially, including adapted snippets long enough to carry a license.
2. **Vendors a generated bundle or asset** produced by an external tool whose
   license requires attribution.
3. **Bundles an external runtime artifact** into a published package instead of
   declaring it as a dependency.
4. **Adopts a method or specification** from a named upstream document closely
   enough that a maintainer would need the citation to audit the change.

An ordinary `dependencies` or `peerDependencies` entry is **not** a reason to
add a row: package managers already record that relationship in `package.json`
and the lockfile. Keep the license of every declared dependency auditable from
the package manifest instead of duplicating it here.

## Method references

None at this time.

## Maintenance

- Record the upstream link, the license value observed at the time of the
  change, the package in this repository that uses it, and whether code was
  copied or only referenced.
- When an upstream is reachable but carries no declared license, record it as
  `NOASSERTION` and do not copy its code.
- Remove a row only when the corresponding copied code or vendored artifact is
  fully removed from this repository.
