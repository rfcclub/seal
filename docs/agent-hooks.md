# Agent hooks and Orca

This page covers the **agent and git workflow**: Seal running unattended inside an agent loop. None of it is needed for the [local workflow](../README.md#two-ways-to-use-seal), and nothing in the CLI or library depends on it.

Seal is a heuristic filter, not a security boundary. An agent can phrase its output to avoid the keyword rules. Use hooks as a tripwire next to real controls (tests, review, permissions), not instead of them.

## Seal has no GitHub integration

Seal reads files and strings. It does not call GitHub, open issues, comment on pull requests or run as a review bot. The repository's `.github/workflows/ci.yml` is the project's own test job. If your pipeline uses GitHub issues, review bots or pull requests, that is done by other tools (Orca has optional GitHub commands) and they call Seal, not the other way round.

## Hooks in the repository

The repository has a `hooks/` directory. **It is not included in the npm package** (the package ships `dist`, `src`, `docs` and `USAGE.md`). To use the hooks, clone the repository and point your agent's settings at the scripts. The TypeScript hooks need Bun, and they import `../src/index.ts`, so they run from inside a checkout.

These hooks were written for one specific agent setup: they hard-code agent names (`agent`, `beta`, `qwen`), and their header comments contain example paths such as `~/work/seal-gate` that you must replace. Treat them as worked examples to adapt.

| Hook | Host | Event | What it does |
|---|---|---|---|
| `claude-pre-tool-use.sh` | Claude Code | PreToolUse | Blocks destructive shell commands before they run. |
| `claude-stop-hook.ts` | Claude Code | Stop | Reviews the last assistant message; blocks the stop on `BLOCK` or escalation. |
| `qwen-post-tool-use.ts` | Qwen Code | PostToolUse | Reviews tool results. |
| `qwen-stop-hook.ts` | Qwen Code | Stop | Reviews the final message for generic-AI self-description and ungrounded claims. |
| `qwen-drift-guard.ts` | Qwen Code | (library function) | Experimental drift check. **Broken as shipped**, see below. |

### claude-pre-tool-use.sh

A shell script that reads the Claude Code hook JSON on stdin (`tool_name`, `tool_input.command`), needs `bash` and `jq`, and does not call the Seal library. It only inspects the `Bash` tool; every other tool passes. For a match it prints `{"decision":"block","reason":"..."}` and exits 0; otherwise it prints nothing.

| Rule in the script | Blocks |
|---|---|
| `AX501` | DROP TABLE, rm -rf, rm -r on an absolute path, rmdir with a path, DELETE FROM ... WHERE at the end of the line, truncate |
| `AX502` | git push --force, git reset --hard, git branch -D, git clean -fd |

Tested: a destructive git command and an rm -rf command are blocked, a harmless `ls -la` prints nothing, and a `Write` tool call containing rm -rf text is not blocked (by design). Two things to know: the `AX502` here means "destructive git", while the library's `AX502` means "production deployment"; and the message says "use seal gate override", but no such override exists in the code.

### claude-stop-hook.ts

Reads the Stop hook input (`transcript_path`), takes the last assistant message and the last six user and assistant turns, runs `Seal.review` as `llm_response` with the Alpha extension, and prints `{"decision":"block","reason":...}` if the verdict is `BLOCK`, `ESCALATE_TO_REVIEWER` or `ESCALATE_TO_HUMAN`. It is fail-open: bad input, a missing transcript or any error ends with exit 0 and no output (tested with a missing transcript).

Things to know before you enable it:

- **The LLM overlay is off unless you enable it.** The hook registers a reviewer only when both `SEAL_LLM_BASE_URL` and `SEAL_LLM_MODEL` are set in the environment the hook runs in; `SEAL_LLM_KEY_ENV` (the name of the variable that holds the key) is optional. Nothing is hard-coded: no vendor, URL, model or key variable. With the two variables unset, no reviewer is registered and nothing leaves your machine.
- When it is enabled, it sends the last six user and assistant turns (as the spec) and the last assistant message (as the output) on every Stop to **whatever endpoint you configured**, so use an endpoint you trust with your conversation. If you name a key variable and it is unset, the reviewer fails before any request and the review carries a LOW "LLM reviewer failed" finding. See [LLM overlay](llm-overlay.md).
- It hard-codes `agent_id` and `agent_role` to `agent`.
- Evidence is always empty, so `TW201` (no test evidence) is always present. That is only `REVISE`-level, so it does not block by itself.
- The `reason` it reports is the evidence text of the first blocking finding. That is often `TW201` rather than the rule that actually caused the `BLOCK` (see the Qwen stop hook run below).

### qwen-post-tool-use.ts and qwen-stop-hook.ts

The post-tool-use hook reviews results of `Write`, `Edit`, `MultiEdit`, `Bash`, `Shell` and `Test` tools and skips all others. It chooses the artifact type from the tool name, raises the risk hint from keywords in the output (delete, rm -rf, drop table: CRITICAL; auth, password, token, migration: HIGH) and returns `continue: false` for `BLOCK` and escalations. It uses `agent_id` `qwen` and role `beta`. Not run: described from the source.

The stop hook reads `last_assistant_message` and applies the Beta extension. Tested with "As an AI language model, I do not have feelings." Result: `{"continue":false,...,"decision":"block"}` with the reason "Implementation artifact has no test evidence" (the `TW201` text), not the identity-bleed finding that caused the block.

### qwen-drift-guard.ts

It imports `../drift/index.ts` and `../drift/drift-db.ts`, but those files are in `../src/drift/`, so the import fails from the `hooks/` directory. It is also unfinished (a TODO says it does not parse its own config file). Do not use it as it stands.

## Orca

Orca is a separate tool (`@gotako/orca` on npm) for a spec-driven workflow: intent, spec, design, plan, test-first implementation, verify, archive. Its README states that the normal workflow uses local files and needs no GitHub account, `gh` command or network connection; GitHub issue integration is optional. Seal is its quality gate. The following was read from the source of the published `@gotako/orca@1.7.0-beta.0` (`dist/harness/gate-plan.js` and `gate-code.js`):

- `orca gate-plan <name>` runs `Seal.review` in-process as `plan_review` on the change's `plan.json` or `tasks.md`. It refuses to run unless `intent.md` has a `## Intent Approval` section with `Status: APPROVED`. The locked criteria are the bullets under `## Success Criteria` in `intent.md`, numbered `SC-1`, `SC-2` and so on, saved to `.harness/locked-criteria.json`; `intent.md` is also passed as the spec. The verdict is written to `.harness/gate-verdicts/<timestamp>-plan.json`.
- `orca gate-code <name>` runs `Seal.review` as `code_diff` on the current diff. It needs a `self-check.md`. The test log and command receipts come from the evidence entries in that file (the test log is the output of the first evidence entry whose command contains "test"); the spec comes from the change's `specs/*/spec.md`. It keeps a `TrustMemory` in `.harness/trust-memory.json` (agent id `orca-agent`), binds the verdict to the SHA-256 of the diff, and for specs with mandatory Properties it supplies a trusted verifier (see [Mandatory Property evidence](property-evidence.md)). It also runs the mutation probe over tests listed in `plan.json`.
- `--llm` on both commands registers an LLM reviewer through Orca's own option handling (read from the Orca 1.7.0-beta.0 source, which bundles the older `seal-gate` 0.6.0-beta.0; not re-checked against this release). For `gate-plan` it has no effect, because plan reviews ignore the reviewer (see [LLM overlay](llm-overlay.md)).

Orca ships its own copy of Seal as a tarball inside its package: the dependency list of `@gotako/orca@1.7.0-beta.0` names `seal-gate` as `file:vendor/seal-gate-0.6.0-beta.0.tgz`. The previously published `seal-gate@0.5.0` returns the old verdict name `ESCALATE_TO_HUMAN` (its `dist` contains that name and not `ESCALATE_TO_REVIEWER`). Orca 1.7.0-beta.0 maps the old name to the new one wherever a verdict enters Orca, so both names are accepted there. If you read verdict files or Seal output in your own scripts, accept both names too.

See [Family](family.md) for the other tools.

## A Claude Code skill

The repository also has `.claude/skills/seal/SKILL.md`, a prompt-level checklist ("verify claims, evidence, and correctness before proceeding") for an agent to read. It is plain instructions, not code, and it is not part of the npm package. The `.claude/plugin.json` next to it is out of date (version 0.2.0, local paths).
