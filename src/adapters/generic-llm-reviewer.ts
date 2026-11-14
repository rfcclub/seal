/**
 * Generic OpenAI-compatible LLM reviewer.
 *
 * Provider-neutral: it talks to any endpoint that speaks the OpenAI chat completions API
 * (a hosted service, a gateway, a local server). There is no built-in provider, base URL,
 * model or key variable: the caller supplies them, and without them nothing is sent.
 *
 * Usage:
 *   Seal.withLLM(createReviewer({ baseUrl: 'https://gateway.example/v1', model: 'my-model', apiKeyEnv: 'MY_LLM_KEY' }))
 *   Seal.withLLM(createReviewer({ baseUrl: 'http://localhost:8080/v1', model: 'local' }))   // no key
 */
import { LLMReviewerAdapter, LLMSignals, SealInput, PartialVerdict } from '../types.js'
import { wrapUntrustedClaim, UNTRUSTED_CLAIM_PREAMBLE } from './sanitize-claim-input.js'

const SYSTEM_PROMPT = `You are Seal, a quality gate in an AI engineering workflow.

Your job is NOT to be polite or creative. Your job is to detect semantic issues the deterministic rules could not catch.

Review AI agent output for semantic correctness, subtle logic bugs, and missing requirements.
The deterministic layer already checked: evidence presence, risk keywords, spec headers, test logs.
Your focus: semantic reasoning, prose logic, subtle edge cases, spec compliance.

Return ONLY valid JSON:
{
  "suspected_issues": ["string — exact reasoning error, max 3"],
  "missing_requirements": ["string — spec requirement clearly absent"],
  "possible_edge_cases": ["string — edge cases to consider"],
  "evidence_gaps": ["string — claims needing evidence that slipped through"],
  "risk_guess": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": 0.0
}

Rules: confidence 0.0–1.0. Empty arrays if output is correct. No padding.

${UNTRUSTED_CLAIM_PREAMBLE}`

export function buildMessage(input: SealInput, partial: PartialVerdict): string {
  const parts: string[] = []
  if (input.spec) parts.push(`=== SPEC ===\n${wrapUntrustedClaim(input.spec)}`)
  parts.push(`=== OUTPUT (${input.artifact_type}) ===\n${wrapUntrustedClaim(input.output)}`)
  const blocking = partial.deterministic_findings.filter(f => f.is_blocking)
  if (blocking.length) {
    parts.push(`=== ALREADY FLAGGED (do not repeat) ===\n${blocking.map(f => `- [${f.rule_id ?? f.type}] ${wrapUntrustedClaim(f.evidence)}`).join('\n')}`)
  }
  parts.push(`=== PARTIAL VERDICT ===\ntrust_score: ${partial.trust_score}, risk: ${partial.risk_level}`)
  return parts.join('\n\n')
}

function extractJSON(raw: string): string {
  // Strip <think>...</think> blocks (thinking models)
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  return match ? match[0] : stripped
}

export interface GenericReviewerOptions {
  baseUrl: string          // required, e.g. https://host/v1 (/chat/completions is appended)
  model: string            // required
  apiKey?: string          // literal key; sent as a Bearer token
  apiKeyEnv?: string       // name of an environment variable that holds the key
  timeoutMs?: number       // default 30000
}

export class GenericLLMReviewer implements LLMReviewerAdapter {
  private baseUrl: string
  private model: string
  private apiKey: string
  private apiKeyEnv: string
  private timeoutMs: number

  constructor(opts: GenericReviewerOptions) {
    if (!opts?.baseUrl) throw new Error('LLM reviewer needs baseUrl; there is no default provider')
    if (!opts.model) throw new Error('LLM reviewer needs model; there is no default model')
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.model = opts.model
    this.apiKeyEnv = opts.apiKeyEnv ?? ''
    // The key is only what the caller named: the literal apiKey, or the variable apiKeyEnv.
    // No other variable is ever read.
    this.apiKey = opts.apiKey ?? (this.apiKeyEnv ? (process.env[this.apiKeyEnv] ?? '') : '')
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  async review(input: SealInput, partial: PartialVerdict): Promise<LLMSignals> {
    if (this.apiKeyEnv && !this.apiKey) {
      // A key variable was named but is empty: fail before any request, nothing is sent.
      throw new Error(`LLM reviewer not called: ${this.apiKeyEnv} is not set`)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: buildMessage(input, partial) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 1024,
        }),
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`LLM reviewer ${this.model} error ${response.status}: ${body.slice(0, 200)}`)
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const raw = data.choices?.[0]?.message?.content ?? '{}'
    const jsonStr = extractJSON(raw)

    let signals: Partial<LLMSignals>
    try { signals = JSON.parse(jsonStr) }
    catch { throw new Error(`LLM reviewer returned invalid JSON: ${raw.slice(0, 200)}`) }

    const VALID_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    return {
      suspected_issues:     Array.isArray(signals.suspected_issues)    ? signals.suspected_issues    : [],
      missing_requirements: Array.isArray(signals.missing_requirements) ? signals.missing_requirements : [],
      possible_edge_cases:  Array.isArray(signals.possible_edge_cases)  ? signals.possible_edge_cases  : [],
      evidence_gaps:        Array.isArray(signals.evidence_gaps)        ? signals.evidence_gaps        : [],
      risk_guess:           VALID_RISKS.includes(signals.risk_guess ?? '') ? signals.risk_guess as LLMSignals['risk_guess'] : 'MEDIUM',
      confidence:           typeof signals.confidence === 'number' ? Math.max(0, Math.min(1, signals.confidence)) : 0.5,
    }
  }
}

/**
 * Build reviewer options from explicit values, falling back to the SEAL_LLM_* environment
 * variables: SEAL_LLM_BASE_URL, SEAL_LLM_MODEL, SEAL_LLM_KEY_ENV (the NAME of the variable
 * that holds the key). Returns the missing field names when incomplete. Never guesses.
 */
export function resolveReviewerOptions(
  explicit: { baseUrl?: string; model?: string; apiKeyEnv?: string } = {},
  env: Record<string, string | undefined> = process.env,
): { options: GenericReviewerOptions } | { missing: string[] } {
  const baseUrl = explicit.baseUrl || env.SEAL_LLM_BASE_URL || ''
  const model = explicit.model || env.SEAL_LLM_MODEL || ''
  const apiKeyEnv = explicit.apiKeyEnv || env.SEAL_LLM_KEY_ENV || undefined
  const missing = [!baseUrl && 'base URL (--llm-base-url or SEAL_LLM_BASE_URL)', !model && 'model (--llm-model or SEAL_LLM_MODEL)'].filter(Boolean) as string[]
  return missing.length ? { missing } : { options: { baseUrl, model, apiKeyEnv } }
}

export const createReviewer = (opts: GenericReviewerOptions) => new GenericLLMReviewer(opts)
