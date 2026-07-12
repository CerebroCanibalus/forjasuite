## Plan de pruebas: forja_check (tool de verificación)

`forja_check` es una tool que el agente invoca. No se ejecuta automáticamente.
El agente la llama después de editar/escribir archivos para verificar integridad.

### Setup
Crear `C:\temp\sieve-test\` con:
```
real_module.py       → def helper(): pass
real_script.gd       → extends Node
real_lib.nut         → function Trace(){}
real_util.ts         → export function foo(){}
real_data.yaml       → key: value
sub/inner.py         → class Inner: pass
```

### Ejecución
1. Escribe el archivo con `write`
2. Llama `forja_check(filePath: "ruta/al/archivo")`
3. Verifica el resultado de la tool

### Tests

| # | Acción | Llamada forja_check | Esperado |
|---|--------|---------------------|----------|
| **Grupo A — File refs** |
| 1 | Write `test_a.py`: `from real_module import helper` | `forja_check(filePath: "test_a.py")` | ✅ Sin issues |
| 2 | Write `test_b.py`: `from fake_module import nothing` | `forja_check(filePath: "test_b.py")` | ⚠️ Warning: archivo no encontrado |
| 3 | Write `test_c.ts`: `import { foo } from './real_util'` | `forja_check(filePath: "test_c.ts")` | ✅ Sin issues |
| 4 | Write `test_d.gd`: `extends "res://real_script.gd"` | `forja_check(filePath: "test_d.gd")` | ⚠️ Warning: res:// no resuelve |
| 5 | Write `test_e.nut`: `IncludeScript("real_lib")` | `forja_check(filePath: "test_e.nut")` | ✅ Sin issues |
| 6 | Write `test_f.nut`: `IncludeScript("fake_lib")` | `forja_check(filePath: "test_f.nut")` | ⚠️ Warning: no encontrado |
| 7 | Write `test_g.py`: `from sub.inner import Inner` | `forja_check(filePath: "test_g.py")` | ✅ Sin issues |
| 8 | Write `test_h.yaml`: `!include real_data.yaml` | `forja_check(filePath: "test_h.yaml")` | ✅ Sin issues |
| **Grupo B — Brace/string balance** |
| 9 | Write `test_i.py`: `def foo():\n    if x > 0:\n        print("ok"` | `forja_check(filePath: "test_i.py")` | ⛔ Error: string sin cierre |
| 10 | Write `test_j.py`: `data = {"a": 1, "b": 2` | `forja_check(filePath: "test_j.py")` | ⛔ Error: `{` sin cierre |
| **Grupo C — Quality checks** |
| 11 | Write `test_k.gd`: `extends "res://scenes/player.tscn"` | `forja_check(filePath: "test_k.gd")` | ✅ Sin issues |
| 12 | Write `test_l.gd`: `extends player.tscn` | `forja_check(filePath: "test_l.gd")` | ⚠️ Warning: extends sin comillas |
| 13 | Write `test_m.js`: `import { x } from ./my-module` | `forja_check(filePath: "test_m.js")` | ⚠️ Warning: falta comillas en import |
| 14 | Write `test_n.py`: `if x = 5:` | `forja_check(filePath: "test_n.py")` | ⚠️ Warning: `=` vs `==` |
| 15 | Write `test_o.rs`: `use std::collections` | `forja_check(filePath: "test_o.rs")` | ✅ Sin issues (std lib) |
| **Grupo D — Falsos positivos** |
| 16 | Write `test_p.js`: `console.log("hello")` | `forja_check(filePath: "test_p.js")` | ✅ Sin issues |
| 17 | Write `test_q.py`: `import os` | `forja_check(filePath: "test_q.py")` | ✅ Sin issues (std lib) |
| 18 | Write `test_r.ts`: `import { defineConfig } from 'vitest/config'` | `forja_check(filePath: "test_r.ts")` | ✅ Sin issues (npm pkg) |
| **Grupo E — Sin argumento** |
| 19 | Write `test_s.py`: `from fake_xyz import foo` | `forja_check()` (sin args) | ⚠️ Warning: último archivo = test_s.py |

### Criterios de éxito
- Tool responde con texto descriptivo
- `⛔` para errores de estructura, `⚠️` para warnings
- Grupo D: cero issues reportados
- Test 19 usa el último archivo editado automáticamente
- Tests 4 (res://) puede fallar si no hay proyecto Godot — es aceptable
