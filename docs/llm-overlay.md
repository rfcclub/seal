# LLM overlay

The LLM overlay is an optional second reviewer for layer L2 (semantic correctness). It is **off by default**. With no reviewer registered, Seal makes no network calls at all.

It is provider-neutral. Seal has no built-in provider, vendor list, default URL, default model or default key variable. You name an OpenAI-compatible chat-completions endpoint (a hosted service, a gateway, or a server on your own machine) and a model. If you do not, the CLI stops with exit 2 and nothing is sent.

Read the privacy notes first: turning it on sends your text to the endpoint you configured, and Seal cannot tell you what that endpoint does with it.

## Turning it on

| Where | How |
|---|---|
| CLI | `--llm --llm-base-url <url> --llm-model <name>` on a code review (`seal code`, `seal review`, `seal <file>`). `seal plan` never calls the reviewer (see below). |
| Library | `Seal.withLLM(createReviewer({ baseUrl, model, apiKeyEnv }))`. `Seal.withLLM(null)` turns it off. See [Library API](api.md#llm-reviewer). |

CLI options:

| Option | Environment variable | Meaning |
|---|---|---|
| `--llm` | | Turns the reviewer on. Takes **no value**: `--llm somename` (any name) is rejected with exit 2. |
| `--llm-base-url <url>` | `SEAL_LLM_BASE_URL` | Required. Base URL of the endpoint; `/chat/completions` is appended (trailing slashes are trimmed). Example: `http://127.0.0.1:8787/v1`. |
| `--llm-model <name>` | `SEAL_LLM_MODEL` | Required. The model name sent in the request. |
| `--llm-key-env <VAR>` | `SEAL_LLM_KEY_ENV` | Optional. The **name** of the environment variable that holds the API key (not the key itself). Leave it out for an endpoint that needs no key. |
| `--llm-mode <always\|auto>` | | `always` (default) or `auto`; see [Mode](#mode-always-and-auto). |

A flag overrides its environment variable. Timeout (30 seconds) and a literal key can be set only in the library.

What stops the run (exit 2; every message except the `--llm-mode` one ends with `Nothing was sent.`): no base URL or no model after flags and environment are combined (the message lists what is missing); `--llm <name>`; a value option with no value or followed by another option (`--llm-model --llm-key-env K`); `--llm-mode` with any other value. All of these are checked before any file is read. Because `--llm` is parsed before the command, `seal --llm code file.md` reads `code` as the value of `--llm` and is rejected; put `--llm` after the file or directly before another `--` option.

## Try it without any account

This runs the overlay against a fake reviewer on your own machine. Save as `fake-llm.mjs`:

```js
import http from 'node:http'

// A fake OpenAI-compatible reviewer: logs what it receives, returns fixed review signals.
http.createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const r = JSON.parse(body)
    console.error(req.method, req.url, 'model=' + r.model, 'authorization=' + (req.headers.authorization ?? 'none'))
    const signals = {
      suspected_issues: ['Empty-name handling is not described'],
      missing_requirements: [], possible_edge_cases: [], evidence_gaps: [],
      risk_guess: 'MEDIUM', confidence: 0.9,
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(signals) } }] }))
  })
}).listen(8787, '127.0.0.1')
```

Start it in one terminal (`node fake-llm.mjs`), then in another, in the directory with `change.md` from the [quick start](../README.md#quick-start):

```sh
npx seal review change.md --artifact-type design \
  --llm --llm-base-url http://127.0.0.1:8787/v1 --llm-model local
```

```text
Seal reviewing change.md (design)...

┌─ Seal v0.6.0-beta.1 Verdict ──────────────────────┐
│  PASS  (trust: 100)  ██████████
│  Risk: MEDIUM
│  PASS (trust_score=100, risk=MEDIUM): 0 blocking, 1 non-blocking, 0 fabricated
│
│  Non-blocking:
│    ⚠ [undefined] Empty-name handling is not described
│
│  ✓ No issues found
│  Next: Proceed
└────────────────────────────────────────────┘
```

(The "No issues found" line next to a non-blocking finding is a cosmetic quirk of the formatted output; the finding is the reviewer's.) The server's terminal shows what Seal sent:

```text
POST /v1/chat/completions model=local authorization=none
```

With `--json` the reviewer's finding is in `llm_findings` (type `LOGIC_BUG`, severity `MEDIUM`, source `llm-overlay`) and the verdict is unchanged. The same flags can come from the environment: `SEAL_LLM_BASE_URL=http://127.0.0.1:8787/v1 SEAL_LLM_MODEL=local npx seal review change.md --artifact-type design --llm`.

Everything on this page about the CLI was run against a package built from this branch (`0.6.0-beta.1`).

## What is sent

For each review, Seal sends one HTTP POST (an OpenAI-style chat completion) to `<base URL>/chat/completions` with:

- a fixed system prompt telling the model it is "Seal, a quality gate" and to return only JSON;
- the `spec` text, if there is one;
- the full `output` text, with the artifact type;
- a list of the findings that are already blocking, as `[rule_id] evidence` lines, so the model does not repeat them (the evidence text can quote phrases from your text);
- the partial trust score and risk level.

The `spec` and `output` are wrapped in `<<<UNTRUSTED_CLAIM_TEXT>>>` markers and the prompt says that text inside them is data, never instructions. That reduces prompt-injection risk; it is not a guarantee.

**Not sent:** `test_log`, `build_log`, `diff`, `references`, the `context` object (agent id and so on), and file names. Request parameters: `temperature` 0.1, `max_tokens` 1024, `response_format` `json_object`, timeout 30 seconds (library `timeoutMs`).

(From `src/adapters/generic-llm-reviewer.ts` and `sanitize-claim-input.ts`.)

## API key handling

- The key is only what you name: the literal `apiKey` option (library), or the value of the variable named by `apiKeyEnv` / `--llm-key-env` / `SEAL_LLM_KEY_ENV`. No other environment variable is ever read.
- With no key named, no `Authorization` header is sent (the demo above shows `authorization=none`). The request is still sent. If the endpoint is a hosted service that rejects keyless calls, the review ends with the "LLM reviewer failed" finding, but your text has already left the machine.
- With a key, it is sent as `Authorization: Bearer <key>`. Checked in the demo: `DEMO_KEY=abc123` with `--llm-key-env DEMO_KEY` produced `authorization=Bearer abc123` at the server.
- If you name a variable and it is unset or empty, the reviewer fails **before any request**: nothing is sent, and the review gets the "LLM reviewer failed — L2 unreviewed" finding (checked: the demo server received no request).
- Use `https://` for any endpoint that is not on your own machine; Seal sends the key and your text to whatever URL you give it.

### Mode: `always` and `auto`

- `always` (default): the reviewer is called on every code-mode review.
- `auto` (CLI `--llm-mode auto`, library `Seal.withLLM(adapter, { mode: 'auto' })`): the reviewer is called only when the deterministic score before policy is below 85. When it is skipped, the review records the assumption "L2 (semantic correctness) skipped — heuristic score confident enough (auto mode, score=N)" (checked: the demo server received no request for the `change.md` design review, score 100).

## What the reviewer can change

The reviewer returns five lists and two numbers: `suspected_issues`, `missing_requirements`, `possible_edge_cases`, `evidence_gaps`, `risk_guess`, `confidence`. Seal turns them into findings:

| Reviewer field | Finding type | Severity |
|---|---|---|
| `suspected_issues` | `LOGIC_BUG` | MEDIUM |
| `missing_requirements` | `SPEC_MISMATCH` | HIGH |
| `evidence_gaps` | `MISSING_EVIDENCE` | MEDIUM |
| `possible_edge_cases` | `AMBIGUITY` | LOW |

These go in `llm_findings` with layer L2 and source `llm-overlay`. **They do not change `trust_score` or `verdict`.** In a test, a reviewer that reported a missing requirement (HIGH) left the review at `PASS` 100 while the HIGH finding showed up in `blocking_issues`. So `blocking_issues` can be non-empty on a `PASS` when the LLM reviewer is on.

Exactly two things from the reviewer can affect the outcome:

1. `confidence` below 0.6 at MEDIUM or higher risk adds finding `CL403`, removes 20 points and raises the verdict to at least `ESCALATE_TO_REVIEWER`.
2. A `risk_guess` higher than the detected risk adds a MEDIUM, non-blocking "LLM reviewer assessed risk as X" finding. It does not change the risk level.

If the request fails for any reason (no network, HTTP error, timeout, invalid JSON, a named key variable that is unset) the review continues: Seal adds the LOW finding "LLM reviewer failed — L2 unreviewed" and the assumption "L2 (semantic correctness) not reviewed — LLM reviewer error". The verdict is unaffected. The CLI then prints a tip to check the endpoint and the variable named by `--llm-key-env`.

Plan reviews never call the reviewer. This means `seal plan --llm ...` is a silent no-op once the flags validate (checked: the demo server received no request), and so is `orca gate-plan --llm` when Orca uses this version of Seal.

## Writing your own reviewer

Any object with a `review(input, partial)` method works. It may be async and must return the signal object:

```ts
import { Seal } from 'seal-gate'

Seal.withLLM({
  async review(input, partial) {
    // input.output, input.spec, input.artifact_type; partial.trust_score, partial.risk_level
    return {
      suspected_issues: [],
      missing_requirements: [],
      possible_edge_cases: [],
      evidence_gaps: [],
      risk_guess: 'MEDIUM',
      confidence: 0.8,
    }
  },
})
```

To keep everything local, point the built-in adapter at a server on your machine: `createReviewer({ baseUrl: 'http://localhost:11434/v1', model: 'your-model' })` (any OpenAI-compatible endpoint; the URL is an example, not something Seal ships). `createReviewer` throws if `baseUrl` or `model` is missing. `resolveReviewerOptions(explicit, env)`, also exported, builds the options from explicit values with the `SEAL_LLM_*` variables as fallback and returns `{ missing: [...] }` instead of guessing; the CLI and the Claude Code Stop hook both use it.

## Not supported

The package also contains `dist/adapters/openai-provider.js`, which builds a reviewer from `~/.seal/providers.d/<name>.yaml` files. That path and file format are not documented anywhere in this package. The adapter is not exported from the package entry point and is unsupported.
