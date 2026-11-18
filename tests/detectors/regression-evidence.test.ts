import { describe, test, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'
import { TestWeaknessDetector } from '../../src/detectors/test-weakness-detector.ts'

// Repro from the issue: a one-line fix, reviewed with only a test log.
const DIFF = [
  'diff --git a/src/export.ts b/src/export.ts',
  '--- a/src/export.ts',
  '+++ b/src/export.ts',
  '@@ -1,3 +1,3 @@',
  ' // any user may export every save slot',
  '-const out = slots.slice(1)',
  '+const out = slots.slice(0)',
  ' export { out }',
].join('\n')

const OUTPUT = 'fix: export includes the first slot'

const ISSUE_LOG =
  'RED (before fix): 1 fail AssertionError expected 3 received 2\n' +
  'GREEN (after fix): 17 pass 0 fail'

async function review(test_log: string, red_green?: unknown) {
  return Seal.review({
    artifact_type: 'code_diff',
    output: OUTPUT,
    evidence: { test_log, build_log: '', diff: DIFF, references: [], ...(red_green ? { red_green } : {}) } as never,
    risk_hint: null,
  })
}

function tw203(v: Awaited<ReturnType<typeof review>>) {
  return v.blocking_issues.concat(v.warnings ?? []).find(i => i.rule_id === 'TW203')
}

const GOOD = {
  red: { test: 'export > includes the first slot', exit_code: 1, output: 'AssertionError: expected 3 received 2' },
  green: { test: 'export > includes the first slot', exit_code: 0, output: '1 pass 0 fail' },
}

describe('TW203 is satisfied by fail-before/pass-after evidence, not by a keyword', () => {
  test('a keyword alone does not turn the issue repro log into a pass', async () => {
    const v = await review(ISSUE_LOG + ' regression')
    expect(tw203(v)).toBeDefined()
    expect(v.verdict).not.toBe('PASS')
  })

  test('the word regression on its own never satisfies a bug fix', async () => {
    const v = await review('regression\n17 pass 0 fail')
    const f = tw203(v)
    expect(f).toBeDefined()
    expect(f!.severity).toBe('HIGH')
    expect(f!.is_blocking).toBe(true)
    expect(f!.evidence).toMatch(/RED/)
  })

  test('structured evidence (named test, nonzero assertion failure, passing run of the same test) satisfies TW203', async () => {
    const v = await review('17 pass 0 fail', GOOD)
    expect(tw203(v)).toBeUndefined()
  })

  test('a RED run that exits 0 is not a failing run', async () => {
    const v = await review('17 pass 0 fail', { ...GOOD, red: { ...GOOD.red, exit_code: 0 } })
    expect(tw203(v)!.evidence).toMatch(/RED.*exit/i)
  })

  test('a RED run that fails without an assertion failure (crash, syntax error) is not evidence', async () => {
    const v = await review('17 pass 0 fail', { ...GOOD, red: { ...GOOD.red, output: 'SyntaxError: Unexpected token' } })
    expect(tw203(v)!.evidence).toMatch(/assertion/i)
  })

  test('a RED record that names no test is rejected', async () => {
    const v = await review('17 pass 0 fail', { ...GOOD, red: { ...GOOD.red, test: '' } })
    expect(tw203(v)!.evidence).toMatch(/RED.*test name/i)
  })

  test('a GREEN run of a different test is rejected', async () => {
    const v = await review('17 pass 0 fail', { ...GOOD, green: { ...GOOD.green, test: 'something else' } })
    expect(tw203(v)!.evidence).toMatch(/same test/i)
  })

  test('a GREEN run that still fails is rejected', async () => {
    const v = await review('17 pass 0 fail', { ...GOOD, green: { ...GOOD.green, exit_code: 1 } })
    expect(tw203(v)!.evidence).toMatch(/GREEN.*exit/i)
  })

  test('malformed structured evidence fails closed', async () => {
    const v = await review('17 pass 0 fail', { red: 'yes', green: null })
    expect(tw203(v)).toBeDefined()
  })

  test('free text with a labelled RED and GREEN section naming the same test satisfies TW203', async () => {
    const log =
      'RED (before fix):\n(fail) export > includes the first slot [0.4ms]\nAssertionError: expected 3 received 2\n 1 fail\n' +
      'GREEN (after fix):\n(pass) export > includes the first slot [0.2ms]\n 17 pass\n 0 fail'
    const v = await review(log)
    expect(tw203(v)).toBeUndefined()
  })

  test('free text without a test name says which evidence is missing', async () => {
    const v = await review(ISSUE_LOG)
    const f = tw203(v)!
    expect(f.evidence).toMatch(/names no test/i)
    expect(f.evidence).not.toMatch(/no RED/i)
    expect(f.evidence).not.toMatch(/no GREEN/i)
  })

  test('free text with no phase markers says both records are missing', async () => {
    const v = await review('17 pass 0 fail')
    const f = tw203(v)!
    expect(f.evidence).toMatch(/no RED/i)
    expect(f.evidence).toMatch(/no GREEN/i)
  })

  test('free text where the GREEN section still has failures is rejected', async () => {
    const log =
      'RED (before fix):\n(fail) a > b\nAssertionError: x\n 1 fail\n' +
      'GREEN (after fix):\n(pass) a > b\n 3 fail'
    const f = tw203(await review(log))!
    expect(f.evidence).toMatch(/GREEN/)
  })

  test('detector unit: no bug-fix wording means no TW203', () => {
    const r = TestWeaknessDetector.detect(
      { artifact_type: 'code_diff', output: 'add a feature', risk_level: 'MEDIUM', auth_flagged: false },
      { test_log: '3 pass 0 fail edge', build_log: '', diff: '', references: [] },
    )
    expect(r.issues.find(i => i.rule_id === 'TW203')).toBeUndefined()
  })
})
