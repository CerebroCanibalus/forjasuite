# 🔨 Forja-Suite v1.3.0

> *Toolbox de ingeniería de contexto para OpenCode. Ocho herramientas que tu agente debería tener desde el día uno.*

[![GitHub](https://img.shields.io/badge/GitHub-CerebroCanibalus/forjasuite-8B5CFE?logo=github)](https://github.com/CerebroCanibalus/forjasuite)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org)
[![Bundle](https://img.shields.io/badge/Bundle-100KB-success)](#)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

---

## 📥 Instalación

### Opción A: GitHub Packages (recomendada)

```jsonc
// opencode.jsonc
"plugin": ["@CerebroCanibalus/forjasuite"]
```

Y en tu `~/.npmrc`:
```npmrc
//npm.pkg.github.com/:_authToken=ghp_<tu-token>
@CerebroCanibalus:registry=https://npm.pkg.github.com/
```

### Opción B: Local (la que no falla)

```jsonc
// opencode.jsonc
"plugin": ["C:\\Users\\<user>\\.config\\opencode\\plugins\\forja-suite"]
```

```bash
cd ~/.config/opencode/plugins
git clone https://github.com/CerebroCanibalus/forjasuite
cd forjasuite && npm install
```

### Opción C: nada, usa las tools de serie y sufre

No recomendada.

> **ℹ️ Sobre npm:** Si, este paquete también está en npm. npm nos pidió 2FA con llave física para publicar. Que se jodan. Usamos GitHub Packages. Misma mierda, menos vueltas.

---

## 🛠️ Tools

| Tool | Qué hace |
|------|----------|
| `forja_read` | Lector universal. 80+ extensiones, encoding auto-detect, fallback hex dump. Acciones: scan, skeleton, extract, context, batch. |
| `forja_project` | Escanea estructura y dependencias del proyecto. Lazy cache. Sin args = resumen. |
| `forja_check` | Balance de llaves, paréntesis, strings. Rápido, sin LLM, determinista. |
| `forja_skill` | Crea/edita/lista skills de OpenCode. |
| `forja_refactor` | Edición batch multi-archivo. Transaccional con rollback. Dif unificado o Jaccard fuzzy. |
| `forja_build` | Creación batch de archivos. Scaffolding, componentes, migraciones. Crea directorios intermedios. |
| `forja_remind` | Recordatorios programados. add, list, remove. |
| `forja_debug` | Estado interno del plugin. Diagnóstico rápido. |

---

## 🔧 forja_refactor — Edición Batch

Carnicero fino para refactors que tocan 3+ archivos. Una tool call reemplaza `write`/`edit` en serie.

### patch (determinista — recomendado)

```
forja_refactor({
  operations: [{
    type: "patch",
    filePath: "src/player.ts",
    diff: "@@ -10,7 +10,7 @@\n function oldName() {\n-  return oldThing\n+  return newThing\n }"
  }],
  dryRun: true
})
```

**Formato diff:** estándar `git diff` o `diff -u`. Contexto mínimo 2-3 líneas alrededor.

### jaccard (fallback — fuzzy)

Cuando no tienes el diff exacto. Pasa `oldBlock` y `newBlock`.

```
forja_refactor({
  operations: [{
    type: "jaccard",
    filePath: "src/enemy.ts",
    oldBlock: "return oldThing",
    newBlock: "return newThing",
    occurrence: 2
  }]
})
```

**Lo que aguanta:** similarity ≥85%, indentación preservada, BOM stripping, trailing whitespace tolerant, `occurrence` selectivo.

### Comportamiento

| Parámetro | Default | Efecto |
|-----------|---------|--------|
| `dryRun` | `true` | Preview sin tocar nada |
| `atomic` | `true` | Si una falla, todas se revierten |
| `verify` | `false` | forja_check post-parche |

**Validaciones:** operations vacío, diff sin hunks, contexto insuficiente, path mismatch, similarity baja. Todo reportado sin rodeos.

---

## 🏗️ forja_build — Batch File Creation

```
forja_build({
  files: [
    { path: "src/components/Button.tsx", content: "export const Button = ..." },
    { path: "src/components/Input.tsx", content: "export const Input = ..." },
  ],
  overwrite: false,
  createDirs: true,
  dryRun: true
})
```

| Parámetro | Default | Efecto |
|-----------|---------|--------|
| `dryRun` | `true` | Preview |
| `overwrite` | `false` | No pisa archivos existentes |
| `createDirs` | `true` | Crea directorios intermedios |

---

## 📖 forja_read — Lector Universal

| Acción | Cuándo |
|--------|--------|
| `scan` | **Siempre primero.** Estructura del archivo. |
| `skeleton` | Solo nombres y línea. Ultra-compacto. |
| `extract` | Ya sabes lo que buscas. Keywords o sección exacta. |
| `context` | Símbolo → firma + cuerpo + referencias. |
| `batch` | Múltiples archivos a la vez. |

**Encoding:** UTF-8 → UTF-16LE (BOM) → Latin-1 → >10% binario → hex dump.

**Binary fallback:** magic bytes + MIME + primeros 256 bytes en hex.

**80+ extensiones:** Minecraft, Godot, L4D2, LaTeX, configs, CSV, XML, legacy, etc.

---

## 🛡️ forja-guard — Seguridad Quirúrgica

Hook `tool.execute.before`. Lo justo y necesario.

| Tool | Protege |
|------|---------|
| `bash` | Escapa comandos con shescape (no regex-block) |
| `read` | Bloquea `.env`, `credentials.*`, `*secret*`, `*.pem` |
| `write`/`edit` | Valida filePath dentro de projectRoot |

Sin falsos bloqueos, sin conteos, sin hallucination checks pedorros.

---

## 🔌 Hooks

| Hook | Para qué |
|------|----------|
| `event` | Session/tool events |
| `system.transform` | Proyector + hints al inicio |
| `compacting` | Preserva estado en compactación |
| `tool.execute.before` | Guard + lazy scan |
| `tool.execute.after` | Sieve post-edit |

---

## 🧱 Arquitectura

```
forjasuite/
├── src/
│   ├── index.ts              ← Orquestador
│   ├── core/
│   │   ├── forja-read.ts     ← Lector universal
│   │   ├── forja-skill.ts    ← Gestor de skills
│   │   ├── forja-refactor.ts ← Refactor batch
│   │   ├── forja-build.ts    ← Creación batch
│   │   ├── forja-guard.ts    ← Seguridad quirúrgica
│   │   └── forja-sieve.ts    ← Verificador sintáctico
│   └── shared/
│       ├── types.ts
│       ├── logger.ts
│       ├── response.ts
│       ├── proyector.ts
│       └── forja-remind.ts
├── dist/plugin.js             ← Bundle 100 KB
├── package.json
└── README.md
```

---

## 🚫 Anti-patrones

- ❌ `full` si no editas. Jerarquía: `scan` > `skeleton` > `context` > `extract`
- ❌ `forja_project` en directorio raíz (no hay proyecto)
- ❌ Loops infinitos en Edit. Máx 2 intentos con re-lectura.
- ❌ Mezclar `forja_refactor` (editar) con `forja_build` (crear)
- ❌ Bundlear zod/SDK: `--external:zod --external:@opencode-ai/plugin`

---

## 🛠️ Desarrollo

```bash
npm run check       # Typecheck
npm run build       # Bundle → dist/plugin.js
npm version patch   # 1.3.0 → 1.3.1
git push --tags
```

---

```text
        ⠀⠀⠀⠀⠀⠀⠀多謝垂注
        ⠀⠀⠀⣏⡱ ⣏⡉ ⣏⡱ ⡇ ⣎⣱   ⡷⢾ ⢇⡸
        ⠀⠀⠀⠧⠜ ⠧⠤ ⠇⠱ ⠇ ⠇⠸   ⠇⠸ ⠇⠸
        ⠀https://ko-fi.com/general_beria
```

**License:** GPL-3.0-only
