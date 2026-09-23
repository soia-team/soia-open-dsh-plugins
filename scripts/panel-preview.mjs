#!/usr/bin/env node
/**
 * Render the panel's browser half against fixture data, in a real browser.
 *
 * Verifying a client plugin by driving a live session is slow, costs tokens and
 * depends on the model doing what the prompt asked. None of that is needed to
 * answer "does this row look right": the component is a pure function of a
 * projection value, so this harness hands it one and screenshots the result.
 *
 * It loads the **built artifact** (`lib/client.js`) through the same
 * `window.__ModuleLoader__` contract the shell uses, with React and a minimal
 * primitives stub standing in for the loader's module table. That makes it a
 * check of the shipped bundle, not of the source.
 *
 * Usage:
 *   node scripts/panel-preview.mjs [--out <png>] [--keep]
 *
 * Exit codes: 0 rendered, 1 the panel did not render.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = outIndex === -1 ? join(tmpdir(), 'panel-preview.png') : args[outIndex + 1]
const keep = args.includes('--keep')

const staleHost = args.includes('--stale-host')
const widthIndex = args.indexOf('--width')
const panelWidth = widthIndex === -1 ? 1180 : Number(args[widthIndex + 1])
const scratch = mkdtempSync(join(tmpdir(), 'panel-preview-'))
const artifact = readFileSync(join(root, 'packages/client-ui-live-tasks/lib/client.js'), 'utf8')
const react = readFileSync(join(root, 'node_modules/react/umd/react.production.min.js'), 'utf8')
const reactDom = readFileSync(join(root, 'node_modules/react-dom/umd/react-dom.production.min.js'), 'utf8')

/**
 * A projection value that exercises every row kind the panel can draw.
 *
 * Deliberately includes the awkward cases: a running call, a failed call, an
 * injected context row, a step-less message and a long payload that must clip.
 */
// `--stale-host` drops the fields a newer client knows and an older host does
// not send: the browser half and the host half are versioned separately, and a
// refresh can pair a new client with the host that is still running. That pairing
// blanked the panel once; this mode keeps it from happening again unnoticed.
const staleFields = ['usage', 'turnsTotal', 'spans']

const fixture = {
  turnsTotal: 64,
  model: 'MiMo-V2.6-Flash',
  provider: 'xiaomi',
  usage: { reported: 12, input: 1_240_000, output: 38_000, cacheRead: 1_120_000, reasoning: 4_200, total: 1_402_000 },
  turn: 2,
  step: 2,
  running: true,
  seq: 42,
  updatedAt: Date.now() - 3_000,
  lastTool: { callId: 'c4', name: 'bash', turn: 2, step: 2, open: true, detail: 'sleep 30', startedAt: Date.now() - 3_000 },
  openTools: [{ callId: 'c4', name: 'bash', turn: 2, step: 2, open: true, detail: 'sleep 30', startedAt: Date.now() - 3_000 }],
  toolCallsInTurn: 2,
  toolCallsTotal: 5,
  failuresTotal: 1,
  toolsAvailable: 62,
  lastEvent: { type: 'tool/call', seq: 42, time: Date.now() - 3_000, detail: 'bash' },
  recent: [],
  actions: [
    { callId: 'c1', name: 'read', detail: '/etc/hosts', startedAt: Date.now() - 60_000, endedAt: Date.now() - 59_800, status: 'ok', result: '<path>/etc/hosts</path>' },
    { callId: 'c2', name: 'check_ui_size', detail: '#pill @ http://127.0.0.1:8899/second-case.html', startedAt: Date.now() - 59_000, endedAt: Date.now() - 58_000, status: 'ok', result: 'selector=#pill, matched=1, visible=true, status=ok' },
    { callId: 'c3', name: 'grep', detail: 'rg __no_such_symbol__ fixture.html', startedAt: Date.now() - 30_000, endedAt: Date.now() - 29_000, status: 'failed', result: 'Error: grep search failed (exit 2)' },
  ],
  timeline: [
    { id: 'turn-1', kind: 'turn', turn: 1, step: null, startedAt: Date.now() - 70_000, endedAt: null, title: '1', entryId: null, detail: null, result: null, argsFull: null, resultFull: null, status: 'ok' },
    { id: 'u1', kind: 'user', turn: 1, step: null, startedAt: Date.now() - 70_000, endedAt: Date.now() - 70_000, title: '', entryId: null, detail: '请做三件事：读 /etc/hosts、量 #pill、跑 echo ok', result: null, argsFull: null, resultFull: '请做三件事：读 /etc/hosts、量 #pill、跑 echo ok', status: 'ok' },
    { id: 'x1', kind: 'context', turn: 1, step: null, startedAt: Date.now() - 69_500, endedAt: Date.now() - 69_500, title: '', entryId: null, detail: '<system-reminder> The following workspace instructions may be relevant …', result: null, argsFull: null, resultFull: null, status: 'ok' },
    { id: 'a1', kind: 'assistant', turn: 1, step: 1, startedAt: Date.now() - 69_000, endedAt: Date.now() - 69_000, title: '', entryId: null, tokens: 5_120, model: 'MiMo-V2.6-Flash', detail: "I'll run all three checks in parallel.", result: null, argsFull: null, resultFull: null, status: 'ok' },
    { id: 'c1', kind: 'tool', turn: 1, step: 1, startedAt: Date.now() - 60_000, endedAt: Date.now() - 59_800, title: 'read', entryId: 'tool-read', detail: '/etc/hosts', result: '<path>/etc/hosts</path>', argsFull: '{\n  "file_path": "/etc/hosts",\n  "limit": 3\n}', resultFull: '<path>/etc/hosts</path>', status: 'ok' },
    { id: 'c2', kind: 'tool', turn: 1, step: 1, startedAt: Date.now() - 59_000, endedAt: Date.now() - 58_000, title: 'check_ui_size', entryId: 'tool-check-ui-size', detail: '#pill @ http://127.0.0.1:8899/second-case.html', result: 'selector=#pill, matched=1, visible=true, status=ok', argsFull: null, resultFull: null, status: 'ok' },
    { id: 'c3', kind: 'tool', turn: 1, step: 2, startedAt: Date.now() - 30_000, endedAt: Date.now() - 29_000, title: 'grep', entryId: 'tool-grep', detail: 'rg __no_such_symbol__ fixture.html', result: 'Error: grep search failed (exit 2)', argsFull: null, resultFull: null, status: 'failed' },
    { id: 'turn-2', kind: 'turn', turn: 2, step: null, startedAt: Date.now() - 10_000, endedAt: null, title: '2', entryId: null, detail: null, result: null, argsFull: null, resultFull: null, status: 'ok' },
    { id: 'u2', kind: 'user', turn: 2, step: null, startedAt: Date.now() - 10_000, endedAt: Date.now() - 10_000, title: '', entryId: null, detail: '再跑一条 bash: sleep 30', result: null, argsFull: null, resultFull: null, status: 'ok' },
    { id: 'c4', kind: 'tool', turn: 2, step: 2, startedAt: Date.now() - 3_000, endedAt: null, title: 'bash', entryId: 'tool-bash', detail: 'sleep 30', result: null, argsFull: '{\n  "command": "sleep 30",\n  "timeoutMs": 60000\n}', resultFull: null, status: 'running' },
  ],
  turns: [
    { turn: 1, startedAt: Date.now() - 70_000, endedAt: Date.now() - 20_000, toolCalls: 3, failures: 1, tools: ['read', 'check_ui_size', 'grep'], tokens: 42000 },
    { turn: 2, startedAt: Date.now() - 10_000, endedAt: null, toolCalls: 1, failures: 0, tools: ['bash'], tokens: 42000 },
  ],
  health: { folded: 47, ignored: 17, unknown: 0, frames: 0, agents: 0, registry: 0, deltasAccepted: 0, deltasDropped: 0 },
  streamedAt: null,
}

/**
 * Copy for the preview, mirroring `src/client/locales.ts`.
 *
 * Duplicated on purpose: the harness must run the shipped bundle without
 * importing the package's source, and a missing key shows up as the raw key in
 * the screenshot rather than as a crash.
 */
const DICTIONARY = {
  'view.tab': '活动', 'view.empty': '本会话还没有动作。',
  'lane.input': '输入', 'lane.model': '模型', 'lane.tools': '工具', 'lane.context': '上下文',
  'timeline.title': '时间线', 'timeline.user': '用户', 'timeline.assistant': '模型', 'timeline.tool': '工具',
  'timeline.turnN': '第 {n} 轮',
  'bar.search': '搜索工具或命令', 'bar.failedOnly': '只看失败', 'bar.expandAll': '展开全部',
  'bar.collapseAll': '收起全部', 'bar.clock': '实际时间', 'bar.duration': '时长',
  'bar.collapseTurns': '收起轮次', 'bar.expandTurns': '展开轮次', 'bar.clearRange': '清除选择',
  'bar.scrollHint': '横向可滚动', 'bar.rangeHint': '在时间图上拖动可框选',
  'axis.title': '轮次横轴（时间向右）',
  'axis.titleWindow': '轮次横轴（最近 {shown} 轮，共 {total} 轮）',
  'axis.summary': '本会话 {turns} 轮 · {calls} 次调用 · 失败 {failures} · 可用工具 {tools}（用到 {used} 种）',
  'overview.title': '概览', 'overview.status': '状态', 'overview.at': '位置',
  'overview.atValue': '#{turn} · 第 {step} 步', 'overview.turnOnly': '#{turn}',
  'overview.callsTurn': '本轮调用（回合）', 'overview.callsTotal': '累计调用（会话）',
  'overview.failures': '失败（会话）', 'overview.tools': '可用工具', 'overview.toolsUsed': '已用到 {n} 种',
  'head.toolRunning': '正在用的工具', 'head.toolLast': '最近用的工具', 'head.toolNone': '还没有用过工具',
  'turn.tools': '{n} 个工具', 'turn.stepN': '第 {n} 步', 'turn.empty': '这一轮没有工具调用',
  'turn.args': '参数', 'turn.result': '结果', 'turn.failed': '{n} 次失败', 'turn.expand': '点击查看详情',
  'detail.overview': '概述', 'detail.none': '（没有可显示的内容）',
  'detail.name': '名称', 'health.tools': '工具：{list}', 'history.loadEarlier': '加载更早的历史', 'history.loadingEarlier': '正在加载更早的历史…', 'detail.entryId': '插件 ID', 'detail.content': '内容', 'overview.caller': '调用方', 'overview.callee': '被调用方', 'overview.tokens': 'Token',
  'detail.timing': '计时', 'detail.close': '关闭详情', 'timing.ended': '结束时间',
  'turn.windowOnly': '更早的明细未保留（仅保留最近 {n} 行）',
  'bar.aria': '活动工具栏', 'bar.durationMode': '时长', 'bar.useActual': '使用实际时长',
  'bar.useEqual': '使用等宽操作', 'bar.turnsMode': '轮次', 'bar.callsMode': '调用',
  'bar.expandCalls': '展开所有调用', 'bar.collapseCalls': '收起所有调用',
  'bar.searchPlaceholder': '搜索',
  'detail.schema': 'Schema', 'detail.schemaUnavailable': 'Schema 不可用',
  'detail.hierarchy': '层级', 'level.user': '用户消息', 'level.assistant': '助手消息', 'level.tool': '工具调用',
  'detail.pending': '运行中，结果完成后显示', 'gen.running': '生成中…', 'detail.package': '包名', 'detail.version': '版本', 'detail.entry': '入口', 'detail.enabled': '已启用', 'detail.disabled': '未启用', 'detail.loading': '读取中…', 'detail.unavailable': '插件信息不可用', 'gen.reasoning': '思考中…',
  'detail.purpose': '说明', 'row.called': '调用: ',
  'timing.ms': '毫秒', 'timing.source': '计时来源', 'timing.sourceSession': '会话时间戳',
  'timeline.toolCallsOnly': '（仅工具调用）',
  'usage.line': '本会话 {total} tok · 输入 {input} · 输出 {output} · 缓存读取 {cache}（{pct}%）',
  'usage.unknown': '本会话还没有用量报告',
  'usage.turn': '{t} tok',
  'status.ok': '完成', 'status.failed': '失败', 'status.running': '进行中',
  'time.seconds': '{s} 秒', 'timing.duration': '时长', 'timing.started': '开始时间',
  'phase.running': '正在干活', 'phase.tool': '等工具返回', 'phase.idle': '空闲', 'phase.ended': '已结束',
  'running.title': '正在跑', 'running.empty': '现在没有在跑的动作', 'running.started': '已跑 {s} 秒',
  'log.title': '动作日志', 'log.filterAll': '最近 {n} 次', 'log.filterFailed': '只看失败 {n}',
  'log.filterEmpty': '没有符合条件的记录', 'log.time': '时间', 'log.tool': '工具', 'log.did': '干了什么',
  'log.took': '耗时', 'log.result': '结果', 'recent.title': '最近动静',
  'health.title': '运行状况', 'health.folded': '已折叠事件', 'health.ignored': '已忽略（会话管理类）',
  'health.unknown': '未知类型', 'health.frames': '收到流式帧', 'health.agents': '已接管 agent',
  'health.registry': '注册表可见', 'health.unreachable': '不可达',
  'health.deltasValue': '接受 {ok} · 丢弃 {dropped}', 'health.lastData': '数据更新',
  'health.silence': '{s} 秒前', 'health.stale': '已 {s} 秒没有新数据',
  'event.turnStart': '开始处理', 'event.turnEnd': '处理结束', 'event.userMessage': '收到你的消息',
  'event.assistantMessage': '模型回复', 'event.toolCall': '调用 {name}', 'event.toolResult': '{name} 返回',
}

// The lane chart plots the dense segment list, not the row window — generate a
// plausible sixty so the preview shows the strip's real density (the trajectory
// view plots every record, and a strip of twenty rows reads as empty beside it).
// Schemas the header would carry — `bash` is stored TRUNCATED the way the fold
// trims long definitions, so the preview proves the description is read even
// when the JSON will not parse (the live bug this fixed).
fixture.toolSchemas = {
  bash: JSON.stringify({
    name: 'bash',
    description: 'Execute a bash command (`bash -c`) and return its stdout/stderr.',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
  }).slice(0, 90),
  read: JSON.stringify({ name: 'read', description: 'Read a file as numbered text.', parameters: {} }),
  check_ui_size: JSON.stringify({ name: 'check_ui_size', description: 'Measure one DOM element against a URL.', parameters: {} }),
  grep: JSON.stringify({ name: 'grep', description: 'Search files for a pattern.', parameters: {} }),
}

fixture.spans = Array.from({ length: 60 }, (_, index) => {
  const kinds = ['user', 'assistant', 'tool', 'context']
  const kind = kinds[index % kinds.length] ?? 'tool'
  const startedAt = Date.now() - 70_000 + index * 1_100
  const toolNames = ['bash', 'read', 'check_ui_size', 'grep']
  return {
    id: `span-${index}`,
    title: kind === 'tool' ? (toolNames[index % toolNames.length] ?? 'bash') : null,
    turn: index < 30 ? 1 : 2,
    kind,
    status: index === 47 ? 'failed' : 'ok',
    startedAt,
    endedAt: startedAt + (kind === 'tool' ? 400 : 150),
  }
})

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>body{margin:0;font-family:-apple-system,"PingFang SC",system-ui;background:#fff}
#root{width:${panelWidth}px}
:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-base-secondary:rgb(0 0 0 / 4%);
--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:rgb(0 0 0 / 3%);
--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#4a4f57;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-label-caption:#9aa0a6;--dsw-alias-separator:rgb(0 0 0 / 10%);--dsw-alias-border-l1:rgb(0 0 0 / 8%);
--dsw-alias-border-l2:rgb(0 0 0 / 14%);--dsw-alias-state-business-primary:#4078ff;
--dsw-alias-state-success-primary:#16a34a;--dsw-alias-state-error-primary:#b42318;
--dsw-alias-state-warn-label:#96540a;--dsw-alias-brand-primary-new-colorprimary-new-color:#7c5cff;
--dsw-static-blue-500:#4078ff;--dsw-font-mono:ui-monospace,SFMono-Regular,Menlo,monospace}</style>
</head><body><div id="root"></div>
<script>${react}</script><script>${reactDom}</script>
<script>
window.__ModuleLoader__ = { load: (spec) => { window.__spec = spec } }
</script>
<script>${artifact}</script>
<script>
const React = window.React, ReactDOM = window.ReactDOM
const requireStub = (name) => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') {
    // The automatic runtime passes the key as a THIRD argument; handing it to
    // createElement as a child renders it as text, which is what the first
    // version of this harness did.
    const jsx = (type, props, key) => React.createElement(type, key === undefined ? props : { ...props, key })
    return { jsx, jsxs: jsx, Fragment: React.Fragment }
  }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      StateDot: ({ state, size = 10 }) => React.createElement('span', {
        style: { display: 'inline-block', width: size, height: size, borderRadius: '50%',
          background: state === 'error' ? '#b42318' : state === 'ongoing' ? '#4078ff' : state === 'done' ? '#16a34a' : '#9aa0a6' },
      }),
      Tag: ({ children }) => React.createElement('span', { style: { background: 'rgb(64 120 255 / 12%)', color: '#243b6b', borderRadius: 4, padding: '1px 6px', fontSize: 11 } }, children),
      Pill: ({ children }) => React.createElement('span', { style: { background: 'rgb(0 0 0 / 6%)', borderRadius: 999, padding: '1px 8px', fontSize: 11 } }, children),
    }
  }
  throw new Error('unexpected require(' + name + ')')
}
const fixture = ${JSON.stringify(fixture)}
// The shell's standard kit hands the view a session selector; the preview has no
// session, so it answers the paging flags the way an open session with nothing
// older would — the archive stays absent and the view uses its projection path.
const sessionStub = (selector) => selector({ hasMore: false, loadingOlder: false, openState: 'open' })
const mod = window.__spec.factory(requireStub)
const View = mod.apply && mod.__view
window.__mounted = false
// The plugin exports apply/inject; the view component is reached by letting the
// plugin register into a stub slot registry, which is how the shell gets it too.
const registrations = []
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register: () => () => {},
    // The plugin binds a translator at registration time for the view tab label.
    bind: () => (key) => DICTIONARY[key] ?? key,
  },
  slots: {
    inject: (_name, fn) => fn(),
    register: (_meta, component) => { registrations.push(component); return () => {} },
  },
}
mod.apply(ctx)
// The plugin registers the view first and the header chip second; this preview
// is of the view, so the first registration is the one to mount.
const Component = registrations[0]
const dict = ${JSON.stringify(DICTIONARY)}
const t = (key, params) => {
  const value = dict[key] ?? key
  return String(value).replace(/[{]([A-Za-z]+)[}]/g, (_m, name) => String(params?.[name] ?? ''))
}
const useProjection = () => fixture
// The shell hands real sessions a remote bundle lookup; the fixture maps its
// one soia tool so the roster's default filter (our packages only) is exercised.
const listToolBundles = async () => [
  { tool: 'check_ui_size', pkg: 'soia-dsh-tool-check-ui-size', entryId: 'tool-check-ui-size' },
]
const sharedProps = { useProjection, t, useSession: sessionStub, listToolBundles }
ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(React.Fragment, null,
    React.createElement(Component, sharedProps),
    registrations[1] ? React.createElement(registrations[1], sharedProps) : null),
)
window.__mounted = true
</script></body></html>`

for (const field of staleFields) {
  if (staleHost) delete fixture[field]
}
if (staleHost) for (const entry of fixture.timeline) delete entry.entryId
if (staleHost) for (const turn of fixture.turns) delete turn.tokens

const pagePath = join(scratch, 'preview.html')
writeFileSync(pagePath, page)

// Resolved through an absolute path for the same reason the other scripts do:
// `playwright-core` is a transitive dependency here, not a direct one.
const playwrightEntry = process.env['PLAYWRIGHT_CORE']
  ?? join(root, 'node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs')
const { chromium } = await import(playwrightEntry)
const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
// Two pixels per CSS pixel and a shot of the panel element only: full-page
// screenshots of a dense table at 1x came back as unreadable thumbnails, which
// was the complaint. The panel is the subject; nothing else is in frame.
const view = await browser.newPage({ viewport: { width: panelWidth + 40, height: 960 }, deviceScaleFactor: 2 })
const errors = []
view.on('pageerror', (error) => errors.push(String(error)))
await view.goto(`file://${pagePath}`)
await view.waitForTimeout(900)
// Open one row so the screenshot shows the detail layout, which is the part a
// reader judges the panel by.
await view.locator('[class*="lt-rowButton"]').nth(5).click()
await view.waitForTimeout(250)
// The overview tab is open by default — read the sizes that only exist there.
const overviewFacts = await view.evaluate(() => {
  const size = (selector) => {
    const node = globalThis.document.querySelector(selector)
    return node ? parseFloat(globalThis.getComputedStyle(node).fontSize) : null
  }
  const body = globalThis.document.querySelector('[class*="lt-detailBody"]')
  return {
    overviewValue: size('[class*="lt-detailGrid"] dd'),
    label: size('[class*="lt-detailLabel"]'),
    hierarchy: (body?.innerText ?? '').includes('层级'),
    sections: globalThis.document.querySelectorAll('[class*="lt-sectionToggle"]').length,
    // 调用方/被调用方在概览页签（此刻可见）
    caller: (() => {
      const match = /调用方\s*\n([^\n]+)/.exec(body?.innerText ?? '')
      return match !== null && (match[1]?.length ?? 0) > 0
    })(),
    callee: (body?.innerText ?? '').includes('被调用方'),
  }
})
// The payload lives on the 参数 tab; read its size there, then switch to 计时 so
// the screenshot shows the millisecond format the reference highlights.
await view.getByRole('tab', { name: '参数' }).click().catch(() => {})
await view.waitForTimeout(150)
const argsFacts = await view.evaluate(() => {
  const node = globalThis.document.querySelector('[class*="lt-detailPre"]')
  const text = node?.textContent ?? ''
  return {
    pre: node ? parseFloat(globalThis.getComputedStyle(node).fontSize) : null,
    // Formatted: indented JSON after the pretty-print, coloured: string spans.
    pretty: /\n\s{2}"/.test(text),
    colored: globalThis.document.querySelectorAll('[class*="lt-jStr"]').length,
  }
})
await view.getByRole('tab', { name: '计时' }).click().catch(() => {})
await view.waitForTimeout(150)
const restFonts = await view.evaluate(() => {
  const size = (selector) => {
    const node = globalThis.document.querySelector(selector)
    return node ? parseFloat(globalThis.getComputedStyle(node).fontSize) : null
  }
  return {
    row: size('[class*="lt-rowButton"]'),
    meta: size('[class*="lt-turnMeta"]'),
    tab: size('[role="tab"][aria-selected="true"]'),
    drawerName: size('[class*="lt-detailsName"]'),
    second: size('[class*="lt-tlSecond"]'),
  }
})
const fonts = { ...overviewFacts, ...argsFacts, ...restFonts }
// 运行状况契约：数据整块挪进专属页签（内部计数常驻可见），名单默认只列咱们的插件。
const healthFacts = await view.evaluate(() => {
  const health = globalThis.document.querySelector('[class*="lt-health"]')
  const text = health?.innerText ?? ''
  const roster = [...(health?.querySelectorAll('span') ?? [])]
    .map((node) => node.textContent ?? '').find((value) => value.startsWith('工具：')) ?? null
  return {
    roster,
    internalsVisible: /已折叠事件/.test(text),
    staleVisible: /数据更新/.test(text),
  }
})
const facts = {
  hierarchy: overviewFacts.hierarchy,
  sections: overviewFacts.sections,
  pretty: argsFacts.pretty,
  colored: argsFacts.colored,
  caller: overviewFacts.caller,
  callee: overviewFacts.callee,
  // 名单默认只显示咱们的插件：fixture 用过 read/grep/bash + 一个 soia 工具。
  ours: healthFacts.roster === '工具：check_ui_size',
  internalsVisible: healthFacts.internalsVisible,
  staleVisible: healthFacts.staleVisible,
}

const mounted = await view.evaluate(() => globalThis.__mounted === true)
// A missing translation renders as its raw key, which is exactly how the first
// version of this harness hid a 46px chip slot behind overflowing text. Detect it
// rather than let it look like a layout bug.
// Visual facts, asserted rather than eyeballed: the strip must be dense, the
// drawer must open with the trajectory view's five tabs, its timing must carry
// milliseconds, and a tool row must show its arguments in the quoted inline form.
const visuals = await view.evaluate(() => ({
  spans: globalThis.document.querySelectorAll('[class*="lt-span"]').length,
  tabs: [...globalThis.document.querySelectorAll('[role="tab"]')].map((node) => node.textContent ?? ''),
  drawer: globalThis.document.querySelector('[class*="lt-details"]') !== null,
  stamp: (globalThis.document.querySelector('[class*="lt-detailBody"]')?.textContent ?? '').match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)?.[0] ?? null,
  argsInline: globalThis.document.querySelectorAll('[class*="lt-tlArgs"]').length,
  secondLines: globalThis.document.querySelectorAll('[class*="lt-tlSecond"]').length,
  spanToolTitle: globalThis.document.querySelector('[data-kind="tool"]')?.getAttribute('title') ?? null,
  spanColors: Object.fromEntries(['assistant', 'tool', 'user', 'context'].map((kind) => {
    const node = globalThis.document.querySelector(`[data-kind="${kind}"]`)
    return [kind, node ? globalThis.getComputedStyle(node).backgroundColor : null]
  })),
  toolbar: [...globalThis.document.querySelectorAll('[class*="lt-control"], [class*="lt-action"]')]
    .map((node) => (node.textContent ?? '').trim()).filter((text) => text !== ''),
  html: '',
}))
visuals.fonts = fonts
visuals.facts = facts

const leakedKeys = await view.evaluate(() => [...globalThis.document.querySelectorAll('#root *')]
  .map((node) => node.children.length === 0 ? (node.textContent ?? '').trim() : '')
  .filter((text) => /^[a-z][A-Za-z]*\.[A-Za-z.]+$/.test(text)))
const rows = await view.locator('[class*="lt-rowButton"]').count()
const chips = await view.locator('[class*="lt-kindTag"]').count()
// Element screenshots wait on `document.fonts.ready`, which has been observed to
// hang in this headless Chrome; clip a page-level capture to the panel instead —
// same pixels, no font gate.
const box = await view.locator('#root').boundingBox()
if (process.env['SOIA_DEBUG']) console.log('clip box:', JSON.stringify(box))
if (box !== null) {
  await view.screenshot({ path: out, clip: box, animations: 'disabled' })
} else {
  await view.screenshot({ path: out })
}
const fontStatus = await view.evaluate(() => globalThis.document.fonts?.status ?? 'n/a')
if (fontStatus !== 'loaded') console.log(`panel-preview: document.fonts.status=${fontStatus}`)
await browser.close()

if (!keep) rmSync(scratch, { recursive: true, force: true })
else console.log(`panel-preview: kept ${pagePath}`)

console.log(`panel-preview: rows=${rows} chips=${chips} mounted=${mounted} → ${out}`)
// Fixture expectation: four tool rows (read/check_ui_size/grep + the truncated
// bash) plus one model call line. The truncated row is the case that regressed
// silently before — a missing purpose dropped the count from five to four.
// Typography contract: one scale (11/12/12.5/13) — "some big, some small" was
// unmeasured until now. Values come from the reference's own numbers: overview
// block at xs-13, payloads at 12, rows at 12.5, meta no longer inheriting 14.
// Drawer contract: 概述 stacks 层级 + four collapsed sections, payloads are
// pretty-printed and colour-tokenised — the three things the operator called out.
if (!(visuals.facts?.hierarchy && visuals.facts?.sections === 4 && visuals.facts?.pretty && (visuals.facts?.colored ?? 0) > 0
  && visuals.facts?.caller && visuals.facts?.callee
  && visuals.facts?.ours && visuals.facts?.internalsVisible && visuals.facts?.staleVisible)) {
  console.error(`panel-preview: drawer contract failed → ${JSON.stringify(visuals.facts)}`)
  process.exit(1)
}
const FONT_CONTRACT = { row: 12.5, meta: 12, overviewValue: 13, pre: 12, tab: 13, drawerName: 13, second: 11 }
const fontDrift = Object.entries(FONT_CONTRACT)
  .filter(([key, want]) => visuals.fonts?.[key] !== want)
  .map(([key, want]) => `${key}: want ${want}, got ${visuals.fonts?.[key]}`)
if (fontDrift.length > 0) {
  console.error(`panel-preview: font drift → ${fontDrift.join('; ')}`)
  process.exit(1)
}
if (visuals.secondLines < 5) {
  console.error(`panel-preview: expected ≥5 second lines, got ${visuals.secondLines}`)
  process.exit(1)
}
console.log(`panel-preview visuals: spans=${visuals.spans} tabs=[${visuals.tabs.join('/')}] drawer=${visuals.drawer} stamp=${visuals.stamp} argsInline=${visuals.argsInline} toolbar=[${visuals.toolbar.join('/')}] second=${visuals.secondLines} toolTip=${visuals.spanToolTitle} colors=${JSON.stringify(visuals.spanColors)} fonts=${JSON.stringify(visuals.fonts)} facts=${JSON.stringify(visuals.facts)}`)
if (errors.length > 0 || !mounted || rows === 0) {
  console.error(`panel-preview: the panel did not render${errors.length === 0 ? '' : ` — ${errors[0]}`}`)
  process.exit(1)
}
if (leakedKeys.length > 0) {
  console.error(`panel-preview: untranslated keys rendered: ${[...new Set(leakedKeys)].join(', ')}`)
  process.exit(1)
}
