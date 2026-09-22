#!/usr/bin/env node
/**
 * Live acceptance: drive the shipped plugins through a real model in a real
 * DSH session and assert what came back.
 *
 * Unit tests prove the code does what its author meant; only a live run shows
 * what the host and the model actually do with it. Every check below was
 * previously performed by hand — which means it was performed once. This turns
 * those runs into one command with assertions and evidence.
 *
 * Design constraints, each of them deliberate:
 *
 *  - **Opt-in.** A full pass spends real tokens, so it runs only with
 *    `SOIA_LIVE_ACCEPTANCE=1`; without it the script explains itself and exits 0.
 *  - **Never the caller's profile.** Packages are installed into a throwaway
 *    profile created from the `headless` template and removed afterwards, so an
 *    in-use `web`/`tui` profile is not a test bed.
 *  - **Assertions read tool results, not the model's prose.** A model that
 *    summarises wrongly must not be able to pass a check.
 *
 * Usage:
 *   SOIA_LIVE_ACCEPTANCE=1 node scripts/acceptance-live.mjs [--keep] [--only <id>]
 *
 * Exit codes: 0 every selected check passed (or the run was skipped), 1 a check
 * failed, 2 a precondition failed.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const keep = args.includes('--keep')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex === -1 ? undefined : args[onlyIndex + 1]

if (process.env['SOIA_LIVE_ACCEPTANCE'] !== '1') {
  console.log('acceptance-live: skipped — this run spends model tokens.')
  console.log('acceptance-live: set SOIA_LIVE_ACCEPTANCE=1 to run it.')
  process.exit(0)
}

const dsh = process.env['DSH_BIN'] ?? 'dsh'
const profile = `acceptance-${Date.now().toString(36)}`
const scratch = mkdtempSync(join(tmpdir(), 'dsh-acceptance-'))
const evidenceDir = join(scratch, 'evidence')
/**
 * Where run history is appended.
 *
 * Machine-specific data, so it lives outside the repository: under `$DSH_HOME`
 * by default, overridable for tests. A trend line needs many runs, and many runs
 * are exactly what a throwaway scratch directory cannot provide.
 */
const historyPath = process.env['SOIA_ACCEPTANCE_HISTORY']
  ?? join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), 'acceptance-history.jsonl')
mkdirSync(evidenceDir, { recursive: true })

/** One check: a prompt plus the assertions its tool results must satisfy. */
const CHECKS = [
  {
    id: 'ui-size',
    title: 'check_ui_size measures a real page and separates the box-model layer',
    prompt: (ctx) => `请依次调用 check_ui_size 两次，都传 url "${ctx.fixtureUrl}", `
      + '第一次 selector 传 "#card"、expected 传 {"width":320}；'
      + '第二次 selector 传 "#pill"、expected 传 {"width":88}。'
      + '把两次返回的 JSON 原样贴给我，不要解释。',
    assert: (results) => {
      const card = results.find((text) => /"?selector"?\s*:\s*"#card"/.test(text))
      const pill = results.find((text) => /"?selector"?\s*:\s*"#pill"/.test(text))
      const problems = []
      if (card === undefined) problems.push('no result for #card')
      else if (!/"?(?:rect\.)?width"?\s*:\s*320/.test(card)) problems.push('#card width was not 320')
      if (pill === undefined) problems.push('no result for #pill')
      else {
        if (!/"rect"?\s*:\s*\{[^}]*"?width"?\s*:\s*108/s.test(pill)) problems.push('#pill rect width was not 108')
        if (!/"computed"?\s*:\s*\{[^}]*"?width"?\s*:\s*88/s.test(pill)) problems.push('#pill computed width was not 88')
      }
      return problems
    },
  },
  {
    id: 'policy-data-root',
    title: 'the policy denies a write into a real data root',
    prompt: () => '请执行这一条命令：rm -rf ~/.myapp/cache 。如果被拒绝，把拒绝原文贴给我。',
    assert: (results) => {
      const denial = results.find((text) => /data root|workspace or a scratch/i.test(text))
      return denial === undefined ? ['no denial mentioning the data-root rule'] : []
    },
  },
  {
    id: 'quality-gates',
    title: 'check_quality_gates reads this repository\'s gate checklist',
    prompt: (_ctx) => '请调用 check_quality_gates，changedFiles 传 '
      + `["packages/check-ui-size/src/index.ts"]，configPath 传 "${join(root, '.dsh/gates.yml')}"，`
      + '把返回的 requiredGates 列表原样贴给我。',
    assert: (results) => {
      const text = results.find((value) => value.includes('requiredGates'))
      if (text === undefined) return ['no result mentioning requiredGates']
      const problems = []
      if (!text.includes('typecheck')) problems.push('the typecheck gate was not selected')
      // The tool answers with pretty-printed JSON, so match on shape, not on one
      // exact byte sequence. `enforcement` is a contract field on every report
      // (this tool produces a checklist; it never blocks), so any value passes —
      // its presence is what the wire contract promises.
      if (!/"?enforcement"?\s*:/.test(text)) problems.push('no enforcement field')
      if (!/"?source"?\s*:\s*"[^"]*gates\.yml"/.test(text)) problems.push('the report did not name the config it read')
      return problems
    },
  },
  {
    id: 'file-hash',
    title: 'check_file_hash returns the digest an independent tool computes',
    prompt: (ctx) => `请调用 check_file_hash，paths 传 ["${ctx.hashTarget}"]，把返回原样贴给我。`,
    assert: (results, ctx) => {
      const text = results.find((value) => value.includes('sha256'))
      if (text === undefined) return ['no result carrying a sha256 digest']
      return text.includes(ctx.hashTargetHash) ? [] : [`the digest did not match ${ctx.hashTargetHash.slice(0, 12)}…`]
    },
  },
  {
    id: 'skills-coverage',
    title: 'check_skills reports a skill that is not in this session\'s catalog',
    prompt: () => '请调用 check_skills，applicableSkills 传 ["definitely-not-a-real-skill"]，'
      + '把 verdict 与 missing 原样贴给我。',
    assert: (results) => {
      const text = results.find((value) => /"?verdict"?\s*:/.test(value))
      if (text === undefined) return ['no result carrying a verdict']
      return text.includes('not_in_catalog') ? [] : ['the verdict was not not_in_catalog']
    },
  },
]

/**
 * Sum the token usage the host reports for one run.
 * @param stdout - the run's JSON event stream.
 * @returns total tokens, or null when the stream carried no usage.
 */
function tokensOf(stdout) {
  let total = null
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'status' && typeof event.usage?.totalTokens === 'number') {
        total = (total ?? 0) + event.usage.totalTokens
      }
    } catch {
      continue
    }
  }
  return total
}

/** Collect the tool results out of one headless run's JSON event stream. */
function parseRun(stdout) {
  const results = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'tool_result') results.push(String(event.result ?? ''))
  }
  return results
}

/**
 * Serve the geometry fixture from a **separate process**.
 *
 * An in-process server looks simpler and cannot work here: every check runs the
 * host synchronously, so this script's event loop is blocked for the whole run
 * and the page request would time out. (Measured — the first version did exactly
 * that and every measurement came back `navigation_failed`.)
 * @param dir - directory to serve.
 * @returns the child process and the URL of the fixture page.
 */
async function serveFixture(dir) {
  const port = 8000 + Math.floor(Math.random() * 1000)
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], {
    stdio: 'ignore',
    detached: false,
  })
  const url = `http://127.0.0.1:${port}/second-case.html`
  // Sequential by necessity: each attempt waits for the previous one to fail, so
  // there is nothing to run in parallel.
  // oxlint-disable-next-line no-await-in-loop -- polling a port is inherently sequential
  for (let attempt = 0; attempt < 40; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- see above
    const ready = await fetch(url).then((response) => response.ok).catch(() => false)
    if (ready) return { child, url }
    // oxlint-disable-next-line no-await-in-loop -- see above
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`the fixture server never answered on ${url}`)
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { encoding: 'utf8', cwd: root, ...options })
}

let failures = 0
const summary = []
let fixtureServer

try {
  // ── throwaway profile with the local packages ─────────────────────────────
  run(dsh, [profile, '--from-default-profile', 'headless', '--dump-config'], { stdio: 'pipe' })
  const packageDirs = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, 'packages', entry.name))
  for (const dir of packageDirs) {
    run('npm', ['pack', '--pack-destination', scratch], { cwd: dir, stdio: 'pipe' })
  }
  const tarballs = readdirSync(scratch)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(scratch, name))
  run(dsh, ['plugin', '--profile', profile, 'add', ...tarballs], { stdio: 'pipe' })
  console.log(`acceptance-live: profile ${profile} carries ${tarballs.length} local package(s)`)

  // ── fixtures (written before the server starts, then served out of process) ──
  const hashTarget = join(scratch, 'fixtures/hash-target.txt')
  mkdirSync(join(scratch, 'fixtures'), { recursive: true })
  writeFileSync(hashTarget, 'live acceptance digest target\n')
  writeFileSync(join(scratch, 'fixtures/second-case.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>acceptance fixture</title>
<style>body{margin:0}#card{width:320px;height:180px;background:#eee}
#pill{display:inline-block;padding:0 10px;min-width:88px;line-height:28px}</style></head>
<body><div id="card"><span id="pill">标签</span></div></body></html>
`)
  const fixture = await serveFixture(join(scratch, 'fixtures'))
  fixtureServer = fixture.child
  const context = {
    fixtureUrl: fixture.url,
    hashTarget,
    hashTargetHash: createHash('sha256').update(readFileSync(hashTarget)).digest('hex'),
  }
  // ── checks ────────────────────────────────────────────────────────────────
  for (const check of CHECKS) {
    if (only !== undefined && check.id !== only) continue
    process.stdout.write(`acceptance-live: ${check.id} … `)
    const startedAt = Date.now()
    const stdout = run(dsh, ['--profile', profile, 'headless', '--json', check.prompt(context)], { stdio: 'pipe' })
    writeFileSync(join(evidenceDir, `${check.id}.jsonl`), stdout)
    const problems = check.assert(parseRun(stdout), context)
    const record = {
      id: check.id,
      status: problems.length === 0 ? 'pass' : 'fail',
      title: check.title,
      durationMs: Date.now() - startedAt,
      tokens: tokensOf(stdout),
      ...(problems.length === 0 ? {} : { problems }),
    }
    if (record.status === 'pass') console.log('✓')
    else {
      console.log(`✗ ${problems.join('; ')}`)
      failures += 1
    }
    summary.push(record)
  }
} catch (error) {
  console.error(`acceptance-live: precondition failed — ${String(error).slice(0, 400)}`)
  failures += 1
} finally {
  fixtureServer?.kill()
  try {
    run(dsh, ['plugin', '--profile', profile, 'remove', '--all'], { stdio: 'pipe' })
  } catch {
    // Removing packages is best-effort; the profile directory goes either way.
  }
  rmSync(join(process.env['DSH_HOME'] ?? '', 'profiles', profile), { recursive: true, force: true })
  writeFileSync(join(scratch, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  // One line per run: a pass rate needs history, and history needs a file that
  // survives the scratch directory.
  const passed = summary.filter((entry) => entry.status === 'pass').length
  try {
    mkdirSync(dirname(historyPath), { recursive: true })
    appendFileSync(historyPath, `${JSON.stringify({
      at: new Date().toISOString(),
      // A partial run must not read as a full pass in the trend.
      only: only ?? null,
      checks: summary.length,
      passed,
      failed: summary.length - passed,
      durationMs: summary.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
      tokens: summary.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0),
      detail: summary.map(({ id, status, durationMs, tokens }) => ({ id, status, durationMs, tokens })),
    })}\n`)
    console.log(`acceptance-live: history appended to ${historyPath}`)
  } catch (error) {
    console.warn(`acceptance-live: could not append history — ${String(error).slice(0, 120)}`)
  }
  console.log(`acceptance-live: evidence in ${evidenceDir}`)
  if (!keep) rmSync(scratch, { recursive: true, force: true })
  else console.log(`acceptance-live: kept ${scratch}`)
}

if (failures > 0) {
  console.error(`acceptance-live: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('acceptance-live: OK — every selected check passed')
