import type { RedGreenEvidence } from '../types.js'

/**
 * Fail-before / pass-after evidence for a bug fix (TW203).
 *
 * Evidence is a RED run of a named test (nonzero exit, assertion failure) paired with a
 * GREEN run of the same test (exit 0). A keyword such as "regression" is never evidence.
 *
 * Two sources are accepted:
 *  1. the structured `evidence.red_green` record;
 *  2. free text in the test log with a labelled RED section (or "before fix") and a labelled
 *     GREEN section (or "after fix") that name the same test.
 */

export interface RegressionAssessment {
  satisfied: boolean
  /** Exactly which pieces of evidence are missing. Empty when satisfied. */
  missing: string[]
}

// A RED run must fail because an assertion failed, not because the file did not compile or load.
const ASSERTION_PATTERN = /AssertionError|assertion|\bexpect(?:ed|ation)?\b|\breceived\b|\bto(?:Be|Equal|Match|Contain|Throw)\w*\b/i
const FAILURE_COUNT_PATTERN = /\b[1-9]\d*\s+(?:fail(?:ed|ing|ures?)?)\b/i
const PASS_COUNT_PATTERN = /\b[1-9]\d*\s+pass(?:ed|ing)?\b/i
const FAILURE_MARK_PATTERN = /\(fail\)|[\u2717\u00d7\u2718]|\bFAIL(?:ED)?\b/
const PASS_MARK_PATTERN = /\(pass\)|[\u2713\u2714]|\bPASS(?:ED)?\b/
const NONZERO_EXIT_PATTERN = /\bexit(?:\s+code|ed(?:\s+with)?)?\s*[:=]?\s*[1-9]\d*\b/i

const TEST_PATH_PATTERN = /[\w./@-]+\.(?:test|spec)\.[cm]?[jt]sx?/g
const TEST_MARKED_NAME_PATTERN = /(?:\((?:fail|pass)\)|[\u2717\u00d7\u2718\u2713\u2714]|\b(?:FAIL|PASS))\s+([^\n\[]+?)(?:\s+\[[\d.]+\s*m?s\])?\s*$/gm
const TEST_CALL_NAME_PATTERN = /\b(?:test|it)\(?\s*["'`]([^"'`\n]+)["'`]/g

const RED_MARK = /\bRED\b|\bbefore\s+(?:the\s+)?fix\b/g
const GREEN_MARK = /\bGREEN\b|\bafter\s+(?:the\s+)?fix\b/g

function norm(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

function testIds(text: string): Set<string> {
  const ids = new Set<string>()
  for (const m of text.matchAll(TEST_PATH_PATTERN)) ids.add(norm(m[0]))
  for (const m of text.matchAll(TEST_MARKED_NAME_PATTERN)) {
    const n = norm(m[1] ?? '')
    // a bare "1 fail" / "17 pass" summary line is a count, not a test name
    if (n.length >= 3 && !/^\d+\s+(?:fail|pass)/.test(n)) ids.add(n)
  }
  for (const m of text.matchAll(TEST_CALL_NAME_PATTERN)) ids.add(norm(m[1] ?? ''))
  return ids
}

/** Split a free-text log into the text of its RED and GREEN sections. */
function splitPhases(log: string): { red: string; green: string } {
  const marks: { idx: number; phase: 'red' | 'green' }[] = []
  for (const m of log.matchAll(RED_MARK)) marks.push({ idx: m.index!, phase: 'red' })
  for (const m of log.matchAll(GREEN_MARK)) marks.push({ idx: m.index!, phase: 'green' })
  marks.sort((a, b) => a.idx - b.idx)
  let red = ''
  let green = ''
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i]!
    if (i > 0 && marks[i - 1]!.phase === cur.phase) continue // same section, label repeated ("RED (before fix)")
    let j = i + 1
    while (j < marks.length && marks[j]!.phase === cur.phase) j++
    const end = j < marks.length ? marks[j]!.idx : log.length
    const chunk = log.slice(cur.idx, end)
    if (cur.phase === 'red') red += '\n' + chunk
    else green += '\n' + chunk
  }
  return { red, green }
}

function assessFreeText(testLog: string): RegressionAssessment {
  const missing: string[] = []
  const { red, green } = splitPhases(testLog)

  if (red.trim() === '') {
    missing.push('no RED record (a section labelled RED or "before fix" with the failing run)')
  } else {
    const failed = FAILURE_COUNT_PATTERN.test(red) || FAILURE_MARK_PATTERN.test(red) || NONZERO_EXIT_PATTERN.test(red)
    if (!failed) missing.push('the RED record shows no failing run (no failure count, (fail) mark or nonzero exit)')
    else if (!ASSERTION_PATTERN.test(red)) missing.push('the RED record shows no assertion failure (a crash or syntax error is not a failing test)')
  }

  if (green.trim() === '') {
    missing.push('no GREEN record (a section labelled GREEN or "after fix" with the passing run)')
  } else {
    const stillFailing = FAILURE_COUNT_PATTERN.test(green) || NONZERO_EXIT_PATTERN.test(green) || /\(fail\)/.test(green)
    if (stillFailing) missing.push('the GREEN record still shows failures')
    else if (!PASS_COUNT_PATTERN.test(green) && !PASS_MARK_PATTERN.test(green)) {
      missing.push('the GREEN record shows no passing run')
    }
  }

  if (red.trim() !== '' && green.trim() !== '') {
    const redIds = testIds(red)
    const greenIds = testIds(green)
    if (redIds.size === 0) {
      missing.push('the RED record names no test (add the test name or its *.test.* path)')
    } else if (greenIds.size === 0) {
      missing.push('the GREEN record names no test (it must run the same test as RED)')
    } else if (![...redIds].some(id => greenIds.has(id))) {
      missing.push('the GREEN record is not for the same test as the RED record')
    }
  }
  return { satisfied: missing.length === 0, missing }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function assessStructured(rg: unknown): RegressionAssessment {
  const missing: string[] = []
  if (!isRecord(rg) || !isRecord(rg.red) || !isRecord(rg.green)) {
    return { satisfied: false, missing: ['evidence.red_green is malformed (it needs a red and a green run record)'] }
  }
  const red = rg.red
  const green = rg.green
  const redName = typeof red.test === 'string' ? norm(red.test) : ''
  const greenName = typeof green.test === 'string' ? norm(green.test) : ''

  if (redName === '') missing.push('the RED record has no test name')
  if (greenName === '') missing.push('the GREEN record has no test name')
  if (redName !== '' && greenName !== '' && redName !== greenName) {
    missing.push('the GREEN record is not for the same test as the RED record')
  }

  if (!Number.isInteger(red.exit_code)) missing.push('the RED record has no integer exit code')
  else if (red.exit_code === 0) missing.push('the RED run exited 0 (a failing run must exit nonzero)')
  const redOut = typeof red.output === 'string' ? red.output : ''
  if (!ASSERTION_PATTERN.test(redOut)) {
    missing.push('the RED output shows no assertion failure (a crash or syntax error is not a failing test)')
  }

  if (!Number.isInteger(green.exit_code)) missing.push('the GREEN record has no integer exit code')
  else if (green.exit_code !== 0) missing.push('the GREEN run did not exit 0')

  return { satisfied: missing.length === 0, missing }
}

export function assessRegressionEvidence(testLog: string, redGreen?: RedGreenEvidence | unknown): RegressionAssessment {
  if (redGreen !== undefined && redGreen !== null) {
    const structured = assessStructured(redGreen)
    if (structured.satisfied) return structured
    // A supplied but invalid record is reported on its own terms; free text can still satisfy the rule.
    const free = assessFreeText(testLog)
    return free.satisfied ? free : structured
  }
  return assessFreeText(testLog)
}
