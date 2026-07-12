import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

export interface ProjectScan {
  root: string
  type: string
  files: string[]
  deps: string[]
  scripts: Record<string, string>
  testFramework: string | null
  entryPoint: string | null
  sourceDir: string
  configFiles: string[]
}

const IGNORE = new Set([
  "node_modules", ".git", "target", "dist", "build",
  ".venv", "venv", "__pycache__", ".next", ".cache", ".npm",
  "coverage", ".husky", ".github", ".vscode", ".idea",
  ".godot", ".godot/imported", ".import", ".mono", ".dotnet", "Desktop_01",
  ".opencode", ".true-mem",
  ".ruff_cache", ".mypy_cache", ".pytest_cache",
])

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a",
  ".mp4", ".avi", ".mov", ".mkv", ".webm",
  ".zip", ".gz", ".tar", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".wasm",
  ".o", ".obj", ".class", ".pyc", ".pyd",
  ".blend", ".blend1", ".fbx", ".glb", ".gltf",
  ".cur",
])

const BACKUP_EXTS = new Set([".bak", ".backup", ".tmp", ".temp", ".swp", ".swo", ".orig"])

const CONFIG_FILE_NAMES = new Set([
  "package.json", "package-lock.json", "tsconfig.json", ".eslintrc",
  "Cargo.toml", "Cargo.lock", "rust-toolchain.toml",
  "project.godot", "project.binary",
  "pyproject.toml", "poetry.lock", "Pipfile", "setup.py", "setup.cfg",
  "go.mod", "go.sum",
  "build.gradle", "settings.gradle", "pom.xml",
  "composer.json",
  ".env", ".env.example",
  "docker-compose.yml", "docker-compose.yaml",
  ".gitignore", ".dockerignore", ".gitattributes",
  ".prettierrc", ".prettierrc.json", ".editorconfig", ".pre-commit-config.yaml",
])
const ENTRY_POINTS = ["main.ts", "main.js", "main.rs", "main.go", "main.py", "index.ts", "index.js", "app.ts", "app.js", "lib.rs", "mod.rs", "__init__.py"]

const EXT_TYPE_MAP: Record<string, string> = {
  ".nut": "L4D2",
  ".rs": "Rust",
  ".gd": "Godot",
  ".py": "Python",
  ".ts": "TypeScript",
  ".tsx": "React",
  ".js": "JavaScript",
  ".jsx": "React",
  ".go": "Go",
  ".java": "Java",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".lua": "Lua",
}

function detectTypeFromExtensions(files: string[]): string {
  const extCount = new Map<string, number>()
  for (const f of files) {
    const ext = f.includes(".") ? (f.match(/\.[^.]+$/)?.[0] || "").toLowerCase() : ""
    if (ext && ext.length > 1) extCount.set(ext, (extCount.get(ext) || 0) + 1)
  }
  let bestType = "unknown"
  let bestCount = 0
  for (const [ext, count] of extCount) {
    const type = EXT_TYPE_MAP[ext]
    if (type && count > bestCount) {
      bestType = type
      bestCount = count
    }
  }
  return bestType
}

function guessTestFramework(type: string): string | null {
  const map: Record<string, string | null> = {
    Rust: "cargo test",
    Go: "go test",
    Python: "pytest",
    L4D2: null,
    Godot: null,
    Java: "gradle test",
    C: null,
    "C++": null,
    Lua: null,
  }
  return map[type] ?? null
}

const MANIFEST_CHECKS = [
  { file: "package.json", type: "Node", read: (c: string) => {
    const j = JSON.parse(c)
    return { deps: [...Object.keys(j.dependencies || {}), ...Object.keys(j.devDependencies || {})], scripts: j.scripts, test: j.scripts?.test?.startsWith("vitest") ? "vitest" : j.scripts?.test?.startsWith("jest") ? "jest" : j.scripts?.test ? j.scripts.test : null }
  }},
  { file: "Cargo.toml", type: "Rust", read: (c: string) => {
    const deps = [...c.matchAll(/^(\w+)\s*=\s*["{]/gm)].map(m => m[1])
    return { deps, scripts: {}, test: "cargo test" }
  }},
  { file: "project.godot", type: "Godot", read: () => ({ deps: [], scripts: {}, test: null })},
  { file: "pyproject.toml", type: "Python", read: (c: string) => ({
    deps: [...c.matchAll(/^\s*"([^"]+)[>=<~!]/gm)].map(m => m[1]),
    scripts: {},
    test: c.includes("pytest") ? "pytest" : c.includes("poetry") ? "poetry run pytest" : null,
  })},
  { file: "go.mod", type: "Go", read: (c: string) => {
    const deps = [...c.matchAll(/^\s+(\S+)\s+v[\d.]/gm)].map(m => m[1])
    return { deps, scripts: {}, test: "go test" }
  }},
  { file: "build.gradle", type: "Java", read: () => ({ deps: [], scripts: {}, test: "gradle test" })},
  { file: "pom.xml", type: "Java", read: () => ({ deps: [], scripts: {}, test: "mvn test" })},
  { file: "go.work", type: "Go", read: () => ({ deps: [], scripts: {}, test: null })},
]

const TYPE_DEFAULT_DEPS: Record<string, string[]> = {
  Godot: ["godot-engine"],
  Node: [],
  Rust: [],
  Python: [],
  Go: [],
  Java: [],
}

export class Proyector {
  private cached: ProjectScan | null = null
  private scanRoot = ""
  private lastInjectTime = 0
  private readonly COOLDOWN_MS = 20 * 60 * 1000

  isReady(): boolean {
    return this.cached !== null
  }

  shouldInject(): boolean {
    if (!this.cached) return false
    if (this.lastInjectTime === 0) return true
    return Date.now() - this.lastInjectTime >= this.COOLDOWN_MS
  }

  markInjected(): void {
    this.lastInjectTime = Date.now()
  }

  async getScan(root: string): Promise<ProjectScan> {
    if (this.cached && this.scanRoot === root) return this.cached
    this.cached = await this.doScan(root)
    this.scanRoot = root
    return this.cached
  }

  async refresh(root: string): Promise<ProjectScan> {
    this.cached = null
    return this.getScan(root)
  }

  clear(): void {
    this.cached = null
    this.scanRoot = ""
  }

  private isRootPath(p: string): boolean {
    const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "")
    return normalized === "" || normalized === "/" || /^[a-zA-Z]:$/.test(normalized) || /^[a-zA-Z]:\\?$/.test(p)
  }

  static isRootPath(p: string): boolean {
    const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "")
    return normalized === "" || normalized === "/" || /^[a-zA-Z]:$/.test(normalized) || /^[a-zA-Z]:\\?$/.test(p)
  }

  private async doScan(root: string): Promise<ProjectScan> {
    if (this.isRootPath(root)) {
      return { root, type: "unknown", files: [], deps: [], scripts: {}, testFramework: null, entryPoint: null, sourceDir: ".", configFiles: [] }
    }

    let type = "unknown"
    let deps: string[] = []
    let scripts: Record<string, string> = {}
    let testFramework: string | null = null
    let projectRoot = root

    // Phase 1: detect manifest at root, then in subdirectories
    const findManifest = async (dir: string): Promise<boolean> => {
      for (const mc of MANIFEST_CHECKS) {
        const p = path.join(dir, mc.file)
        try {
          await stat(p)
          const content = await readFile(p, "utf-8")
          const info = mc.read(content)
          type = mc.type
          deps = info.deps
          scripts = info.scripts
          testFramework = info.test
          projectRoot = dir
          return true
        } catch { /* next */ }
      }
      return false
    }

    if (await findManifest(root)) {
      // found at root
    } else {
      // Check first-level subdirs for project markers
      let entries: string[]
      try { entries = await readdir(root) } catch { entries = [] }
      for (const e of entries) {
        if (IGNORE.has(e) || e.startsWith(".")) continue
        const sub = path.join(root, e)
        let st
        try { st = await stat(sub) } catch { continue }
        if (st.isDirectory() && await findManifest(sub)) break
      }
    }

    // Phase 2: recursive file walk — siempre, incluso si type es "unknown"
    const MAX_FILES = 500
    const MAX_DEPTH = 8
    const files: string[] = []

    const walk = async (dir: string, depth: number) => {
      if (files.length >= MAX_FILES || depth > MAX_DEPTH) return
      let entries: string[]
      try { entries = await readdir(dir) } catch { return }

      const valid = entries.filter(e => !IGNORE.has(e) && !(e.startsWith(".") && depth > 0)).slice(0, MAX_FILES - files.length)

      const stats = await Promise.all(valid.map(async (e) => {
        const full = path.join(dir, e)
        try {
          const st = await stat(full)
          return { name: e, full, stat: st }
        } catch { return null }
      }))

      const dirs: string[] = []
      for (const item of stats) {
        if (!item) continue
        const rel = path.relative(projectRoot, item.full).replace(/\\/g, "/")
        if (item.stat.isDirectory()) {
          dirs.push(item.full)
        } else if (item.stat.isFile()) {
          const ext = path.extname(item.name).toLowerCase()
          if (BINARY_EXTS.has(ext) || BACKUP_EXTS.has(ext)) continue
          if (item.name.includes(".backup.")) continue
          files.push(rel)
        }
      }

      await Promise.all(dirs.map(d => walk(d, depth + 1)))
    }

    await walk(projectRoot, 0)
    files.sort()

    // Heuristic fallback: si no se encontró manifest, detectar tipo por extensión
    if (type === "unknown") {
      const guessed = detectTypeFromExtensions(files)
      if (guessed !== "unknown") {
        type = guessed
        if (!testFramework) testFramework = guessTestFramework(type)
      }
    }

    // Add default deps for known types that don't have package manifests
    if (deps.length === 0 && TYPE_DEFAULT_DEPS[type]) {
      deps = [...TYPE_DEFAULT_DEPS[type]]
    }

    // Phase 3: find config files (well-known names only)
    const configFiles = files.filter(f => {
      const name = f.split("/").pop() || f
      return CONFIG_FILE_NAMES.has(name)
    })

    const sourceDir = files.find(f => /^[^/]+\//.test(f))?.split("/")[0] || "."
    const entryPoint = ENTRY_POINTS.find(ep => files.includes(ep) || files.some(f => f.endsWith("/" + ep))) || null

    return { root: projectRoot, type, files, deps, scripts, testFramework, entryPoint, sourceDir, configFiles }
  }

  getCompactContext(): string {
    if (!this.cached) return ""
    const s = this.cached
    const parts = [`[Project] ${s.type}`]
    if (s.sourceDir !== ".") {
      const count = s.files.filter(f => f.startsWith(s.sourceDir)).length
      parts.push(`${s.sourceDir}/ (${count} file(s))`)
    }
    if (s.files.length > 0) parts.push(`${s.files.length} file(s)`)
    if (s.deps.length > 0) parts.push(`deps: ${s.deps.slice(0, 15).join(", ")}${s.deps.length > 15 ? "…" : ""}`)
    if (s.entryPoint) parts.push(`entry: ${s.entryPoint}`)
    if (s.testFramework) parts.push(`test: ${s.testFramework}`)
    const scripts = Object.keys(s.scripts)
    if (scripts.length > 0) parts.push(`scripts: ${scripts.join(", ")}`)
    return parts.join(" | ")
  }

  queryTree(): string {
    if (!this.cached) return "No project scan yet."
    const s = this.cached
    // Group by dir
    const groups = new Map<string, string[]>()
    for (const f of s.files) {
      const dir = f.includes("/") ? f.substring(0, f.lastIndexOf("/")) : "."
      if (!groups.has(dir)) groups.set(dir, [])
      groups.get(dir)!.push(f.includes("/") ? f.substring(f.lastIndexOf("/") + 1) : f)
    }
    let out = ""
    const sorted = [...groups.keys()].sort()
    for (const dir of sorted) {
      out += `${dir === "." ? "" : dir + "/"}: ${groups.get(dir)!.join(", ")}\n`
    }
    return out
  }

}
