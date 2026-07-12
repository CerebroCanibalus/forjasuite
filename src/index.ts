import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { DEFAULT_CONFIG } from "./shared/types.js"
import { log, logSync } from "./shared/logger.js"
import { ok, fail } from "./shared/response.js"
import { readFile } from "node:fs/promises"
import { createForjaReadTool, createForjaReadHooks } from "./core/forja-read.js"
import { createForjaSkillTool } from "./core/forja-skill.js"
import { createForjaRefactorTool } from "./core/forja-refactor.js"
import { createForjaBuildTool } from "./core/forja-build.js"
import { createGuardHooks } from "./core/forja-guard.js"
import { ForjaSieve } from "./core/forja-sieve.js"
import { ForjaRemind } from "./shared/forja-remind.js"
import { Proyector } from "./shared/proyector.js"

const ForjaPlugin: Plugin = async (input) => {
  const { client, $, directory, worktree } = input
  const config = DEFAULT_CONFIG
  const sieve = new ForjaSieve()
  const proyector = new Proyector()
  const projectRoot = worktree || directory || ""
  const remind = new ForjaRemind(client)

  let lastFilePath = ""
  const hintsInjected = new Set<string>()

  // Eager scan: completado antes del log de init para que
  // - el init.log muestre el contexto real del proyecto
  // - system.transform inyecte desde el primer turno
  // - compacting tenga datos desde la primera compresión
  if (projectRoot && !Proyector.isRootPath(projectRoot)) {
    await proyector.getScan(projectRoot).catch(() => {})
  }

  await log(client, {
    service: "core",
    level: "info",
    message: `🏗️ Forja-Suite v1.3.0 — ${worktree || directory}`,
    extra: {
      features: { guard: config.enableGuard, read: config.enableRead, sieve: config.enableSieve, refactor: config.enableRefactor, build: config.enableBuild },
      proyector: "eager scan",
      proyectorReady: proyector.isReady(),
      projectContext: proyector.getCompactContext() || undefined,
    },
  })

  // Lazy scan fallback (solo si eager no encontró projectRoot válido y agente usa file tools)
  const doLazyScan = async () => {
    if (proyector.isReady() || !projectRoot || Proyector.isRootPath(projectRoot)) return
    await proyector.getScan(projectRoot).catch(() => {})
  }

  const hooks: Hooks & Record<string, any> = {
    tool: {
      ...(config.enableRead ? { forja_read: createForjaReadTool(client) } : {}),

      forja_skill: createForjaSkillTool(),

      ...(config.enableRefactor ? { forja_refactor: createForjaRefactorTool() } : {}),

      ...(config.enableBuild ? { forja_build: createForjaBuildTool() } : {}),

      ...(config.enableSieve ? {
        forja_check: tool({
          description: "Verifica integridad de un archivo: balance llaves/paréntesis, cierre de strings, calidad de código. Rápido, determinista, sin LLM.",
          args: {
            filePath: tool.schema.string().optional().describe("Ruta del archivo. Por defecto: último editado/leído."),
          },
          async execute(args) {
            const target = args.filePath || lastFilePath
            if (!target) return fail("No hay archivo especificado.")

            let content = ""
            try {
              content = await readFile(target, "utf-8")
            } catch {
              return fail(`No se pudo leer: ${target}`)
            }

            if (!content || content.length < 3) return ok(`${target} está vacío.`)

            const checkResult = await sieve.checkEdit(target, content)
            if (checkResult.issues.length === 0) {
              return ok(`✅ ${target} — Sin issues [${checkResult.stats.timeMs}ms]`)
            }

            const lines = [
              `🔬 ${target} — ${checkResult.issues.length} issue(s) [${checkResult.stats.timeMs}ms]:`,
              ...checkResult.issues.map(i =>
                `L${i.line}:${i.column} ${i.type === "error" ? "⛔" : "⚠️"} ${i.message}`
              ),
            ].filter(Boolean).join("\n")
            return ok(lines)
          },
        }),
      } : {}),

      forja_project: tool({
        description: "Escanea el proyecto actual y responde consultas sobre estructura, archivos y dependencias. Lazy: cachea resultado tras primera llamada. Sin args = resumen compacto.",
        args: {
          query: tool.schema.enum(["files", "deps", "type", "tree", "refresh"]).optional().describe("Tipo de consulta"),
          dir: tool.schema.string().optional().describe("Filtrar archivos por directorio (ej: src/db)"),
        },
        async execute({ query, dir }) {
          if (!projectRoot) return fail("No hay proyecto activo (worktree/directory no definido).")
          if (Proyector.isRootPath(projectRoot)) return fail("No hay proyecto activo — worktree es directorio raíz. Usa el agente desde un proyecto específico.")

          await proyector.getScan(projectRoot)

          if (!query) {
            const compact = proyector.getCompactContext()
            return ok(compact ? `## Proyector\n\n${compact}\n\nUsa \`forja_project query=files\` para listar archivos.` : "Proyecto escaneado pero sin datos relevantes.")
          }

          if (query === "files") {
            const scan = await proyector.getScan(projectRoot)
            if (!dir) return ok(scan.files.length > 0 ? scan.files.join("\n") : "No se encontraron archivos.")
            const filtered = scan.files.filter(f => f.startsWith(dir + "/") || f.startsWith(dir))
            return ok(filtered.length > 0 ? filtered.join("\n") : `No hay archivos en: ${dir}`)
          }

          if (query === "deps") {
            const scan = await proyector.getScan(projectRoot)
            return ok(scan.deps.length > 0 ? scan.deps.join("\n") : "Sin dependencias detectadas.")
          }

          if (query === "type") {
            const scan = await proyector.getScan(projectRoot)
            let out = `Tipo: ${scan.type}\n`
            if (scan.entryPoint) out += `Entry: ${scan.entryPoint}\n`
            if (scan.testFramework) out += `Test: ${scan.testFramework}\n`
            if (Object.keys(scan.scripts).length > 0) {
              out += `Scripts:\n${Object.entries(scan.scripts).map(([k, v]) => `  ${k}: ${v}`).join("\n")}\n`
            }
            if (scan.configFiles.length > 0) out += `Config: ${scan.configFiles.join(", ")}\n`
            return ok(out)
          }

          if (query === "tree") {
            return ok(proyector.queryTree())
          }

          if (query === "refresh") {
            await proyector.refresh(projectRoot)
            return ok("✅ Proyecto re-escaneado.")
          }

          return fail("Query no reconocida. Opciones: files, deps, type, tree, refresh")
        },
      }),

      forja_remind: tool({
        description: "Gestiona recordatorios programados. add: crear recordatorio. list: ver activos. remove: cancelar.",
        args: {
          action: tool.schema.enum(["add", "list", "remove"]).describe("Operación"),
          text: tool.schema.string().optional().describe("Texto del recordatorio (para add)"),
          delay: tool.schema.number().optional().describe("Segundos hasta el recordatorio (para add)"),
          recurring: tool.schema.boolean().optional().describe("Repetir cada N segundos (para add)"),
          id: tool.schema.string().optional().describe("ID del recordatorio (para remove)"),
        },
        async execute(args, context) {
          if (args.action === "add") {
            if (!args.text) return fail("Missing --text")
            const delay = args.delay || 30
            const sessionId = (context as any)?.sessionID || ""
            const id = await remind.addReminder(args.text, delay, sessionId, !!args.recurring)
            return ok(`✅ Recordatorio #${id} en ${delay}s: "${args.text.slice(0, 80)}"`)
          }
          if (args.action === "list") {
            const list = remind.listReminders()
            if (list.length === 0) return ok("No hay recordatorios activos.")
            const lines = list.map(r => {
              const due = r.dueAt ? `${Math.round((r.dueAt - Date.now()) / 1000)}s` : "inmediato"
              return `  #${r.id} "${r.text.slice(0, 60)}" (${due})${r.recurring ? " 🔁" : ""}`
            })
            return ok("📋 Recordatorios:\n" + lines.join("\n"))
          }
          if (args.action === "remove") {
            if (!args.id) return fail("Missing --id")
            const ok_ = await remind.removeReminder(args.id)
            return ok_ ? ok(`✅ Recordatorio #${args.id} eliminado`) : fail(`ID #${args.id} no encontrado`)
          }
          return fail("Action debe ser: add, list, remove")
        },
      }),

      forja_debug: tool({
        description: "Muestra estado interno de forja-suite: caché, watchdogs, sessionId, skills/MCPs encontrados. Diagnóstico.",
        args: {},
        async execute() {
          const lines: string[] = ["# Forja Debug", ""]
          lines.push(`projectRoot: ${projectRoot || "(ninguno)"}`)
          lines.push(`Proyector ready: ${proyector.isReady()}`)
          if (proyector.isReady()) {
            const scan = await proyector.getScan(projectRoot).catch(() => null)
            if (scan) {
              lines.push(`Tipo proyecto: ${scan.type}`)
              lines.push(`Archivos: ${scan.files.length}`)
              lines.push(`Entry: ${scan.entryPoint || "(ninguno)"}`)
            }
          }
          return ok(lines.join("\n"))
        },
      }),
    },

    "tool.execute.before": async (input: any, output: any) => {
      if (config.enableGuard) {
        const guardHooks = createGuardHooks()
        if (guardHooks["tool.execute.before"]) {
          await (guardHooks["tool.execute.before"] as any)(input, output)
        }
      }

      if (projectRoot && !proyector.isReady() && ["read", "edit", "write"].includes(String(input.tool || ""))) {
        if (!Proyector.isRootPath(projectRoot)) {
          logSync(client, { service: "proyector", level: "info", message: "Lazy scan triggered by file tool" })
          await proyector.getScan(projectRoot)
        }
      }

      const args = input.args || output.args || {}
      const filePath = args.filePath || ""
      if (filePath && ["read", "edit", "write"].includes(String(input.tool || ""))) {
        lastFilePath = filePath
      }
    },

    "tool.execute.after": async (input: any) => {
      if (config.enableSieve && ["edit", "write"].includes(String(input.tool || ""))) {
        const args = input.args || {}
        if (args.filePath) {
          lastFilePath = args.filePath
          try {
            const content = await readFile(args.filePath, "utf-8")
            const result = await sieve.checkEdit(args.filePath, content)
            sieve.storePending(result.issues)
          } catch { /* fail-soft */ }
        }
      }
    },

    "experimental.chat.system.transform": async (_input: any, output: any) => {
      // Project context — cada ~20 min
      if (proyector.shouldInject()) {
        const ctx = proyector.getCompactContext()
        if (ctx) {
          output.system.push(ctx)
          proyector.markInjected()
        }
      }

      // Hints de productividad — una vez por sesión
      if (!hintsInjected.has("forja_project") && proyector.isReady()) {
        output.system.push("📐 Prefiere `forja_project` (tree/files/deps) sobre bash `ls`/`Get-ChildItem` para explorar estructura del proyecto.")
        hintsInjected.add("forja_project")
      }

      if (!hintsInjected.has("forja_refactor")) {
        output.system.push("🔧 `forja_refactor` edita múltiples archivos vía diff unificado. Transaccional con dry-run. Preferir sobre `edit` nativo para cambios que tocan 3+ archivos.")
        hintsInjected.add("forja_refactor")
      }

      if (!hintsInjected.has("forja_build")) {
        output.system.push("🏗️ `forja_build` crea múltiples archivos en batch (scaffolding, componentes, migraciones). Usar en vez de `write` para crear 2+ archivos.")
        hintsInjected.add("forja_build")
      }

      const sieveCtx = sieve.drainPending()
      if (sieveCtx) {
        output.system.push(sieveCtx)
      }
    },

    "experimental.session.compacting": async (_input: any, output: any) => {
      if (config.enableRead) {
        const readHooks = createForjaReadHooks()
        if (readHooks["experimental.session.compacting"]) {
          await (readHooks["experimental.session.compacting"] as any)(_input, output)
        }
      }

      // Project context — SIEMPRE en compactación para que el agente no olvide la estructura
      const ctx = proyector.getCompactContext()
      if (ctx) {
        output.context.push(ctx)
        proyector.markInjected() // resetea cooldown de system.transform también
      }

      // Hint — una vez por sesión
      if (!hintsInjected.has("forja_project") && proyector.isReady()) {
        output.context.push("📐 Prefiere `forja_project` sobre bash `ls`/`Get-ChildItem` para explorar estructura del proyecto.")
        hintsInjected.add("forja_project")
      }

      if (!hintsInjected.has("forja_refactor")) {
        output.context.push("🔧 `forja_refactor` edita múltiples archivos vía diff unificado. Preferir sobre `edit` nativo para cambios que tocan 3+ archivos.")
        hintsInjected.add("forja_refactor")
      }

      if (!hintsInjected.has("forja_build")) {
        output.context.push("🏗️ `forja_build` crea múltiples archivos en batch (scaffolding, componentes, migraciones).")
        hintsInjected.add("forja_build")
      }
    },
  }

  return hooks
}

export default ForjaPlugin
