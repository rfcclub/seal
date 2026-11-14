# Mandatory Property evidence

Some specs mark behaviour as mandatory and require executable property tests for it. Seal can enforce that as a hard gate. This page describes exactly what Seal checks and what it leaves to the caller.

**Short version:** Seal checks the *shape and flags* of evidence that your own trusted code returns. It does not run property tests, mutate code, verify signatures or read receipts. If your verifier returns "verified" falsely, Seal believes it.

## When it applies

It applies to code-mode reviews (not `plan_review`). Seal counts the mandatory Properties in `input.spec`:

- A requirement is a section starting with `### Requirement:`.
- Its description is the text after the heading line up to the first `#### Scenario:` or `#### Property:` line.
- Its strength is the first of `SHALL`, `MUST`, `SHOULD`, `MAY` (checked in that order) found in the description, and `SHALL` if none is found. The requirement title does not matter.
- Each `#### Property:` heading under a `SHALL` or `MUST` requirement is one mandatory Property. Ordinary Scenarios and optional (`SHOULD` or `MAY`) Properties are not affected.

If the spec has no mandatory Properties and `context.property_contracts` is not set, this policy does nothing.

## What you must supply

1. **Contracts**, in `input.context.property_contracts`: an array of

   ```json
   { "id": "trim-idempotent", "priority": "MUST", "runs": 100, "contract_sha256": "<64 lowercase hex characters>" }
   ```

   `id` must match `^[a-z0-9][a-z0-9-]*$` and be unique; `priority` is `MUST`, `SHOULD` or `MAY`; `runs` is a positive integer. How ids and digests are derived is your harness's business.

2. **A trusted verifier** passed in the second argument, separately from the input:

   ```js
   const verdict = await Seal.review(input, {
     propertyEvidenceVerifier: async (input, mustContracts) => reviews,
   })
   ```

   It receives the `MUST` contracts and must return exactly one review per contract:

   ```ts
   {
     property_id: string,
     contract_sha256: string,                 // must equal the contract's digest
     status: 'verified' | 'invalid' | 'unavailable',
     fresh: boolean,
     runs_actual: number,
     seed: number,                            // 32-bit integer
     mutants: Array<{
       id: string,
       outcome: 'killed' | 'survived' | 'equivalent' | 'invalid' | 'unavailable',
       equivalence_verified?: boolean,
     }>,
   }
   ```

The verifier is trusted application code. Anything the agent writes into `input` (a status, a "verified" flag, a run count) is never a substitute for it. Seal does not sandbox the verifier.

## Rules

All findings are HIGH, blocking, type `SPEC_UNTESTED`, and any of them forces the verdict to `BLOCK` regardless of trust score or LLM opinion (tested for `PMUST-01`: `BLOCK` with a score of 100).

| Rule | Raised when |
|---|---|
| `PMUST-01` | The contracts are missing or malformed; there are fewer `MUST` contracts than mandatory Properties in the spec; no verifier was passed; the verifier threw; or it did not return exactly one review per `MUST` contract. |
| `PMUST-02` | For a contract: the review's digest differs from the contract's, `status` is not `verified`, `fresh` is not `true`, `runs_actual` is less than `runs`, or `seed` is not a 32-bit integer. |
| `PMUST-03` | The mutant list is missing, empty, has an empty or duplicate id, or some mutant is not resolved. A mutant is resolved if its outcome is `killed`, or `equivalent` with `equivalence_verified === true`. Survived, invalid and unavailable outcomes, and unverified equivalence claims, are unresolved. |
| `PMUST-04` | No mutant was `killed`. A property whose mutants are all "equivalent" remains untested. |

What the flags mean is up to your verifier. A sound one should run the actual property runner, check that the source, test, generator and corpus match the contract, rerun the mutations in isolation, and set `equivalence_verified` only after checking an independent reviewer's signature (for example one made with a key that is pinned outside the project). Seal reads only the `equivalence_verified` boolean; it does not look at keys or signatures.

## From the CLI

The CLI cannot pass contracts or a verifier. A spec with mandatory Property blocks, given with `--spec`, therefore always produces `PMUST-01` and `BLOCK`. If you only want ordinary spec checks, keep mandatory Property blocks out of that spec.

## Orca

Orca's `gate-code` builds the contracts and a verifier through its own "Property bridge" when the change's spec has mandatory Properties, and passes them to `Seal.review` (read from the source of the published Orca 1.7.0-beta.0). The verifier is Orca's code, which is where receipts and signatures are checked. See [Agent hooks and Orca](agent-hooks.md#orca).

## Related

- `checkTestPinsBehavior` (the mutation probe described in the [Library API](api.md#spec-coverage-and-mutation-probe-helpers)) is an older advisory helper. This policy does not use it, and its result is not acceptable evidence for a mandatory Property.
- Passing a finite number of property runs does not prove the code correct.
