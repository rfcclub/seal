# Rules

Every finding Seal produces comes from a rule. This page lists them, what each checks, and what it costs. All rules are keyword or pattern checks on text. "Blocking" means severity HIGH or CRITICAL. "Deduction" is the number of trust-score points removed (see [Concepts](concepts.md#score-arithmetic-code-mode)); "none" means the rule has no deduction of its own.

Rules marked "run" were triggered in test runs of `0.6.0-beta.0`. `0.6.0-beta.1` changes only the CLI argument handling and the LLM adapter, not the rules. Rules marked "from source" are described from reading the code only.

Claims are extracted from `output` and skip anything inside a code fence (triple backticks) or inline code (single backticks). The overconfidence-language rules (`CL-*`) do not skip fenced text.

## Evidence rules (code mode)

These apply to phrases Seal treats as claims. A claim is found by phrase, not by meaning.

| Rule | Severity | Deduction | Triggers when | Fix |
|---|---|---|---|---|
| `E001` | HIGH, blocking | 20 | The text claims tests passed (phrases: "all tests pass(ed)", "test(s) pass(ed)", "verified", "tested") and there is no `test_log` text and no `command` reference whose command matches test, spec, jest, vitest or pytest. Note the single words "verified" and "tested" are enough. (run) | Supply a test log or a command receipt. |
| `E002` | MEDIUM | 15 | The text claims a build ("build succeeded", "compiled", "build passed", "build is clean/green") with no `build_log` and no command reference matching build, compile, make, gradle, maven or tsc. (from source) | Supply a build log. |
| `E003` | HIGH, blocking | 20 | The text makes a security claim ("no security impact", "no risk of breach/exploit/injection/attack", "safe to deploy/release/merge", "security-free/cleared", "no auth/security change/impact/risk") with no test log mentioning security, auth, unauthorized, pentest or vuln, and no text reference labelled "security". (run) | Supply security test evidence. |
| `E004` | CRITICAL, blocking | 20 | The text claims production readiness ("production-ready", "ready for production/deploy/release") at MEDIUM or higher risk, with no references and no test log. (run) | Supply evidence. |

Claims of other kinds (implemented, fixed, completed, resolved, built, deployed; compatibility; generic words such as "definitely") are recognised but have no evidence rule of their own.

Evidence-envelope findings have no rule id (they print as `[undefined]` in the CLI): a malformed envelope is a MEDIUM `MISSING_EVIDENCE` finding, and a `command` envelope with a non-zero `exit_code` is a HIGH, blocking one (run).

## Test-weakness rules (code mode)

| Rule | Severity | Deduction | Triggers when |
|---|---|---|---|
| `TW201` | HIGH, blocking | 15 | `artifact_type` is `code_diff` or `llm_response` and `test_log` is empty. (run) |
| `TW202` | MEDIUM | 10 | Risk is MEDIUM or higher, `test_log` is non-empty, and it contains none of: fail, error, exception, invalid, unauthorized, forbidden, edge, negative, reject, timeout, backoff (whole words, any case). I.e. "happy path only". (run) |
| `TW203` | HIGH, blocking | none | The text contains fix, fixed, bug, defect or regression, `test_log` is non-empty, and the log contains none of: regression, repro, original bug, fixed case. (run) See [issue #16](https://github.com/rfcclub/seal-gate/issues/16). |
| `TW204` | MEDIUM | none | The text mentions retry, retries, exponential backoff, timeout or circuit breaker, `test_log` is non-empty, and it has none of the `TW202` words. (run) |
| `TW205` | CRITICAL, blocking | none; the policy escalates | The HIGH-risk pattern (auth, authentication, authorization, JWT, OAuth, sudo, admin, privilege, chmod) matches anywhere in `output` plus `diff`, `test_log` is non-empty, and it contains none of: unauthorized, forbidden, 403, 401, permission denied, access denied, exhausted, "no candidate/access/permission", "not allowed/permitted/authorized", "reject(ed) access/action/request". Result: at least `ESCALATE_TO_REVIEWER`. (run) See [issue #17](https://github.com/rfcclub/seal-gate/issues/17). |

TW203, TW204 and TW205 stay silent when `test_log` is empty; `TW201` covers that case.

### Why TW203 and TW205 are known to be wrong

Both issues are open. Each was reproduced against `0.6.0-beta.0`:

- **TW203** ([#16](https://github.com/rfcclub/seal-gate/issues/16)) tests the log for the word, not for evidence that a test failed before the fix and passed after. A log of passing tests that never says "regression" raises `TW203`. A log that is only the word "regression" satisfies it. The trigger side is also loose: any mention of "fix" or "bug" in the text counts as a bug-fix claim.
- **TW205** ([#17](https://github.com/rfcclub/seal-gate/issues/17)) decides "this is an auth change" from the whole `output` and `diff` strings, including unchanged context lines and removed lines. A diff whose only change deletes a comment containing the word "auth" classified the review as HIGH risk and escalated it to `ESCALATE_TO_REVIEWER`. The same classification adds 10 points of risk deduction.

Until these are fixed, treat both findings as prompts to look, not as evidence.

## Overconfidence-language rules (code mode)

| Rule | Severity | Triggers when |
|---|---|---|
| `CL402` | HIGH, blocking; policy escalates | Risk is HIGH or CRITICAL and the text contains a hedge: probably, should work, seems, might, appears to, I think. Result: at least `ESCALATE_TO_REVIEWER`. (run) |
| `CL-B01` | MEDIUM | "verified correct", "bug-free", "guaranteed" or "all tests pass" with no `test_log`. Usually a claim phrase is already caught by `E001` and the group rule is skipped for the same span. (run) |
| `CL-C01` | HIGH, blocking | "secure", "no security impact" or "no vulnerabilit(y/ies)" with no test log mentioning security, auth, unauthorized, pentest, vuln, safe or protect. (run) |
| `CL-D02` | HIGH, blocking | "no breaking change(s)" (and similar compatibility phrases not already claimed) with no `diff`. (run) |
| `CL-D01` | HIGH | Intended for compatibility claims with endpoint or migration changes and no evidence. As written it cannot fire, because it needs endpoint changes parsed from a diff and also "no diff". (from source) |
| `CL-E01` | HIGH, blocking | "ready to ship", "deploy-ready" and similar at HIGH or CRITICAL risk with no test log, build log, diff or references. (run) |
| `CL401` | advisory note | Any overconfident phrase and no evidence at all. Appears in `advisory_notes`, not as a finding. (run) |

A fourth group, "completeness" ("fully implemented", "fully tested/working/functional", "handles all (edge) cases", "100% complete") and a generic word list (definitely, all good, no issues, completely) add to the overconfidence total but produce no finding.

**Known problem: the deductions never reach the score.** The detector computes 5 points per overconfident phrase and extra points for the CL-B/C/D/E rules, but it does not attach them to the findings, so they appear only in `score_breakdown.overconfidence_deductions` and `score_breakdown.final`, never in `trust_score`. A `CL-C01` finding can leave `trust_score` at 100 while the verdict is `REVISE` (run). Blocking findings still raise the verdict.

## Spec rules (code and plan mode)

| Rule | Severity | Deduction | Triggers when |
|---|---|---|---|
| `SC301` | MEDIUM | 10 each, 20 total | Used when `test_log` is empty, and in plan mode. For each bullet line (`- ...` or `* ...`) of the spec, none of its words of 4 or more characters appears in `output`. (run) |
| `SC302` | LOW | none | The spec has at least one heading and `output` has a heading (levels 1 to 3) that the spec does not. (run) |
| `SV101` | MEDIUM | 10 each, 20 total | Used instead of `SC301` when `test_log` is non-empty. A bullet longer than 10 characters is "covered" if its `AC-n`, `REQ-n` or `CRITERION-n` id appears in the test log or diff; or an assertion, `test(...)`, `it(...)`, `describe(...)` or `// covers:` line contains its first significant word; or at least half of its significant words appear in the log. (run) |
| `TE201` | MEDIUM | 8 each, shared 20 cap | Only from `SpecCoverageValidator.validateWithProbe()` (library), which runs a mutation probe on a test file. `Seal.review()` does not call it. (from source) |
| `PMUST-01` to `PMUST-04` | HIGH, blocking | none; forces `BLOCK` | Mandatory Property evidence. See [Mandatory Property evidence](property-evidence.md). (`PMUST-01` run) |

## Policy rules (code mode)

These are added after scoring and can change the verdict (see [Concepts](concepts.md#policy-rules)).

| Rule | Severity | Triggers when | Effect |
|---|---|---|---|
| `AX105` | HIGH | Risk is HIGH or CRITICAL and some finding is a HIGH or CRITICAL `MISSING_EVIDENCE` (for example `E004`). (run) | at least `REVISE` |
| `AX501` | CRITICAL | The text contains DROP TABLE, rm -rf, DELETE FROM, TRUNCATE TABLE, "format /" or fdisk, and none of "requires (human) confirmation/approval/review", "please confirm", "must approve/confirm" within 150 characters on either side of the first such match. (run) | `BLOCK` |
| `AX502` | HIGH | The text says deploy(ing) to prod(uction), push to production, go live or release to prod(uction), and risk is HIGH or CRITICAL. (run) | at least `ESCALATE_TO_REVIEWER` |
| `AX503` | CRITICAL, 25 points | `artifact_type` is `migration` or the text contains migration, migrate or schema change, and neither `output` nor `diff` has a rollback plan phrase (rollback plan/script/procedure/step, revert migration/schema/change, down migration, migration rollback). (run) | at least `REVISE` |
| `CL403` | MEDIUM, 20 points | The LLM reviewer reported confidence below 0.6 and risk is MEDIUM or higher. (run) | at least `ESCALATE_TO_REVIEWER` |

The policy also escalates for a `TW205` finding and for a `CL402` finding (rows above). It does not apply to plan mode: `AX501` to `AX503` are skipped for `plan_review`.

The rule ids `AX501` and `AX502` also appear in the shell hook `hooks/claude-pre-tool-use.sh`, where `AX502` means a destructive git command, not production deployment. See [Agent hooks](agent-hooks.md).

## Plan-mode rules

Plan mode runs these four stages on a `plan_review` artifact.

| Rule | Severity | Deduction | Triggers when |
|---|---|---|---|
| `PR001` | HIGH, blocking, requires `BLOCK` | 20 | Two different sections (headings level 1 to 4) conflict: one contains "writes/modifies/overwrites/creates ..." and another contains "... is read-only/append-only/immutable"; or one says "removes/deletes/drops ..." and another "requires/depends on/needs ..."; or a step-ordering pattern. The pairs are matched by phrase only, not by whether they name the same object. Also a non-goal violation: a "Non-goals: X" line and, three or more lines away, "shall/will/must/implement Y" where X and Y share a word. Code blocks and inline code are ignored. (run) |
| `PR002` | MEDIUM, requires `ESCALATE_TO_REVIEWER` | 15 | No locked criteria were supplied. (run) |
| `PR002` | MEDIUM, requires `REVISE` | 10 each | A locked criterion is not covered. A criterion is covered if its id appears in the artifact (case-insensitive), or at least half of its words longer than 4 characters (leaving out shall, must, should, when, then, given, that, this, with) appear in the artifact. Each covered criterion adds +5 to the score, capped at +15. (run) |
| `PR003` | LOW | 5 | Intended: a claim with no traceability anchor (REQ-n, AC-n, intent.md, and so on). **Dead in this release:** plan mode extracts no claims, so it never fires. (from source) |
| `PR004:<probe>` | MEDIUM or HIGH, never blocking | 3 or 8 | Four LLM "falsification" probes (failure_mode, assumption_collapse, missing_step, reversibility). **Unreachable from the public API:** the function that registers the probe adapter is not exported, and `--llm` is ignored for plan reviews. (from source) |

Plan-mode policy rules are added after those stages:

| Rule | Severity | Triggers when | Resulting verdict |
|---|---|---|---|
| `PR-HB-01` | CRITICAL | The text says it removes a BLOCK or ESCALATE (within 20 characters). | `BLOCK` (run) |
| `PR-HB-02` | CRITICAL | The text amends axiom, soul, identity, 0_SOUL or AGENTS and does not contain the word "protocol". The finding text refers to an "Amendment Protocol" document (`0_SOUL/axioms.md`) that does not ship with this package. | `BLOCK` (run) |
| `PR-HB-03` | HIGH | The text has DROP TABLE, rm -rf, DELETE FROM, TRUNCATE TABLE or "irreversible" with none of "requires human/approval/confirmation", "sign-off", "gate", "checkpoint". | `BLOCK` (run) |

The source intends `PR-HB-01` and `PR-HB-02` to escalate and `PR-HB-03` to ask for a revision, but because the injected findings are blocking and plan mode turns any blocking finding into `BLOCK`, all three end as `BLOCK`.

Plan mode uses the same risk classifier as code mode. At HIGH risk, a score from 71 to 89 escalates instead of passing with warnings.

## Rule activation table

The source contains a table of which rules are "activated" per artifact type, but nothing reads it. The conditions written in each rule above decide what runs, not the table.

## Extensions

Extensions add findings from your own code. See [Library API](api.md#extensions). One is in the package source. It is not exported from the package entry point and is not a stable API.

| Rule | Extension | Applies when `context.agent_role` is | Checks | Effect |
|---|---|---|---|---|
| `CG-LOW-CONFIDENCE`, `CG-EXCESSIVE-QUESTIONS` | context-guard | any (reads `context.context_guard`) | Reply produced under low context confidence; three or more clarifying questions | MEDIUM and LOW |

Extension findings do not change `trust_score`. In code mode, a blocking extension finding that requires `BLOCK` makes the verdict `BLOCK`; any other blocking extension finding makes it at least `REVISE`. Extension rule descriptions above come from the source and the existing test suite; not every extension rule was run by hand.
