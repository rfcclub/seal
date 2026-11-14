import { it, expect } from 'bun:test'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { mkdtempSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))
const run = (...args: string[]) => spawnSync('node', [cli, ...args], { encoding: 'utf-8', env: { ...process.env, SEAL_LLM_BASE_URL: '', SEAL_LLM_MODEL: '', SEAL_LLM_KEY_ENV: '' } })

it('entry: running the file prints output (not a silent exit 0)', () => {
  const r = run('--version')
  expect([r.status, r.stdout.startsWith('seal v')]).toEqual([0, true])
})

it('entry: runs through a symlink, as the npm bin does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seal-bin-'))
  const link = join(dir, 'seal')
  symlinkSync(cli, link)
  const r = spawnSync('node', [link, '--version'], { encoding: 'utf-8' })
  expect([r.status, r.stdout.startsWith('seal v')]).toEqual([0, true])
})

it('llm: no endpoint stops with exit 2 before reviewing anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seal-llm-'))
  const f = join(dir, 'a.md')
  writeFileSync(f, 'hello')
  const cases = [
    ['code', f, '--llm'],
    ['code', f, '--llm', '--llm-model', 'm'],
    ['code', f, '--llm', '--llm-base-url', 'http://127.0.0.1:9/v1'],
    ['code', f, '--llm', 'minimax'],
  ]
  for (const args of cases) {
    const r = run(...args)
    expect([args.join(' '), r.status, r.stderr.includes('Nothing was sent'), r.stdout.includes('Verdict')]).toEqual([args.join(' '), 2, true, false])
  }
})

it('flags: a value flag followed by another flag stops with exit 2 and sends nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seal-flag-'))
  const f = join(dir, 'a.md')
  writeFileSync(f, 'hello')
  const hits: string[] = []
  // an unreachable port: if anything were sent it would show as a failed-review finding in stdout
  for (const args of [
    ['code', f, '--llm', '--llm-base-url', 'http://127.0.0.1:9/v1', '--llm-model', '--llm-key-env', 'K', '--json'],
    ['code', f, '--llm', '--llm-base-url', '--llm-model', 'm'],
    ['code', f, '--llm', '--llm-base-url', 'http://127.0.0.1:9/v1', '--llm-model', 'm', '--llm-key-env'],
    ['code', f, '--llm', '--llm-base-url', 'http://127.0.0.1:9/v1', '--llm-model', 'm', '--llm-mode'],
  ]) {
    const r = run(...args)
    if (r.status !== 2 || !r.stderr.includes('needs a value') || r.stdout.includes('verdict')) hits.push(args.join(' '))
  }
  expect(hits).toEqual([])
})

it('llm: --llm-mode rejects unknown values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seal-llm-'))
  const f = join(dir, 'a.md')
  writeFileSync(f, 'hello')
  expect(run('code', f, '--llm', '--llm-base-url', 'http://127.0.0.1:9/v1', '--llm-model', 'm', '--llm-mode', 'sometimes').status).toBe(2)
})
