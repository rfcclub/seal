# Troubleshooting

## Symptoms

### `seal code` always returns REVISE with TW201

Expected. The CLI sends empty evidence, so "Implementation artifact has no test evidence" always fires for `code_diff` and `llm_response`. Use `seal review file --artifact-type design` (or `test_plan`, `migration`) if the text is not an implementation, `seal plan` for plans, or the [library](api.md) to supply a test log.

### `--risk high` fails with "risk_hint must be one of"

Use upper case: `--risk HIGH`. The help text shows lower case; the code accepts only `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.

### `--llm` exits 2 with "--llm needs an endpoint"

Seal has no default provider, URL or model. Give both `--llm-base-url <url>` and `--llm-model <name>`, or set `SEAL_LLM_BASE_URL` and `SEAL_LLM_MODEL`. Nothing was sent. See [LLM overlay](llm-overlay.md#turning-it-on).

### `--llm` exits 2 with "--llm takes no value"

You wrote `--llm <something>` (for example `--llm somename`, or `seal --llm code file.md`, where `code` is read as the value). `--llm` is a plain switch; name the endpoint with `--llm-base-url` and `--llm-model`, and put `--llm` after the file or before another `--` option.

### An option exits 2 with "--x needs a value"

Every option except `--json`, `--version`, `--help` and `--llm` takes a value, and the value must not start with `--`. Nothing was sent and no file was read.

### `--llm` prints "LLM reviewer failed — L2 unreviewed" or a tip about the key

The endpoint was unreachable, answered with an HTTP error or something that is not JSON, timed out, or the variable named by `--llm-key-env` is not set (in that case nothing was sent). The review itself is unaffected. Otherwise the request was sent, with no `Authorization` header unless you named a key variable: see [LLM overlay](llm-overlay.md#api-key-handling).

### `--llm` makes no difference on `seal plan`

Right: plan reviews never call the reviewer. The flags are still validated, so a missing endpoint still exits 2.

### The verdict is PASS but `blocking_issues` is not empty

With an LLM reviewer on, findings from it (for example a HIGH "missing requirement") are listed in `blocking_issues` but do not change the verdict or score. Look at `llm_findings` and decide yourself.

### `trust_score` and `score_breakdown.final` differ

The overconfidence-language deductions appear only in the breakdown. Use `trust_score` and `verdict`. See [Rules](rules.md#overconfidence-language-rules-code-mode).

### A finding prints as `[undefined]`

The finding has no rule id (for example the standing "L2 unreviewed" note, or an evidence-envelope problem). Cosmetic. `--json` shows the finding's `type` and `evidence`.

### E001 fires on a sentence like "I tested it"

The words "verified" and "tested" count as a test-result claim. Either supply a test log, or reword.

### TW203 or TW205 fires and looks wrong

Known: [#11](https://github.com/rfcclub/seal/issues/11) and [#12](https://github.com/rfcclub/seal/issues/12). See [Rules](rules.md#why-tw203-and-tw205-are-known-to-be-wrong).

### My `--spec` or `--locked-criteria` file seems ignored

A path that does not exist is silently ignored, and so is criteria JSON that is not a non-empty array. Check the path (it is resolved from the current directory). Without criteria a plan escalates with `PR002`. Malformed JSON is reported and exits 1.

### A review with a spec containing "#### Property:" blocks returns BLOCK

Mandatory Property blocks need a trusted verifier that only the library can be given. From the CLI such a spec always ends in `PMUST-01` and `BLOCK` (tested). See [Mandatory Property evidence](property-evidence.md).

### Exit code 1 and I do not know why

Exit 1 covers both a non-passing verdict and a runtime error. Run with `--json`: a verdict means the gate said no; an error message on stderr and no JSON means the CLI failed.

### I see ESCALATE_TO_HUMAN

That is the verdict name before 0.6.0-beta.0. Something in your pipeline is using an older Seal (an older Orca bundle, for example). Accept both names, or update. See [Concepts](concepts.md#verdicts).

### `require('seal-gate')` fails

The package is ESM only. Use `import` (or `await import('seal-gate')`).

### Colour codes in logs

The formatted CLI output always contains ANSI colour codes; `NO_COLOR` is ignored. Use `--json`.

## Known problems

Everything below was confirmed against `0.6.0-beta.1` (a build of this branch) or, for the rules, `0.6.0-beta.0`, whose rules are unchanged. Open GitHub issues are linked.

| # | Problem | Where documented |
|---|---|---|
| 1 | TW203 judges the word "regression", not fail-before/pass-after evidence. [#11](https://github.com/rfcclub/seal/issues/11) (open) | [Rules](rules.md) |
| 2 | TW205's auth flag matches unchanged context and removed lines. [#12](https://github.com/rfcclub/seal/issues/12) (open) | [Rules](rules.md) |
| 3 | Mutation-probe kills are judged from output text, so assertion failures cannot be attributed exactly. [#10](https://github.com/rfcclub/seal/issues/10) (open) | [API](api.md#spec-coverage-and-mutation-probe-helpers) |
| 4 | The CLI cannot supply evidence; `seal code` always gets `TW201`. | [CLI](cli.md) |
| 5 | `--risk` is upper-case only (the help text says lower case); `--agent-id` does nothing; `--artifact-type` works only with `review`; `seal --llm code file.md` reads `code` as the value of `--llm` and exits 2. | [CLI](cli.md) |
| 6 | LLM findings do not affect the verdict (except `CL403`) but can appear in `blocking_issues`. Plan reviews ignore the LLM reviewer. | [LLM overlay](llm-overlay.md) |
| 7 | Overconfidence deductions never reach `trust_score`; `CL-D01` cannot fire; `CL-B/C/D/E` phrases fire even inside code fences. | [Rules](rules.md) |
| 8 | Plan-mode rules `PR003` and `PR004` cannot fire; `PR001` matches phrases in different sections without checking that they name the same object; `PR-HB-01/02/03` end as `BLOCK`. | [Rules](rules.md) |
| 9 | A missing `--spec` / `--locked-criteria` file, or criteria JSON that is not an array, is silently ignored. Runtime errors share exit code 1 with failing verdicts. | [CLI](cli.md) |
| 10 | Human-readable output prints `[undefined]` for findings with no rule id and ignores `NO_COLOR`. | [CLI](cli.md) |
| 11 | The hooks are not in the npm package; they hard-code agent names and example paths; `qwen-drift-guard.ts` has a broken import; the Stop hooks report the first blocking finding (often `TW201`) as the reason. | [Agent hooks](agent-hooks.md) |
| 12 | The npm package ships the `src/drift/__tests__` test files and `docs/`, but not `hooks/`; `dist/adapters/openai-provider.js` is present but not exported from the entry point and is unsupported. | [Library API](api.md#what-is-public), [LLM overlay](llm-overlay.md#not-supported) |
| 13 | Risk is never `LOW`: the classifier starts at `MEDIUM` and a hint can only raise it. | [Concepts](concepts.md#risk) |
| 14 | No Python package exists. | [Python](python.md) |
| 15 | The rule-activation table in the source is computed but never used. | [Rules](rules.md) |
| 16 | The `Seal` object is global state: extensions cannot be removed, and the LLM reviewer and trust memory persist across calls. | [API](api.md) |

## Fixed problems

- **The `seal` command printed nothing and exited 0 on Node 22.17 and older, 23.x and 24.0 to 24.1** (issue #22 (archived), closed; fixed in [#23](https://github.com/rfcclub/seal/pull/23), included in `0.6.0-beta.1`). The entry guard used `import.meta.main`, which those Node versions do not define, so even `--version` printed nothing. The CLI now finds its own entry path and runs on every Node in `engines` (`>=22.5.0`). If you still see silent exit 0 with empty output, you have an older package (`0.6.0-beta.0` or earlier): upgrade. In a script, never treat exit 0 with empty output as a pass; parse the `--json` output and require a `verdict` field.
- **The LLM overlay used to default to a specific vendor** (bare `--llm` posted your text to it, and a custom base URL could borrow that vendor's key variable). Fixed in the same change: no default provider, URL, model or key variable; see [LLM overlay](llm-overlay.md).

Two more observations on the output: `fabricated_evidence` and the integrity check are part of the result shape, but in all test runs `fabricated_evidence` was empty (no built-in code-mode rule attaches file and line citations to verify), and the CLI never prints `trust_memory_summary`.
