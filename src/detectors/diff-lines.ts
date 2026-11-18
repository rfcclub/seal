/**
 * Changed-line extraction from a unified diff.
 *
 * Only added ('+') and removed ('-') lines are returned, never unchanged context and never the
 * '---' / '+++' file headers. Header lines are recognised only in the header region of a file
 * (outside a hunk), so an added line whose text starts with "++" is still an added line.
 */

export interface ChangedLine {
  /** Path from the diff header (a/ b/ prefixes stripped); undefined when the diff carries none. */
  file?: string
  /** 1-based line number in the new file (added) or the old file (removed). */
  line: number
  text: string
  kind: 'added' | 'removed'
}

export interface ParsedDiff {
  /** True when at least one "@@ -a,b +c,d @@" hunk header was found. */
  unified: boolean
  lines: ChangedLine[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function stripPrefix(raw: string): string {
  let p = raw.split('\t')[0]!.trim()
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1)
  if (p === '/dev/null') return p
  return p.replace(/^[ab]\//, '')
}

/** True when a diff text looks like a unified diff from its first non-empty line. */
export function startsLikeDiff(text: string): boolean {
  const first = text.split('\n').find(l => l.trim() !== '') ?? ''
  return /^(diff --git |--- |@@ )/.test(first)
}

export function parseUnifiedDiff(text: string): ParsedDiff {
  const rows = text.split(/\r?\n/)
  const lines: ChangedLine[] = []
  let unified = false
  let file: string | undefined
  let oldPath: string | undefined
  let oldLine = 0
  let newLine = 0
  let oldLeft = 0
  let newLeft = 0

  const inHunk = () => oldLeft > 0 || newLeft > 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!

    if (!inHunk()) {
      if (row.startsWith('diff --git ')) {
        const m = / b\/(.+)$/.exec(row)
        file = m ? m[1] : undefined
        oldPath = undefined
        continue
      }
      if (row.startsWith('--- ')) {
        oldPath = stripPrefix(row.slice(4))
        const next = rows[i + 1]
        if (next !== undefined && next.startsWith('+++ ')) {
          const np = stripPrefix(next.slice(4))
          file = np === '/dev/null' ? oldPath : np
          i++
        }
        continue
      }
      if (row.startsWith('+++ ')) {
        const np = stripPrefix(row.slice(4))
        file = np === '/dev/null' ? oldPath : np
        continue
      }
    }

    const h = HUNK.exec(row)
    if (h) {
      unified = true
      oldLine = Number(h[1])
      oldLeft = h[2] === undefined ? 1 : Number(h[2])
      newLine = Number(h[3])
      newLeft = h[4] === undefined ? 1 : Number(h[4])
      continue
    }
    if (!unified) continue

    if (row.startsWith('+')) {
      lines.push({ file, line: newLine, text: row.slice(1), kind: 'added' })
      newLine++
      newLeft = Math.max(0, newLeft - 1)
    } else if (row.startsWith('-')) {
      lines.push({ file, line: oldLine, text: row.slice(1), kind: 'removed' })
      oldLine++
      oldLeft = Math.max(0, oldLeft - 1)
    } else if (row.startsWith('\\')) {
      // "\ No newline at end of file"
    } else {
      oldLine++
      newLine++
      oldLeft = Math.max(0, oldLeft - 1)
      newLeft = Math.max(0, newLeft - 1)
    }
  }
  return { unified, lines }
}

function normPath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^[ab]\//, '')
}

/** True when a diff file path is one of the scope files (exact, or one is a path suffix of the other). */
export function fileInScope(file: string | undefined, scope: string[] | undefined): boolean {
  if (!scope || scope.length === 0) return true
  if (file === undefined) return true // cannot attribute the line to a file, so keep it (fail closed)
  const f = normPath(file)
  return scope.some(s => {
    const n = normPath(s)
    return n === f || f.endsWith('/' + n) || n.endsWith('/' + f)
  })
}
