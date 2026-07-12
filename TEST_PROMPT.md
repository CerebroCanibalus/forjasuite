# 🧪 Test Prompt: forja_refactor + forja_build

## Setup

1. Clona/usa **cualquier repositorio** con al menos 5-10 archivos fuente (TS, JS, Python, lo que sea).
2. Asegúrate de que en `opencode.jsonc` esté registrado el plugin forja-suite v1.3.0:
   ```json
   "plugin": ["file:///C:/Users/Lord Gatito/.config/opencode/plugins/forja-suite"]
   ```
3. Abre OpenCode desde el repositorio.

---

## 1. `forja_refactor` — Tests de calidad

### 1a. Patch básico — 1 hunk, 1 archivo
```
[EDIT] en un archivo .ts cualquiera, cambia una function por otra
Usa: forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<ruta>",
    diff:"@@ -10,5 +10,7 @@\n function oldName() {\n-  return oldThing\n+  return newThing\n }" }]
```
✅ **Esperado:** El archivo se modifica. Verificar con read que `newThing` aparece.

### 1b. Patch multi-hunk — 2 cambios en 1 archivo
```
forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<ruta>",
    diff:"@@ -1,3 +1,3 @@\n-const a=1\n+const a=2\n@@ -10,3 +10,3 @@\n-let b=3\n+let b=4" }]
```
✅ **Esperado:** Ambos cambios aplicados.

### 1c. dryRun = true — preview sin modificar
```
forja_refactor dryRun:true
  operations: [{ type:"patch", filePath:"<ruta>", diff:"@@ -1,3 +1,3 @@\n-const a=1\n+const a=2" }]
```
✅ **Esperado:** Muestra preview con `🔍 Dry-run — Preview`. Archivo NO cambia.

### 1d. Jaccard exact match — oldBlock idéntico
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>",
    oldBlock:"const a = 1",
    newBlock:"const a = 999" }]
```
✅ **Esperado:** Reemplazo exacto aplicado. similarity=100%.

### 1e. Jaccard fuzzy match — oldBlock con whitespace distinto
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>",
    oldBlock:"const   a   =   1",
    newBlock:"const a = 999" }]
```
✅ **Esperado:** Debe encontrar el match (Jaccard >85%). Similarity <100%.

### 1f. Atomic rollback — 2 ops, 1 falla, todo se revierte
```
forja_refactor dryRun:false atomic:true
  operations: [
    { type:"patch", filePath:"<ruta-existente>", diff:"@@ -1,3 +1,3 @@\n-const a=1\n+const a=2" },
    { type:"patch", filePath:"<ruta-inexistente>", diff:"@@ -1,1 +1,1 @@\n-x\n+y" }
  ]
```
✅ **Esperado:** La primera op se aplica, la segunda falla, rollback revierte la primera. Archivo original intacto.

---

## 2. `forja_refactor` — Tests de bugs (debe fallar graceful)

### 2a. Diff sin hunks
```
forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<ruta>", diff:"esto no es un diff" }]
```
✅ **Esperado:** Error: "No valid hunks found in diff"

### 2b. Diff que no matchea
```
forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<ruta>",
    diff:"@@ -1,3 +1,3 @@\n-ESTA_LINEA_NO_EXISTE\n+NADA" }]
```
✅ **Esperado:** Error: "Hunk... failed to match (Jaccard: 0%)"

### 2c. Jaccard con similarity <85%
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>",
    oldBlock:"ZXKJDHFKSJDHFKJSHDKFJHSDKJFHSKDJFHSKD",  // texto sin sentido
    newBlock:"reemplazo" }]
```
✅ **Esperado:** Error: "Jaccard match failed (similarity: ~0%)"

### 2d. Archivo no existe
```
forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"/ruta/que/no/existe.ts",
    diff:"@@ -1,3 +1,3 @@\n-x\n+y" }]
```
✅ **Esperado:** Error: "File does not exist"

### 2e. type="jaccard" sin oldBlock
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>", newBlock:"algo" }]
```
✅ **Esperado:** Error: "jaccard operation requires oldBlock + newBlock"

### 2f. type="patch" sin diff
```
forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<ruta>" }]
```
✅ **Esperado:** Error: "patch operation requires diff"

---

## 3. `forja_refactor` — Estrés

### 3a. Archivo grande (1000+ líneas)
```
Busca un archivo con 500+ líneas o créalo.
forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<archivo-grande>",
    diff:"@@ -1,3 +1,3 @@\n-import {something}\n+import {somethingElse}" }]
```
✅ **Esperado:** Aplica correctamente. <500ms.

### 3b. 5 operaciones en lote
```
forja_refactor dryRun:false
  operations: [
    { type:"patch", filePath:"<ruta1>", diff:"..." },
    { type:"patch", filePath:"<ruta2>", diff:"..." },
    { type:"jaccard", filePath:"<ruta3>", oldBlock:"...", newBlock:"..." },
    { type:"patch", filePath:"<ruta4>", diff:"..." },
    { type:"patch", filePath:"<ruta5>", diff:"..." },
  ]
```
✅ **Esperado:** Las 5 ops aplicadas correctamente.

### 3c. Unicode / ñ / tildes
```
Crea archivo test con: "const ñoño = 'méxico está aquí'"
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>",
    oldBlock:"const ñoño = 'méxico está aquí'",
    newBlock:"const renovado = 'nuevo valor'" }]
```
✅ **Esperado:** Reemplazo con caracteres Unicode funciona.

---

## 4. `forja_build` — Tests de calidad

### 4a. Crear 1 archivo
```
forja_build dryRun:false
  files: [{ path:"<ruta>/test-output/hello.ts", content:"export const hello = 'world'" }]
```
✅ **Esperado:** Archivo creado. `read` verifica contenido.

### 4b. Crear múltiples archivos con directorios anidados
```
forja_build createDirs:true dryRun:false
  files: [
    { path:"<ruta>/src/a/b/c/file1.ts", content:"// 1" },
    { path:"<ruta>/src/a/b/c/file2.ts", content:"// 2" },
    { path:"<ruta>/src/x/y/z/file3.ts", content:"// 3" },
  ]
```
✅ **Esperado:** 3 archivos creados, directorios intermedios creados automáticamente.

### 4c. dryRun = true
```
forja_build dryRun:true
  files: [{ path:"<ruta>/test-output/dry-test.ts", content:"// test" }]
```
✅ **Esperado:** Preview con `🔍 Dry-run — Preview`. Archivo NO se crea.

### 4d. overwrite = false (default) — archivo ya existe
```
Primero: write file test-output/exists.ts con contenido "original"
Luego: forja_build dryRun:false files: [{ path:"<ruta>/test-output/exists.ts", content:"nuevo" }]
```
✅ **Esperado:** "skipped — Ya existe". Contenido sigue siendo "original".

### 4e. overwrite = true — forzar sobrescritura
```
forja_build overwrite:true dryRun:false
  files: [{ path:"<ruta>/test-output/exists.ts", content:"nuevo" }]
```
✅ **Esperado:** Sobrescrito. `read` muestra "nuevo".

---

## 5. `forja_build` — Bugs (debe fallar graceful)

### 5a. files vacío
```
forja_build dryRun:false files: []
```
✅ **Esperado:** Error de validación del schema (min 1).

### 5b. path sin content
```
forja_build dryRun:false
  files: [{ path:"<ruta>/test.ts" }]
```
✅ **Esperado:** Error de validación del schema (content requerido).

### 5c. Ruta inválida (caracteres prohibidos en Windows)
```
forja_build dryRun:false
  files: [{ path:"<ruta>/te*st<>|.ts", content:"// x" }]
```
✅ **Esperado:** Error del sistema de archivos capturado graceful.

---

## 6. `forja_build` — Estrés

### 6a. 20 archivos en lote
```
forja_build createDirs:true dryRun:false
  files: [ { path:"<ruta>/stress-{n}.ts", content:"// file {n}" } for n in 1..20 ]
```
✅ **Esperado:** 20 archivos creados en <2 segundos.

### 6b. Contenido grande (100KB)
```
forja_build dryRun:false
  files: [{ path:"<ruta>/big-file.ts", content:"x".repeat(100000) }]
```
✅ **Esperado:** Archivo creado correctamente. 100KB.

---

## Criterios de éxito global

| Categoría | Mínimo |
|-----------|--------|
| Calidad refactor | 6/6 tests pasan |
| Bugs refactor | 6/6 fallos graceful |
| Estrés refactor | 3/3 funcionales |
| Calidad build | 5/5 tests pasan |
| Bugs build | 3/3 fallos graceful |
| Estrés build | 2/2 funcionales |

**FAIL** si algún test de "Esperado" no se cumple o si la tool crashea (throw en vez de devolver error string).

---

## Reporte

Devuelve:
1. Número de tests pasados/fallados por categoría
2. Para cada fallo: qué test + qué pasó + qué se esperaba
3. Tiempo total de ejecución
4. Bug crítico si hay crash (throw no capturado)
