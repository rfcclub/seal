import { RiskLevel } from '../types.js'
import { parseUnifiedDiff, startsLikeDiff, fileInScope } from './diff-lines.js'

const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

const CRITICAL_PATTERN = /\b(DROP\s+TABLE|delete.{0,20}production|rm\s+-rf|irreversible|PII|personal\s+data|health\s+data|financial\s+record|legal\s+(?:liability|compliance)|payment|billing)\b/i
// HIGH: auth/security constructs that require elevated access or auth test evidence
// MEDIUM-risk operational terms (migration, rollback, session, token, password) moved to MEDIUM_PATTERN
const HIGH_PATTERN = /\b(auth(?:entication|orization)?|JWT|OAuth|sudo|admin|privilege|chmod)\b/i
const MEDIUM_PATTERN = /\b(migration|rollback|schema\s+change|token|session|password)\b/i
// A removed line that is only a comment is not removed auth code.
const COMMENT_LINE = /^\s*(?:\/\/|#|\/\*|\*|--|<!--|;)/

export interface RiskMatch {
  /** The matched HIGH-risk token, as written in the line. */
  token: string
  /** File from the diff header; undefined for prose or a diff without file headers. */
  file?: string
  /** Line number in the new file (added) or old file (removed); in the text for prose. */
  line: number
  /** The matched line, trimmed. */
  text: string
  kind: 'added' | 'removed' | 'text'
  source: 'output' | 'diff'
}

export interface RiskResult {
  risk_level: RiskLevel
  trust_deduction: number
  matched_rules: string[]
  /** Added or changed lines (and prose, when no unified diff is available) that set RK-HIGH. */
  high_matches: RiskMatch[]
  /** Removed non-comment lines that set RK-HIGH-REMOVED. */
  removed_high_matches: RiskMatch[]
}

function firstToken(line: string): string | null {
  const m = HIGH_PATTERN.exec(line)
  return m ? m[0] : null
}

function scanProse(text: string, source: RiskMatch['source']): RiskMatch[] {
  const out: RiskMatch[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const token = firstToken(line)
    if (token) out.push({ token, line: i + 1, text: line.trim(), kind: 'text', source })
  })
  return out
}

/**
 * HIGH-risk matches in one text. A unified diff contributes only its added or changed lines
 * (RK-HIGH) and its removed non-comment lines (RK-HIGH-REMOVED), restricted to scope files when
 * given. Text that is not a unified diff is scanned whole, so a prose diff cannot hide auth code.
 */
function scanHigh(text: string, source: RiskMatch['source'], scope: string[] | undefined, requireDiffStart: boolean): { added: RiskMatch[]; removed: RiskMatch[] } {
  if (text.trim() === '') return { added: [], removed: [] }
  const parsed = !requireDiffStart || startsLikeDiff(text) ? parseUnifiedDiff(text) : null
  if (!parsed || !parsed.unified) return { added: scanProse(text, source), removed: [] }
  const added: RiskMatch[] = []
  const removed: RiskMatch[] = []
  for (const cl of parsed.lines) {
    if (!fileInScope(cl.file, scope)) continue
    if (cl.kind === 'removed' && COMMENT_LINE.test(cl.text)) continue
    const token = firstToken(cl.text)
    if (!token) continue
    const m: RiskMatch = { token, file: cl.file, line: cl.line, text: cl.text.trim(), kind: cl.kind, source }
    if (cl.kind === 'added') added.push(m)
    else removed.push(m)
  }
  return { added, removed }
}

export class RiskClassifier {
  static classify(params: { output: string; diff: string; risk_hint: RiskLevel | null; scope_files?: string[] }): RiskResult {
    const { output, diff, risk_hint, scope_files } = params
    const text = output + '\n' + diff
    let risk_level: RiskLevel = 'MEDIUM'
    let trust_deduction = 0
    const matched_rules: string[] = []

    // HIGH looks only at added or changed lines of in-scope files (issue #12). The output is the
    // author's own description and is scanned as prose unless it is itself a unified diff.
    const fromOutput = scanHigh(output, 'output', scope_files, true)
    const fromDiff = scanHigh(diff, 'diff', scope_files, false)
    const high_matches = [...fromOutput.added, ...fromDiff.added]
    const removed_high_matches = [...fromOutput.removed, ...fromDiff.removed]

    if (CRITICAL_PATTERN.test(text)) {
      risk_level = maxRisk(risk_level, 'CRITICAL')
      trust_deduction += 20
      matched_rules.push('RK-CRITICAL')
    }
    if (high_matches.length > 0) {
      risk_level = maxRisk(risk_level, 'HIGH')
      trust_deduction += 10
      matched_rules.push('RK-HIGH')
    }
    if (removed_high_matches.length > 0) {
      risk_level = maxRisk(risk_level, 'HIGH')
      if (!matched_rules.includes('RK-HIGH')) trust_deduction += 10
      matched_rules.push('RK-HIGH-REMOVED')
    }
    if (!matched_rules.includes('RK-HIGH') && !matched_rules.includes('RK-HIGH-REMOVED') && !matched_rules.includes('RK-CRITICAL') && MEDIUM_PATTERN.test(text)) {
      trust_deduction += 5
      matched_rules.push('RK-MEDIUM')
    }

    if (risk_hint) {
      const prevLevel = risk_level
      risk_level = maxRisk(risk_level, risk_hint)
      if (risk_level !== prevLevel) {
        if (risk_level === 'CRITICAL') trust_deduction += 10
        else if (risk_level === 'HIGH') trust_deduction += 5
      }
    }

    return { risk_level, trust_deduction, matched_rules, high_matches, removed_high_matches }
  }
}
