# 🧪 Test Round 2 — 5 nuevos fixes (v1.3.0)

## Fix 1: BOM Stripping

### T1a — Archivo con BOM
```
Crea un archivo con BOM:
  bash: $'\\uFEFFconst x = 1\\nconst y = 2' > test-bom.ts
  (o con PowerShell: [System.IO.File]::WriteAllBytes('test-bom.ts', [byte[]](0xEF,0xBB,0xBF,0x63,0x6F,0x6E,0x73,0x74,0x20,0x78,0x20,0x3D,0x20,0x31))

Luego forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<ruta>/test-bom.ts",
    diff:"@@ -1,2 +1,2 @@\n const x = 1\n-const y = 2\n+const y = 999" }]
```
✅ **Esperado:** Patch aplicado correctamente a pesar del BOM. `read` muestra `const y = 999`.

### T1b — Sin BOM (regresión)
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<archivo-normal>",
    oldBlock:"return a + b", newBlock:"return a + b + c" }]
```
✅ **Esperado:** Sigue funcionando normal, BOM stripping no rompe nada.

---

## Fix 2: Trailing Whitespace

### T2a — Diff con trailing spaces en el archivo
```
Crea: echo "const x = 1   " > test-trail.ts  (3 espacios al final)
Luego forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<ruta>/test-trail.ts",
    diff:"@@ -1,1 +1,1 @@\n const x = 1\n+const x = 999" }]
```
✅ **Esperado:** El diff matchea aunque el archivo tenga trailing spaces y el diff no.

### T2b — Diff con trailing spaces en oldBlock
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<archivo>",
    oldBlock:"return a + b   ",   // con trailing spaces
    newBlock:"return z" }]
```
✅ **Esperado:** Jaccard matchea aunque oldBlock tenga trailing spaces extras.

### T2c — Sin trailing spaces pero diff matchea (regresión)
```
forja_refactor dryRun:false
  operations: [{ type:"patch", filePath:"<archivo-normal>",
    diff:"@@ -1,3 +1,3 @@\n-const a = 1\n+const a = 2" }]
```
✅ **Esperado:** Sigue funcionando exactamente igual.

---

## Fix 3: Contexto insuficiente

### T3a — Diff sin contexto (0 líneas)
```
forja_refactor dryRun:true
  operations: [{ type:"patch", filePath:"<archivo>",
    diff:"@@ -1,1 +1,1 @@\n-const a = 1\n+const a = 2" }]
```
✅ **Esperado:** Error: "Diff tiene solo 0 línea(s) de contexto. Incluye al menos 2-3 líneas"

### T3b — Diff con 1 línea de contexto
```
forja_refactor dryRun:true
  operations: [{ type:"patch", filePath:"<archivo>",
    diff:"@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 999" }]
```
✅ **Esperado:** Error: "Diff tiene solo 1 línea(s) de contexto..."

### T3c — Diff con 2 líneas de contexto (debe pasar)
```
forja_refactor dryRun:true
  operations: [{ type:"patch", filePath:"<archivo>",
    diff:"@@ -1,3 +1,3 @@\n const a = 1\n const b = 2\n-const c = 3\n+const c = 999" }]
```
✅ **Esperado:** Preview normal, sin error de contexto.

---

## Fix 4: Flag `occurrence`

### T4a — occurrence: 2 (segunda ocurrencia)
```
Crea archivo test-occ.ts con:
  const x = 1   // preserve
  const x = 1   // replace this one
  const x = 1   // preserve

forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>/test-occ.ts",
    oldBlock:"const x = 1", newBlock:"const x = 999",
    occurrence: 2 }]
```
✅ **Esperado:** Solo la SEGUNDA línea cambia. Primer y tercer `const x = 1` intactos.
```
// Resultado:
  const x = 1
  const x = 999
  const x = 1
```

### T4b — occurrence: 3 (que no existe)
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>/test-occ.ts",
    oldBlock:"NO_EXISTE", newBlock:"NADA", occurrence: 1 }]
```
✅ **Esperado:** Error normal de Jaccard (similarity baja). No crash.

### T4c — occurrence: "last"
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>/test-occ.ts",
    oldBlock:"const x = 1", newBlock:"const x = 777",
    occurrence: "last" }]
```
✅ **Esperado:** Solo la ÚLTIMA línea cambia.

### T4d — Sin occurrence (default 1, regresión)
```
forja_refactor dryRun:false
  operations: [{ type:"jaccard", filePath:"<ruta>/test-occ.ts",
    oldBlock:"const x = 1", newBlock:"const x = 555" }]
```
✅ **Esperado:** Solo la PRIMERA línea cambia (comportamiento original).

---

## Fix 5: Diff header path mismatch

### T5a — Paths diferentes: debe fallar
```
forja_refactor dryRun:true
  operations: [{ type:"patch", filePath:"src/actual.ts",
    diff:"--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1,3 +1,3 @@\n const a = 1\n const b = 2\n-const c = 3\n+const c = 999" }]
```
✅ **Esperado:** Error: `Diff header path "src/other.ts" no coincide con filePath "src/actual.ts"`

### T5b — Paths que coinciden: debe pasar
```
forja_refactor dryRun:true
  operations: [{ type:"patch", filePath:"<ruta>/test-path.ts",
    diff:"--- a/<ruta>/test-path.ts\n+++ b/<ruta>/test-path.ts\n@@ -1,3 +1,3 @@\n const a = 1\n const b = 2\n-const c = 3\n+const c = 999" }]
```
✅ **Esperado:** Preview normal (paths coinciden).

### T5c — Sin --- header en diff: debe pasar (no hay path para comparar)
```
forja_refactor dryRun:true
  operations: [{ type:"patch", filePath:"<archivo>",
    diff:"@@ -1,3 +1,3 @@\n const a = 1\n const b = 2\n-const c = 3\n+const c = 999" }]
```
✅ **Esperado:** Preview normal. Sin path header = no hay validación.

---

## Reporte

```
Fix 1 (BOM):       T1a __/1  T1b __/1
Fix 2 (Trailing):  T2a __/1  T2b __/1  T2c __/1
Fix 3 (Contexto):  T3a __/1  T3b __/1  T3c __/1
Fix 4 (Occurr.):   T4a __/1  T4b __/1  T4c __/1  T4d __/1
Fix 5 (Path):      T5a __/1  T5b __/1  T5c __/1
────────────────────────────────────────
Total:            __/15
```

**FAIL** si algún test de "Esperado" no se cumple o si la tool crashea (throw en vez de `{ok:false, err}`).
