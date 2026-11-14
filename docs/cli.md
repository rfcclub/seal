# CLI reference

The package installs one command, `seal` (`dist/cli.js`). Everything on this page was checked against the built CLI of `0.6.0-beta.1` (a build of this branch) unless marked otherwise.

```text
seal <command> [options]
```

**Node version.** The `seal` command runs on every Node version the package declares (`>=22.5.0`). It was checked by hand on 22.12.0, 22.17.1, 22.18.0, 23.11.0, 24.1.0 and 24.2.0 when the entry-point fix landed ([#23](https://github.com/rfcclub/seal-gate/pull/23)), and the quick start was re-run on Node 26.5.0 for these docs. It also runs under Bun (tested: 1.3.14). Releases before `0.6.0-beta.1` printed nothing and exited 0 on some Node versions; see [Troubleshooting](troubleshooting.md#fixed-problems).

## Commands

Each review command takes one file. The file is read as UTF-8 text and trimmed. An empty file is an error (`output is required and must be non-empty`, exit 1). A path that is a directory fails with `EISDIR`, exit 1.

| Command | Artifact type | Mode | Notes |
|---|---|---|---|
| `seal code <file>` | `code_diff` | code | Help text calls it the "default mode"; it is not the default for a bare file. |
| `seal plan <file>` | `plan_review` | plan | Also accepted as `seal spec <file>` and `seal design <file>` (both are the same as `plan`, not listed in the help). |
| `seal review <file>` | `--artifact-type` value, default `llm_response` | code, or plan if you pass `plan_review` | The only command that honours `--artifact-type`. |
| `seal <file>` | `llm_response` | code | Shorthand: if the first word is not a command and names an existing file. |
| `seal help`, `seal --help`, `seal -h` | | | Prints usage, exit 0. |
| `seal version`, `seal --version`, `seal -v` | | | Prints `seal v0.6.0-beta.1`, exit 0. |

Running `seal` with no arguments, an unknown command that is not an existing file, or a command without a file prints the usage and exits 2.

## Options

| Option | Value | Applies to | Meaning |
|---|---|---|---|
| `--spec <file>` | path | all | Requirements text. Bullet lines (`- ...` or `* ...`) are treated as acceptance criteria. If the file does not exist the option is silently ignored. |
| `--locked-criteria <file>` | path | plan reviews | JSON array of `{ "id": "AC-1", "text": "...", "source_file"?: "...", "source_line"?: 1 }`. A missing file, an empty array or JSON that is not an array is silently ignored (the plan then escalates with `PR002`). Malformed JSON prints the parser's message and exits 1. |
| `--risk <level>` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` | code reviews and plan reviews | Risk hint. **Upper case only**: `--risk high` fails with `risk_hint must be one of: LOW, MEDIUM, HIGH, CRITICAL or null` and exit 1, although the help text shows lower case. A hint can only raise the detected risk. |
| `--agent-id <id>` | string | all | Sets `context.agent_id`. **No effect in the CLI**: trust memory is not wired in, so no `trust_memory_summary` is produced and nothing is stored. |
| `--artifact-type <type>` | `llm_response`, `code_diff`, `test_plan`, `design`, `migration`, `plan_review` | `review` only | Ignored by every other command (`seal code f --artifact-type design` still reviews as `code_diff`). An invalid value exits 1. |
| `--llm` | none | code reviews | Registers the LLM reviewer. **Sends your text to the endpoint you name.** Takes no value (`--llm <name>` exits 2). Needs `--llm-base-url` and `--llm-model` (or the `SEAL_LLM_*` variables); there is no default provider. Read [LLM overlay](llm-overlay.md) first. Plan reviews never call the reviewer. |
| `--llm-base-url <url>` | URL | with `--llm` | Base URL of an OpenAI-compatible endpoint (`/chat/completions` is appended). Or `SEAL_LLM_BASE_URL`. |
| `--llm-model <name>` | string | with `--llm` | Model name sent in the request. Or `SEAL_LLM_MODEL`. |
| `--llm-key-env <VAR>` | variable name | with `--llm` | Name of the environment variable that holds the API key. Or `SEAL_LLM_KEY_ENV`. Omit it and no `Authorization` header is sent. A named variable that is unset makes the reviewer fail before any request. |
| `--llm-mode <always\|auto>` | `always` or `auto` | with `--llm` | `auto` calls the reviewer only when the deterministic score before policy is below 85. Default `always`. Any other value exits 2. |
| `--json` | none | all | Print the verdict as JSON (no header line, no colour). |

How arguments are parsed:

- `--json`, `--version` and `--help` take no value.
- Every other `--option` takes the next argument as its value. If the value is missing, or the next token starts with `--`, the CLI prints `Error: --x needs a value. Nothing was sent.` and exits 2 before reading any file or sending anything. An unknown `--option` is treated the same way (it takes the next argument, or fails if there is none).
- `--llm` takes no value, but it is parsed before the command is known, so a bare word right after it is read as its value and rejected: `seal --llm code file.md` exits 2 (`--llm takes no value`). Put `--llm` after the file or directly before another `--` option.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Verdict is `PASS` or `PASS_WITH_WARNINGS`; also help and version |
| 1 | Verdict is `REVISE`, `ESCALATE_TO_REVIEWER` or `BLOCK`; **also** runtime errors: invalid `--risk` or `--artifact-type`, empty file, unreadable file, malformed criteria JSON |
| 2 | Usage error: no command, unknown command, no file given, file not found, an option missing its value, `--llm` without an endpoint and model, `--llm <name>`, an invalid `--llm-mode` |

Exit code 1 therefore does not distinguish "the gate said no" from "the CLI failed". In a script, use `--json` and check that stdout parses and contains a `verdict` field.

## Output

Without `--json` the CLI prints a header line (`Seal reviewing <file> (<type>)...`), then a box with the verdict, the trust score, the risk level, the one-line summary, blocking issues (`[rule_id] evidence`), non-blocking issues, and the next action:

```text
┌─ Seal v0.6.0-beta.1 Verdict ──────────────────────┐
│  REVISE  (trust: 85)  ███████░░░
│  Risk: MEDIUM
│  REVISE (trust_score=85, risk=MEDIUM): 1 blocking, 1 non-blocking, 0 fabricated
│
│  Blocking Issues:
│    ✗ [TW201] Implementation artifact has no test evidence
│
│  Non-blocking:
│    ⚠ [undefined] L2 unreviewed — semantic issues may exist
│  Next: Return to producing agent with blocking_issues
└────────────────────────────────────────────┘
```

Known cosmetic problems: findings without a rule id print as `[undefined]`, and the colour codes are always emitted (`NO_COLOR` is not honoured). Prefer `--json` in scripts.

If you pass `--llm` and the reviewer failed, the CLI also prints a tip: "the LLM reviewer failed; check the endpoint and the variable named by --llm-key-env." See [LLM overlay](llm-overlay.md).

## JSON output

`--json` prints the verdict object, pretty-printed:

| Field | Type | Meaning |
|---|---|---|
| `verdict` | string | One of the five verdicts. |
| `trust_score` | number | 0 to 100. |
| `risk_level` | string | `MEDIUM`, `HIGH` or `CRITICAL` in practice (see [Concepts](concepts.md#risk)). |
| `summary` | string | One-line summary. |
| `deterministic_findings` | array | Findings from the built-in rules and policy. |
| `llm_findings` | array | Findings from the LLM reviewer (plan mode: from the falsification stage). |
| `blocking_issues` | array | Findings with severity `HIGH` or `CRITICAL`, from all sources. |
| `non_blocking_issues` | array | The rest. |
| `missing_evidence` | array of strings | Claims that lack evidence. |
| `assumptions_detected` | array of strings | What Seal skipped or could not check (no spec, no LLM reviewer, and so on). |
| `advisory_notes` | array of strings | Informational; do not affect score or verdict. |
| `next_action` | string | Text for the verdict. |
| `score_breakdown` | object | `base`, `issue_deductions`, `missing_evidence_deductions`, `risk_deductions`, `overconfidence_deductions`, `evidence_bonuses`, `final`. Informational; can differ from `trust_score`. |
| `fabricated_evidence` | array | Citations proven false. Empty in every test run. |
| `version`, `schema_version` | string | Package version and result schema (`0.2.0`). |
| `trust_memory_summary` | object | Library only, when trust memory is wired in and `context.agent_id` is set. Never present from the CLI. |

Each finding has `type`, `severity` (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), `is_blocking`, `layer`, `source` (`core`, `llm-overlay`, `extension`), `evidence` (text), and where the rule provides them `rule_id`, `trust_deduction`, `required_fix`, `suggested_fix`, `required_verdict`. Plan-mode findings may add `evidence_file`, `evidence_lines`, `evidence_quote`, `criterion_ref`, `confidence` and `policy_tags`.

## Examples

```sh
# A plan against locked criteria, JSON out
seal plan plan.md --locked-criteria criteria.json --json

# A design note with a requirements file and a risk hint
seal review design.md --artifact-type design --spec requirements.md --risk HIGH

# The LLM overlay, against any OpenAI-compatible endpoint you choose (see llm-overlay.md)
seal code change.md --llm --llm-base-url http://127.0.0.1:8787/v1 --llm-model local

# Use the exit code in a script (remember exit 1 also means a runtime error)
if seal plan plan.md --locked-criteria criteria.json --json > verdict.json; then
  echo "plan passes"
fi
```

For evidence (test logs, build logs, diffs, command receipts) use the [library](api.md). The CLI cannot supply it.

## Help text versus behaviour

| Help text says | Actual behaviour |
|---|---|
| `--risk <level>`: `low, medium, high, critical` | Upper case only. |
| `--agent-id <id>`: "Agent identifier for trust memory" | No trust memory in the CLI. |
| `--artifact-type <type>` listed as a general override | Only `seal review` reads it. |
| `code`: "default mode" | A bare file is reviewed as `llm_response`. |
| Exit 2 for misuse only | A missing option value exits 2, but an invalid `--risk` or `--artifact-type` value, an empty file or malformed criteria JSON exit 1. |
