#!/usr/bin/env node
import { Seal } from './index.js'
import { ArtifactType, RiskLevel } from './types.js'
import { VERSION } from './version.js'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

// True when this file is the program being run (node dist/cli.js, the npm bin symlink, bun).
// import.meta.main is not defined on Node 22.17 and older, 23.x and 24.0-24.1, which made the
// command exit 0 silently there, so compare the entry path instead.
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

function colorForVerdict(v: string): string {
  if (v === 'PASS') return GREEN
  if (v === 'PASS_WITH_WARNINGS') return YELLOW
  return RED
}

function usage(code = 2): never {
  console.log(`
${BOLD}seal${RESET} v${VERSION} — AI quality gate

${BOLD}USAGE${RESET}
  seal <command> [options]

${BOLD}COMMANDS${RESET}
  ${CYAN}code${RESET}     <file>       Review code output / diff (default mode)
  ${CYAN}plan${RESET}     <file>       Review plan, design, or spec (plan_review mode)
  ${CYAN}review${RESET}   <file>       Review with full control over artifact type

${BOLD}OPTIONS${RESET}
  --llm                        Enable the LLM reviewer (any OpenAI-compatible endpoint; no default provider)
  --llm-base-url <url>         Endpoint base URL (or SEAL_LLM_BASE_URL)
  --llm-model <name>           Model name (or SEAL_LLM_MODEL)
  --llm-key-env <VAR>          Name of the env var holding the API key (or SEAL_LLM_KEY_ENV); omit for no key
  --llm-mode <always|auto>     always (default) or auto (call the reviewer only when the heuristic result is ambiguous)
  --spec <file>                Spec file for compliance check
  --locked-criteria <file>     JSON file with locked acceptance criteria (plan_review)
  --risk <level>               Risk hint: low, medium, high, critical
  --agent-id <id>              Agent identifier for trust memory
  --json                       Raw JSON output (no formatting)
  --artifact-type <type>       Override: llm_response, code_diff, test_plan, design, migration, plan_review

${BOLD}EXAMPLES${RESET}
  ${DIM}# Review with LLM reviewer${RESET}
  seal code src/auth.ts --llm --llm-base-url http://localhost:8080/v1 --llm-model local

  ${DIM}# Review a code change${RESET}
  seal code src/auth.ts --spec specs/auth.md

  ${DIM}# Review a plan/spec against locked criteria${RESET}
  seal plan spec.md --locked-criteria intent-criteria.json

  ${DIM}# Full control mode${RESET}
  seal review output.md --artifact-type plan_review --locked-criteria criteria.json
`)
  process.exit(code)
}

export function parseArgs(args: string[]) {
  const parsed: Record<string, string | boolean> = {}
  const errors: string[] = []
  let positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      if (key === 'json' || key === 'version' || key === 'help') { parsed[key] = true; continue }
      // --llm takes an optional value (provider name, or 'auto') — but must not swallow
      // the NEXT flag as its value when no provider was actually given (bare --llm).
      if (key === 'llm') {
        const next = args[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          parsed[key] = next
          i++
        } else {
          parsed[key] = true
        }
        continue
      }
      // Every other flag takes a value. A missing value, or a following flag, is an error:
      // the next flag is never consumed as the value.
      const next = args[i + 1]
      if (next === undefined || next.startsWith('--')) {
        errors.push(`--${key} needs a value`)
        parsed[key] = ''
        continue
      }
      parsed[key] = next
      i++
    } else {
      positional.push(args[i])
    }
  }
  return { positional, parsed, errors }
}

function formatVerdict(v: any, json: boolean) {
  if (json) {
    console.log(JSON.stringify(v, null, 2))
    return
  }

  const c = colorForVerdict(v.verdict)
  const scoreBar = v.trust_score >= 90 ? '██████████' :
                   v.trust_score >= 70 ? '███████░░░' :
                   v.trust_score >= 50 ? '█████░░░░░' :
                   v.trust_score >= 30 ? '███░░░░░░░' : '█░░░░░░░░░'

  console.log(`\n${BOLD}┌─ Seal v${v.version} Verdict ──────────────────────┐${RESET}`)
  console.log(`${BOLD}│${RESET}  ${c}${BOLD}${v.verdict}${RESET}  ${DIM}(trust: ${v.trust_score})${RESET}  ${scoreBar}`)
  console.log(`${BOLD}│${RESET}  Risk: ${v.risk_level}`)
  console.log(`${BOLD}│${RESET}  ${v.summary}`)

  if (v.blocking_issues?.length > 0) {
    console.log(`${BOLD}│${RESET}`)
    console.log(`${BOLD}│${RESET}  ${RED}${BOLD}Blocking Issues:${RESET}`)
    for (const issue of v.blocking_issues) {
      console.log(`${BOLD}│${RESET}    ${RED}✗${RESET} [${issue.rule_id}] ${issue.evidence}`)
    }
  }

  if (v.non_blocking_issues?.length > 0) {
    console.log(`${BOLD}│${RESET}`)
    console.log(`${BOLD}│${RESET}  ${YELLOW}Non-blocking:${RESET}`)
    for (const issue of v.non_blocking_issues) {
      console.log(`${BOLD}│${RESET}    ${YELLOW}⚠${RESET} [${issue.rule_id}] ${issue.evidence}`)
    }
  }

  if (v.deterministic_findings?.length === 0 && v.blocking_issues?.length === 0) {
    console.log(`${BOLD}│${RESET}`)
    console.log(`${BOLD}│${RESET}  ${GREEN}✓${RESET} No issues found`)
  }

  console.log(`${BOLD}│${RESET}  ${DIM}Next: ${v.next_action}${RESET}`)
  console.log(`${BOLD}└────────────────────────────────────────────┘${RESET}`)
}

async function run(args: string[]) {
  const { positional, parsed, errors } = parseArgs(args)
  const cmd = positional[0]

  if (parsed['version'] || cmd === 'version' || cmd === '-v') { console.log(`seal v${VERSION}`); process.exit(0) }
  // An explicit help request is not an error; a missing command is.
  if (cmd === 'help' || cmd === '--help' || cmd === '-h' || (!cmd && parsed['help'] !== undefined)) usage(0)
  if (!cmd) usage()
  // Bad flag values stop the run before any file is read and before anything is sent.
  if (errors.length > 0) {
    console.error(`Error: ${errors.join('; ')}. Nothing was sent.`)
    process.exit(2)
  }

  // Wire LLM reviewer if --llm flag is present
  let llmFlagUsed = false
  if (parsed['llm']) {
    llmFlagUsed = true
    const { createReviewer, resolveReviewerOptions } = await import('./adapters/generic-llm-reviewer.js')
    // Provider-neutral: any OpenAI-compatible endpoint. No default provider, URL or model;
    // if they are not given (flags or SEAL_LLM_* environment variables) stop before reading
    // or sending anything.
    if (typeof parsed['llm'] === 'string') {
      console.error('Error: --llm takes no value. Name the endpoint with --llm-base-url and --llm-model. Nothing was sent.')
      process.exit(2)
    }
    const resolved = resolveReviewerOptions({
      baseUrl: parsed['llm-base-url'] as string | undefined,
      model: parsed['llm-model'] as string | undefined,
      apiKeyEnv: parsed['llm-key-env'] as string | undefined,
    })
    if ('missing' in resolved) {
      console.error(`Error: --llm needs an endpoint. Missing: ${resolved.missing.join('; ')}. No provider is chosen for you. Nothing was sent.`)
      process.exit(2)
    }
    const modeFlag = parsed['llm-mode']
    if (modeFlag !== undefined && modeFlag !== 'always' && modeFlag !== 'auto') {
      console.error('Error: --llm-mode must be "always" or "auto"')
      process.exit(2)
    }
    // --llm-mode auto (AD-5): the heuristic scorer runs first; the reviewer is only called
    // when the heuristic result is ambiguous.
    Seal.withLLM(createReviewer(resolved.options), modeFlag === 'auto' ? { mode: 'auto' } : undefined)
  }

  let artifactFile: string | null = null
  let artifactType: ArtifactType = 'llm_response'
  let specFile: string | null = null
  let lockedCriteriaFile: string | null = null
  let riskHint: RiskLevel | null = null
  let agentId: string | null = null
  let jsonOutput = !!parsed['json']

  switch (cmd) {
    case 'code':
      artifactFile = positional[1]
      artifactType = 'code_diff'
      break
    case 'plan':
    case 'spec':
    case 'design':
      artifactFile = positional[1]
      artifactType = 'plan_review'
      break
    case 'review':
      artifactFile = positional[1]
      artifactType = (parsed['artifact-type'] as ArtifactType) ?? 'llm_response'
      break
    default:
      // `seal <file>` shorthand — treat first arg as file
      if (existsSync(cmd)) {
        artifactFile = cmd
        artifactType = 'llm_response'
      } else {
        console.error(`Unknown command or file not found: ${cmd}`)
        usage()
      }
  }

  if (!artifactFile) { console.error('Error: no file specified'); usage() }

  const filePath = artifactFile as string
  if (!existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`)
    process.exit(2)
  }

  // Resolve optional flags
  if (parsed['spec']) { specFile = parsed['spec'] as string }
  if (parsed['locked-criteria']) { lockedCriteriaFile = parsed['locked-criteria'] as string }
  if (parsed['risk']) { riskHint = parsed['risk'] as RiskLevel }
  if (parsed['agent-id']) { agentId = parsed['agent-id'] as string }
  // Load files
  const output = readFileSync(resolve(filePath), 'utf-8')
  const spec = specFile && existsSync(specFile) ? readFileSync(resolve(specFile), 'utf-8') : null
  const evidence = { test_log: '', build_log: '', diff: '', references: [] }

  const lockedCriteria = lockedCriteriaFile && existsSync(lockedCriteriaFile)
    ? JSON.parse(readFileSync(resolve(lockedCriteriaFile), 'utf-8'))
    : []

  const context: Record<string, unknown> = {}
  if (agentId) context.agent_id = agentId
  if (lockedCriteria.length > 0) context.locked_criteria = lockedCriteria

  if (!jsonOutput) {
    console.log(`${DIM}Seal reviewing ${artifactFile} (${artifactType})...${RESET}`)
  }

  const verdict = await Seal.review({
    artifact_type: artifactType,
    spec,
    output,
    evidence,
    risk_hint: riskHint,
    context: Object.keys(context).length > 0 ? context : undefined,
  })

  formatVerdict(verdict, jsonOutput)

  // Hint when --llm used but LLM reviewer failed (no API key)
  if (llmFlagUsed && verdict.assumptions_detected?.some(a => a.includes('L2') && (a.includes('not reviewed') || a.includes('error')))) {
    if (!jsonOutput) {
      console.log(`${DIM}💡 Tip: the LLM reviewer failed; check the endpoint and the variable named by --llm-key-env.${RESET}`)
    }
  }

  const passing = verdict.verdict === 'PASS' || verdict.verdict === 'PASS_WITH_WARNINGS'
  process.exit(passing ? 0 : 1)
}

// Guarded so importing this module (e.g. from tests, to exercise parseArgs) doesn't
// also execute the CLI and call process.exit().
if (isEntryPoint()) {
  run(process.argv.slice(2)).catch(err => {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  })
}
