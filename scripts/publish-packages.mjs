#!/usr/bin/env node
/**
 * Publish every workspace package to the **official** npm registry.
 *
 * The machine's `~/.npmrc` points at a read-only mirror, so this script always
 * passes `--registry https://registry.npmjs.org` explicitly and verifies the
 * login state before doing anything irreversible.
 *
 * Usage:
 *   node scripts/publish-packages.mjs --dry-run   # pack, inspect, upload nothing
 *   node scripts/publish-packages.mjs             # publish every package for real
 *   node scripts/publish-packages.mjs <name> …    # publish only the named packages
 *
 * It deliberately does not read or print any credential value: login state comes
 * from `npm whoami`, which prints the account name only.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY = 'https://registry.npmjs.org'
const dryRun = process.argv.includes('--dry-run')
/** Optional package-name filter; with no names, every publishable package is a target. */
const only = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Run a command, returning stdout; throws with stderr attached on failure. */
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

function packages() {
  const dir = join(root, 'packages')
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ dir: join(dir, entry.name), manifest: join(dir, entry.name, 'package.json') }))
    .filter((entry) => existsSync(entry.manifest))
    .map((entry) => ({ ...entry, json: JSON.parse(readFileSync(entry.manifest, 'utf8')) }))
    .filter((entry) => entry.json.private !== true)
    .sort((a, b) => a.json.name.localeCompare(b.json.name))
}

/** Same check the repo uses for name availability: 404 means free. */
function publishedVersions(name) {
  try {
    const body = run('curl', ['-s', '-f', `${REGISTRY}/${name}`])
    const json = JSON.parse(body)
    return Object.keys(json.versions ?? {})
  } catch {
    return []
  }
}

const account = run('npm', ['whoami', '--registry', REGISTRY]).trim()
console.log(`publish: registry=${REGISTRY} account=${account} mode=${dryRun ? 'dry-run' : 'PUBLISH'}`)

const all = packages()
const targets = only.length === 0 ? all : all.filter((entry) => only.includes(entry.json.name))
if (only.length > 0 && targets.length !== only.length) {
  const known = all.map((entry) => entry.json.name)
  const unknown = only.filter((name) => !known.includes(name))
  console.error(`publish: unknown package name(s): ${unknown.join(', ')}`)
  process.exit(1)
}
if (targets.length === 0) {
  console.error('publish: no publishable packages found')
  process.exit(1)
}

const results = []
for (const target of targets) {
  const { name, version } = target.json
  const existing = publishedVersions(name)
  if (existing.includes(version)) {
    results.push({ name, version, status: 'skip: version already published', files: 0, size: 0 })
    continue
  }
  try {
    const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--registry', REGISTRY], { cwd: target.dir }))
    const info = packed[0] ?? {}
    const fileCount = info.files?.length ?? 0
    const size = info.size ?? 0
    if (!dryRun) {
      run('npm', ['publish', '--registry', REGISTRY], { cwd: target.dir })
    }
    results.push({
      name,
      version,
      status: dryRun ? 'would publish' : 'published',
      files: fileCount,
      size,
      missing: ['lib/index.js', 'cordis.patch.yml'].filter(
        (required) => !(info.files ?? []).some((file) => file.path === required),
      ),
    })
  } catch (error) {
    results.push({ name, version, status: `FAILED: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`, files: 0, size: 0 })
  }
}

const width = results.reduce((max, row) => Math.max(max, row.name.length), 4)
console.log(`\n${'package'.padEnd(width)}  version  files  size      status`)
for (const row of results) {
  console.log(
    `${row.name.padEnd(width)}  ${row.version.padEnd(7)}  ${String(row.files).padStart(5)}  `
    + `${String(Math.round(row.size / 1024) + ' kB').padEnd(8)}  ${row.status}`
    + (row.missing?.length ? `  [missing from tarball: ${row.missing.join(', ')}]` : ''),
  )
}

const failed = results.filter((row) => row.status.startsWith('FAILED') || row.missing?.length)
if (failed.length > 0) {
  console.error(`\npublish: ${failed.length} package(s) need attention`)
  process.exit(1)
}
console.log(`\npublish: ${dryRun ? 'dry-run complete' : 'all packages published'}`)
