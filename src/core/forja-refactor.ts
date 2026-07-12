import { tool } from "@opencode-ai/plugin"
import { readFile, writeFile } from "node:fs/promises"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { ForjaSieve } from "./forja-sieve.js"

// ─── Types ───────────────────────────────────────────────────────────────────

interface PatchHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** Raw lines with prefix: ' ', '-', '+' */
  lines: string[]
}

interface RefactorOp {
  type: "patch" | "jaccard"
  filePath: string
  diff?: string
  oldBlock?: string
  newBlock?: string
  context?: string
  description?: string
  /** occurrence: 1=primera, 2=segunda, "last"=última. Default: 1 */
  occurrence?: number | "last"
}

interface RefactorResult {
  filePath: string
  status: "ok" | "skipped" | "failed"
  description?: string
  hunksApplied?: number
  similarity?: number
  error?: string
  fileExists: boolean
  warnings?: string[]
}

// ─── Rollback store (sesión volátil, no persistir) ──────────────────────────

const rollbackStore = new Map<string, string[]>()

function commit() { rollbackStore.clear() }
function rollbackAll() {
  const errors: string[] = []
  for (const [filePath, contents] of rollbackStore) {
    for (const content of contents) {
      try {
        writeFile(filePath, content, "utf-8")
      } catch (e) {
        errors.push(`${filePath}: ${e}`)
      }
    }
  }
  rollbackStore.clear()
  return errors
}
function saveRollback(filePath: string, content: string) {
  let arr = rollbackStore.get(filePath)
  if (!arr) { arr = []; rollbackStore.set(filePath, arr) }
  // Only save first snapshot per file
  if (arr.length === 0) arr.push(content)
}

// ─── Diff parser ─────────────────────────────────────────────────────────────

function parseUnifiedDiff(diff: string): { hunks: PatchHunk[]; filePath?: string } {
  const lines = diff.split("\n")
  const hunks: PatchHunk[] = []
  let currentHunk: PatchHunk | null = null
  let filePath: string | undefined

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "")

    // File headers: --- a/file, +++ b/file
    if (line.startsWith("--- ") && !line.startsWith("--- /")) {
      const m = line.match(/---\s+(?:a\/)?(.+)/)
      if (m) filePath = m[1]
      continue
    }
    if (line.startsWith("+++ ") && !line.startsWith("+++ /")) {
      const m = line.match(/\+\+\+\s+(?:b\/)?(.+)/)
      if (m) filePath = m[1]
      continue
    }

    // Hunk header: @@ -start,count +start,count @@
    const hdr = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
    if (hdr) {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = {
        oldStart: parseInt(hdr[1], 10),
        oldCount: hdr[2] ? parseInt(hdr[2], 10) : 1,
        newStart: parseInt(hdr[3], 10),
        newCount: hdr[4] ? parseInt(hdr[4], 10) : 1,
        lines: [],
      }
      continue
    }

    // Diff content lines
    if (currentHunk && (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+"))) {
      // Empty context line: " " followed by nothing → just " "
      currentHunk.lines.push(line)
    }
    // Lines outside hunks (e.g. diff --git, index, ---/+++ without header) are skipped
  }

  if (currentHunk) hunks.push(currentHunk)

  return { hunks, filePath }
}

// ─── Diff application ────────────────────────────────────────────────────────

function applyHunkToLines(fileLines: string[], hunk: PatchHunk): { ok: boolean; lines: string[]; matchedPos: number; similarity: number } {
  // Build "before" block: context + removed lines
  const beforeBlock: string[] = []
  let afterBlock: string[] = []
  for (const l of hunk.lines) {
    if (l.startsWith("-")) {
      beforeBlock.push(l.slice(1))
    } else if (l.startsWith("+")) {
      afterBlock.push(l.slice(1))
    } else {
      // context line ' '
      const content = l.slice(1)
      beforeBlock.push(content)
      afterBlock.push(content)
    }
  }

  if (beforeBlock.length === 0) {
    return { ok: false, lines: fileLines, matchedPos: -1, similarity: 0 }
  }

  // Try exact match first (with trimEnd for trailing whitespace resilience)
  let bestPos = -1
  let bestSim = 0

  for (let i = 0; i <= fileLines.length - beforeBlock.length; i++) {
    let match = true
    for (let j = 0; j < beforeBlock.length; j++) {
      if (fileLines[i + j].trimEnd() !== beforeBlock[j].trimEnd()) { match = false; break }
    }
    if (match) {
      bestPos = i
      bestSim = 1.0
      break
    }
  }

  // Fallback: Jaccard fuzzy match
  if (bestPos === -1) {
    const beforeStr = beforeBlock.join("\n").toLowerCase()
    const beforeTokens = new Set(beforeStr.split(/[^\wáéíóúñüÑÜ]+/).filter(Boolean))

    for (let i = 0; i <= Math.max(0, fileLines.length - beforeBlock.length); i++) {
      const windowStr = fileLines.slice(i, i + beforeBlock.length).join("\n").toLowerCase()
      const windowTokens = new Set(windowStr.split(/[^\wáéíóúñüÑÜ]+/).filter(Boolean))
      const sim = jaccard(beforeTokens, windowTokens)
      if (sim > bestSim) {
        bestSim = sim
        bestPos = i
      }
    }

    if (bestSim < 0.7) {
      return { ok: false, lines: fileLines, matchedPos: bestPos, similarity: bestSim }
    }
  }

  // Preserve indentation for fuzzy matches
  if (bestSim < 1) {
    const delta = detectIndentDelta(fileLines, bestPos, beforeBlock[0])
    if (delta !== 0) {
      afterBlock = applyIndentToLines(afterBlock, delta)
    }
  }

  // Apply: replace beforeBlock with afterBlock at bestPos
  const result = [
    ...fileLines.slice(0, bestPos),
    ...afterBlock,
    ...fileLines.slice(bestPos + beforeBlock.length),
  ]

  return { ok: true, lines: result, matchedPos: bestPos, similarity: bestSim }
}

// ─── Indent preservation helper ───────────────────────────────────────────────

function detectIndentDelta(fileLines: string[], bestPos: number, oldBlockFirstLine: string): number {
  if (bestPos < 0 || bestPos >= fileLines.length) return 0
  const fileLine = fileLines[bestPos]
  const fileIndent = fileLine.match(/^\s*/)?.[0]?.length ?? 0
  const oldIndent = oldBlockFirstLine.match(/^\s*/)?.[0]?.length ?? 0
  return fileIndent - oldIndent
}

function applyIndentToLines(lines: string[], delta: number): string[] {
  if (delta === 0) return lines
  if (delta > 0) {
    const pad = " ".repeat(delta)
    return lines.map(l => l === "" ? l : pad + l)
  }
  // delta < 0: strip whitespace
  const strip = Math.abs(delta)
  return lines.map(l => {
    const ws = l.match(/^\s*/)?.[0] ?? ""
    return l.slice(Math.min(ws.length, strip))
  })
}

// ─── Jaccard similarity ──────────────────────────────────────────────────────

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = new Set<string>()
  for (const x of a) if (b.has(x)) intersection.add(x)
  const union = new Set<string>([...a, ...b])
  return union.size === 0 ? 0 : intersection.size / union.size
}

// ─── Jaccard direct replacement ──────────────────────────────────────────────

function jaccardReplace(content: string, oldBlock: string, newBlock: string, threshold: number = 0.85, occurrence: number | "last" = 1): { ok: boolean; content: string; similarity: number } {
  const contentLines = content.split("\n")
  const oldLines = oldBlock.split("\n")

  if (oldLines.length === 0) return { ok: false, content, similarity: 0 }

  // Helper: apply replacement at position i
  const applyAt = (pos: number, sim: number) => {
    const delta = detectIndentDelta(contentLines, pos, oldLines[0])
    const newLines = delta !== 0 ? applyIndentToLines(newBlock.split("\n"), delta) : newBlock.split("\n")
    const result = [
      ...contentLines.slice(0, pos),
      ...newLines,
      ...contentLines.slice(pos + oldLines.length),
    ]
    return { ok: true, content: result.join("\n"), similarity: sim }
  }

  // Step 1: collect all exact match positions (trimEnd = trailing whitespace resilient)
  const exactPositions: number[] = []
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let match = true
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j].trimEnd() !== oldLines[j].trimEnd()) {
        match = false
        break
      }
    }
    if (match) exactPositions.push(i)
  }

  // Step 2: if no trimEnd matches, try strict match
  if (exactPositions.length === 0) {
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      let match = true
      for (let j = 0; j < oldLines.length; j++) {
        if (contentLines[i + j] !== oldLines[j]) {
          match = false
          break
        }
      }
      if (match) exactPositions.push(i)
    }
  }

  // Step 3: pick the right occurrence from exact matches
  if (exactPositions.length > 0) {
    let targetPos = -1
    if (occurrence === "last") {
      targetPos = exactPositions[exactPositions.length - 1]
    } else if (occurrence <= exactPositions.length) {
      targetPos = exactPositions[occurrence - 1]  // occurrence is 1-indexed
    }
    if (targetPos >= 0) return applyAt(targetPos, 1.0)
    // else: requested occurrence doesn't exist — fall through to fuzzy
  }

  // Step 4: no exact match — use Jaccard fuzzy, find ALL matches above threshold
  const oldStr = oldBlock.toLowerCase()
  const oldTokens = new Set(oldStr.split(/[^\wáéíóúñüÑÜ]+/).filter(Boolean))

  const fuzzyMatches: { pos: number; sim: number }[] = []
  for (let i = 0; i <= Math.max(0, contentLines.length - oldLines.length); i++) {
    const windowStr = contentLines.slice(i, i + oldLines.length).join("\n").toLowerCase()
    const windowTokens = new Set(windowStr.split(/[^\wáéíóúñüÑÜ]+/).filter(Boolean))
    const sim = jaccard(oldTokens, windowTokens)
    if (sim >= threshold) {
      fuzzyMatches.push({ pos: i, sim })
    }
  }

  if (fuzzyMatches.length === 0) {
    // Best effort: return best match below threshold for error reporting
    let bestPos = -1
    let bestSim = 0
    for (let i = 0; i <= Math.max(0, contentLines.length - oldLines.length); i++) {
      const windowStr = contentLines.slice(i, i + oldLines.length).join("\n").toLowerCase()
      const windowTokens = new Set(windowStr.split(/[^\wáéíóúñüÑÜ]+/).filter(Boolean))
      const sim = jaccard(oldTokens, windowTokens)
      if (sim > bestSim) { bestSim = sim; bestPos = i }
    }
    return { ok: false, content, similarity: bestSim }
  }

  // Step 5: pick the right occurrence from fuzzy matches
  let targetMatch: { pos: number; sim: number }
  if (occurrence === "last") {
    targetMatch = fuzzyMatches[fuzzyMatches.length - 1]
  } else if (occurrence <= fuzzyMatches.length) {
    targetMatch = fuzzyMatches[occurrence - 1]
  } else {
    targetMatch = fuzzyMatches[fuzzyMatches.length - 1] // fallback: last
  }

  return applyAt(targetMatch.pos, targetMatch.sim)
}

// ─── Main refactor execution ─────────────────────────────────────────────────

async function executePatchOp(op: RefactorOp): Promise<RefactorResult> {
  const result: RefactorResult = {
    filePath: op.filePath,
    status: "failed",
    description: op.description,
    fileExists: true,
  }

  // Check if file exists and strip BOM
  let originalContent: string
  try {
    originalContent = await readFile(op.filePath, "utf-8")
    originalContent = originalContent.replace(/^\uFEFF/, "")
  } catch {
    result.fileExists = false
    result.error = `File does not exist: ${op.filePath}`
    return result
  }

  let fileLines = originalContent.split(/\r?\n/)
  let totalHunks = 0
  let totalSimilarity = 1.0

  if (op.type === "patch" && op.diff) {
    const parsed = parseUnifiedDiff(op.diff)
    if (parsed.hunks.length === 0) {
      result.error = "No valid hunks found in diff"
      return result
    }

    for (const hunk of parsed.hunks) {
      const applied = applyHunkToLines(fileLines, hunk)
      if (!applied.ok) {
        result.error = `Hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ failed to match (Jaccard: ${(applied.similarity * 100).toFixed(0)}%)`
        return result
      }
      fileLines = applied.lines
      totalHunks++
      if (applied.similarity < totalSimilarity) totalSimilarity = applied.similarity
    }

    result.hunksApplied = totalHunks
    result.similarity = totalSimilarity
  } else if (op.type === "jaccard" && op.oldBlock && op.newBlock) {
    const replaced = jaccardReplace(originalContent, op.oldBlock, op.newBlock, 0.85, op.occurrence ?? 1)
    if (!replaced.ok) {
      result.error = `Jaccard match failed (similarity: ${(replaced.similarity * 100).toFixed(0)}%, threshold: 85%)`
      result.similarity = replaced.similarity
      return result
    }
    fileLines = replaced.content.split("\n")
    result.hunksApplied = 1
    result.similarity = replaced.similarity
  } else {
    result.error = "Invalid operation: patch needs diff, jaccard needs oldBlock+newBlock"
    return result
  }

  // Write result
  const newContent = fileLines.join("\n")
  const didChange = newContent !== originalContent

  if (!didChange) {
    result.status = "skipped"
    return result
  }

  saveRollback(op.filePath, originalContent)
  try {
    await writeFile(op.filePath, newContent, "utf-8")
    result.status = "ok"
  } catch (e: any) {
    result.error = `Write failed: ${e.message || e}`
  }

  return result
}

// ─── Tool factory ────────────────────────────────────────────────────────────

export function createForjaRefactorTool() {
  return tool({
    description: `Refactor multi-archivo vía diff unificado (primary) o Jaccard fuzzy match (fallback). Transaccional: rollback automático en caso de error.

**patch** (recomendado — determinista): pasa un diff unificado (---/+++/@@).
  ✅ Contexto explícito: incluye líneas alrededor del cambio para anclaje seguro.
  ✅ Multi-hunk: puedes cambiar 3 sitios distintos en 1 diff.
  ✅ Respeta indentación exacta.
  Ejemplo:
  @@ -10,5 +10,7 @@
   function oldName() {
  -  return oldThing
  +  return newThing
   }

**jaccard** (fallback — fuzzy): pasa oldBlock (lo que buscas) y newBlock (reemplazo).
  ✅ Preserva indentación automáticamente: detecta el whitespace del bloque
     en el archivo y lo aplica al reemplazo.
  ✅ occurrence: reemplaza la 1ra, 2da, o "last" ocurrencia del bloque.
  ⚠️ Similarity mínima: 85%. Si no encuentra match, reporta error.

**Orden:** las operaciones se ejecutan en el orden del array. Si la op 2 falla
  y atomic=true, las ops 0 y 1 se revierten.

**Rollback:** solo revierte archivos que ya se modificaron. Archivos no tocados
  por ops anteriores no se ven afectados. El orden del array importa.

**verify:** si es true, ejecuta forja_check (balance llaves/paréntesis/strings)
  en cada archivo modificado. Detecta parches incompletos.`,
    args: {
      operations: tool.schema.array(tool.schema.object({
        type: tool.schema.enum(["patch", "jaccard"]).describe("patch = diff unificado, jaccard = fuzzy fallback"),
        filePath: tool.schema.string().describe("Ruta absoluta al archivo"),
        diff: tool.schema.string().optional().describe("Diff unificado (para type=patch)"),
        oldBlock: tool.schema.string().optional().describe("Bloque original a reemplazar (para type=jaccard)"),
        newBlock: tool.schema.string().optional().describe("Bloque nuevo (para type=jaccard)"),
        context: tool.schema.string().optional().describe("Contexto alrededor para mejorar precisión (opcional)"),
        description: tool.schema.string().optional().describe("Descripción de este cambio (para el preview)"),
        occurrence: tool.schema.union([
          tool.schema.number().int().min(1),
          tool.schema.literal("last"),
        ]).optional().describe("Ocurrencia a reemplazar: 1=primera, 2=segunda, 'last'=última (default: 1)"),
      })).min(1).describe("Operaciones a realizar"),
      dryRun: tool.schema.boolean().default(true).describe("Preview sin aplicar cambios"),
      atomic: tool.schema.boolean().default(true).describe("Rollback todo si alguna falla"),
      verify: tool.schema.boolean().default(false).describe("Ejecutar forja_check post-parche en cada archivo modificado"),
    },
    async execute(args) {
      const operations = args?.operations
      const dryRun = args?.dryRun ?? true
      const atomic = args?.atomic ?? true
      const verify = args?.verify ?? false

      if (!operations || !Array.isArray(operations) || operations.length === 0) {
        return JSON.stringify({ ok: false, err: "Missing required parameter: \`operations\` must be a non-empty array with at least one operation." })
      }

      const results: RefactorResult[] = []
      let hasError = false

      // Phase 1: validate + apply all
      for (const op of operations) {
        if (op.type === "patch" && !op.diff) {
          results.push({ filePath: op.filePath, status: "failed", error: "patch operation requires diff (unified diff format)", fileExists: true })
          hasError = true
          continue
        }
        if (op.type === "jaccard" && (!op.oldBlock || !op.newBlock)) {
          results.push({ filePath: op.filePath, status: "failed", error: "jaccard operation requires oldBlock + newBlock", fileExists: true })
          hasError = true
          continue
        }

        // Validate diff syntax + emit warnings
        if (op.type === "patch" && op.diff) {
          const parsed = parseUnifiedDiff(op.diff)
          if (parsed.hunks.length === 0) {
            results.push({ filePath: op.filePath, status: "failed", error: "No valid hunks found in diff. Expected format: @@ -line,count +line,count @@", fileExists: true })
            hasError = true
            continue
          }

          // Warning: diff header path vs filePath (normalizado para Windows/mixed separators)
          if (parsed.filePath && op.filePath) {
            const normalize = (p: string) => p.replace(/\\/g, "/").toLowerCase()
            const headerPath = normalize(parsed.filePath)
            const opPath = normalize(op.filePath)
            if (!opPath.endsWith(headerPath) && !headerPath.endsWith(opPath) && headerPath !== opPath) {
              results.push({
                filePath: op.filePath, status: "failed",
                error: `Diff header path "${parsed.filePath}" no coincide con filePath "${op.filePath}". Usa la misma ruta en ambos.`,
                fileExists: true,
              })
              hasError = true
              continue
            }
          }

          // Warning: low context (0-1 context lines)
          const totalCtx = parsed.hunks.reduce((sum, h) => {
            return sum + h.lines.filter(l => l.startsWith(" ")).length
          }, 0)
          if (totalCtx <= 1) {
            results.push({
              filePath: op.filePath, status: "failed",
              error: `Diff tiene solo ${totalCtx} línea(s) de contexto. Incluye al menos 2-3 líneas alrededor del cambio para un match seguro.`,
              fileExists: true,
            })
            hasError = true
            continue
          }
        }

        // Run actual operation
        const r = await executePatchOp(op as RefactorOp)
        results.push(r)
        if (r.status === "failed") hasError = true

        // Verify (optional) on successfully modified files
        if (verify && r.status === "ok" && r.hunksApplied && r.hunksApplied > 0) {
          try {
            const content = await readFile(r.filePath, "utf-8")
            const sieve = new ForjaSieve()
            const sieveResult = await sieve.checkEdit(r.filePath, content)
            if (!sieveResult.valid) {
              const issues = sieveResult.issues.filter(i => i.type === "error").slice(0, 5)
              r.status = "failed"
              r.error = `Sieve check failed: ${issues.map(i => `L${i.line}:${i.column} ${i.message}`).join("; ")}`
              hasError = true
            }
          } catch {
            // fail-soft if sieve can't read the file
          }
        }
      }

      // If dryRun: rollback + show preview
      if (dryRun) {
        const rollbackErrors = rollbackAll()
        const preview = results.map(r => {
          if (r.status === "ok") return `  ✅ ${r.filePath}${r.hunksApplied ? ` (${r.hunksApplied} hunk(s))` : ""}${r.description ? ` — ${r.description}` : ""}`
          if (r.status === "skipped") return `  ➖ ${r.filePath} — sin cambios${r.description ? ` (${r.description})` : ""}`
          if (r.status === "failed") return `  ❌ ${r.filePath} — ${r.error}${r.description ? ` (${r.description})` : ""}`
          return ""
        }).filter(Boolean).join("\n")

        let msg = `## 🔍 Dry-run — Preview\n\n${preview || "  (sin operaciones)"}`
        if (hasError) {
          const failCount = results.filter(r => r.status === "failed").length
          msg += `\n\n⚠️  ${failCount} operación(es) van a FALLAR. Corrige los errores antes de aplicar.`
          return JSON.stringify({ ok: false, err: msg })
        }
        msg += "\n\n_Pasa `dryRun: false` para aplicar._"
        return JSON.stringify({ ok: true, data: msg })
      }

      // If not dry-run and atomic + hasError: rollback everything
      if (atomic && hasError) {
        const rollbackErrors = rollbackAll()
        const okCount = results.filter(r => r.status === "ok").length
        const failCount = results.filter(r => r.status === "failed").length
        const skippedCount = results.filter(r => r.status === "skipped").length

        let msg = `## ⛔ Atomic rollback — ${failCount} operación(es) fallaron\n\n`
        msg += `Aplicados: ${okCount} | Saltados: ${skippedCount} | Fallos: ${failCount}\n\n`
        msg += "Se revirtieron TODOS los cambios.\n\nDetalles:\n"
        msg += results.map(r => {
          if (r.status === "ok") return `  ✅ ${r.filePath} (revertido)${r.description ? ` — ${r.description}` : ""}`
          if (r.status === "skipped") return `  ➖ ${r.filePath} — sin cambios`
          if (r.status === "failed") return `  ❌ ${r.filePath} — ${r.error}`
          return ""
        }).filter(Boolean).join("\n")

        if (rollbackErrors.length > 0) {
          msg += `\n\n⚠️  Errores de rollback:\n${rollbackErrors.map(e => `  ${e}`).join("\n")}`
        }

        return JSON.stringify({ ok: false, err: msg })
      }

      // Success (or non-atomic with some errors)
      commit()
      const okCount = results.filter(r => r.status === "ok").length
      const failCount = results.filter(r => r.status === "failed").length
      const skippedCount = results.filter(r => r.status === "skipped").length

      let msg = `## ✅ Refactor completado\n\n`
      msg += `Aplicados: ${okCount} | Saltados: ${skippedCount}${failCount > 0 ? ` | Fallos: ${failCount}` : ""}\n\n`
      msg += results.map(r => {
        if (r.status === "ok") return `  ✅ ${r.filePath}${r.hunksApplied ? ` (${r.hunksApplied} hunk(s))` : ""}${r.similarity !== undefined && r.similarity < 1 ? ` [Jaccard: ${(r.similarity * 100).toFixed(0)}%]` : ""}${r.description ? ` — ${r.description}` : ""}${r.error ? ` ⚠️ ${r.error}` : ""}`
        if (r.status === "skipped") return `  ➖ ${r.filePath} — sin cambios`
        if (r.status === "failed") return `  ❌ ${r.filePath} — ${r.error}`
        return ""
      }).filter(Boolean).join("\n")

      return JSON.stringify({ ok: failCount === 0, data: msg, err: failCount > 0 ? `${failCount} fallo(s)` : undefined })
    },
  })
}
