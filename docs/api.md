# Library API

The package is an ES module (`"type": "module"`, entry `dist/index.js`, types in `dist/index.d.ts`). Import from the package name:

```js
import { Seal, TrustMemory } from 'seal-gate'
```

The package declares Node `>=22.5.0`. The library was tested on Node 22.12.0 (the oldest version tried) and under Bun (1.3.14); the `seal` command runs on the same Node versions (see [CLI reference](cli.md)).

## What is public

Only what `dist/index.js` exports is the public API:

| Export | Kind |
|---|---|
| `Seal` | object with `review`, `extend`, `withLLM`, `withTrustMemory` |
| `TrustMemory` | class |
| `VERSION` | string |
| `createReviewer`, `resolveReviewerOptions` | Provider-neutral LLM reviewer factory and its options resolver (see [LLM overlay](llm-overlay.md)) |
| `SpecCoverageValidator` | class with static `validate` and `validateWithProbe` |
| `checkTestPinsBehavior`, `breedMutations`, `DEFAULT_FAILURE_PATTERN` | mutation-probe helpers |
| `evaluatePropertyEvidence` | function, plus types `PropertyContract`, `PropertyEvidenceReview`, `PropertyReviewOptions` |
| `SealInputError` | error class |
| types `SealInput`, `SealVerdict`, `SealExtension`, `LLMReviewerAdapter` | TypeScript types |

The package has no `exports` map, so deep imports such as `seal-gate/dist/types.js` or `seal-gate/dist/extensions/context-guard/index.js` resolve today. They are **not** a stable API and may move without notice. That covers the context-guard extension, the `drift` module (a separate experimental feature that keeps a SQLite database under `~/.seal/`; not documented here), the `openai-provider` adapter, and helper types such as `SealIssue` and `Verdict`. The types `SealIssue` and `SealEvidence` are reachable as `SealVerdict['blocking_issues'][number]` and `SealInput['evidence']`.

## Seal

`Seal` is a module-level singleton. Its configuration is **global and persists across calls**:

- `Seal.extend(ext)` adds an extension. There is no way to remove one.
- `Seal.withLLM(adapter, { mode? })` sets or clears (`null`) the LLM reviewer. `mode` is `'always'` (default) or `'auto'`.
- `Seal.withTrustMemory(mem)` sets the trust memory.

In a long-lived process, or in tests, set these once at start-up and do not assume a clean slate between modules that import Seal. `Seal.withLLM(null)` resets the reviewer.

### `Seal.review(input, options?)`

Returns `Promise<SealVerdict>`.

```ts
Seal.review(input: Partial<SealInput>, options?: { propertyEvidenceVerifier?: ... }): Promise<SealVerdict>
```

`input`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `artifact_type` | `'llm_response' \| 'code_diff' \| 'test_plan' \| 'design' \| 'migration' \| 'plan_review'` | yes | |
| `output` | string | yes | Non-empty after trimming. |
| `spec` | string \| null | no | Default `null`. |
| `evidence` | `{ test_log, build_log, diff: string, references: EvidenceEnvelope[], red_green?: { red, green } }` | no | Missing fields default to empty. `red_green` is optional structured fail-before/pass-after evidence for `TW203`: `{ red: { test, exit_code, output }, green: { test, exit_code, output } }` (see [Rules](rules.md#what-satisfies-tw203)). |
| `risk_hint` | `'LOW' \| 'MEDIUM' \| 'HIGH' \| 'CRITICAL' \| null` | no | Upper case. Can only raise risk. |
| `context` | object | no | See below. |

`context` keys Seal reads: `agent_id` (trust memory), `agent_role` (the bundled extensions), `locked_criteria` (plan reviews: `{ id, text, source_file?, source_line? }[]`), `artifact_file` (plan reviews: the file name used in findings, default `artifact.md`), `property_contracts` ([Mandatory Property evidence](property-evidence.md)), and the extension keys `aria_axioms`, `aria_pattern_memory` and `context_guard`. Any other keys are passed through to extensions.

Throws `SealInputError` (with `name`, `message` and `field`) for an empty `output`, an unknown `artifact_type` or an invalid `risk_hint`. A failing LLM reviewer or extension does not throw; it becomes a LOW finding.

Result (`SealVerdict`): the fields are listed in the [CLI reference](cli.md#json-output). From the library you also get `trust_memory_summary` when trust memory is wired in and `context.agent_id` is set.

Acting on a verdict:

```js
const v = await Seal.review({ artifact_type: 'code_diff', output, evidence })
switch (v.verdict) {
  case 'PASS':
  case 'PASS_WITH_WARNINGS':
    break                                   // continue; log v.non_blocking_issues
  case 'REVISE':
    sendBack(v.blocking_issues)             // let the producer fix and retry
    break
  default:                                  // ESCALATE_TO_REVIEWER or BLOCK
    halt(v.next_action)
}
```

### Supplying evidence

`evidence.test_log`, `build_log` and `diff` are plain text. `evidence.references` takes envelopes:

```js
references: [
  { type: 'command', command: 'npm test', exit_code: 0, output: '12 passed' },
  { type: 'file', path: 'src/a.ts', line: 10, snapshot: 'export const x = 1' },
  { type: 'text', label: 'security-review', content: 'Checked token expiry paths.' },
]
```

See [Concepts](concepts.md#evidence) for what each type must contain and how each is used. File envelopes are not read from disk by `review()`.

## Extensions

An extension is an object with `name`, `description` and a synchronous `check(input)` that returns findings. `input` is the normalized input (all fields filled in).

```js
Seal.extend({
  name: 'no-todo',
  description: 'Flags TODO left in output',
  check(input) {
    return /TODO/.test(input.output)
      ? [{
          type: 'OTHER', severity: 'HIGH', is_blocking: true,
          layer: 'EXTENSION', source: 'extension',
          rule_id: 'X-TODO', evidence: 'TODO left in output',
        }]
      : []
  },
})
```

(Run: this gave `REVISE` with `X-TODO` blocking.) Set `is_blocking` yourself, because the helper that derives it is not public. `type` is one of `SPEC_MISMATCH`, `LOGIC_BUG`, `TEST_GAP`, `MISSING_EVIDENCE`, `SECURITY_RISK`, `DATA_RISK`, `HALLUCINATION`, `AMBIGUITY`, `COMPATIBILITY_RISK`, `FABRICATED_EVIDENCE`, `SPEC_UNTESTED`, `OTHER`. `severity` is `CRITICAL`, `HIGH`, `MEDIUM` or `LOW`.

Effect on the verdict: a blocking extension finding with `required_verdict: 'BLOCK'` makes the verdict `BLOCK`; any other blocking extension finding makes it at least `REVISE`. Extension findings never change `trust_score`. Other `required_verdict` values from extensions are not honoured in code mode. If `check` throws, Seal adds a LOW finding "Extension [name] failed: ..." and carries on.

## TrustMemory

`TrustMemory` keeps per-agent review history in memory. **Persistence is up to you.** It never changes a verdict.

```js
import { writeFileSync, readFileSync } from 'node:fs'
import { Seal, TrustMemory } from 'seal-gate'

const memory = new TrustMemory({ maxHistory: 50, driftThreshold: 15 })   // these are the defaults
Seal.withTrustMemory(memory)

const v = await Seal.review({ artifact_type: 'code_diff', output, context: { agent_id: 'bot' } })
console.log(v.trust_memory_summary)
// { agent_id: 'bot', reliability_score: 61, drift_trend: 'stable', review_count: 1, last_reviewed_at: 1794673803394 }

writeFileSync('trust-memory.json', JSON.stringify(memory.toJSON()))
const restored = TrustMemory.fromJSON(JSON.parse(readFileSync('trust-memory.json', 'utf8')))
```

| Member | Meaning |
|---|---|
| `new TrustMemory(options?)` | `maxHistory` (default 50 reviews kept per agent), `driftThreshold` (default 15). |
| `record(agentId, { verdict, trust_score, risk_level, blocking_count, ts? })` | Append a review. `Seal.review()` calls this for you when `context.agent_id` is set. |
| `getHistory(agentId)` | Records, oldest first. |
| `getScore(agentId)` | Reliability score 0 to 100, or `null` with no history. |
| `getSummary(agentId)` | `{ agent_id, reliability_score, drift_trend, review_count, last_reviewed_at }`. |
| `toJSON()` | `{ [agentId]: ReviewRecord[] }` where a record is `{ ts, verdict, trust_score, risk_level, blocking_count }`. |
| `TrustMemory.fromJSON(data, options?)` | Restores; drops invalid records, sorts by `ts`, drops duplicate timestamps, caps history. Reads the old verdict name `ESCALATE_TO_HUMAN` as `ESCALATE_TO_REVIEWER` (run). |

How the numbers are computed is in [Concepts](concepts.md#trust-memory).

## LLM reviewer

See [LLM overlay](llm-overlay.md) for what is sent and how the key is handled. Seal has no built-in provider: you give it an OpenAI-compatible endpoint and a model. In code:

```js
import { Seal, createReviewer } from 'seal-gate'

// a server on your own machine, no key
Seal.withLLM(createReviewer({ baseUrl: 'http://127.0.0.1:8787/v1', model: 'local' }))

// a hosted endpoint; the key is read from the variable you name
Seal.withLLM(
  createReviewer({ baseUrl: 'https://llm.example.com/v1', model: 'my-model', apiKeyEnv: 'MY_LLM_KEY' }),
  { mode: 'auto' },
)
```

`createReviewer(options)` takes:

| Option | Required | Meaning |
|---|---|---|
| `baseUrl` | yes | Endpoint base URL; `/chat/completions` is appended. |
| `model` | yes | Model name sent in the request. |
| `apiKey` | no | A literal key, sent as `Authorization: Bearer <key>`. |
| `apiKeyEnv` | no | The **name** of an environment variable that holds the key. Used when `apiKey` is not given. |
| `timeoutMs` | no | Default 30000. |

It throws if `baseUrl` or `model` is missing. The key is only the literal `apiKey` or the variable named by `apiKeyEnv`; no other environment variable is read. With neither, no `Authorization` header is sent. If `apiKeyEnv` is named but the variable is unset or empty, `review()` throws before any request (the review then carries the LOW finding "LLM reviewer failed").

`resolveReviewerOptions(explicit?, env?)` returns `{ options }` built from `{ baseUrl, model, apiKeyEnv }` with the `SEAL_LLM_BASE_URL`, `SEAL_LLM_MODEL` and `SEAL_LLM_KEY_ENV` variables as fallback (`env` defaults to `process.env`), or `{ missing: [...] }` naming what is absent. It never guesses a default.

```js
import { Seal, createReviewer, resolveReviewerOptions } from 'seal-gate'

const r = resolveReviewerOptions()
if ('options' in r) Seal.withLLM(createReviewer(r.options))
else console.error('LLM overlay off; missing:', r.missing.join('; '))
```

The per-vendor factory functions of earlier releases no longer exist; use `createReviewer`.

An adapter is any object with `review(input, partial)` returning the signal object (see [LLM overlay](llm-overlay.md#writing-your-own-reviewer)).

## Spec coverage and mutation probe helpers

`SpecCoverageValidator.validate(spec, testLog, diff)` is the check behind rule `SV101`. It returns `{ issues, assumptions, trust_deductions, coverage }`, where `coverage` has one entry per spec bullet.

`SpecCoverageValidator.validateWithProbe(spec, testLog, diff, probes)` additionally mutation-probes tests. Each probe is `{ criterion, test_file, run_command: [command, args], workdir }`. It produces rule `TE201` findings for tests that stay green after a mutation. `Seal.review()` does not call it; the Orca harness does.

`checkTestPinsBehavior({ test_file, run_command, workdir, cap?, timeout_ms?, failure_pattern? })` is the probe itself. Read these properties before using it:

- It **rewrites the test file on disk** for each mutation, runs `run_command`, and restores the original in a `finally` block. A hard kill of the process during a run could leave a mutated file, so run it on a clean working tree (a hard kill during a run was not tested).
- It first runs the unmutated test. If that fails or errors, or already prints assertion-failure text, the result is `{ skipped: true, reason: 'inconclusive: ...' }`.
- Mutations are simple text rewrites: `expect(...).toBe(x)` to `.not.toBe(x)` (and the same for `toEqual`, `toMatch`, `toContain`, `toBeDefined`, `toBeTruthy`, `toBeFalsy`), `===` and `!==` swapped, `true` and `false` swapped, the first integer of 2 or more increased by 1, and `<=` and `>` flipped.
- A mutation counts as killed only if the run exits with code 1 and its output matches `DEFAULT_FAILURE_PATTERN` (an `AssertionError` or `expect(received)` line at the start of a line). Output text cannot say whose assertion failed; exact attribution is an open limitation, [issue #10](https://github.com/rfcclub/seal/issues/10).
- Result: `{ pinned: true, survivors: [] }`, `{ pinned: false, survivors: [...] }` (a survivor is the full mutated source) or `{ skipped: true, reason }`.

`breedMutations(source)` returns the mutated sources without running anything.

## Mandatory Property evidence

`Seal.review(input, { propertyEvidenceVerifier })` and `evaluatePropertyEvidence()` implement a blocking policy for specs that contain mandatory `#### Property:` blocks. See [Mandatory Property evidence](property-evidence.md).

## Calling from other languages

There is no Python package or other binding. See [Python](python.md).
