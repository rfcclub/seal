import { describe, test, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'
import { RiskClassifier } from '../../src/detectors/risk-classifier.ts'

function exportDiff(contextLine: string): string {
  return [
    'diff --git a/src/export.ts b/src/export.ts',
    '--- a/src/export.ts',
    '+++ b/src/export.ts',
    '@@ -1,3 +1,3 @@',
    ' ' + contextLine,
    '-const out = slots.slice(1)',
    '+const out = slots.slice(0)',
    ' export { out }',
  ].join('\n')
}

const GREEN_LOG = '17 pass 0 fail edge'

async function review(diff: string, context?: Record<string, unknown>, output = 'change: export includes the first slot') {
  return Seal.review({
    artifact_type: 'code_diff',
    output,
    evidence: { test_log: GREEN_LOG, build_log: '', diff, references: [] },
    risk_hint: null,
    context,
  })
}

const all = (v: Awaited<ReturnType<typeof review>>) => v.blocking_issues.concat(v.warnings ?? [])
const tw205 = (v: Awaited<ReturnType<typeof review>>) => all(v).find(i => i.rule_id === 'TW205')

describe('issue repro: an unchanged context line must not set the auth flag', () => {
  test('context line mentioning admin: no TW205 and no escalation', async () => {
    const v = await review(exportDiff('// admin users may export every save slot'))
    expect(tw205(v)).toBeUndefined()
    expect(v.verdict).not.toBe('ESCALATE_TO_REVIEWER')
  })

  test('control: a context line without the word behaves the same', async () => {
    const v = await review(exportDiff('// any user may export every save slot'))
    expect(tw205(v)).toBeUndefined()
    expect(v.verdict).not.toBe('ESCALATE_TO_REVIEWER')
  })
})

describe('RiskClassifier looks only at added or changed lines', () => {
  const classify = (diff: string, extra: Record<string, unknown> = {}) =>
    RiskClassifier.classify({ output: 'change: export', diff, risk_hint: null, ...extra } as never)

  test('unchanged context does not set RK-HIGH', () => {
    expect(classify(exportDiff('// admin users may export')).matched_rules).not.toContain('RK-HIGH')
  })

  test('an added auth line sets RK-HIGH and names the token, file and new-file line', () => {
    const diff = [
      '--- a/src/export.ts',
      '+++ b/src/export.ts',
      '@@ -10,3 +10,4 @@',
      ' const a = 1',
      ' const b = 2',
      '+const ok = admin.verify(token)',
      ' export { a }',
    ].join('\n')
    const r = classify(diff) as ReturnType<typeof RiskClassifier.classify> & { high_matches: any[] }
    expect(r.matched_rules).toContain('RK-HIGH')
    expect(r.risk_level).toBe('HIGH')
    expect(r.high_matches).toHaveLength(1)
    expect(r.high_matches[0]).toMatchObject({ token: 'admin', file: 'src/export.ts', line: 12, kind: 'added' })
    expect(r.high_matches[0].text).toContain('admin.verify(token)')
  })

  test('a changed line (the + side of a replacement) counts', () => {
    const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -1,1 +1,1 @@', '-const role = "user"', '+const role = "admin"'].join('\n')
    expect(classify(diff).matched_rules).toContain('RK-HIGH')
  })

  test('the +++ file header is not a changed line', () => {
    const diff = ['--- a/src/admin/page.ts', '+++ b/src/admin/page.ts', '@@ -1,1 +1,1 @@', '-const x = 1', '+const x = 2'].join('\n')
    expect(classify(diff).matched_rules).not.toContain('RK-HIGH')
  })

  test('an added line whose text starts with ++ is not mistaken for a header', () => {
    const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -1,2 +1,3 @@', ' const x = 1', '+++ admin.count', ' const y = 2'].join('\n')
    expect(classify(diff).matched_rules).toContain('RK-HIGH')
  })

  test('auth code in a file outside context.scope_files does not set RK-HIGH; without scope it still does', () => {
    const diff = [
      '--- a/src/export.ts', '+++ b/src/export.ts', '@@ -1,1 +1,1 @@', '-const a = 1', '+const a = 2',
      '--- a/src/login.ts', '+++ b/src/login.ts', '@@ -1,1 +1,2 @@', ' const l = 1', '+const ok = admin.verify(token)',
    ].join('\n')
    expect(classify(diff, { scope_files: ['src/export.ts'] }).matched_rules).not.toContain('RK-HIGH')
    expect(classify(diff, { scope_files: ['src/login.ts'] }).matched_rules).toContain('RK-HIGH')
    expect(classify(diff).matched_rules).toContain('RK-HIGH')
  })

  test('removed auth code is flagged under its own rule, not RK-HIGH', () => {
    const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,2 @@', ' const a = 1', '-if (!user.admin) throw new Error("no")', ' export { a }'].join('\n')
    const r = classify(diff) as ReturnType<typeof RiskClassifier.classify> & { removed_high_matches: any[] }
    expect(r.matched_rules).not.toContain('RK-HIGH')
    expect(r.matched_rules).toContain('RK-HIGH-REMOVED')
    expect(r.risk_level).toBe('HIGH')
    expect(r.removed_high_matches[0]).toMatchObject({ token: 'admin', file: 'a.ts', kind: 'removed' })
  })

  test('a removed comment line is not auth code', () => {
    const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,2 @@', ' const a = 1', '-// admin only', ' export { a }'].join('\n')
    const r = classify(diff)
    expect(r.matched_rules).not.toContain('RK-HIGH')
    expect(r.matched_rules).not.toContain('RK-HIGH-REMOVED')
  })

  test('all lines of a deleted file are removed lines', () => {
    const diff = ['--- a/src/guard.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-export const guard = () => sudo()', '-export default guard'].join('\n')
    expect(classify(diff).matched_rules).toContain('RK-HIGH-REMOVED')
  })

  test('a diff that is not in unified format falls back to scanning the whole text (fail closed)', () => {
    expect(classify('changed the admin check').matched_rules).toContain('RK-HIGH')
  })

  test('with no diff the output text is still scanned (the CLI passes no diff)', () => {
    const r = RiskClassifier.classify({ output: 'update admin permissions', diff: '', risk_hint: null })
    expect(r.matched_rules).toContain('RK-HIGH')
  })
})

describe('TW205 end to end', () => {
  test('a real added auth line still escalates and the finding names the token and line', async () => {
    const diff = ['--- a/src/export.ts', '+++ b/src/export.ts', '@@ -1,2 +1,3 @@', ' const a = 1', '+const ok = admin.verify(token)', ' export { a }'].join('\n')
    const v = await review(diff)
    const f = tw205(v)!
    expect(f).toBeDefined()
    expect(v.verdict).toBe('ESCALATE_TO_REVIEWER')
    expect(f.evidence).toContain('"admin"')
    expect(f.evidence).toContain('src/export.ts:2')
  })

  test('auth code in another file of the same diff is ignored when scope_files names the change', async () => {
    const diff = [
      '--- a/src/export.ts', '+++ b/src/export.ts', '@@ -1,1 +1,1 @@', '-const a = 1', '+const a = 2',
      '--- a/src/login.ts', '+++ b/src/login.ts', '@@ -1,1 +1,2 @@', ' const l = 1', '+const ok = admin.verify(token)',
    ].join('\n')
    expect(tw205(await review(diff, { scope_files: ['src/export.ts'] }))).toBeUndefined()
    expect(tw205(await review(diff))).toBeDefined()
  })

  test('removing real auth code still escalates and says it was removed', async () => {
    const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,2 @@', ' const a = 1', '-if (!user.admin) throw new Error("no")', ' export { a }'].join('\n')
    const v = await review(diff)
    const f = tw205(v)!
    expect(f).toBeDefined()
    expect(f.evidence).toMatch(/removed/)
    expect(v.verdict).toBe('ESCALATE_TO_REVIEWER')
  })

  test('removing a comment that mentions admin does not escalate', async () => {
    const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,2 @@', ' const a = 1', '-// admin only', ' export { a }'].join('\n')
    expect(tw205(await review(diff))).toBeUndefined()
  })
})
