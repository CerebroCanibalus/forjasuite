# 🔨 Forja-Suite v1.3.0

> Ocho tools reales para un agente que no sea un lastre. Aquí: lector universal, refactor transaccional, builder batch, guard quirúrgico, checker sintáctico, project scanner, skill manager, reminder. 100 KB. OpenCode sin nosotros está cojo.

[![GitHub](https://img.shields.io/badge/GitHub-CerebroCanibalus/forjasuite-8B5CFE?logo=github)](https://github.com/CerebroCanibalus/forjasuite)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org)
[![Bundle](https://img.shields.io/badge/Bundle-100KB-success)](#)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

---

## 🤔 Por qué existe esto

Usé **oh-my-opencode**. Menuda mierda.

### Sísifo: el agente que no es un agente

Se vende como "Sísifo, el orquestador principal". Sabes qué es? **Un prompt.** 650 líneas de plantilla markdown que le dice al LLM:

- *"You are a senior SF Bay Area engineer. You delegate, verify, and ship."*
- Tiene un "Intent Gate" que clasifica tu consulta en research/implementation/evaluation
- Te obliga a llamar a un "plan agent" para todo
- Tiene un TODO enforcer para que el agente no se duerma
- Te exige hacer TDD con RED→GREEN→SURFACE y capturar evidencia

A eso le llaman "orquestación inteligente". Es un prompt con nombre mitológico y un montón de reglas. No hay AGI, no hay orquestación real. Es un system prompt enorme que intenta suplir con ingeniería de texto lo que el plugin no puede hacer con código real.

Y lo peor: su flujo "ultrawork" te obliga a invocar subagentes para todo. Quieres leer un archivo? Primero invoca al Librarian, después al Explore, después al Plan Agent, espera su respuesta, luego tal vez puedas editar. El 80% del tiempo y tokens se pierde en burocracia de agentes.

### Hashline Edit: benchmark amañado y corrupción de archivos

Su gran innovación es **Hashline Edit**. Un sistema que asigna un hash de 2 caracteres a cada línea (`5#NS`) y edita por hash en vez de por contenido. Presumen de un benchmark: *"6.7% → 68.3% de éxito"*.

Vamos a diseccionar ese benchmark:

1. **El 6.7% es una strawman.** Comparan contra el `edit` nativo de OpenCode, que usa búsqueda por string exacto (`oldString`/`newString`). El agente tiene que reproducir el string perfecto incluyendo whitespace. Saben que eso falla a menudo — es la peor línea base posible. Podrían haber comparado contra diff analysis o fuzzy match, pero no les interesa.

2. **El 68.3% sigue siendo una mierda.** 1 de cada 3 ediciones falla. En producción eso es inaceptable.

3. **Los hashes de 2 caracteres = colisión asegurada.** Usan un diccionario de 256 entradas para generar hashes de 2 chars. En un archivo de 50 líneas tienes ~99% de probabilidad de colisión. Cuando dos líneas tienen el mismo hash, el sistema no sabe cuál editar. El resultado: **archivos corruptos.** En mis pruebas pasó exactamente eso.

4. **Autocorrect hacks.** El sistema tiene funciones como `stripInsertAnchorEcho` y `restoreLeadingIndent` — parches para corregir ediciones malformadas después de aplicarlas. En vez de rechazar una edición incorrecta, la aceptan y tratan de arreglarla. Eso no es seguridad, es adivinar.

5. **Sin rollback.** Si el hash falla y escribe donde no debe, no hay transacción, no hay vuelta atrás. El archivo queda corrupto y tienes que rehacerlo con git.

6. **Reemplaza las tools nativas.** Hashline deshabilita `read`, `edit` y `grep` nativos. No puedes elegir. Si hashline falla, no hay plan B.

**Ahora compáralo con forja_refactor:**
- **Diff unificado** (determinista, sin hash, sin colisiones)
- **Jaccard fallback** con 85% de similitud mínima (fuzzy, no hash ciego)
- **Rollback transaccional** — si algo falla, todo se revierte
- **Verify post-parche** — balance de llaves y paréntesis
- **Nunca corrompe un archivo.** Prefiere fallar antes que escribir mal

### El autor no sabe TypeScript

No lo digo yo. Lo dice **él mismo** en el Author's Note del README:

> *"I tested for functionality—I don't really know how to write proper TypeScript. But I personally reviewed and largely rewrote this doc, so read with confidence."*

Y más abajo: *"99% of this project was built using OpenCode."* O sea: el 99% del código lo escribió la IA (OpenCode usa LLMs para codegear), y él solo testeó. El resultado: 1.477 commits, 1.335 líneas solo en el manager de background agents, y un plugin monolítico que el autor no entiende del todo. Y encima te pide firmar un CLA para contribuir.

**Forja-suite es la respuesta:**
- **8 tools reales** con nombres que hacen lo que dicen. Nada de Sísifo ni Prometeo.
- **Refactor transaccional** con diff unificado + rollback. No un search-and-replace con hash.
- **100 KB**, cero dependencias externas, cero agentes, cero magia.
- **Guard quirúrgico** que protege sin joder.
- **Código escrito por alguien que sí sabe TypeScript.**
- **Sin skills pedorras. Sin MCPs. Sin orquestación mitológica.**

Oh-my-opencode te vende una película. Forja-suite te da herramientas que funcionan.

---

## 📥 Instalación

### GitHub Packages (recomendada)

```jsonc
"plugin": ["@CerebroCanibalus/forjasuite"]
```

Y en tu `~/.npmrc`:
```npmrc
//npm.pkg.github.com/:_authToken=ghp_<tu-token>
@CerebroCanibalus:registry=https://npm.pkg.github.com/
```

### Local (la que no falla)

```jsonc
"plugin": ["C:\\Users\\<user>\\.config\\opencode\\plugins\\forja-suite"]
```

```bash
cd ~/.config/opencode/plugins
git clone https://github.com/CerebroCanibalus/forjasuite
cd forjasuite && npm install
```

Que se vaya a la mierda NPM.

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
