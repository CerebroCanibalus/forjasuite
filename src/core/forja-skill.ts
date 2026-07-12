import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "../shared/types.js"
import { ok, fail } from "../shared/response.js"
import { mkdir, writeFile, readFile, rm, stat, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

const SKILLS_BASE = path.join(homedir(), ".config", "opencode", "skills")

const SKILL_SEARCH_PATHS = [
  (root: string) => path.join(root, ".opencode", "skills"),
  (root: string) => path.join(root, ".claude", "skills"),
  (root: string) => path.join(root, ".agents", "skills"),
]

const GLOBAL_SKILL_PATHS = [
  path.join(homedir(), ".claude", "skills"),
  path.join(homedir(), ".agents", "skills"),
]

function skillPath(name: string): string {
  return path.join(SKILLS_BASE, name, "SKILL.md")
}

const VALID_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function createForjaSkillTool(): ToolDefinition {
  return tool({
    description: `Gestiona skills OpenCode de forma programática.

**Actions:**
- **create**: Crea SKILL.md con frontmatter (name, description + body opcional)
- **list**: Lista skills con metadatos. Opciones: format=json, query=..., tag=..., compact, page=N, per_page=N
- **delete**: Elimina una skill

Las skills creadas aparecen automáticamente en \`skill\` tool de OpenCode.`,

    args: {
      action: tool.schema
        .enum(["create", "list", "delete"])
        .describe("Operación a realizar"),
      name: tool.schema.string().optional()
        .describe("Nombre de la skill (lowercase, hyphens, ej: godot-state-machine)"),
      description: tool.schema.string().optional()
        .describe("Descripción breve (1-1024 chars)"),
      content: tool.schema.string().optional()
        .describe("Cuerpo de la skill en markdown (opcional en create)"),
      tags: tool.schema.string().optional()
        .describe("Tags separados por coma (opcional)"),
      dir: tool.schema.string().optional()
        .describe("Ruta del proyecto para escanear skills locales (ej: .)"),
      format: tool.schema.enum(["markdown", "json"]).optional()
        .describe("Formato de salida: markdown (default) o json"),
      query: tool.schema.string().optional()
        .describe("Filtrar skills por nombre o descripción"),
      tag: tool.schema.string().optional()
        .describe("Filtrar skills por tag exacto"),
      compact: tool.schema.boolean().optional()
        .describe("Modo compacto: solo nombres en una línea"),
      page: tool.schema.number().optional()
        .describe("Número de página (default 1, 20 por página)"),
      per_page: tool.schema.number().optional()
        .describe("Skills por página (default 20)"),
    },

    async execute(args, context) {
      const worktree = (context as any)?.worktree || ""
      const directory = (context as any)?.directory || ""
      const projectRoot = worktree || directory || ""

      switch (args.action) {
        case "create": return handleCreate(args)
        case "list": return handleList(args, projectRoot)
        case "delete": return handleDelete(args)
        default: return fail(`Unknown action: ${args.action}`)
      }
    },
  })
}

async function handleCreate(args: any): Promise<string> {
  const name = args.name?.trim()
  const desc = args.description?.trim()

  if (!name) return fail("Missing --name")
  if (!VALID_NAME.test(name)) return fail(`Invalid name '${name}'. Use lowercase alphanumeric with single hyphens (^[a-z0-9]+(-[a-z0-9]+)*$)`)
  if (!desc) return fail("Missing --description")
  if (desc.length > 1024) return fail("Description too long (max 1024 chars)")

  const skPath = skillPath(name)
  if (existsSync(skPath)) return fail(`Skill '${name}' already exists at ${skPath}`)

  const dir = path.dirname(skPath)
  await mkdir(dir, { recursive: true })

  const tags = args.tags
    ? args.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
    : []

  const body = args.content || "# " + name.replace(/-/g, " ") + "\n\nDescribe what this skill does and when to use it."

  const meta = ["name: " + name, "description: " + desc]
  if (tags.length > 0) meta.push("tags: " + tags.join(", "))

  const content = "---\n" + meta.join("\n") + "\n---\n\n" + body + "\n"

  await writeFile(skPath, content, "utf-8")
  return ok(`✅ Skill '${name}' creada en ${skPath}`)
}

interface SkillEntry {
  name: string
  desc: string
  tags: string[]
  file: string
  size: number
  mtime: number
  source: string
}

async function handleList(args: any, projectRoot: string): Promise<string> {
  const seen = new Map<string, SkillEntry>()

  const scanDir = async (base: string, label: string) => {
    if (!existsSync(base)) return
    const dirs = await readdirSafe(base)
    for (const d of dirs) {
      if (seen.has(d)) continue
      const mdPath = path.join(base, d, "SKILL.md")
      if (!existsSync(mdPath)) continue
      try {
        const raw = await readFile(mdPath, "utf-8")
        const parsed = parseSkillMd(raw)
        if (parsed) {
          const stat_ = await readFileStatSafe(mdPath)
          seen.set(d, {
            name: parsed.name,
            desc: parsed.description,
            tags: parsed.tags,
            file: mdPath,
            size: stat_?.size ?? 0,
            mtime: stat_?.mtimeMs ?? 0,
            source: label,
          })
        }
      } catch { /* skip */ }
    }
  }

  await scanDir(SKILLS_BASE, "global")
  for (const gp of GLOBAL_SKILL_PATHS) await scanDir(gp, "global")
  if (projectRoot) {
    const root = args.dir ? path.resolve(projectRoot, args.dir) : projectRoot
    for (const sp of SKILL_SEARCH_PATHS) await scanDir(sp(root), "local")
  }

  if (seen.size === 0) return ok("No se encontraron skills en ningún directorio.")

  let entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))

  // Filter by query (name or desc match)
  if (args.query) {
    const q = args.query.toLowerCase()
    entries = entries.filter(e =>
      e.name.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q)
    )
  }
  // Filter by tag
  if (args.tag) {
    const tag = args.tag.toLowerCase()
    entries = entries.filter(e => e.tags.some(t => t.toLowerCase() === tag))
  }

  if (entries.length === 0) return ok("0 skills — no coinciden con el filtro.")

  // JSON mode
  if (args.format === "json") {
    const data = entries.map(e => ({
      name: e.name,
      description: e.desc || "(sin descripción)",
      tags: e.tags,
      path: e.file,
      size: e.size,
      modified: new Date(e.mtime).toISOString(),
      source: e.source,
    }))
    return ok(JSON.stringify(data, null, 2))
  }

  // Compact mode (only names, one per line)
  if (args.compact) {
    const names = entries.map(e => e.name).join(", ")
    return ok(`${entries.length} skills: ${names}`)
  }

  // Default: markdown list with pagination
  const page = args.page || 1
  const perPage = args.per_page || 20
  const totalPages = Math.ceil(entries.length / perPage)
  const start = (page - 1) * perPage
  const chunk = entries.slice(start, start + perPage)

  const esc = (s: string) => s.replace(/\|/g, "\\|")
  const fmtDate = (ts: number) => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }

  const lines = [
    `# Skills: ${entries.length} | page ${page}/${totalPages}`,
    "",
    ...chunk.map(e => {
      const desc = e.desc ? esc(e.desc.slice(0, 120)) : "*(sin descripción)*"
      const sizeInfo = e.size > 0 ? ` (${e.size}b)` : ""
      const tagInfo = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : ""
      return [
        `- **\`${e.name}\`** — ${desc}`,
        `  path: \`${e.file}\` | modified: ${fmtDate(e.mtime)}${sizeInfo} | source: ${e.source}${tagInfo}`,
      ].join("\n")
    }),
    "",
    page < totalPages
      ? `Página ${page}/${totalPages}. Usa \`page=${page + 1}\` para la siguiente.`
      : `Usa \`format=compact\` para solo nombres, \`format=json\` para datos estructurados.`,
  ]

  return ok(lines.join("\n").trim())
}

async function readFileStatSafe(p: string): Promise<{ size: number; mtimeMs: number } | null> {
  try { const s = await stat(p); return { size: s.size, mtimeMs: s.mtimeMs } }
  catch { return null }
}
async function handleDelete(args: any): Promise<string> {
  const name = args.name?.trim()
  if (!name) return fail("Missing --name")
  if (!VALID_NAME.test(name)) return fail("Invalid --name format")

  const dir = path.join(SKILLS_BASE, name)
  if (!existsSync(dir)) return fail(`Skill '${name}' no encontrada`)

  await rm(dir, { recursive: true, force: true })
  return ok(`✅ Skill '${name}' eliminada`)
}

function parseSkillMd(raw: string): { name: string; description: string; tags: string[] } | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return null
  const front = m[1]
  const name = extractField(front, "name")
  const description = extractField(front, "description")
  if (!name || !description) return null
  const tagsRaw = extractField(front, "tags")
  const tags = tagsRaw ? tagsRaw.split(",").map((t: string) => t.trim()).filter(Boolean) : []
  return { name, description, tags }
}

function extractField(frontmatter: string, key: string): string | null {
  const re = new RegExp("^" + key + ":\\s*(.+)$", "m")
  const m = frontmatter.match(re)
  return m ? m[1].trim() : null
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}
