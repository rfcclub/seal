# seal-gate

Seal is a quality gate for AI output. You give it a piece of text (an agent's summary of its work, a description of a code change, a plan, a design) and, optionally, evidence such as a test log, a build log or a diff. It returns a verdict (`PASS`, `PASS_WITH_WARNINGS`, `REVISE`, `ESCALATE_TO_REVIEWER` or `BLOCK`), a trust score from 0 to 100, and a list of findings.

The core is deterministic: regular expressions and fixed rules, no network, the same input gives the same verdict. An optional LLM reviewer can be added on top for a second opinion. The package ships a CLI (`seal`) and a TypeScript library.

This is a beta release (`0.6.0-beta.1`). Behaviour is described below as verified against the source and a build of this branch; known problems are listed plainly in [Known limitations](#known-limitations).

## What Seal is, and what it is not

Seal is:

- a set of heuristic checks on text: missing evidence for a claim, a bug fix without a regression test, a destructive command with no confirmation, a migration with no rollback plan, a plan that contradicts itself, and similar;
- a verdict you can wire into a script, a hook or an agent loop so that something stops or goes back for revision;
- usable with plain files and no account of any kind.

Seal is not:

- a test runner, linter, type checker or static analyzer. It never runs your code and does not read your repository. The CLI reads only the files you name;
- a proof of correctness. It looks at words. The regression check (TW203) wants a recorded failing run followed by a passing run of the same test, but it reads that from text, so it cannot tell a real run from a pasted one;
- a GitHub tool. Seal has no GitHub integration. Orca, a separate tool, has optional GitHub commands (see [Family](docs/family.md)).

## Install

Requirements: Node.js `>=22.5.0`. The `seal` command and the library run on every Node version in that range (the CLI was checked by hand on 22.12.0, 22.17.1, 22.18.0, 23.11.0, 24.1.0 and 24.2.0, and the quick start below was run on Node 26.5.0). Both also work under Bun 1.3.14. Releases before `0.6.0-beta.1` printed nothing on some Node versions; see [Troubleshooting](docs/troubleshooting.md#fixed-problems).

```sh
npm install seal-gate@beta        # in a project
npx seal --version                # prints seal v<installed version>
```

`npm install -g seal-gate@beta` gives you a global `seal` command (same package; only the project-local install was tested).

## Quick start

Everything here was run in an empty directory with no GitHub, no API key and no agent. It was run against a package built from this branch (`npm pack` of `0.6.0-beta.1`, installed from the tarball in place of `npm install seal-gate@beta`), not against the published package, so the printed version is `0.6.0-beta.1`; the `@beta` tag may still point at an older release until this one is published.

Create three small files:

```sh
mkdir seal-demo && cd seal-demo
npm init -y
npm install seal-gate@beta

printf 'Added a helper that trims whitespace from user names.\n' > change.md

cat > plan.md <<'EOF'
# Plan

## Goals

- Trim whitespace from user names (AC-1)
- Reject empty names (AC-2)

## Steps

1. Implement the trim helper.
2. Add one test for each of AC-1 and AC-2.
EOF

cat > criteria.json <<'EOF'
[
  { "id": "AC-1", "text": "Trim whitespace from user names" },
  { "id": "AC-2", "text": "Reject empty names" }
]
EOF
```

**1. Review a text artifact.** `review` lets you pick the artifact type. A `design` has no test-evidence rule, so a plain description passes:

```sh
npx seal review change.md --artifact-type design
echo $?
```

```text
Seal reviewing change.md (design)...

┌─ Seal v0.6.0-beta.1 Verdict ──────────────────────┐
│  PASS  (trust: 100)  ██████████
│  Risk: MEDIUM
│  PASS (trust_score=100, risk=MEDIUM): 0 blocking, 1 non-blocking, 0 fabricated
│
│  Non-blocking:
│    ⚠ [undefined] L2 unreviewed — semantic issues may exist
│  Next: Proceed
└────────────────────────────────────────────┘
0
```

The `[undefined]` is a cosmetic bug: that finding has no rule id. The finding itself is the standing note that no LLM reviewed the semantics.

**2. Review a code change.** `code` treats the file as a code change summary:

```sh
npx seal code change.md
echo $?
```

It returns `REVISE` (trust 85), one blocking finding `TW201` ("Implementation artifact has no test evidence"), and exit code 1. This is expected, not a mistake in your file: **the CLI sends no test log, build log or diff, and has no option to supply them**, so `seal code` and `seal <file>` can never reach `PASS`. To give Seal evidence, use the [library](docs/api.md).

**3. Review a plan against locked acceptance criteria.**

```sh
npx seal plan plan.md --locked-criteria criteria.json     # PASS, trust 100, exit 0
npx seal plan plan.md                                     # ESCALATE_TO_REVIEWER, exit 1
```

Without locked criteria, Seal cannot measure coverage, so it escalates (finding `PR002`).

**4. Machine-readable output.**

```sh
npx seal review change.md --artifact-type design --json
```

This prints the full verdict object (fields in [CLI reference](docs/cli.md#json-output)). Use `--json` in scripts; the formatted output always contains terminal colour codes, even when `NO_COLOR` is set.

**5. Use the library with evidence.** Save as `lib.mjs`:

```js
import { Seal } from 'seal-gate'

const verdict = await Seal.review({
  artifact_type: 'code_diff',
  spec: null,
  output: 'Added a helper that trims whitespace from user names.',
  evidence: {
    test_log: 'PASS trims whitespace\nPASS rejects empty name: error case',
    build_log: 'tsc: 0 errors',
    diff: '',
    references: [],
  },
  risk_hint: null,
})
console.log(verdict.verdict, verdict.trust_score, verdict.risk_level)
console.log(verdict.next_action)
```

```text
PASS 100 MEDIUM
Proceed
```

Remove the `test_log` line and the same call returns `REVISE` with `TW201`.

**6. Optional: the LLM overlay, against a server on your own machine.** The reviewer needs no third-party account: any OpenAI-compatible endpoint works, and Seal has no default provider. [LLM overlay](docs/llm-overlay.md#try-it-without-any-account) has a 20-line fake reviewer (`fake-llm.mjs`) to run locally. With it listening on port 8787:

```sh
npx seal review change.md --artifact-type design \
  --llm --llm-base-url http://127.0.0.1:8787/v1 --llm-model local
```

```text
│  PASS  (trust: 100)  ██████████
│  Non-blocking:
│    ⚠ [undefined] Empty-name handling is not described
```

The reviewer's finding is listed but the verdict is unchanged (see [what the reviewer can change](docs/llm-overlay.md#what-the-reviewer-can-change)). Without `--llm-base-url` and `--llm-model` (or `SEAL_LLM_BASE_URL` and `SEAL_LLM_MODEL`) the command exits 2 with "Nothing was sent".

## Two ways to use Seal

**Local workflow (the default).** Plain files in, verdict out. You run `seal` or `Seal.review()` yourself or from your own scripts. It needs no GitHub, no agents, no API key and no network. Everything in the quick start above is this workflow. Start with [Concepts](docs/concepts.md), [CLI reference](docs/cli.md) and [Library API](docs/api.md).

**Agent and git workflow (optional).** Seal sits inside an unattended agent loop: Claude Code or Qwen Code hooks that gate tool calls and final messages, or the Orca harness calling Seal on plans and code diffs, possibly in a pipeline that also uses GitHub issues and review bots. Seal itself does not talk to GitHub; the GitHub parts belong to Orca. See [Agent hooks and Orca](docs/agent-hooks.md) and [Family](docs/family.md). The optional LLM reviewer is a separate opt-in and sends text to whichever OpenAI-compatible endpoint you configure; read [LLM overlay](docs/llm-overlay.md) before enabling it.

## Documentation

| Page | Contents |
|---|---|
| [Concepts](docs/concepts.md) | Artifact types, verdicts, score and bands, risk, evidence, trust memory |
| [CLI reference](docs/cli.md) | Every command, option, exit code and the JSON output |
| [Rules](docs/rules.md) | Every rule id, what it checks, deduction and effect |
| [LLM overlay](docs/llm-overlay.md) | Endpoint configuration, key handling, modes, exactly what is sent, a local demo |
| [Library API](docs/api.md) | `Seal`, `TrustMemory`, extensions, types, what is and is not public |
| [Mandatory Property evidence](docs/property-evidence.md) | The blocking policy for Property blocks in specs |
| [Python](docs/python.md) | Calling Seal from Python |
| [Agent hooks and Orca](docs/agent-hooks.md) | Hooks and the agent/git workflow |
| [Family](docs/family.md) | Orca, Pilotfish, Hammerhead and how they relate |
| [Troubleshooting](docs/troubleshooting.md) | Symptoms, causes, and the full list of known problems |

## Known limitations

- **The CLI cannot supply evidence**, so `seal code` always returns at least `REVISE` (`TW201`).
- **The optional LLM reviewer does not change the verdict**, except through one low-confidence rule (`CL403`). It is ignored for plan reviews. If no key variable is named, `--llm` still sends your text to the endpoint you configured, without an `Authorization` header. See [LLM overlay](docs/llm-overlay.md).
- `--risk` only accepts upper-case values (`HIGH`, not `high`), contrary to the help text.
- `--agent-id` has no effect in the CLI; trust memory works only through the library.
- Overconfidence-language deductions are reported in `score_breakdown` but never lower `trust_score`.
- The npm package does not include `hooks/`, and it does include the test files under `src/drift/__tests__`. `dist/adapters/openai-provider.js` is present but not exported from the entry point and is unsupported.
- There is no Python package. See [Python](docs/python.md).

More detail and the remaining items are in [Troubleshooting](docs/troubleshooting.md#known-problems).

## License

MIT. See [LICENSE](LICENSE).
