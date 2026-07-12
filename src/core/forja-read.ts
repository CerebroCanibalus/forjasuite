import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "../shared/types.js"
import { logSync } from "../shared/logger.js"
import { ok, fail } from "../shared/response.js"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Buffer } from "node:buffer"

// ============================================================================
// FILE TYPE DETECTION
// ============================================================================

const CODE_EXTENSIONS = new Set([
  // Standard languages
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi", ".gd", ".nut", ".rs", ".go",
  ".java", ".cpp", ".c", ".h", ".hpp", ".cs",
  ".php", ".rb", ".swift", ".kt", ".kts",
  ".sql", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  // Web
  ".css", ".scss", ".less", ".html", ".vue", ".svelte", ".astro", ".htm",
  // Data / config
  ".yml", ".yaml", ".toml", ".json", ".jsonc", ".json5",
  ".ini", ".cfg", ".conf", ".properties", ".env",
  ".csv", ".tsv", ".xml", ".xsd", ".dtd", ".xslt",
  ".plist", ".gradle", ".sbt", ".mak", ".mk", ".cmake",
  // Game engines
  ".lua", ".hlsl", ".glsl", ".cg", ".shader", ".fx", ".wgsl",
  ".gdshader", ".gdshaderinc", ".gdextension", ".tscn", ".tres",
  // Minecraft
  ".mcfunction", ".mcmeta", ".mcstructure",
  // LaTeX / docs
  ".tex", ".sty", ".cls", ".bib", ".bst", ".ltx",
  ".adoc", ".asciidoc", ".rest", ".rst", ".org", ".wiki",
  // Legacy / niche languages
  ".f", ".f90", ".f95", ".f03", ".f08", ".for", ".pas", ".pp",
  ".lisp", ".clj", ".cljs", ".edn",
  ".erl", ".hrl", ".ex", ".exs", ".heex", ".leex",
  ".hs", ".lhs", ".ml", ".mli",
  ".scala", ".sc", ".kt", ".kts",
  ".r", ".rdata", ".rmd",
  ".dart", ".groovy", ".julia", ".jl",
  ".nim", ".zig", ".odin", ".v", ".c3",
  ".asm", ".s", ".inc",
  // L4D2 / Source engine
  ".vdf", ".res", ".txt", ".game", ".qc", ".qci",
  ".smx", ".sp",
])

const DOC_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".org",
  ".adoc", ".asciidoc", ".rdoc", ".doc", ".docx",
  ".log", ".changelog", ".changes", ".release-notes",
  ".readme", ".license", ".copying",
])

type FileKind = "doc" | "code" | "text"

function detectKind(filePath: string): FileKind {
  const lower = filePath.toLowerCase()
  for (const ext of DOC_EXTENSIONS) { if (lower.endsWith(ext)) return "doc" }
  for (const ext of CODE_EXTENSIONS) { if (lower.endsWith(ext)) return "code" }
  return "text"
}

// ============================================================================
// CHUNKING
// ============================================================================

interface Chunk { heading: string; content: string[]; level: number }

function isMdHeading(line: string): boolean { return /^#{1,6}\s+/.test(line) }

function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s+/)
  return m ? m[1].length : 0
}

function chunkByHeadings(doc: string): Chunk[] {
  const chunks: Chunk[] = []
  const lines = doc.split("\n")
  let cur: Chunk = { heading: "root", content: [], level: 0 }
  for (const line of lines) {
    if (isMdHeading(line)) {
      if (cur.content.length > 0) chunks.push(cur)
      cur = { heading: line.replace(/^#+\s+/, ""), content: [], level: headingLevel(line) }
    } else {
      cur.content.push(line)
    }
  }
  if (cur.content.length > 0) chunks.push(cur)
  return chunks
}

// ============================================================================
// CODE PARSING
// ============================================================================

interface CodeStructure {
  imports: string[]
  exports: string[]
  functions: { name: string; signature: string; line: number }[]
  classes: { name: string; extends?: string; line: number }[]
  signals: { name: string; line: number }[]
  variables: { name: string; line: number }[]
  complexity: { total: number; functions: number; classes: number }
}

function parseCodeStructure(code: string, ext: string, mode: "full" | "skeleton" = "full"): CodeStructure {
  const lines = code.split("\n")
  const language = getLanguageRules(ext)
  const isBraceLang = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "cpp", "c", "h", "hpp", "cs", "php", "go", "rs", "swift", "kt", "kts", "nut", "json", "jsonc", "css", "scss", "less"].includes(ext)
  let braceDepth = 0
  const structure: CodeStructure = {
    imports: [], exports: [], functions: [], classes: [],
    signals: [], variables: [], complexity: { total: lines.length, functions: 0, classes: 0 },
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const l = line.trim(); const n = i + 1

    if (isBraceLang) { braceDepth += countBraceDelta(line); if (braceDepth < 0) braceDepth = 0 }

    if (mode !== "skeleton") {
      if (language.importRegex.test(l)) structure.imports.push(`${n}: ${l.slice(0, 80)}`)
      if (language.exportRegex.test(l)) structure.exports.push(`${n}: ${l.slice(0, 80)}`)
    }

    const fnMatch = l.match(language.fnRegex)
    if (fnMatch) {
      const name = fnMatch[1] || fnMatch[2] || fnMatch[3] || fnMatch[4] || fnMatch[5] || fnMatch[6] || fnMatch[7]
      structure.functions.push({ name, signature: mode === "skeleton" ? name : l.slice(0, 100), line: n })
      structure.complexity.functions++
    }

    const classMatch = l.match(language.classRegex)
    if (classMatch) {
      const name = classMatch[1] || classMatch[3] || classMatch[4]
      structure.classes.push({ name, extends: classMatch[2] || classMatch[5] || undefined, line: n })
      structure.complexity.classes++
    }

    if (mode !== "skeleton") {
      const varMatch = l.match(language.varRegex)
      if (varMatch) structure.variables.push({ name: varMatch[1], line: n })
      if (ext === "gd") {
        const sigMatch = l.match(/^signal\s+(\w+)/)
        if (sigMatch) structure.signals.push({ name: sigMatch[1], line: n })
      }
    }
  }
  return structure
}

function countBraceDelta(line: string): number {
  let delta = 0, inString = false, stringChar = ""
  for (let i = 0; i < line.length; i++) {
    const ch = line[i], prev = line[i - 1]
    if (inString) { if (ch === stringChar && prev !== "\\") inString = false; continue }
    if (ch === '"' || ch === "'" || ch === "`") { inString = true; stringChar = ch; continue }
    if (ch === "{") delta++; else if (ch === "}") delta--
  }
  return delta
}

interface LanguageRules { fnRegex: RegExp; classRegex: RegExp; varRegex: RegExp; importRegex: RegExp; exportRegex: RegExp }

function getLanguageRules(ext: string): LanguageRules {
  switch (ext) {
    case "nut": case "gnut": return {
      fnRegex: /(?:function\s+(\w+)|(?:local\s+)?(\w+)\s*:\s*function|\b(\w+)\s*<-\s*function)/,
      classRegex: /class\s+(\w+)(?:\s+extends\s+(\w+))?/,
      varRegex: /^(?:local\s+)?(\w+)\s*(?:<-|=)\s*/,
      importRegex: /^(?:#include|require|dofile|loadfile)\s/,
      exportRegex: /__Collect(?:Game)?EventCallbacks/,
    }
    case "gd": return {
      fnRegex: /(?:func\s+(\w+)|static\s+func\s+(\w+))/,
      classRegex: /(?:class\s+(\w+)(?:\s+extends\s+(\w+))?|class_name\s+(\w+))/,
      varRegex: /^(?:@export\s+)?(?:var|const)\s+(\w+)/,
      importRegex: /^(?:extends|class_name|const|preload|load)\s/,
      exportRegex: /^@tool|^@export/,
    }
    case "py": case "pyi": return {
      fnRegex: /(?:def\s+(\w+)|async\s+def\s+(\w+))/,
      classRegex: /class\s+(\w+)\s*(?:\(([^)]*)\))?/,
      varRegex: /^(?:\w+\s*=|(?:global|nonlocal)\s+(\w+))/,
      importRegex: /^(?:import|from)\s/,
      exportRegex: /^(?:__all__|def\s|class\s)/,
    }
    case "rs": return {
      fnRegex: /(?:fn\s+(\w+)|pub\s+fn\s+(\w+)|async\s+fn\s+(\w+))/,
      classRegex: /(?:struct\s+(\w+)|enum\s+(\w+)|trait\s+(\w+)|impl\s+(?:(\w+)\s+for\s+)?(\w+))/,
      varRegex: /^(?:let\s+mut|let|const|static|pub\s+static)\s+(\w+)/,
      importRegex: /^(?:use|mod)\s/,
      exportRegex: /^pub\s/,
    }
    case "go": return {
      fnRegex: /func\s+(?:\([^)]*\)\s*)?(\w+)/,
      classRegex: /(?:type\s+(\w+)\s+struct|type\s+(\w+)\s+interface)/,
      varRegex: /^(?:var|const)\s+(\w+)|^(\w+)\s*:=/,
      importRegex: /^import\s/,
      exportRegex: /^func\s|^[A-Z]/,
    }
    case "lua": return {
      fnRegex: /(?:function\s+(\w+(?:\.\w+)*)|local\s+function\s+(\w+))/,
      classRegex: /(\w+)\s*=\s*\{/,
      varRegex: /^(?:local\s+)?(\w+)\s*=/,
      importRegex: /^(?:require|dofile|loadfile)\s/,
      exportRegex: /^(?:module|return)/,
    }
    case "gdshader": case "gdshaderinc": return {
      fnRegex: /(?:void\s+(\w+)|fragment\s*\(|vertex\s*\()/,
      classRegex: /shader_type\s+(\w+)/,
      varRegex: /uniform\s+(?:\w+\s+)*(\w+)/,
      importRegex: /^#include/,
      exportRegex: /^\w+\s*\(/,
    }
    default: return {
      fnRegex: /(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:def\s+(\w+))|(?:fn\s+(\w+))|(?:func\s+(\w+))|(?:(\w+)\s*:=\s*function)|(\w+)\s*\([^)]*\)\s*\{)/,
      classRegex: /(?:class\s+(\w+)(?:\s+extends\s+(\w+))?|export\s+class\s+(\w+)|interface\s+(\w+)(?:\s+extends\s+([^{]+))?)/,
      varRegex: /^(?:const|let|var|local)\s+(\w+)\s*[:=]/,
      importRegex: /^(?:import|from|#include|require|use)/,
      exportRegex: /^(?:export|pub\s)/,
    }
  }
}

// ============================================================================
// KEYWORDS & SCORING
// ============================================================================

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || []
  const freq: Record<string, number> = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w)
}

const regexCacheForScore = new Map<string, RegExp>()
function getRegex(pattern: string): RegExp {
  let re = regexCacheForScore.get(pattern)
  if (!re) { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); regexCacheForScore.set(pattern, re) }
  return re
}

function chunkScore(chunk: Chunk, keywords: string[]): number {
  const text = (chunk.heading + " " + chunk.content.join(" ")).toLowerCase()
  let score = 0
  for (const kw of keywords) { const m = text.match(getRegex(kw)); if (m) score += m.length }
  return score
}

// ============================================================================
// PARALLEL MAP
// ============================================================================

async function parallelMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 5): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    results.push(...await Promise.all(items.slice(i, i + concurrency).map(fn)))
  }
  return results
}

// ============================================================================
// OUTPUT FORMATTING
// ============================================================================

interface ReadOptions { compact: boolean; lineNumbers: boolean; tokenBudget?: number }

function compactText(text: string): string {
  return text.split("\n").map(l => l.trimEnd()).reduce<string[]>((acc, line) => {
    if (line.trim() === "" && acc.length > 0 && acc[acc.length - 1].trim() === "") return acc
    acc.push(line); return acc
  }, []).join("\n").trim()
}

function addLineNumbers(text: string, startLine = 1): string {
  const lines = text.split("\n")
  const width = String(startLine + lines.length - 1).length
  return lines.map((l, i) => `${String(startLine + i).padStart(width, " ")}│${l}`).join("\n")
}

function applyOutputOptions(text: string, opts: ReadOptions, startLine = 1, ext = ""): string {
  let out = text
  if (opts.compact) out = compactText(out)
  if (opts.lineNumbers) out = addLineNumbers(out, startLine)
  if (opts.tokenBudget && opts.tokenBudget > 0) {
    const maxChars = opts.tokenBudget * 4
    if (out.length > maxChars) out = out.slice(0, maxChars) + `\n\n[...truncado a ~${opts.tokenBudget} tokens...]`
  }
  return out
}

function estimateTokens(text: string): number { return Math.ceil(text.length / 4) }

// ============================================================================
// CACHE (LRU, max 100)
// ============================================================================

interface CacheEntry { mtimeMs: number; output: string }

const readCache = new Map<string, CacheEntry>()
const CACHE_MAX = 100

function cacheKey(filePath: string, args: any): string {
  return JSON.stringify({ filePath, action: args.action, query: args.query, symbol: args.symbol,
    compact: args.compact, line_numbers: args.line_numbers, max_tokens: args.max_tokens, token_budget: args.token_budget })
}

async function getCached(filePath: string, args: any): Promise<{ output: string; hit: boolean } | null> {
  if (!args.cache) return null
  const entry = readCache.get(cacheKey(filePath, args))
  if (!entry) return null
  try { const s = await stat(filePath); if (s.mtimeMs === entry.mtimeMs) return { output: entry.output, hit: true } } catch { /* */ }
  return null
}

function markCached(output: string): string { return JSON.stringify({ ok: true, data: output, cached: true }) }

async function setCached(filePath: string, args: any, output: string): Promise<void> {
  if (!args.cache) return
  if (readCache.size >= CACHE_MAX) { const k = readCache.keys().next().value; if (k !== undefined) readCache.delete(k) }
  try { const s = await stat(filePath); readCache.set(cacheKey(filePath, args), { mtimeMs: s.mtimeMs, output }) } catch { /* */ }
}

// ============================================================================
// FILE HELPERS — con fallback de encoding para archivos raros
// ============================================================================

async function readFileContent(_$: any, filePath: string): Promise<string> {
  // Leer raw bytes primero para detectar encoding
  const raw = await readFile(filePath).catch(() => { throw new Error(`Cannot read: ${filePath}`) })

  // Detectar BOM
  if (raw.length >= 2) {
    if (raw[0] === 0xFF && raw[1] === 0xFE) {
      // UTF-16LE con BOM
      return raw.toString("utf16le").replace(/^\uFEFF/, "")
    }
    if (raw[0] === 0xFE && raw[1] === 0xFF) {
      return raw.toString("utf16le", 1) // swap — utf16le parser para BE, no perfecto pero mejor que crash
    }
  }
  if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    return raw.toString("utf8").slice(1) // UTF-8 BOM
  }

  // Try UTF-8 first
  try {
    return raw.toString("utf8")
  } catch {
    // Try UTF-16LE next
    try {
      return raw.toString("utf16le")
    } catch {
      // Latin-1 nunca falla — todo byte es válido
      // Check si no es binario: si hay >10% de bytes de control (0x00-0x08, 0x0E-0x1F) salvo \n\r\t, es binario
      let ctrlCount = 0
      for (let i = 0; i < Math.min(raw.length, 4096); i++) {
        const b = raw[i]
        if ((b < 0x09) || (b > 0x0D && b < 0x20)) ctrlCount++
      }
      const threshold = Math.min(raw.length, 4096) * 0.1
      if (ctrlCount > threshold) {
        // Parece binario — mostrar hex dump de los primeros bytes
        return renderBinaryPreview(filePath, raw)
      }
      return raw.toString("latin1")
    }
  }
}

function renderBinaryPreview(filePath: string, raw: Buffer): string {
  const size = raw.length
  const preview = raw.slice(0, 256)
  const hexRows: string[] = []
  for (let i = 0; i < preview.length; i += 16) {
    const hex = Array.from(preview.slice(i, i + 16)).map(b => b.toString(16).padStart(2, "0")).join(" ")
    const ascii = Array.from(preview.slice(i, i + 16)).map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : ".").join("")
    hexRows.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`)
  }
  return [
    `# Binary file: ${path.basename(filePath)}`,
    `**Size:** ${size} bytes (${(size / 1024).toFixed(1)} KB)`,
    `**MIME:** ${guessMimeFromMagic(raw)}`,
    ``,
    `## Hex dump (first ${Math.min(size, 256)} bytes)`,
    ...hexRows,
    size > 256 ? `\n... ${size - 256} more bytes (truncated)` : "",
  ].join("\n")
}

function guessMimeFromMagic(raw: Buffer): string {
  if (raw.length < 4) return "application/octet-stream"
  const magic = Array.from(raw.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join(" ")
  const map: Record<string, string> = {
    "50 4b 03 04": "application/zip",
    "50 4b 05 06": "application/zip (empty)",
    "50 4b 07 08": "application/zip (spanned)",
    "1f 8b 08 00": "application/gzip",
    "1f 8b 08 08": "application/gzip",
    "42 5a 68": "application/bzip2",
    "28 b5 2f fd": "application/zstd",
    "89 50 4e 47": "image/png",
    "ff d8 ff e0": "image/jpeg",
    "ff d8 ff e1": "image/jpeg (exif)",
    "47 49 46 38": "image/gif",
    "52 49 46 46": "image/webp",
    "25 50 44 46": "application/pdf",
    "7f 45 4c 46": "application/x-elf",
    "4d 5a": "application/x-dosexec",
    "ca fe ba be": "application/java-class",
    "44 49 43 4d": "image/dicom",
    "00 00 00 18": "video/mp4 (ftyp)",
    "00 00 00 1c": "video/mp4 (ftyp)",
    "66 74 79 70": "video/mp4 (ftyp)",
    "1a 45 df a3": "video/webm (matroska)",
    "4f 67 67 53": "application/ogg",
  }
  for (const [sig, mime] of Object.entries(map)) {
    const sigBytes = sig.split(" ").map(s => parseInt(s, 16))
    if (sigBytes.every((b, i) => b === raw[i])) return mime
  }
  return "application/octet-stream"
}

function resolvePath(file: string, worktree: string, directory: string): string {
  return path.isAbsolute(file) ? file : path.resolve(worktree || directory, file)
}

// ============================================================================
// BLOCK EXTRACTION (for context action)
// ============================================================================

function isBraceLanguage(ext: string): boolean {
  return ["ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "cpp", "c", "h", "hpp", "cs", "php", "go", "rs", "swift", "kt", "kts",
    "nut", "gnut", "json", "jsonc", "json5", "css", "scss", "less",
    "lua", "groovy", "scala", "dart", "zig", "odin", "v",
  ].includes(ext)
}

function isIndentLanguage(ext: string): boolean {
  return ["py", "pyi", "gd", "gdshader", "gdshaderinc", "yml", "yaml", "nim", "julia", "jl", "c3", "svelte", "vue"].includes(ext)
}

function findSymbolBlock(lines: string[], symbol: string, ext: string): { start: number; end: number; signature: string } | null {
  const lowerSymbol = symbol.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    const match = l.toLowerCase().includes(lowerSymbol) && (
      /\b(func|def|function|fn|class|signal)\s+\b/.test(l) || /\b(class|struct|enum|trait|interface|type)\s+\b/.test(l) ||
      /\b\w+\s*[:=]\s*function\b/.test(l) || /\b\w+\s*\([^)]*\)\s*[{:=]/.test(l))
    if (!match) continue
    const nameRegex = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    if (!nameRegex.test(l)) continue

    let end = lines.length - 1
    if (isBraceLanguage(ext)) {
      let braceDepth = 0, foundOpen = false, inString = false, stringChar = ""
      for (let j = i; j < lines.length; j++) {
        for (let k = 0; k < lines[j].length; k++) {
          const ch = lines[j][k], prev = lines[j][k - 1]
          if (inString) { if (ch === stringChar && prev !== "\\") inString = false; continue }
          if (ch === '"' || ch === "'" || ch === "`") { inString = true; stringChar = ch; continue }
          if (ch === "{") { braceDepth++; foundOpen = true } else if (ch === "}" && foundOpen && --braceDepth === 0) { end = j; j = lines.length; break }
        }
      }
    } else if (isIndentLanguage(ext)) {
      const baseIndent = lines[i].match(/^(\s*)/)?.[1].length ?? 0
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim()
        if (trimmed === "") continue
        if ((lines[j].match(/^(\s*)/)?.[1].length ?? 0) <= baseIndent) { end = j - 1; break }
      }
    } else { end = Math.min(lines.length - 1, i + 39) }
    return { start: i, end, signature: lines[i] }
  }
  return null
}

function findSymbolReferences(lines: string[], symbol: string): { line: number; text: string }[] {
  const refs: { line: number; text: string }[] = []
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
  for (let i = 0; i < lines.length; i++) { if (re.test(lines[i])) refs.push({ line: i + 1, text: lines[i].trim() }) }
  return refs.slice(0, 10)
}

// ============================================================================
// THE UNIFIED TOOL
// ============================================================================

export function createForjaReadTool(client: any): ToolDefinition {
  return tool({
    description: `Universal file reader for OpenCode. Auto-detects file type and applies optimal reading strategy.

**Actions:**
- **scan**: Quick structure overview (headings for docs, functions/classes for code, paragraphs for text). Use FIRST to understand what's in a file.
- **extract**: Pull specific content by keywords or exact heading. For docs: use query="## Section Name" for exact section match, or keywords for fuzzy scoring. For code: function matching.
- **skeleton**: Ultra-compact outline: only function/class/variable names and line numbers. Minimal tokens.
- **context**: Given a symbol name, returns its signature, full body, and internal references.
- **batch**: Process multiple files in parallel. Modes: scan, extract, skeleton, context.

**Output options:**
- **compact**: Collapse blank lines and trim trailing whitespace.
- **line_numbers**: Prefix every line with its 1-based number (helps native Edit).
- **token_budget**: Hard cap output to ~N tokens.
- **cache**: Return cached output if file hasn't changed since last read.

**File types supported:** .ts/.tsx/.js/.py/.gd/.nut/.gnut/.rs/.go/.lua/.gdshader + 80+ extensions incluyendo Minecraft (.mcfunction/.mcmeta), Godot (.tscn/.tres), L4D2 (.vdf/.qc/.smx/.sp), LaTeX (.tex/.sty), configs (.ini/.cfg/.conf/.properties), data (.csv/.xml/.plist), legacy (.f/.pas/.lisp/.asm), y más.

**Binary fallback:** si un archivo no es texto, forja_read muestra un hex dump + magic bytes + tamaño + MIME detectado.

**Encoding auto-detection:** UTF-8, UTF-16 (BOM), Latin-1, y detección de archivos binarios.`,

    args: {
      action: tool.schema
        .enum(["scan", "extract", "skeleton", "context", "batch"])
        .describe("What to do with the file(s)"),
      file: tool.schema.string().optional()
        .describe("Single file path (for scan, extract, skeleton, context)"),
      files: tool.schema.array(tool.schema.string()).optional()
        .describe("Multiple file paths (for batch)"),
      query: tool.schema.string().optional()
        .describe("Search query, keywords (comma-separated for extract), or `## Heading Name` for exact section match"),
      symbol: tool.schema.string().optional()
        .describe("Symbol name for context action"),
      max_tokens: tool.schema.number().optional()
        .describe("Max tokens in output (default: 500)"),
      token_budget: tool.schema.number().optional()
        .describe("Hard cap output to ~N tokens (overrides max_tokens)"),
      compact: tool.schema.boolean().optional()
        .describe("Collapse blank lines and trim trailing whitespace"),
      line_numbers: tool.schema.boolean().optional()
        .describe("Prefix lines with 1-based line numbers"),
      cache: tool.schema.boolean().optional()
        .describe("Use cached output if file hasn't changed since last read"),
    },

    async execute(args, context) {
      const $ = (context as any).$
      const worktree = (context as any).worktree || ""
      const directory = (context as any).directory || ""

      try {
        switch (args.action) {
          case "scan": return await handleScan(args, $, worktree, directory)
          case "extract": return await handleExtract(args, $, worktree, directory)
          case "skeleton": return await handleSkeleton(args, $, worktree, directory)
          case "context": return await handleContext(args, $, worktree, directory)
          case "batch": return await handleBatch(args, $, worktree, directory)
          default: return fail(`Unknown action: ${args.action}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logSync(client, { service: "read", level: "error", message: `${args.action}: ${msg}` })
        return fail(`${args.action}: ${msg}`)
      }
    },
  })
}

function makeOpts(args: any): ReadOptions {
  return { compact: !!args.compact, lineNumbers: !!args.line_numbers, tokenBudget: args.token_budget || args.max_tokens }
}

// ── SCAN ──

async function handleScan(args: any, $: any, worktree: string, directory: string): Promise<string> {
  if (!args.file) return fail("Missing --file")
  const path = resolvePath(args.file, worktree, directory)
  const cached = await getCached(path, args)
  if (cached) return markCached(cached.output)

  const content = await readFileContent($, path)
  const kind = detectKind(args.file)
  const opts = makeOpts(args)
  const ext = args.file.split(".").pop() || ""

  let result = ""
  if (kind === "doc") {
    const chunks = chunkByHeadings(content)
    const codeBlocks = (content.match(/```[\s\S]*?```/g) || []).length
    const tables = (content.match(/\|.+\|/g) || []).length
    result = [
      `# scan: ${args.file} (doc)`,
      `**Secciones:** ${chunks.length} | **Code blocks:** ${codeBlocks} | **Tablas:** ${tables} | **Tokens:** ~${estimateTokens(content)}`,
      `## Headings`,
      ...chunks.slice(0, 15).map(c => `${"  ".repeat(Math.max(0, c.level - 1))}- ${c.heading}`),
    ].join("\n")
  } else if (kind === "code") {
    const structure = parseCodeStructure(content, ext)
    const lines = content.split("\n")
    result = [
      `# scan: ${args.file} (code :: ${ext})`,
      `**Líneas:** ${lines.length} | **Funciones:** ${structure.functions.length} | **Clases:** ${structure.classes.length} | **Imports:** ${structure.imports.length}`,
      structure.imports.length > 0 ? `## Imports\n${structure.imports.slice(0, 10).join("\n")}` : "",
      structure.classes.length > 0 ? `\n## Classes\n${structure.classes.map(c => `- \`${c.name}\`${c.extends ? ` extends ${c.extends}` : ""} (line ${c.line})`).join("\n")}` : "",
      structure.functions.length > 0 ? `\n## Functions\n${structure.functions.slice(0, 20).map(f => `- \`${f.name}\` (line ${f.line})`).join("\n")}` : "",
      structure.variables.length > 0 ? `\n## Variables\n${structure.variables.map(v => `\`${v.name}\` [L${v.line}]`).slice(0, 10).join(", ")}` : "",
    ].filter(Boolean).join("\n")
  } else {
    const paragraphs = content.split(/\n\n+/)
    result = `# scan: ${args.file} (text)\n**Líneas:** ${content.split("\n").length} | **Párrafos:** ${paragraphs.length} | **Tokens:** ~${estimateTokens(content)}\n\n${paragraphs.slice(0, 3).map((p, i) => `## Section ${i + 1}\n${p.slice(0, 200)}...`).join("\n\n")}`
  }

  result = applyOutputOptions(result, opts, 1, ext)
  await setCached(path, args, result)
  return ok(result)
}

// ── EXTRACT ──

async function handleExtract(args: any, $: any, worktree: string, directory: string): Promise<string> {
  if (!args.file || !args.query) return fail("Missing --file and --query")
  const path = resolvePath(args.file, worktree, directory)
  const cached = await getCached(path, args)
  if (cached) return markCached(cached.output)

  const content = await readFileContent($, path)
  const kind = detectKind(args.file)
  const keywords = args.query.split(",").map((k: string) => k.trim())
  const maxTokens = args.max_tokens || 1000
  const opts = makeOpts(args)
  const ext = args.file.split(".").pop() || ""

  let result = ""
  if (kind === "doc") {
    const chunks = chunkByHeadings(content)
    if (/^#+\s/.test(keywords[0])) {
      const target = keywords[0].replace(/^#+\s*/, "").toLowerCase()
      const match = chunks.find(c => c.heading.toLowerCase() === target || c.heading.toLowerCase().includes(target))
      if (match) {
        result = `# ${match.heading}\n${match.content.join("\n")}`
        result = applyOutputOptions(result, opts, 1, ext)
        await setCached(path, args, result)
        return ok(result)
      }
      result = `Heading "${keywords[0].replace(/^#+\s*/, "")}" no encontrado.\nSecciones:\n${chunks.map(c => `- ## ${c.heading}`).join("\n")}`
      await setCached(path, args, result)
      return fail(`Heading no encontrado: ${keywords[0].replace(/^#+\s*/, "")}`)
    }

    const scored = chunks.map(c => ({ chunk: c, score: chunkScore(c, keywords) })).filter(c => c.score > 0).sort((a, b) => b.score - a.score)
    let out = "", used = 0
    for (const { chunk } of scored) {
      const text = chunk.content.join("\n").trim()
      const cost = estimateTokens(text)
      if (used + cost <= maxTokens) { out += `## ${chunk.heading}\n${text}\n\n`; used += cost } else break
    }
    result = `# extract: ${args.file}\n**Keywords:** ${keywords.join(", ")}\n**Tokens:** ~${used}\n\n${out || "No relevant sections found."}`
  } else if (kind === "code") {
    const lines = content.split("\n")
    const matching: string[] = []
    for (let i = 0; i < lines.length; i++) {
      if (keywords.some((kw: string) => lines[i].toLowerCase().includes(kw.toLowerCase()))) {
        const start = Math.max(0, i - 2), end = Math.min(lines.length, i + 3)
        for (let j = start; j < end; j++) matching.push(`${j + 1}: ${lines[j]}`)
        matching.push("---")
      }
    }
    result = `# extract: ${args.file} (code)\n\n${[...new Set(matching)].slice(0, 50).join("\n")}`
  } else {
    const paragraphs = content.split(/\n\n+/)
    const relevant = paragraphs.filter(p => keywords.some((kw: string) => p.toLowerCase().includes(kw.toLowerCase())))
    result = `# extract: ${args.file}\n\n${relevant.slice(0, 5).map((p, i) => `## Match ${i + 1}\n${p.slice(0, 300)}`).join("\n\n")}`
  }

  result = applyOutputOptions(result, opts, 1, ext)
  await setCached(path, args, result)
  return ok(result)
}

// ── SKELETON ──

async function handleSkeleton(args: any, $: any, worktree: string, directory: string): Promise<string> {
  if (!args.file) return fail("Missing --file")
  const path = resolvePath(args.file, worktree, directory)
  const cached = await getCached(path, args)
  if (cached) return markCached(cached.output)

  const content = await readFileContent($, path)
  const kind = detectKind(args.file)
  const opts = makeOpts(args)
  const ext = args.file.split(".").pop() || ""

  if (kind !== "code") return ok(applyOutputOptions(`# skeleton: ${args.file}\n\nNot a code file. Use 'scan' for docs.`, opts, 1, ext))

  const structure = parseCodeStructure(content, ext, "skeleton")
  const out = [`# skeleton: ${args.file} (${ext})`, `**Funcs:** ${structure.functions.length} | **Classes:** ${structure.classes.length}`, ""]
  if (structure.functions.length > 0) out.push("## functions", ...structure.functions.map(f => `- ${f.name} [L${f.line}]`), "")
  if (structure.classes.length > 0) out.push("## classes", ...structure.classes.map(c => `- ${c.name} [L${c.line}]`))

  const result = applyOutputOptions(out.filter(Boolean).join("\n"), opts, 1, ext)
  await setCached(path, args, result)
  return ok(result)
}

// ── CONTEXT ──

async function handleContext(args: any, $: any, worktree: string, directory: string): Promise<string> {
  if (!args.file) return fail("Missing --file")
  if (!args.symbol) return fail("Missing --symbol for context action")
  const path = resolvePath(args.file, worktree, directory)
  const cached = await getCached(path, args)
  if (cached) return markCached(cached.output)

  const content = await readFileContent($, path)
  const kind = detectKind(args.file)
  const opts = makeOpts(args)
  const ext = args.file.split(".").pop() || ""

  if (kind !== "code") return ok(applyOutputOptions(`# context: ${args.file}\n\nNot a code file. Use 'scan' or 'extract'.`, opts, 1, ext))

  const lines = content.split("\n")
  const block = findSymbolBlock(lines, args.symbol, ext)
  if (!block) {
    const structure = parseCodeStructure(content, ext, "skeleton")
    const names = [...structure.functions.map(f => f.name), ...structure.classes.map(c => c.name), ...structure.variables.map(v => v.name)]
    const similar = names.filter(n => n.toLowerCase().includes(args.symbol.toLowerCase()) || args.symbol.toLowerCase().includes(n.toLowerCase()))
    return ok(applyOutputOptions(`# context: ${args.file}\n**Symbol not found:** \`${args.symbol}\`\n${similar.length > 0 ? `\nDid you mean: ${similar.map(s => `\`${s}\``).join(", ")}?` : ""}`, opts, 1, ext))
  }

  const body = lines.slice(block.start, block.end + 1).join("\n")
  const refs = findSymbolReferences(lines, args.symbol).filter(r => r.line < block.start + 1 || r.line > block.end + 1)
  const out = [`# context: ${args.symbol} in ${args.file}`, `**Lines:** ${block.start + 1}-${block.end + 1}`, `**Tokens:** ~${estimateTokens(body)}`, "", "## body", body]
  if (refs.length > 0) out.push("", "## references", ...refs.map(r => `- L${r.line}: ${r.text}`))

  const result = applyOutputOptions(out.join("\n"), { ...opts, lineNumbers: opts.lineNumbers || true }, block.start + 1, ext)
  await setCached(path, args, result)
  return ok(result)
}

// ── BATCH (ultra-efficient) ──

async function handleBatch(args: any, $: any, worktree: string, directory: string): Promise<string> {
  if (!args.files || args.files.length === 0) return fail("Missing --files")
  const mode = args.query || "skeleton"
  if (!["scan", "extract", "skeleton", "context"].includes(mode)) return fail(`Unsupported batch mode: ${mode}. Use: scan, extract, skeleton, context`)

  const results = await parallelMap(args.files.slice(0, 20), async (file: string) => {
    try {
      const fullPath = resolvePath(file, worktree, directory)
      const content = await readFileContent($, fullPath)
      const kind = detectKind(file)
      const ext = file.split(".").pop() || ""
      let output = ""

      if (mode === "skeleton") {
        if (kind !== "code") { output = "(not code)" }
        else { const s = parseCodeStructure(content, ext, "skeleton"); output = `fn:${s.functions.length} cls:${s.classes.length} vars:${s.variables.length}` }
      } else if (mode === "scan") {
        if (kind === "doc") { const c = chunkByHeadings(content); output = `sections:${c.length} lines:${content.split("\n").length}` }
        else { output = `lines:${content.split("\n").length}` }
      } else if (mode === "extract" && args.query) {
        const kw = args.query.split(",").map((k: string) => k.trim())
        output = content.split("\n").filter(l => kw.some((k: string) => l.toLowerCase().includes(k))).slice(0, 5).join("; ")
      } else if (mode === "context" && args.symbol) {
        const lines = content.split("\n")
        const block = findSymbolBlock(lines, args.symbol, ext)
        output = block ? `found at L${block.start + 1}` : "not found"
      } else {
        output = `lines:${content.split("\n").length}`
      }
      return { file, tokens: estimateTokens(output), output }
    } catch (e) {
      return { file, tokens: 0, output: `❌ ${e instanceof Error ? e.message : String(e)}` }
    }
  }, 5)

  const total = results.reduce((s, r) => s + r.tokens, 0)
  return ok(`# batch ${mode}: ${results.length} files (~${total} tokens)\n\n${results.map(r => `${r.file} (${r.tokens}t) — ${r.output.slice(0, 120)}`).join("\n")}`)
}

// ============================================================================
// HOOK
// ============================================================================

export function createForjaReadHooks() {
  return {
    "experimental.session.compacting": async (_input: any, output: any) => {
      output.context.push("\n📖 forja_read: scan (estructura) | skeleton (ultra-compacto) | extract (keywords/secciones) | context (símbolo + cuerpo) | batch (multi-archivo). Usa skeleton para ahorrar tokens.\n")
    },
  }
}
