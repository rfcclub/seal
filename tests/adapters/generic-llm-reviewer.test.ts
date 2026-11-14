import { it, expect, afterEach } from 'bun:test'
import { GenericLLMReviewer, resolveReviewerOptions } from '../../src/adapters/generic-llm-reviewer.js'

const input: any = { artifact_type: 'code_diff', spec: null, output: 'secret text', evidence: { test_log: '', build_log: '', diff: '', references: [] }, risk_hint: null }
const partial: any = { deterministic_findings: [], trust_score: 90, risk_level: 'LOW' }

const realFetch = globalThis.fetch
const saved = process.env.SOME_OTHER_KEY
afterEach(() => {
  globalThis.fetch = realFetch
  if (saved === undefined) delete process.env.SOME_OTHER_KEY
  else process.env.SOME_OTHER_KEY = saved
  delete process.env.MY_LLM_KEY
})

function stubFetch() {
  const calls: { url: string; headers: Record<string, string>; model: string }[] = []
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, headers: init.headers, model: JSON.parse(init.body).model })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 })
  }) as any
  return calls
}

it('no baseUrl or no model: construction throws, there is no default provider or model', () => {
  expect(() => new GenericLLMReviewer({} as any)).toThrow(/no default provider/)
  expect(() => new GenericLLMReviewer({ baseUrl: 'http://h/v1' } as any)).toThrow(/no default model/)
})

it('named key variable that is unset: nothing is sent', async () => {
  const calls = stubFetch()
  delete process.env.MY_LLM_KEY
  await expect(new GenericLLMReviewer({ baseUrl: 'http://h/v1', model: 'm', apiKeyEnv: 'MY_LLM_KEY' }).review(input, partial)).rejects.toThrow(/MY_LLM_KEY is not set/)
  expect(calls.length).toBe(0)
})

it('sends to the given endpoint and model with the key from the named variable only', async () => {
  const calls = stubFetch()
  process.env.SOME_OTHER_KEY = 'should-not-leak'
  process.env.MY_LLM_KEY = 'k1'
  await new GenericLLMReviewer({ baseUrl: 'https://gw.example/v1/', model: 'any-model', apiKeyEnv: 'MY_LLM_KEY' }).review(input, partial)
  expect(calls[0].url).toBe('https://gw.example/v1/chat/completions')
  expect(calls[0].model).toBe('any-model')
  expect(calls[0].headers.Authorization).toBe('Bearer k1')
  expect(JSON.stringify(calls)).not.toContain('should-not-leak')
})

it('no key configured: no Authorization header (local server)', async () => {
  const calls = stubFetch()
  await new GenericLLMReviewer({ baseUrl: 'http://localhost:8080/v1', model: 'local' }).review(input, partial)
  expect('Authorization' in calls[0].headers).toBe(false)
})

it('resolveReviewerOptions: explicit values win, env fills gaps, missing is reported, nothing guessed', () => {
  expect(resolveReviewerOptions({}, {})).toEqual({ missing: [expect.stringContaining('base URL'), expect.stringContaining('model')] })
  expect(resolveReviewerOptions({ baseUrl: 'http://a/v1' }, {})).toEqual({ missing: [expect.stringContaining('model')] })
  const env = { SEAL_LLM_BASE_URL: 'http://env/v1', SEAL_LLM_MODEL: 'em', SEAL_LLM_KEY_ENV: 'MY_LLM_KEY', MINIMAX_PLAN_KEY: 'ignored' }
  expect(resolveReviewerOptions({}, env)).toEqual({ options: { baseUrl: 'http://env/v1', model: 'em', apiKeyEnv: 'MY_LLM_KEY' } })
  expect(resolveReviewerOptions({ model: 'x' }, env)).toEqual({ options: { baseUrl: 'http://env/v1', model: 'x', apiKeyEnv: 'MY_LLM_KEY' } })
})
