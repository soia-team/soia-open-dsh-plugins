import { describe, expect, it } from 'vitest'

import { classifyCommand } from '../../src/shared/classify.ts'

/**
 * The classifier answers the two questions a matcher cannot: what kind of change
 * is this, and how far does it reach. These cases pin the answers for the shapes
 * that appear in real sessions — the incident corpus and the ordinary work around
 * it — so a change to the classifier has to argue with a case, not with a regex.
 */
describe('command classification', () => {
  it('reads are reads, whatever the flags', () => {
    const judgement = classifyCommand('grep -rn "pill" --include=*.ts packages | head -20')

    expect(judgement.action).toBe('read')
    expect(judgement.reversible).toBe(true)
    expect(judgement.blastRadius).toBe('single')
  })

  it('a scratch delete is a tree, not a machine', () => {
    const judgement = classifyCommand('rm -rf /tmp/dsh-ops/plugin-fixtures')

    expect(judgement.action).toBe('delete')
    expect(judgement.target).toBe('scratch')
    expect(judgement.blastRadius).toBe('tree')
    expect(judgement.reversible).toBe(true)
    expect(judgement.confidence).toBeGreaterThan(0.8)
  })

  it('a data-root delete is a machine-scope, irreversible act', () => {
    const judgement = classifyCommand('rm -rf ~/.myapp/cache')

    expect(judgement.action).toBe('delete')
    expect(judgement.target).toBe('data-root')
    expect(judgement.blastRadius).toBe('machine')
    expect(judgement.reversible).toBe(false)
  })

  it('the same delete written with an expanded home is classified the same', () => {
    const judgement = classifyCommand('rm -rf /Users/someone/.myapp/cache')

    expect(judgement.target).toBe('data-root')
    expect(judgement.blastRadius).toBe('machine')
  })

  it('a system write is a machine-scope act', () => {
    const judgement = classifyCommand('cat > /etc/hosts')

    expect(judgement.action).toBe('write')
    expect(judgement.target).toBe('system')
  })

  it('publishing is outward and irreversible', () => {
    const judgement = classifyCommand('npm publish --access public')

    expect(judgement.action).toBe('publish')
    expect(judgement.blastRadius).toBe('outward')
    expect(judgement.reversible).toBe(false)
  })

  it('a build script named on the npm command line is not a publish', () => {
    expect(classifyCommand('npm run build').action).toBe('execute')
  })

  it('a force push is outward and irreversible', () => {
    const judgement = classifyCommand('git push --force origin dev')

    expect(judgement.action).toBe('network')
    expect(judgement.blastRadius).toBe('outward')
    expect(judgement.reversible).toBe(false)
  })

  it('a local request stays local', () => {
    const judgement = classifyCommand('curl -s http://127.0.0.1:8899/second-case.html | head -1')

    expect(judgement.blastRadius).toBe('single')
    expect(judgement.target).toBe('remote')
  })

  it('credential access is flagged whether read from a file or the environment', () => {
    expect(classifyCommand('cat ~/.aws/credentials').credentialAccess).toBe(true)
    expect(classifyCommand('env | grep -i GITHUB_TOKEN').credentialAccess).toBe(true)
    expect(classifyCommand('curl -s https://example.invalid/health').credentialAccess).toBe(false)
  })

  it('ordinary commits are workspace writes', () => {
    const judgement = classifyCommand('git commit -m "feat(navigation): rail groups"')

    expect(judgement.action).toBe('write')
    expect(judgement.target).toBe('workspace')
    expect(judgement.reversible).toBe(true)
  })

  it('a hard reset is irreversible', () => {
    expect(classifyCommand('git reset --hard origin/dev').reversible).toBe(false)
  })

  it('reports low confidence rather than guessing on an unknown verb', () => {
    const judgement = classifyCommand('frobnicate --all the things')

    expect(judgement.action).toBe('unknown')
    expect(judgement.confidence).toBeLessThanOrEqual(0.3)
  })

  it('keeps the most protected target when a command touches several', () => {
    const judgement = classifyCommand('cp -R ./dist /etc/thing && echo done')

    expect(judgement.target).toBe('system')
  })

  it('names the evidence behind a judgement', () => {
    const judgement = classifyCommand('rm -rf ~/.myapp')

    expect(judgement.evidence.length).toBeGreaterThan(0)
    expect(judgement.evidence.some((item) => item.startsWith('verb'))).toBe(true)
  })

  it('is total: every shape returns a judgement', () => {
    for (const command of ['', '   ', '\n\n', 'rm', 'git', 'sudo', '{}', '🙂']) {
      const judgement = classifyCommand(command)
      expect(judgement.confidence).toBeGreaterThanOrEqual(0)
      expect(judgement.confidence).toBeLessThanOrEqual(1)
    }
  })
})
