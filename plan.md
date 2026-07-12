# Forja-Suite — Plan Maestro v2

> Plugin monolítico de desarrollo para OpenCode.
> Edición tolerante + verificación determinista + propagación semántica + compresión de contexto.

---

## 1. Arquitectura (v2)

```
forja-suite/
├── plan.md
├── README.md
├── BENCHMARK.md
├── package.json
├── tsconfig.json
│
├── src/
│   ├── index.ts                    # Entry point
│   ├── core/
│   │   ├── forja-edit.ts           # ★ Flagship — fuzzy edit (Jaccard, 5 ops)
│   │   ├── forja-sieve.ts          # ★ Anti-alucinación por AST determinista [NUEVO]
│   │   ├── forja-contract.ts       # ★ Contratos de edición pre/post [NUEVO]
│   │   ├── forja-amplify.ts        # ★ Propagación semántica de cambios [NUEVO]
│   │   ├── forja-compress.ts       # ★ Compresión de contexto conversacional [NUEVO]
│   │   ├── forja-read.ts           #   Lector universal (doc/code)
│   │   ├── forja-hash.ts           # [DEPRECATED — se elimina]
│   │   └── forja-diff.ts           # [LEGACY — se elimina]
│   ├── languages/
│   │   ├── vscript-l4d2/
│   │   ├── gdscript/
│   │   └── mythicmobs/
│   └── shared/
│       ├── types.ts
│       ├── session-store.ts
│       ├── tokenizer.ts
│       └── logger.ts
│
└── tests/
```

## 2. Eliminaciones

| Módulo | Razón |
|--------|-------|
| `forja-reason` | Patético: solo inyecta "piensa más corto" en system prompt. Sin cambio estructural. Ignorado por el modelo cuando le conviene. |
| `forja-guard` | Rescatable en parte (brace parity, rm -rf block). Lo útil migra a `forja-sieve`. El resto (hallucination checks con nombres `doMagic`, `makeItWork`) es ridículo. |
| `forja-hash` | Reemplazado por `forja-edit` (flagship). |
| `forja-diff` | Reemplazado por `forja-edit`. |

## 3. Nuevos Módulos Core

### 3.1 `forja-sieve` — Integrity Checker Post-Edit ★ P1 ✅

**Idea:** Verificar que las referencias a archivos en código nuevo realmente existan en disco. 100% determinista, 0 falsos positivos, cross-language.

**Chequeos:**
- **File reference resolution**: extrae `from/import/require/preload/extends/load` de cualquier lenguaje (regex genérico, no específico por lenguaje), resuelve contra el filesystem con `fs.access(F_OK)`.
- **Brace/paren balance:** detecta llaves y paréntesis sin cerrar.
- **String closure:** detecta strings sin cerrar.

**No usa CBM:** es ortogonal. CBM resuelve símbolos (deep), sieve verifica archivos (shallow). Son complementarios.

**Implementación:** post-edit hook, <5ms por chequeo, cachea resultados de `fs.access`.

### 3.2 `forja-contract` — Contratos de Edición ★ P2

**Idea:** Antes de editar, el agente declara invariantes post-edit. Forja verifica después.

**Sintaxis:**
```
/// @contract after-edit:
///   - function "process" exists with signature (data: str) -> Result
///   - class "Handler" has method "validate"
///   - file exports at least 3 symbols
```

**Implementación:**
- Parse declaraciones de contrato en comentarios o argumentos de tool
- Verifica determinísticamente después del edit
- Reporta contrato violado vs cumplido

### 3.3 `forja-amplify` — Propagación Semántica de Edits ★ P3

**Idea:** Detecta el intento de un cambio y lo propaga a archivos relacionados.

**Escenarios:**
- Renombrar función → actualizar todos los callers por firma fuzzy
- Mover archivo → actualizar imports dependientes
- Cambiar API → encontrar usos y actualizar
- Refactor rename → propagación tipo-aware

### 3.4 `forja-compress` — Compresión de Contexto Conversacional ★ P3

**Idea:** 80% de tokens se gastan en "finding things". Una tool que analiza el flujo de mensajes del agente y comprime.

**Técnicas:**
- Dedup: reads repetidos del mismo archivo → cache
- Collapse: tool results idénticos consecutivos
- Summary: outputs largos de bash → resumen automático
- Prune: mensajes irrelevantes para la tarea actual

---

## 4. Prioridades

| Prioridad | Módulo | Esfuerzo | Impacto | Novedad |
|-----------|--------|----------|---------|---------|
| P1 | `forja-sieve` | Media | Alto | Muy alto — único tool agente con AST determinista |
| P2 | `forja-contract` | Bajo | Alto | Alto — nadie ofrece contracts para edits de IA |
| P3 | `forja-amplify` | Alto | Muy alto | Muy alto — propagación semántica como tool no existe |
| P3 | `forja-compress` | Medio | Medio | Alto — compresión en capa de mensajes es único |

---

## 5. Plan de Implementación

### Fase 1 — Refinar forja-sieve (ahora)
- [ ] Diseñar interfaz `Resolver` por lenguaje
- [ ] Implementar import resolver para Python/JS/Rust
- [ ] Implementar function call resolver
- [ ] Implementar scope validation
- [ ] Integrar como post-edit hook
- [ ] Benchmark vs hallucination dataset

### Fase 2 — forja-contract
### Fase 3 — forja-amplify o forja-compress
### Fase 4 — Limpieza: eliminar razón/guard/hash/diff del index.ts
### Fase 5 — Release v2

---

*Última actualización: 2026-07-08*
*Versión: 2.0.0 — Reinicio con enfoque en verificación determinista*
