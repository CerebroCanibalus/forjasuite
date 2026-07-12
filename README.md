# 🔨 Forja-Suite v1.3.0

> *Toolbox de ingeniería de contexto para OpenCode. Lectura universal de archivos, escaneo de proyecto, edición batch multi-archivo, scaffolding, skills, recordatorios y guardias de seguridad.*

[![npm](https://img.shields.io/npm/v/forjasuite)](https://www.npmjs.com/package/forjasuite)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-8A2BE2)](https://opencode.ai/docs/plugins)
[![Bundle](https://img.shields.io/badge/Bundle-100KB-success)](https://github.com/CerebroCanibalus/forjasuite)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

---

## Instalación

### 1. Publicar en npm *(una vez, ya hecho)*
```bash
npm publish
```

### 2. Usuario — agregar a `opencode.jsonc`

```jsonc
{
  "plugin": ["forjasuite"]
}
```

OpenCode resuelve automáticamente el paquete desde npm, lo instala y carga `src/index.ts`.  
**Sin clonar, sin setup.bat, sin configuración manual.**

### 3. Reiniciar OpenCode

Listo. Las 8 tools están disponibles.

---

## Tools

| Tool | Acción |
|------|--------|
| `forja_read` | Lector universal. 80+ extensiones, encoding auto-detection (UTF-8 → UTF-16 → Latin-1), fallback hex dump para binarios. Acciones: scan, skeleton, extract, context, batch. |
| `forja_project` | Escanea estructura/dependencias/tipo del proyecto actual. Sin args = resumen compacto. Lazy con cache. |
| `forja_check` | Verifica integridad sintáctica: balance de llaves/paréntesis, cierre de strings, calidad de código. Rápido, determinista, sin LLM. |
| `forja_skill` | Crea, edita y lista skills de OpenCode programáticamente. |
| `forja_refactor` | Edición batch multi-archivo vía **diff unificado** (determinista, primario) o **Jaccard** (fuzzy, fallback). Transaccional con rollback. |
| `forja_build` | Creación batch de archivos nuevos. Scaffolding, componentes, migraciones. Crea directorios intermedios automáticamente. |
| `forja_remind` | Recordatorios programados. add, list, remove. |
| `forja_debug` | Estado interno del plugin: caché, sessionId, skills/MCPs encontrados. |

---

## forja_refactor — Edición Batch Multi-archivo

Operación principal para refactors que tocan **3+ archivos**. Una sola tool call reemplaza múltiples `write`/`edit` secuenciales.

### patch (recomendado — determinista)

Usa **diff unificado** (formato estándar de `git diff`, `diff -u`). Incluye contexto alrededor del cambio para anclaje seguro.

```
forja_refactor({
  operations: [{
    type: "patch",
    filePath: "src/player.ts",
    diff: "@@ -10,7 +10,7 @@\n function oldName() {\n-  return oldThing\n+  return newThing\n }"
  }],
  dryRun: true    // ← SIEMPRE usa dryRun primero
})
```

**Formato diff:**
- `@@ -line,count +line,count @@` — hunk header
- ` contenido` — línea de contexto (anclaje)
- `-línea` — línea a eliminar
- `+línea` — línea a añadir

### jaccard (fallback — fuzzy)

Para cuando no tienes el diff exacto. Pasa `oldBlock` (lo que buscas) y `newBlock` (reemplazo).

```
forja_refactor({
  operations: [{
    type: "jaccard",
    filePath: "src/enemy.ts",
    oldBlock: "return oldThing",
    newBlock: "return newThing",
    occurrence: 2  // reemplaza la 2da ocurrencia (default: 1)
  }]
})
```

**Características:**
- ✅ Similarity mínima 85% — evita falsos positivos
- ✅ **Preserva indentación automáticamente** — detecta whitespace del archivo
- ✅ `occurrence: 1` | `N` | `"last"` — selecciona qué ocurrencia reemplazar
- ✅ **BOM stripping** — archivos con BOM UTF-8 funcionan
- ✅ **Trailing whitespace** — diff tolerant a espacios al final

### Parámetros globales

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `operations[]` | — | Operaciones a realizar |
| `dryRun` | `true` | Preview sin aplicar cambios |
| `atomic` | `true` | Rollback de TODOS los archivos si alguna operación falla |
| `verify` | `false` | Ejecuta forja_check (balance llaves/strings) post-parche |

### Validaciones

| Condición | Comportamiento |
|-----------|---------------|
| `operations` vacío o faltante | `{ok:false, err: "Missing required parameter"}` |
| Diff sin hunks válidos | Error: "No valid hunks found" |
| Diff con 0-1 líneas de contexto | Error: "Incluye al menos 2-3 líneas alrededor del cambio" |
| Path del diff header ≠ filePath | Error: "no coincide con filePath" |
| Jaccard < 85% | Error: "similarity: X%, threshold: 85%" |
| Archivo no existe | Error: "File does not exist" |

### Orden y transaccionalidad

Las operaciones se ejecutan en el orden del array:
- Si `atomic=true` y la op 2 falla, las ops 0 y 1 se revierten automáticamente
- Archivos no tocados por ops anteriores no se ven afectados
- El orden del array importa para el resultado del rollback

---

## forja_build — Creación Batch de Archivos

```
forja_build({
  files: [
    { path: "src/components/Button.tsx", content: "export const Button = ..." },
    { path: "src/components/Input.tsx", content: "export const Input = ..." },
  ],
  overwrite: false,    // no sobrescribir existentes
  createDirs: true,    // crear directorios intermedios
  dryRun: true         // preview antes de crear
})
```

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `files[]` | — | Archivos a crear (path + content) |
| `overwrite` | `false` | Sobrescribir si ya existe |
| `createDirs` | `true` | Crear directorios intermedios automáticamente |
| `dryRun` | `true` | Preview sin crear archivos |

---

## forja_read — Lector Universal

| Acción | Descripción | Cuándo usar |
|--------|-------------|-------------|
| `scan` | Estructura: headings (docs), funciones/clases (código), párrafos (texto) | **Siempre primero** — entender qué hay en el archivo |
| `skeleton` | Solo nombres + números de línea. Ultra-compacto | Cuando quieres ahorrar tokens |
| `extract` | Extrae por keywords o sección exacta (`## Section Name`) | Cuando sabes lo que buscas |
| `context` | Símbolo → firma + cuerpo completo + referencias internas | Para entender una función/clase en detalle |
| `batch` | Múltiples archivos en paralelo con la misma acción | Comparar estructura de varios archivos |

**Encoding auto-detection:** UTF-8 → UTF-16LE (BOM) → Latin-1 → si >10% bytes de control → **hex dump**.

**Binary fallback:** Muestra magic bytes + MIME detectado (ZIP, PNG, PDF, ELF, PE, MP4...) + dump hex de primeros 256 bytes.

**80+ extensiones soportadas:** incluyendo Minecraft (.mcfunction, .mcmeta), Godot (.tscn, .tres, .gdshader), L4D2 (.vdf, .qc, .nut, .gnut), LaTeX (.tex, .sty), configs (.ini, .cfg, .properties), data (.csv, .xml, .plist), legacy (.f, .pas, .lisp, .asm).

---

## forja-guard — Seguridad Quirúrgica

Hook `tool.execute.before` para protección mínima:

| Tool | Protección |
|------|------------|
| `bash` | Escapa comandos con shescape (no regex-block) |
| `read` | Bloquea `.env`, `credentials.*`, `*secret*`, `*.pem` |
| `write`/`edit` | Valida filePath dentro de projectRoot |

Sin regex-block de comandos, sin conteo de edits, sin hallucination checks falsos.

---

## Hooks

| Hook | Propósito |
|------|-----------|
| `event` | Detectar session/tool events |
| `experimental.chat.system.transform` | Inyectar proyector + hints al inicio de cada turno |
| `experimental.session.compacting` | Preservar proyector + hints en compactación |
| `tool.execute.before` | Guard + lazy scan en read/edit/write |
| `tool.execute.after` | Sieve check post-edit automático |

---

## Arquitectura

```
plugins/forja-suite/
├── src/
│   ├── index.ts                 ← Orquestador: hooks, eager scan, hints
│   ├── core/
│   │   ├── forja-read.ts        ← Lector universal (encoding fallback, binary dump)
│   │   ├── forja-skill.ts       ← Gestor de skills OpenCode
│   │   ├── forja-refactor.ts    ← Batch multi-archivo (diff + Jaccard + rollback)
│   │   ├── forja-build.ts       ← Batch file creation
│   │   ├── forja-guard.ts       ← Seguridad quirúrgica
│   │   └── forja-sieve.ts       ← Verificador sintáctico post-edit
│   ├── shared/
│   │   ├── types.ts             ← Interfaces y configuración
│   │   ├── logger.ts            ← Structured logging via SDK
│   │   ├── response.ts          ← ok() / fail() helpers
│   │   ├── proyector.ts         ← Escáner de proyecto con cache
│   │   └── forja-remind.ts      ← Recordatorios programados
├── dist/plugin.js               ← Bundle (~100 KB, npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Desarrollo

```bash
# Typecheck
npm run check

# Build bundle
npm run build          # → dist/plugin.js

# Publicar nueva versión
npm version patch      # 1.3.0 → 1.3.1
npm run prepublishOnly # verify + build
git push --tags
npm publish
```

---

## Anti-patrones

- NUNCA `full` si no editas — jerarquía token: `scan` > `skeleton` > `context` > `extract`
- NUNCA `forja_project` sin verificar que `projectRoot` no es raíz
- NUNCA loops infinitos en Edit — máx 2 intentos con re-lectura
- NUNCA mezclar `forja_refactor` (editar) con `forja_build` (crear)
- NUNCA bundlear zod/SDK — `--external:zod --external:@opencode-ai/plugin` siempre

---

## ⠀⠀⠀⠀⠀⠀⠀多謝垂注
⠀⠀⠀⣏⡱ ⣏⡉ ⣏⡱ ⡇ ⣎⣱   ⡷⢾ ⢇⡸
⠀⠀⠧⠜ ⠧⠤ ⠇⠱ ⠇ ⠇⠸   ⠇⠸ ⠇⠸
⠀https://ko-fi.com/general_beria

---

**License:** GPL-3.0-only
