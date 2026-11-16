# Agent hooks and Orca

This page covers the **agent and git workflow**: Seal running unattended inside an agent loop. None of it is needed for the [local workflow](../README.md#two-ways-to-use-seal), and nothing in the CLI or library depends on it.

Seal is a heuristic filter, not a security boundary. An agent can phrase its output to avoid the keyword rules. Use hooks as a tripwire next to real controls (tests, review, permissions), not instead of them.

## Seal has no GitHub integration

Seal reads files and strings. It does not call GitHub, open issues, comment on pull requests or run as a review bot. The repository's `.github/workflows/ci.yml` is the project's own test job. If your pipeline uses GitHub issues, review bots or pull requests, that is done by other tools (Orca has optional GitHub commands) and they call Seal, not the other way round.

## Hooks in the repository

The repository has a `hooks/` directory. **It is not included in the npm package** (the package ships `dist`, `src`, `docs` and `USAGE.md`). To use the hooks, clone the repository and point your agent's settings at the scripts. The TypeScript hooks need Bun, and they import `../src/index.ts`, so they run from inside a checkout.

The hook below is a worked example: its header comments contain example paths such as `~/work/seal-gate` that you must replace. Adapt it before use.

| Hook | Host | Event | What it does |
|---|---|---|---|
| `claude-pre-tool-use.sh` | Claude Code | PreToolUse | Blocks destructive shell commands before they run. |

### claude-pre-tool-use.sh

A shell script that reads the Claude Code hook JSON on stdin (`tool_name`, `tool_input.command`), needs `bash` and `jq`, and does not call the Seal library. It only inspects the `Bash` tool; every other tool passes. For a match it prints `{"decision":"block","reason":"..."}` and exits 0; otherwise it prints nothing.

| Rule in the script | Blocks |
|---|---|
| `AX501` | DROP TABLE, rm -rf, rm -r on an absolute path, rmdir with a path, DELETE FROM ... WHERE at the end of the line, truncate |
| `AX502` | git push --force, git reset --hard, git branch -D, git clean -fd |

Tested: a destructive git command and an rm -rf command are blocked, a harmless `ls -la` prints nothing, and a `Write` tool call containing rm -rf text is not blocked (by design). Two things to know: the `AX502` here means "destructive git", while the library's `AX502` means "production deployment"; and the message says "use seal gate override", but no such override exists in the code.

## Orca

Orca is a separate tool (`@gotako/orca` on npm) for a spec-driven workflow: intent, spec, design, plan, test-first implementation, verify, archive. Its README states that the normal workflow uses local files and needs no GitHub account, `gh` command or network connection; GitHub issue integration is optional. Seal is its quality gate. The following was read from the source of the published `@gotako/orca@1.7.0-beta.0` (`dist/harness/gate-plan.js` and `gate-code.js`):

- `orca gate-plan <name>` runs `Seal.review` in-process as `plan_review` on the change's `plan.json` or `tasks.md`. It refuses to run unless `intent.md` has a `## Intent Approval` section with `Status: APPROVED`. The locked criteria are the bullets under `## Success Criteria` in `intent.md`, numbered `SC-1`, `SC-2` and so on, saved to `.harness/locked-criteria.json`; `intent.md` is also passed as the spec. The verdict is written to `.harness/gate-verdicts/<timestamp>-plan.json`.
- `orca gate-code <name>` runs `Seal.review` as `code_diff` on the current diff. It needs a `self-check.md`. The test log and command receipts come from the evidence entries in that file (the test log is the output of the first evidence entry whose command contains "test"); the spec comes from the change's `specs/*/spec.md`. It keeps a `TrustMemory` in `.harness/trust-memory.json` (agent id `orca-agent`), binds the verdict to the SHA-256 of the diff, and for specs with mandatory Properties it supplies a trusted verifier (see [Mandatory Property evidence](property-evidence.md)). It also runs the mutation probe over tests listed in `plan.json`.
- `--llm` on both commands registers an LLM reviewer through Orca's own option handling (read from the Orca 1.7.0-beta.0 source, which bundles the older `seal-gate` 0.6.0-beta.0; not re-checked against this release). For `gate-plan` it has no effect, because plan reviews ignore the reviewer (see [LLM overlay](llm-overlay.md)).

Orca ships its own copy of Seal as a tarball inside its package: the dependency list of `@gotako/orca@1.7.0-beta.0` names `seal-gate` as `file:vendor/seal-gate-0.6.0-beta.0.tgz`. The previously published `seal-gate@0.5.0` returns the old verdict name `ESCALATE_TO_HUMAN` (its `dist` contains that name and not `ESCALATE_TO_REVIEWER`). Orca 1.7.0-beta.0 maps the old name to the new one wherever a verdict enters Orca, so both names are accepted there. If you read verdict files or Seal output in your own scripts, accept both names too.

See [Family](family.md) for the other tools.

## A Claude Code skill

The repository also has `.claude/skills/seal/SKILL.md`, a prompt-level checklist ("verify claims, evidence, and correctness before proceeding") for an agent to read. It is plain instructions, not code, and it is not part of the npm package. The `.claude/plugin.json` next to it is out of date (version 0.2.0, local paths).
