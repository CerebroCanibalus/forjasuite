export interface SieveIssue {
  type: "error" | "warning"
  line: number
  column: number
  message: string
}

export interface SieveResult {
  valid: boolean
  issues: SieveIssue[]
  stats: { timeMs: number }
}

// ── Structural checks ──

function checkBraceBalance(lines: string[]): SieveIssue[] {
  const issues: SieveIssue[] = []
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" }
  const stack: { char: string; line: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const cleaned = lines[i].replace(/(["'`])(?:(?!\1).)*\1/g, "").replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "")
    for (const ch of cleaned) {
      if ("{([".includes(ch)) {
        stack.push({ char: ch, line: i + 1 })
      } else if ("})]".includes(ch)) {
        if (stack.length === 0) {
          issues.push({ type: "error", line: i + 1, column: 1, message: `${ch} sin apertura correspondiente` })
        } else {
          const last = stack.pop()!
          if (pairs[last.char] !== ch) {
            issues.push({ type: "error", line: i + 1, column: 1, message: `Esperaba '${pairs[last.char]}' pero encontró '${ch}' (abierto L${last.line})` })
          }
        }
      }
    }
  }
  for (const u of stack) {
    issues.push({ type: "error", line: u.line, column: 1, message: `'${u.char}' abierto en L${u.line} sin cierre` })
  }
  return issues
}

function checkStringClosure(lines: string[]): SieveIssue[] {
  const issues: SieveIssue[] = []
  for (let i = 0; i < lines.length; i++) {
    let inString = false, char = "", start = 0
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j]
      if (inString) {
        if (ch === char && lines[i][j - 1] !== "\\") inString = false
      } else if (["\"", "'", "`"].includes(ch) && lines[i][j - 1] !== "\\") {
        inString = true; char = ch; start = i + 1
      }
    }
    if (inString) issues.push({ type: "error", line: i + 1, column: 1, message: `String ${char} iniciado en L${start} sin cierre` })
  }
  return issues
}

// ── Language quality checks ──

function checkQuality(lines: string[], ext: string): SieveIssue[] {
  const issues: SieveIssue[] = []

  // Mixed indentation (any language)
  let hasTabs = false, hasSpaces = false
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (lines[i][0] === "\t") hasTabs = true
    else if (lines[i][0] === " " && lines[i].startsWith("  ")) hasSpaces = true
  }
  if (hasTabs && hasSpaces) {
    issues.push({ type: "warning", line: 1, column: 1, message: "Indentación mixta tabs+espacios — elegir uno" })
  }

  // Missing trailing newline
  if (lines.length > 1 && lines[lines.length - 1] !== "") {
    issues.push({ type: "warning", line: lines.length, column: 1, message: "Falta newline al final del archivo (POSIX)" })
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t || t.startsWith("#") || t.startsWith("//")) continue

    switch (ext) {
      case "py": {
        if (/^from\s+\.?[\w.]+\s+import\s*,?\s*$/.test(t)) {
          issues.push({ type: "error", line: i + 1, column: 1, message: "Import incompleto — falta símbolo(s)" })
        }
        const m = t.match(/\b(?:if|elif|while)\s+.*?(\w+\s*=\s*\w+)/)
        if (m && !t.includes("==") && !t.includes("!=") && !t.includes("in") && !t.includes("is")) {
          issues.push({ type: "warning", line: i + 1, column: Math.max(0, t.indexOf(m[1]) + 1), message: `Posible '=' en lugar de '==': '${m[1]}'` })
        }
        break
      }

      case "ts": case "tsx": case "js": case "jsx": case "mjs": {
        const iq = t.match(/from\s+([^\s"'`;,)]+)/)
        if (iq && !iq[1].startsWith('"') && !iq[1].startsWith("'") && !iq[1].startsWith("`")) {
          issues.push({ type: "error", line: i + 1, column: Math.max(0, t.indexOf(iq[1]) + 1), message: `Import sin comillas: '${iq[1]}'` })
        }
        const rq = t.match(/require\s*\(\s*([^\s"'`)]+)\s*\)/)
        if (rq && !rq[1].startsWith('"') && !rq[1].startsWith("'") && !rq[1].startsWith("`")) {
          issues.push({ type: "error", line: i + 1, column: Math.max(0, t.indexOf(rq[1]) + 1), message: `require sin comillas: '${rq[1]}'` })
        }
        break
      }

      case "gd": {
        const pq = t.match(/\bpreload\s*\(\s*(\w[\w\/.-]*)\s*\)/)
        if (pq) issues.push({ type: "error", line: i + 1, column: t.indexOf(pq[1]) + 1, message: `preload() sin comillas: '${pq[1]}'` })
        const lq = t.match(/\bload\s*\(\s*(\w[\w\/.-]*)\s*\)/)
        if (lq) issues.push({ type: "error", line: i + 1, column: t.indexOf(lq[1]) + 1, message: `load() sin comillas: '${lq[1]}'` })
        break
      }

      case "nut": {
        const isq = t.match(/(?:::)?IncludeScript\s*\(\s*(\w[\w\/.-]*)\s*\)/)
        if (isq) issues.push({ type: "error", line: i + 1, column: t.indexOf(isq[1]) + 1, message: `IncludeScript() sin comillas: '${isq[1]}'` })
        break
      }

      case "lua": {
        const rq = t.match(/\brequire\s*\(\s*(\w[\w\/.-]*)\s*\)/)
        if (rq) issues.push({ type: "error", line: i + 1, column: t.indexOf(rq[1]) + 1, message: `require() sin comillas: '${rq[1]}'` })
        break
      }

      case "cs": {
        const dq = t.match(/^#(?:r|load)\s+(\w[\w\/.-]*)\b/)
        if (dq) issues.push({ type: "error", line: i + 1, column: t.indexOf(dq[1]) + 1, message: `#r/#load sin comillas: '${dq[1]}'` })
        break
      }
    }
  }
  return issues
}

// ── ForjaSieve ──

export class ForjaSieve {
  private pendingIssues: SieveIssue[] = []

  async checkEdit(filePath: string, content: string): Promise<SieveResult> {
    const start = performance.now()
    const issues: SieveIssue[] = []
    const lines = content.split("\n")
    const ext = filePath.split(".").pop()?.toLowerCase() || ""

    issues.push(...checkBraceBalance(lines))
    issues.push(...checkStringClosure(lines))
    issues.push(...checkQuality(lines, ext))

    const timeMs = Math.round(performance.now() - start)
    return { valid: issues.filter(i => i.type === "error").length === 0, issues, stats: { timeMs } }
  }

  storePending(issues: SieveIssue[]) {
    if (issues.length > 0) this.pendingIssues = issues.slice(0, 5)
  }

  drainPending(): string {
    if (this.pendingIssues.length === 0) return ""
    const lines = this.pendingIssues.map(i => `  L${i.line}:${i.column} ${i.type === "error" ? "⛔" : "⚠️"} ${i.message}`)
    const result = `\n🔍 Forja quality issues (${this.pendingIssues.length}):\n${lines.join("\n")}\n`
    this.pendingIssues = []
    return result
  }
}
