import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Mechanical checks on the bilingual README pairs.
 *
 * The blob-hash record in `README.i18n.yaml` only proves a side has not changed
 * since it was recorded — it cannot prove the two sides agree, and re-recording
 * it after editing one side silently blesses the drift. That happened: the
 * English limitations list kept a claim the Chinese one had already retired, and
 * the pair shipped with ten bullets against nine.
 *
 * These checks compare structure rather than wording: same headings, same number
 * of limitation bullets, same top-level sections. Prose is a translator's job;
 * structure is a machine's.
 */
const packagesDir = join(import.meta.dirname, '..', '..', 'packages')

/** Every package with a bilingual README pair. */
function bilingualPackages(): { id: string, zh: string, en: string }[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(packagesDir, entry.name)
      const read = (file: string): string | undefined => {
        try {
          return readFileSync(join(dir, file), 'utf8')
        } catch {
          return undefined
        }
      }
      const zh = read('README.md')
      const en = read('README.en.md')
      return zh === undefined || en === undefined ? [] : [{ id: entry.name, zh, en }]
    })
}

/** Level-2 heading texts, in order. */
function headings(text: string): string[] {
  return [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]?.trim() ?? '')
}

/** The `Known Limitations` section's bullets, whatever their wording. */
function limitations(text: string): string[] {
  const start = text.indexOf('## Known Limitations')
  if (start === -1) return []
  const tail = text.slice(start)
  const next = tail.indexOf('\n## ', 5)
  const section = next === -1 ? tail : tail.slice(0, next)
  return section.split('\n').filter((line) => line.startsWith('- **'))
}

describe('bilingual README pairs', () => {
  const pairs = bilingualPackages()

  it('covers every package that ships both sides', () => {
    expect(pairs.length).toBeGreaterThan(0)
  })

  for (const pair of pairs) {
    describe(pair.id, () => {
      it('carries the same number of level-2 sections', () => {
        // The titles differ by language, so the count is what can be compared.
        expect(headings(pair.en).length).toBe(headings(pair.zh).length)
      })

      it('states the same number of known limitations on both sides', () => {
        const zh = limitations(pair.zh)
        const en = limitations(pair.en)
        expect(zh.length).toBeGreaterThan(0)
        expect(en.length).toBe(zh.length)
      })

      it('keeps the two sections the repository requires', () => {
        for (const text of [pair.zh, pair.en]) {
          expect(text).toContain('## Known Limitations')
          expect(text).toContain('## Model Experience')
        }
      })
    })
  }
})
