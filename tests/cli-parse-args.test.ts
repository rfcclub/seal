import { describe, it, expect } from 'bun:test'
import { parseArgs } from '../src/cli.ts'

// Pre-existing bug found while implementing --llm auto (Track 4): --llm was in the
// boolean-only flag list alongside --json/--version, so a provider name typed after it
// (e.g. `--llm fireworks`) was never captured — it silently fell through to `positional`
// and `parsed.llm` was always `true`, making `--llm fireworks` behave identically to a
// bare `--llm`. This must be fixed for `--llm auto` to be distinguishable at all.
describe('parseArgs — --llm value capture', () => {
  it('captures a provider name after --llm', () => {
    const { parsed, positional } = parseArgs(['code', 'file.ts', '--llm', 'fireworks'])
    expect(parsed.llm).toBe('fireworks')
    expect(positional).toEqual(['code', 'file.ts'])
  })

  it('captures "auto" after --llm', () => {
    const { parsed } = parseArgs(['code', 'file.ts', '--llm', 'auto'])
    expect(parsed.llm).toBe('auto')
  })

  it('bare --llm with no following value stays boolean true', () => {
    const { parsed } = parseArgs(['code', 'file.ts', '--llm'])
    expect(parsed.llm).toBe(true)
  })

  it('bare --llm followed by another flag stays boolean true (does not eat the next flag)', () => {
    const { parsed } = parseArgs(['code', 'file.ts', '--llm', '--json'])
    expect(parsed.llm).toBe(true)
    expect(parsed.json).toBe(true)
  })

  it('--json and --version remain pure boolean flags, unaffected', () => {
    const { parsed, positional } = parseArgs(['code', 'file.ts', '--json'])
    expect(parsed.json).toBe(true)
    expect(positional).toEqual(['code', 'file.ts'])
  })

  it('a value flag never consumes the next flag: it is reported as missing', () => {
    const { parsed, errors } = parseArgs(['code', 'f', '--llm', '--llm-base-url', 'http://h/v1', '--llm-model', '--llm-key-env', 'K', '--json'])
    expect(errors).toEqual(['--llm-model needs a value'])
    expect(parsed['llm-base-url']).toBe('http://h/v1')
    expect(parsed['llm-key-env']).toBe('K')
    expect(parsed.json).toBe(true)
  })

  it('a value flag at the end of the line is reported as missing', () => {
    expect(parseArgs(['code', 'f', '--llm-key-env']).errors).toEqual(['--llm-key-env needs a value'])
    expect(parseArgs(['code', 'f', '--llm-mode']).errors).toEqual(['--llm-mode needs a value'])
    expect(parseArgs(['code', 'f', '--spec', '--risk', 'HIGH']).errors).toEqual(['--spec needs a value'])
  })

  it('well-formed flags give no errors; --help is boolean', () => {
    expect(parseArgs(['code', 'f', '--spec', 's.md', '--risk', 'HIGH', '--llm-key-env', 'K']).errors).toEqual([])
    expect(parseArgs(['--help']).parsed.help).toBe(true)
  })
})
