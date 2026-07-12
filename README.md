# 🔨 Forja-Suite v1.3.0

> Ocho tools reales para un agente que no sea un lastre. Aquí: lector universal, refactor transaccional, builder batch, guard quirúrgico, checker sintáctico, project scanner, skill manager, reminder. 100 KB. OpenCode sin nosotros está cojo.

[![GitHub](https://img.shields.io/badge/GitHub-CerebroCanibalus/forjasuite-8B5CFE?logo=github)](https://github.com/CerebroCanibalus/forjasuite)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org)
[![Bundle](https://img.shields.io/badge/Bundle-100KB-success)](#)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

---

## 🤔 Por qué existe esto

Usé **oh-my-opencode**. Esto es lo que aprendí.

### Sísifo no es un agente, es un prompt

Se vende como "orquestador principal". Son 650 líneas de markdown que le dicen al LLM: *"You are a senior SF Bay Area engineer. You delegate, verify, and ship."* Después lo obligan a pasar por un Intent Gate, un Plan Agent, un TODO enforcer y TDD compulsivo antes de escribir una línea. Es un system prompt enorme disfrazado de agente. No hay inteligencia, no hay orquestación real — solo reglas para que el LLM no se duerma.

El resultado: el 80% de los tokens se quema invocando subagentes (Librarian, Explore, Oracle...) antes siquiera de tocar código. Es burocracia mitológica.

### Hashline vende benchmarks tramposos

Su "innovación": un hash de 2 caracteres por línea y un benchmark que presume de pasar del 6.7% al 68.3% de éxito en ediciones. Analicemos:

- **El 6.7% es trampa.** Comparan contra el `edit` nativo de OpenCode, que usa búsqueda de string exacto. Saben que es una mierda — es la peor baseline posible. Evitan comparar contra diff analysis o fuzzy match porque perderían.
- **68.3% también es una mierda.** 1 de cada 3 ediciones falla. Y cuando falla, **corrompe el archivo**: no hay rollback, no hay transacción. Sobrevives con git.
- **Colisión de hash asegurada.** 256 entradas para archivos de cientos de líneas. Dos líneas con el mismo hash y el sistema edita la que no es. En mis pruebas pasó.
- **Parches sobre parches.** Tienen funciones para "autocorregir" ediciones malformadas después de aplicarlas. Aceptan basura y tratan de arreglarla adivinando.
- **Secuestra las tools nativas.** Hashline deshabilita `read`, `edit` y `grep` de OpenCode. Si falla, te quedas sin herramientas.

**Mi solución fue forja_refactor:** edita múltiples archivos en una sola llamada usando diff unificado (determinista, sin hash), con Jaccard como fallback fuzzy, rollback transaccional si algo sale mal, y verify post-parche. Nunca corrompe un archivo — prefiere fallar antes que escribir mal.

### El autor no sabe programar

Lo dice él: *"I don't really know how to write proper TypeScript. 99% of this project was built using OpenCode."*

La IA hoy escribe el 90% del código, eso no es novedad. El problema no es que el código lo hiciera una IA — el problema es **el diseño.** La IA escribe lo que le pides. Si tiene una arquitectura de mierda, la IA te la escribe igual de bonita. Y oh-my-opencode la tiene:

**Monolito total.** 1.477 commits. Agentes, hooks, tools, MCPs, skills, LSP, CLI, instalador, doctor, binarios, CLA, Discord, web... todo revuelto sin separación de nada. No es un plugin, es un sistema operativo.

**Prompts como arquitectura.** Sísifo es un prompt. El Intent Gate es otro prompt. El Plan Agent, otro más. Cada nuevo "agente" es otro archivo markdown. En vez de construir infraestructura real (diff engine, transaction manager, abstracción de archivos), lo resuelven con más texto. Eso no escala, no se testea, y se rompe cada vez que el modelo cambia.

**Acoplados al modelo de turno.** Prompts distintos para GPT-5.4, Claude Opus 4.7, Gemini, Kimi K2... cada uno con su "arquitectura" de prompt. El día que el modelo cambie de comportamiento, todo el castillo de naipes se cae.

**Core primitive de 2 caracteres.** Todo el sistema de edición descansa sobre un hash de 2 caracteres (256 entradas). Eso no es un bug, es una decisión arquitectónica mala. Es construir una casa sobre cimientos de papel.

### Pero no todo está perdido

Forja-suite existe para lo contrario: **tools que resuelven problemas reales, diseñadas para lo que OpenCode no te da.**

OpenCode por sí solo tiene un `read` básico, un `edit` que falla si cambia un espacio, un `write` para un archivo a la vez, skills que no se pueden gestionar desde el chat, y cero seguridad. Forja-suite tapa esos agujeros:

| Herramienta | Qué necesitabas | Lo que te damos |
|-------------|----------------|-----------------|
| `forja_read` | Leer archivos sin quemar tokens en texto plano | 5 modos (scan/skeleton/extract/context/batch) que ahorran hasta 95% |
| `forja_project` | Preguntar "qué hay en src/db" sin hacer glob manual | Escaneo estructurado con cache. Consultas por archivos, deps, tipo, árbol |
| `forja_refactor` | Editar 5 archivos sin 5 tool calls | Diff unificado + Jaccard + rollback. Todo en una llamada |
| `forja_build` | Crear 10 archivos de una puta vez | Batch creation con dry-run, directorios intermedios, sin pisar existentes |
| `forja_check` | Verificar que el edit no dejó llaves sueltas | Determinista, 0 tokens, milisegundos |
| `forja_skill` | Crear/editar skills sin salir del chat | CRUD completo de skills de OpenCode. Creas, editas, listas, borras |
| `forja_guard` | Que el agente no borre .env ni escape a producción | Shescape + path validation + bloqueo de archivos sensibles |
| `forja_remind` | Recordar algo en 5 minutos sin poner un timer manual | Recordatorios programados con add/list/remove/recurring |
| `forja_debug` | Saber qué mierda pasa con el plugin | Estado interno: caché, watchdogs, sessionId, skills cargados |

**Token savings reales:**
- `forja_read` en modo `scan` o `skeleton`: **80-95% menos tokens** que leer el archivo entero. Para archivos de 1000+ líneas, el ahorro supera el 95%.
- `forja_refactor` edita N archivos en **una sola tool call**. Cada `edit` nativo cuesta ~500 tokens de overhead. En 5 archivos ahorras ~2000 tokens.
- `forja_check`: **0 tokens.** Corre en milisegundos, detecta desbalances que el LLM dejó pasar.
- `forja_project`: cachea resultados. La primera llamada escanea, las siguientes son instantáneas.
- `forja_guard`: usa shescape (escapado real), no regex blocks falibles. 0 falsos positivos. 0 tokens.

**Calidad:**
- 59 tests de integración: diff unificado, Jaccard fuzzy, encoding detection, binary fallback, guard bypass, edge cases (vacíos, single-line, UTF-16, símbolos)
- Verify post-parche: detecta corrupción antes de que llegue al disco
- Rollback transaccional: si una falla, todas se revierten
- Sin dependencias externas. Sin MCPs. Sin agentes. Sin Discord. Sin CLA.

**El resultado:** 100 KB de tools que tu agente puede usar con cualquier modelo, que no secuestran las tools nativas, y que nunca te van a corromper un archivo.

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

## 🛠️ Tools al detalle

| Tool | Lo que hace | Lo que OpenCode no te da | Tokens |
|------|------------|--------------------------|--------|
| `forja_read` | 5 modos de lectura, 80+ formatos, auto-encoding, hex dump | Leer con estructura (scan/skeleton) en vez de texto plano | ~80-95% |
| `forja_project` | Escanea proyecto, cachea, 5 consultas: files/deps/type/tree/refresh | Preguntar "qué hay en src/db" sin leer el árbol entero | ∞ (cache) |
| `forja_refactor` | Edición batch multi-archivo, diff unificado + Jaccard, rollback | Editar 10 archivos en 1 call con transacciones | ~2000 en 5 |
| `forja_build` | Crea N archivos en batch, directorios, dry-run, no pisa | Crear proyectos enteros en 1 tool call | N→1 calls |
| `forja_check` | Balance llaves/paréntesis/strings, determinista, 0 tokens | Verificar sintaxis post-edit sin LLM | 0 tokens |
| `forja_skill` | CRUD de skills: create/list/delete desde el chat | Gestionar skills sin salir de la sesión | N/A |
| `forja_guard` | Escapa bash (shescape), bloquea .env/pem/secret, valida projectRoot | Seguridad quirúrgica sin regex blocks ni falsos bloqueos | 0 tokens |
| `forja_remind` | Recordatorios programados: add/list/remove/recurring | Sistema de notificaciones temporizadas | N/A |
| `forja_debug` | Estado interno: caché, watchdogs, sessionId, skills cargados | Diagnóstico rápido sin revisar logs | N/A |

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
