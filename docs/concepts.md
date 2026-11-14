# Concepts

This page explains what Seal looks at, how it turns findings into a verdict, and what the numbers mean. Rule ids are listed in [Rules](rules.md).

## What goes in

A review takes one text artifact and some optional context:

| Field | Meaning |
|---|---|
| `artifact_type` | What kind of text this is. See below. Required. |
| `output` | The text under review. Required and non-empty. |
| `spec` | Optional requirements text to compare against. |
| `evidence` | Optional `test_log`, `build_log`, `diff` (all strings) and `references` (a list of evidence envelopes). |
| `risk_hint` | Optional `LOW`, `MEDIUM`, `HIGH` or `CRITICAL`. It can only raise the detected risk. |
| `context` | Optional extras: `agent_id`, `agent_role`, `locked_criteria`, `artifact_file` (a name used in plan-mode findings), `property_contracts` and a few extension keys. |

From the command line you can supply only `output` (the file you name), `spec`, `locked_criteria`, `risk_hint`, `agent_id` and the artifact type. `evidence` is always empty from the CLI. See [CLI reference](cli.md).

### Artifact types

| Type | Used for | Review mode |
|---|---|---|
| `llm_response` | An agent's answer or summary. Default for `seal review` and `seal <file>`. | code |
| `code_diff` | A description of a code change. Used by `seal code`. | code |
| `test_plan` | A test plan. | code |
| `design` | A design note. | code |
| `migration` | A data or schema migration. | code |
| `plan_review` | A plan, design, proposal or spec seed. Used by `seal plan`. | plan |

There are two review modes. **Code mode** (every type except `plan_review`) checks claims against evidence. **Plan mode** (`plan_review`) has no runtime to check, so it asks a different question: is this plan coherent, and does it cover the acceptance criteria that were locked before it was written? The two modes use different rules and different score bands.

Only `code_diff` and `llm_response` are "implementation artifacts" for rule `TW201` (no test evidence). That is why a `design` passes without a test log and a `code_diff` does not.

## Layers

Findings carry a layer tag:

| Layer | Meaning | Source |
|---|---|---|
| L1 | Spec compliance and plan coherence | rules |
| L2 | Semantic correctness | LLM reviewer only |
| L3 | Evidence | rules |
| L4 | Risk and policy | rules |
| EXTENSION, LLM_OVERLAY | Findings from extensions or the plan-mode falsification stage | extensions |

Without an LLM reviewer, layer L2 is never checked. Seal says so on every code-mode review: finding "L2 unreviewed — semantic issues may exist" (LOW, non-blocking, no score effect) and the assumption "L2 (semantic correctness) not reviewed — no LLM reviewer registered".

## Verdicts

| Verdict | Meaning | `next_action` text |
|---|---|---|
| `PASS` | Nothing blocks. | Proceed |
| `PASS_WITH_WARNINGS` | Nothing blocks, but read the findings. | Proceed with caution — review warnings |
| `REVISE` | Send the blocking findings back to whoever produced the artifact. | Return to producing agent with blocking_issues |
| `ESCALATE_TO_REVIEWER` | The gate cannot decide. Hand the evidence to an independent reviewer. | Halt — hand the evidence to an independent reviewer before continuing |
| `BLOCK` | Do not proceed. | Halt — do not proceed |

Verdicts are ordered from least to most severe in the order above. When several rules want different verdicts, the most severe wins, and `BLOCK` is terminal.

**Rename.** `ESCALATE_TO_REVIEWER` replaced `ESCALATE_TO_HUMAN` in 0.6.0-beta.0. Seal never returns the old name. Code that stores or receives verdicts still understands it: `TrustMemory.fromJSON()` reads a stored `ESCALATE_TO_HUMAN` record as `ESCALATE_TO_REVIEWER` (tested), and the bundled hooks accept both names. The `Verdict` type no longer includes the old name. A helper `normalizeVerdict()` exists in `dist/types.js`; it is reachable by deep import but is not part of the public API. If you compare verdict strings, compare against the new name. Older consumers of Seal (for example the published `seal-gate@0.5.0`, and anything that bundles it) still see the old name.

### Blocking and non-blocking findings

A finding is **blocking** when its severity is `CRITICAL` or `HIGH`. Any blocking finding makes the verdict at least `REVISE` in code mode. Severity `MEDIUM` and `LOW` findings are non-blocking.

### Score bands, code mode

The trust score starts at 100 and goes down with deductions (below). The score maps to a verdict:

| Score | Verdict |
|---|---|
| 85 to 100 | `PASS` |
| 70 to 84 | `PASS_WITH_WARNINGS` |
| 50 to 69 | `REVISE` |
| 30 to 49 | `ESCALATE_TO_REVIEWER` |
| below 30 | `BLOCK` |

If any finding is blocking, the verdict is raised to at least `REVISE`. Policy rules (below) can raise it further. The final verdict is the more severe of the score verdict and the policy verdict. A score of 100 can still produce `REVISE` or `BLOCK`, because blocking findings and hard rules do not depend on the score.

### Score bands, plan mode

| Condition | Verdict |
|---|---|
| any blocking finding | `BLOCK` (not `REVISE`) |
| risk `HIGH` and score 71 to 89 | `ESCALATE_TO_REVIEWER` |
| score 90 to 100 | `PASS` |
| score 71 to 89 | `PASS_WITH_WARNINGS` |
| score 50 to 70 | `REVISE` |
| score 30 to 49 | `ESCALATE_TO_REVIEWER` |
| below 30 | `BLOCK` |

Plan mode also honours `required_verdict` on every finding, so a non-blocking finding that asks for `REVISE` (an uncovered criterion, `PR002`) or `ESCALATE_TO_REVIEWER` (no locked criteria) moves the verdict even when the score is high. Because the policy-injected `PR-HB-01`, `PR-HB-02` and `PR-HB-03` findings are blocking, they end as `BLOCK` in practice (tested for all three).

## Score arithmetic, code mode

1. Start at 100.
2. Subtract the `trust_deduction` of each finding that has one (table in [Rules](rules.md)).
3. Subtract the risk deduction: 20 if the CRITICAL pattern matched, plus 10 if the HIGH pattern matched (both add up when both match), or 5 if only the MEDIUM pattern matched. Subtract a further 10 or 5 when `risk_hint` raised the level to CRITICAL or HIGH.
4. Floor to an integer and clamp to 0 to 100.
5. Add the evidence bonus, capped at 100 overall. The bonus is +5 for each of `test_log`, `build_log` and `diff` that is non-empty and does not contain the words FAIL, ERROR, failed or `error:` (case-insensitive), plus +5 if at least one evidence reference is well formed and is not a failed command, capped at +15. A test log with a negative-test name such as "rejects error case" loses its bonus because it contains the word "error".
6. Subtract policy deductions: 25 for `AX503` (migration without rollback), 20 for `CL403` (low LLM confidence).

The result is `trust_score`. The `score_breakdown` object in the output restates the pieces, but it is informational. It can disagree with `trust_score`: deductions the overconfidence-language rules compute (the `overconfidence_deductions` field) are subtracted in `score_breakdown.final` and never in `trust_score`. For example, the text "Definitely all good, completely done. All tests pass and it is production-ready." as a `design` gave `trust_score` 60 and `score_breakdown.final` 45. Treat `trust_score` and `verdict` as authoritative.

Plan mode starts at 100, subtracts finding deductions, adds +5 per covered locked criterion (capped at +15), and subtracts any falsification-stage deductions (that stage cannot be reached through the public API, see [Rules](rules.md#plan-mode-rules)). It does not apply the evidence bonus.

## Policy rules

After scoring, a fixed policy can override the verdict (code mode):

| Policy | Effect |
|---|---|
| Mandatory Property evidence missing or failing (`PMUST-*`) | `BLOCK` regardless of score |
| `AX501` destructive command without adjacent confirmation | `BLOCK` |
| An extension finding that is blocking and requires `BLOCK` | `BLOCK` |
| `AX502` production deployment at HIGH or CRITICAL risk | at least `ESCALATE_TO_REVIEWER` |
| Auth change without an unauthorized-access test (`TW205`) | at least `ESCALATE_TO_REVIEWER` |
| `CL402` hedging language at HIGH or CRITICAL risk | at least `ESCALATE_TO_REVIEWER` |
| LLM confidence below 0.6 at MEDIUM or higher risk (`CL403`) | at least `ESCALATE_TO_REVIEWER` and 20 points off |
| `AX105` HIGH or CRITICAL risk with a HIGH or CRITICAL missing-evidence finding | at least `REVISE` |
| `AX503` migration without rollback plan | at least `REVISE`, 25 points off |

## Risk

Seal classifies risk from the text of `output` plus `evidence.diff` (the whole text, not only changed lines):

| Level | Matched words |
|---|---|
| CRITICAL | DROP TABLE, delete ... production, rm -rf, irreversible, PII, personal data, health data, financial record, legal liability or compliance, payment, billing |
| HIGH | auth, authentication, authorization, JWT, OAuth, sudo, admin, privilege, chmod |
| MEDIUM | migration, rollback, schema change, token, session, password (only if neither HIGH nor CRITICAL matched) |

The default is `MEDIUM`. The classifier never returns `LOW`, and `risk_hint` can raise the level but never lower it. Risk matters because several rules apply only at MEDIUM or higher, and a few only at HIGH or higher.

## Evidence

Evidence comes in two forms.

**Text fields.** `test_log`, `build_log` and `diff` are free text. Seal searches them with regular expressions, for example for assertion names that match your spec, or for the words "unauthorized" or "401" in a test log. It does not parse a particular test runner's format.

**References.** `evidence.references` is a list of envelopes:

| `type` | Required fields |
|---|---|
| `file` | `path`, `line`, `snapshot` |
| `command` | `command`, `exit_code`, `output` |
| `url` | `url`, `retrieved_at`, `content_snapshot` |
| `text` | `label`, `content` |
| `memory` | `memory_key`, `retrieved_at`, `content_snapshot` |

A malformed envelope is a MEDIUM finding. A `command` envelope with a non-zero `exit_code` is a HIGH finding ("Command failed with exit_code N"). `review()` checks envelopes in "portable" mode: `file` envelopes are checked for structure only and are not read from disk. A command envelope whose command contains "test", "spec", "jest", "vitest" or "pytest" counts as test evidence for rule `E001`; one containing "build", "compile", "make", "gradle", "maven" or "tsc" counts as build evidence for `E002`.

## Trust memory

Trust memory is an optional, in-process record of past verdicts per agent id. It produces a reliability score, a drift trend and a review count, returned as `trust_memory_summary` on the verdict. **It never changes the verdict or the score.** It is not wired into the CLI. See [Library API](api.md#trustmemory).

Reliability score: each stored review contributes `0.7 x verdict score + 0.3 x trust_score`, where the verdict scores are PASS 100, PASS_WITH_WARNINGS 80, REVISE 50, ESCALATE_TO_REVIEWER 20, BLOCK 0. Newer reviews weigh more (linear weights 1 to n). The result is rounded. Drift trend compares the average trust score of the earlier half of the history with the later half, split at the midpoint in time: a difference above 15 is "improving", below -15 is "degrading", otherwise "stable". Defaults: 50 reviews kept per agent, threshold 15.

## Optional LLM overlay

An LLM reviewer can be registered to cover layer L2. It returns suspected issues, missing requirements, edge cases and evidence gaps. These are listed as findings but do not change the score or the verdict, with one exception (`CL403`). Read [LLM overlay](llm-overlay.md) before using it, including what text leaves your machine.

## What Seal assumes

- The text is the evidence. A claim is "supported" when a matching word appears in the right field, not when it is true.
- Keyword rules can be wrong in both directions. Treat a `PASS` as "no rule objected", and a failure as "a rule objected, check why".
