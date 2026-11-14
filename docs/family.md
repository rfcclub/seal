# Family: Orca, Pilotfish, Hammerhead

Seal is one of four tools that are published separately on npm. Seal works on its own; none of the others is required. This page says what each one is and how they are connected, limited to what could be confirmed from the published npm packages (their metadata, command-line usage text and source).

| Tool | npm package (current beta) | What it is |
|---|---|---|
| Seal (this package) | `seal-gate` 0.6.0-beta.1 | Quality gate: verdicts on text artifacts. |
| Orca | `@gotako/orca` 1.7.0-beta.0 | Harness for a spec-driven workflow: intent, spec, design, plan, test-first implementation, verify, archive. |
| Pilotfish | `@gotako/pilotfish` 0.2.0-beta.8 | Drives a model through the tasks of a `plan.json`, by role, with a bounded retry loop (`pilotfish run <changeDir> <task-id> [--project-root <dir>] [--config <path>] [--role <role>]`). The README of this beta still names LoomKit as the plan source. |
| Hammerhead | `@gotako/hammerhead-debug` 0.5.0-beta.4 | Hypothesis-gated debugging: no fix until a prediction is confirmed by a real probe, using the debug adapter protocol (subcommands `install`, `open`, `hypothesis`, `probe`, `verdict`, `fix`, `status`, `check`, `list`). |

Versions are the `latest` and `beta` dist-tags at the time of the 0.6.0-beta.1 release.

## Orca calls Seal

Orca's `gate-plan` and `gate-code` commands call `Seal.review` in-process. How, and what they pass, is described in [Agent hooks and Orca](agent-hooks.md#orca). The one-line version:

- `orca gate-plan <name>`: a `plan_review` of the plan against criteria locked from the approved intent.
- `orca gate-code <name>`: a `code_diff` review of the current diff, with test evidence from the change's self-check, trust memory kept per change, and the mandatory-Property policy when the spec has such blocks.

Orca ships its own copy of Seal inside its package (`@gotako/orca@1.7.0-beta.0` bundles `seal-gate` 0.6.0-beta.0), so the Seal version you get through Orca can differ from the one you install here.

## Pilotfish and Hammerhead

Neither package imports or calls Seal. The only mention of Seal in Pilotfish's code is a comment; both READMEs name `seal-gate` only as one of the packages released together. Orca's `orca loop` command is described in its usage text as driving "an approved plan through bounded Pilotfish, gates and verify", so Seal's gates run through Orca, not through Pilotfish. Pilotfish's README says it hands off to Hammerhead when its retry loop is exhausted.

Orca's own package also bundles its own tarballs of Pilotfish and Hammerhead (newer than the ones published separately), so the versions you get through Orca can differ from the table above.

## Where Seal fits

- Seal is the gate: it answers "does this artifact pass?" from text.
- Orca is the workflow that decides when to ask and what to do with the answer.
- Pilotfish does the work of a plan's tasks with models.
- Hammerhead is for debugging a failure with real debugger evidence instead of guessing.

For the unattended, GitHub-connected usage of this family, Seal contributes only the verdict. See [Agent hooks and Orca](agent-hooks.md).
