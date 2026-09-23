#!/usr/bin/env node
/**
 * Plugin scorecard: measure what can be measured about each package, and say
 * plainly what the numbers do and do not prove.
 *
 * The question this answers is "is this plugin good, and is it right?" — which
 * is not one question. A plugin can be loaded and wrong, right and unaffordable,
 * or cheap and silent when it breaks. Each row below therefore names both the
 * dimension and the evidence that would falsify it.
 *
 * What it does NOT do: judge quality. It reports measurable facts and marks the
 * dimensions that only a live run (or a human reading the output) can settle.
 * Where a number would be a guess, the cell says `not measured` rather than a
 * comfortable estimate.
 *
 * Usage:
 *   node scripts/plugin-scorecard.mjs [--json]
 *
 * Exit codes: 0 the scorecard was produced, 1 a measurement could not be taken.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', cwd: root, stdio: 'pipe', ...options })
}

/** Every package directory, in a stable order. */
function packages() {
  return readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(root, 'packages', entry.name)
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      return { dir, name: manifest.name, id: entry.name, manifest }
    })
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

/**
 * Resident token cost per package, read from the budget gate itself.
 *
 * The gate is the authority on this number: it measures the model-visible
 * projection by loading the built entry, so the scorecard repeats its run
 * instead of re-implementing its arithmetic.
 */
function tokenCosts() {
  const output = run('node', ['scripts/token-budget.mjs'])
  const costs = new Map()
  for (const line of output.split('\n')) {
    // `package  tools  sections  tool  section  resident  budget  headroom`
    const cells = line.trim().split(/\s+/)
    if (cells.length !== 8 || !cells[0].startsWith('soia-dsh-')) continue
    costs.set(cells[0].replace(/^soia-dsh-/, ''), { resident: Number(cells[5]), tools: Number(cells[1]) })
  }
  return costs
}

/**
 * Test counts per package, and how many of those tests exercise a failure path.
 *
 * A package whose tests only cover the happy path cannot tell you it breaks; the
 * ratio is reported so that gap is visible rather than implied by a large total.
 */
function testCounts() {
  const raw = run('npx', ['vitest', 'run', '--reporter=json', '--silent'], { env: { ...process.env, CI: '1' } })
  const start = raw.indexOf('{')
  const report = JSON.parse(raw.slice(start))
  const counts = new Map()
  for (const suite of report.testResults ?? []) {
    const file = String(suite.name ?? '')
    const pkg = /\/packages\/([^/]+)\//.exec(file)?.[1]
    if (pkg === undefined) continue
    const current = counts.get(pkg) ?? { total: 0, failurePaths: 0 }
    for (const assertion of suite.assertionResults ?? []) {
      current.total += 1
      const title = String(assertion.title ?? '')
      const status = String(assertion.status ?? '')
      if (/fail|error|invalid|missing|refus|reject|deny|unknown|unreadable|unavailable/i.test(title) || status === 'failed') {
        current.failurePaths += 1
      }
    }
    counts.set(pkg, current)
  }
  return counts
}

/** How many cases the shipped rule corpus pins, and on which side. */
function ruleCorpus() {
  const path = join(root, 'packages/safe-tool-call-policy/tests/shared/rule-corpus.test.ts')
  const text = readFileSync(path, 'utf8')
  return {
    total: (text.match(/^\s*\{ rule:/gm) ?? []).length,
    mustFire: (text.match(/^\s*\{ rule: '/gm) ?? []).length,
    mustStayQuiet: (text.match(/^\s*\{ rule: undefined/gm) ?? []).length,
  }
}

/**
 * Whether a package's tool results carry a machine-readable outcome.
 *
 * This is a source-level check for the *shape* of a failure report (`status`,
 * `code`, `error`), not a behavioural one: it says the package has somewhere to
 * put a typed failure, not that every path fills it in. The behavioural half is
 * the failure-path test count beside it.
 */
function failureVisibility(pkg) {
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) sources.push(readFileSync(path, 'utf8'))
    }
  }
  walk(join(pkg.dir, 'src'))
  const text = sources.join('\n')
  const hasStatus = /status:\s*'(ok|error)'|status:\s*"error"|'status'/.test(text)
  // `code: 'x'`, `code: variable`, or the shorthand `{ code }` — the live
  // measurement tool uses the shorthand, and a heuristic that only matched the
  // long form reported a typed failure as absent.
  const hasCode = /\bcode\s*[:,}]/.test(text)
  const hasErrorField = /error:\s*(?:string|null)|error\?:/.test(text)
  return {
    // Three shapes are legitimate, and the scorecard names which one is present
    // rather than collapsing them: `status` + `code` (a per-call verdict),
    // `error` + `code` (a report that either produced a result or did not), and
    // status alone.
    shape: hasStatus && hasCode
      ? 'status+code'
      : hasErrorField && hasCode
        ? 'error+code'
        : hasStatus
          ? 'status'
          : hasErrorField
            ? 'error'
            : 'none',
  }
}

/**
 * Whether the package exposes a runtime self-check service.
 *
 * A source-level check for the contract — a `health.ts` that publishes a
 * `Service` — because the value of a self-check is that something can *read* it.
 * The counters themselves are pinned by each package's own tests.
 */
function selfCheck(pkg) {
  const path = join(pkg.dir, 'src/host/health.ts')
  if (!existsSync(path)) return { has: false, counters: 0 }
  const text = readFileSync(path, 'utf8')
  const counters = (text.match(/^\s{2}readonly \w+:/gm) ?? []).length
  return { has: text.includes('extends Service'), counters }
}
function limitations(pkg) {
  const count = (file) => {
    const path = join(pkg.dir, file)
    if (!existsSync(path)) return 0
    const text = readFileSync(path, 'utf8')
    const index = text.indexOf('## Known Limitations')
    if (index === -1) return 0
    const tail = text.slice(index)
    const nextHeading = tail.indexOf('\n## ', 5)
    const section = nextHeading === -1 ? tail : tail.slice(0, nextHeading)
    return (section.match(/^- \*\*/gm) ?? []).length
  }
  return { zh: count('README.md'), en: count('README.en.md') }
}

/**
 * Read the live-acceptance history, if there is one.
 *
 * The trend is the point: one green run says "it works today", a pass rate over
 * many runs says whether it keeps working. Each check is reported separately,
 * because a suite that passes 9 of 10 times is not 90% healthy — it has one
 * flaky check, and which one matters.
 * @returns per-run summaries, oldest first.
 */
function acceptanceHistory() {
  const path = process.env['SOIA_ACCEPTANCE_HISTORY']
    ?? join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), 'acceptance-history.jsonl')
  if (!existsSync(path)) return { path, runs: [] }
  const runs = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
  return { path, runs }
}

const rows = []
let failed = false
let costs
let tests
try {
  costs = tokenCosts()
  tests = testCounts()
} catch (error) {
  console.error(`plugin-scorecard: a measurement failed — ${String(error).slice(0, 300)}`)
  failed = true
}

for (const pkg of packages()) {
  const corpus = pkg.id === 'safe-tool-call-policy' ? ruleCorpus() : undefined
  const visibility = failureVisibility(pkg)
  const counts = tests?.get(pkg.id) ?? { total: 0, failurePaths: 0 }
  rows.push({
    id: pkg.id,
    name: pkg.name,
    // The gate reports package names; rows are keyed by directory, so one
    // derivation is applied in exactly one place.
    resident: costs?.get(pkg.name.replace(/^soia-dsh-/, ''))?.resident ?? null,
    tools: costs?.get(pkg.name.replace(/^soia-dsh-/, ''))?.tools ?? null,
    budget: pkg.manifest.dsh?.tokenBudget?.resident ?? null,
    tests: counts.total,
    failurePathTests: counts.failurePaths,
    failureShape: visibility.shape,
    limitationsZh: limitations(pkg).zh,
    limitationsEn: limitations(pkg).en,
    ruleCorpus: corpus,
    // Dimensions no script can settle, listed so their absence is not mistaken
    // for a pass.
    liveAccuracy: 'opt-in: scripts/acceptance-live.mjs',
    runtimeSelfCheck: pkg.id === 'client-ui-live-tasks'
      ? 'health counters in the view'
      : selfCheck(pkg),
  })
}

const history = acceptanceHistory()

if (asJson) {
  console.log(JSON.stringify({ rows, acceptance: history }, null, 2))
} else {
  console.log('插件记分卡 —— 每个数字都说明它能证明什么、不能证明什么\n')
  const header = ['插件', '常驻', '预算', '用例', '失败路径用例', 'typed 失败', '限制条目(中/英)', '自检']
  console.log(header.join('\t'))
  for (const row of rows) {
    console.log([
      row.id,
      row.resident ?? '未测',
      row.budget ?? '未声明',
      row.tests,
      `${row.failurePathTests} (${row.tests === 0 ? 0 : Math.round((row.failurePathTests / row.tests) * 100)}%)`,
      // A hook has no tool result to shape: say so instead of printing "none",
      // which would read as a defect rather than as a different kind of plugin.
      row.tools === 0 ? '不适用（无工具）' : row.failureShape,
      `${row.limitationsZh}/${row.limitationsEn}`,
      row.runtimeSelfCheck === 'health counters in the view'
        ? '面板内'
        : row.runtimeSelfCheck.has ? `服务（${row.runtimeSelfCheck.counters} 项）` : '无',
    ].join('\t'))
  }
  console.log('\n规则语料:', JSON.stringify(rows.find((row) => row.ruleCorpus !== undefined)?.ruleCorpus ?? {}))
  const runs = history.runs
  const recent = runs.slice(-10)
  console.log(`\n验收历史（${history.path}）`)
  if (runs.length === 0) {
    console.log('  还没有记录。跑一次：SOIA_LIVE_ACCEPTANCE=1 node scripts/acceptance-live.mjs')
  } else {
    const fullRuns = recent.filter((run) => run.only === null || run.only === undefined)
    const passed = fullRuns.reduce((sum, run) => sum + (run.passed ?? 0), 0)
    const checks = fullRuns.reduce((sum, run) => sum + (run.checks ?? 0), 0)
    const tokens = recent.reduce((sum, run) => sum + (run.tokens ?? 0), 0)
    const duration = recent.reduce((sum, run) => sum + (run.durationMs ?? 0), 0)
    console.log(`  最近 ${recent.length} 次（其中整轮 ${fullRuns.length} 次）：整轮通过 ${passed}/${checks} 项 · 平均 ${Math.round(duration / recent.length / 1000)} 秒/次 · 平均 ${Math.round(tokens / recent.length / 1000)}k token/次`)
    const perCheck = new Map()
    for (const run of fullRuns) {
      for (const entry of run.detail ?? []) {
        const bucket = perCheck.get(entry.id) ?? { pass: 0, fail: 0 }
        bucket[entry.status === 'pass' ? 'pass' : 'fail'] += 1
        perCheck.set(entry.id, bucket)
      }
    }
    for (const [id, bucket] of perCheck) {
      const rate = bucket.pass + bucket.fail === 0 ? 0 : Math.round((bucket.pass / (bucket.pass + bucket.fail)) * 100)
      console.log(`    ${id}: ${bucket.pass} 通过 / ${bucket.fail} 失败（${rate}%）`)
    }
  }

  console.log('\n这些数字**不能**证明的事：')
  console.log('  · 常驻 token 便宜 ≠ 判据有用；要另外看语料的误报/漏报。')
  console.log('  · 用例多 ≠ 覆盖到失败路径；所以旁边给了失败路径用例占比。')
  console.log('  · 「失败形态」是源码形态检查：说明"有地方放失败码"，不等于每条路径都填了；真正的行为由失败路径用例覆盖。')
  console.log('  · 结论正确性只有活会话验收能证明（对照独立来源），见 scripts/acceptance-live.mjs。')
  console.log('  · 插件的"准不准"最终由使用者的判断决定：面板/工具只能保证事实与可追溯性。')
}

if (failed) process.exit(1)
