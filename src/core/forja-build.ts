import { tool } from "@opencode-ai/plugin"
import { writeFile, mkdir, access } from "node:fs/promises"
import { dirname } from "node:path"

// ─── Types ───────────────────────────────────────────────────────────────────

interface BuildFile {
  /** Ruta absoluta del archivo a crear */
  path: string
  /** Contenido del archivo */
  content: string
  /** Sobrescribir si existe (default: usa el overwrite global ) */
  overwrite?: boolean
}

interface BuildResult {
  path: string
  status: "created" | "skipped" | "overwritten" | "failed"
  error?: string
}

// ─── Tool factory ────────────────────────────────────────────────────────────

export function createForjaBuildTool() {
  return tool({
    description: `Crea múltiples archivos nuevos en batch. Ideal para scaffolding, generar componentes, migraciones, o cualquier tarea que requiera crear 2+ archivos simultáneamente.

**Características:**
- Crea directorios intermedios automáticamente
- No sobreescribe por defecto (protección)
- Verificación opcional post-escritura
- Preview con dryRun antes de crear

**NO usar para editar archivos existentes** — usa \`forja_refactor\` o \`edit\` nativo para eso.

Ejemplos:
- Crear estructura de componentes: {path: "src/components/Button.tsx", content: "..."}
- Scaffolding de tests: varios archivos \`*.test.ts\` en paralelo
- Migraciones: crear archivos SQL en orden`,
    args: {
      files: tool.schema.array(tool.schema.object({
        path: tool.schema.string().describe("Ruta absoluta del archivo a crear"),
        content: tool.schema.string().describe("Contenido del archivo"),
        overwrite: tool.schema.boolean().optional().describe("Sobrescribir si ya existe (default: usa el valor global)"),
      })).min(1).describe("Archivos a crear"),
      overwrite: tool.schema.boolean().default(false).describe("Sobrescribir archivos existentes (default: false)"),
      createDirs: tool.schema.boolean().default(true).describe("Crear directorios intermedios automáticamente"),
      dryRun: tool.schema.boolean().default(true).describe("Preview sin crear archivos"),
    },
    async execute(args) {
      const files = args?.files
      const overwrite = args?.overwrite ?? false
      const createDirs = args?.createDirs ?? true
      const dryRun = args?.dryRun ?? true

      if (!files || !Array.isArray(files) || files.length === 0) {
        return JSON.stringify({ ok: false, err: "Missing required parameter: `files` must be a non-empty array. Ej: `files: [{ path: \"...\", content: \"...\" }]`" })
      }

      const results: BuildResult[] = []

      // Phase 1: validate + build plan
      for (const f of files) {
        // Validate content is a non-empty string
        if (typeof f.content !== "string") {
          results.push({ path: f.path || "(unknown)", status: "failed", error: "`content` debe ser un string" })
          continue
        }

        // Validate path is a non-empty string
        if (!f.path || typeof f.path !== "string") {
          results.push({ path: "(unknown)", status: "failed", error: "`path` debe ser un string no vacío" })
          continue
        }

        const effectiveOverwrite = f.overwrite ?? overwrite
        let exists = false

        try {
          await access(f.path)
          exists = true
        } catch {
          // File doesn't exist — good
        }

        if (exists && !effectiveOverwrite) {
          results.push({ path: f.path, status: "skipped", error: "Ya existe (usa overwrite: true para sobrescribir)" })
          continue
        }

        if (dryRun) {
          results.push({
            path: f.path,
            status: exists ? "overwritten" : "created",
          })
          continue
        }

        // Phase 2: create directories + write
        try {
          if (createDirs) {
            await mkdir(dirname(f.path), { recursive: true }).catch((e: any) => {
              throw new Error(`No se pudo crear el directorio: ${e.message || e}`)
            })
          }

          await writeFile(f.path, f.content, "utf-8").catch((e: any) => {
            throw new Error(`No se pudo escribir el archivo: ${e.message || e}`)
          })
          results.push({ path: f.path, status: exists ? "overwritten" : "created" })
        } catch (e: any) {
          const msg = e.message || String(e)
          // Sanitizar errores comunes de Node
          const clean = msg
            .replace(/^ENOENT: /, "")
            .replace(/^EACCES: /, "")
            .replace(/^EPERM: /, "")
            .replace(/', open '/g, " — ")
            .replace(/', mkdir '/g, " — ")
          results.push({ path: f.path, status: "failed", error: clean })
        }
      }

      // ─── Build report ───────────────────────────────────────────────
      if (dryRun) {
        const preview = results.map(r => {
          if (r.status === "created") return `  🆕 ${r.path}`
          if (r.status === "overwritten") return `  🔄 ${r.path} (se sobrescribirá)`
          if (r.status === "skipped") return `  ➖ ${r.path} — ${r.error}`
          return ""
        }).filter(Boolean).join("\n")

        let msg = `## 🔍 Dry-run — Preview\n\n${preview || "  (sin archivos)"}\n\n_Pasa \`dryRun: false\` para crear._`
        return JSON.stringify({ ok: true, data: msg })
      }

      const created = results.filter(r => r.status === "created").length
      const overwritten = results.filter(r => r.status === "overwritten").length
      const skipped = results.filter(r => r.status === "skipped").length
      const failed = results.filter(r => r.status === "failed").length

      let msg = `## ✅ Build completado\n\n`
      msg += `Creados: ${created} | Sobrescritos: ${overwritten} | Saltados: ${skipped}${failed > 0 ? ` | Fallos: ${failed}` : ""}\n\n`
      msg += results.map(r => {
        if (r.status === "created") return `  🆕 ${r.path}`
        if (r.status === "overwritten") return `  🔄 ${r.path} (sobrescrito)`
        if (r.status === "skipped") return `  ➖ ${r.path} — ${r.error}`
        if (r.status === "failed") return `  ❌ ${r.path} — ${r.error}`
        return ""
      }).filter(Boolean).join("\n")

      return JSON.stringify({
        ok: failed === 0,
        data: msg,
        err: failed > 0 ? `${failed} archivo(s) fallaron` : undefined,
      })
    },
  })
}
