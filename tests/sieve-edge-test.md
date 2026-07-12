## Test: edge cases + bugs corregidos

### Setup
```
C:\temp\sieve-test\
├── real_module.py       → def helper(): pass
├── real_script.gd       → extends Node
├── real_lib.nut         → function Trace(){}
├── real_util.ts         → export function foo(){}
├── real_data.yaml       → key: value
├── sub/inner.py         → class Inner: pass
├── icons/
│   └── hero.png         → (archivo PNG válido o dummy)
```

### Tests rápidos (15)
Escribir cada archivo → `forja_check(filePath: "...")`

| # | Contenido | Esperado |
|---|-----------|----------|
| **Bug 1: Resolución de paths** |
| 1 | `from real_module import helper` | ✅ Sin issues |
| 2 | `import { foo } from './real_util'` | ✅ Sin issues |
| 3 | `IncludeScript("real_lib")` | ✅ Sin issues |
| 4 | `from sub.inner import Inner` | ✅ Sin issues |
| 5 | `from fake_module import nothing` | ⚠️ no encontrado |
| 6 | `extends "res://scenes/player.tscn"` | ⚠️ res:// no resuelve (aceptable) |
| **Bug 2: Quality checks** |
| 7 | `extends player.tscn` | ⚠️ extends sin comillas |
| 8 | `import { x } from ./my-module` | ⚠️ import sin comillas |
| 9 | `if x = 5:` | ⚠️ `=` vs `==` |
| **Edge cases nuevos** |
| 10 | `from . import utils` (ref solo `.`) | Sin issues (ignora path vacío) |
| 11 | `use crate::module::helper` (Rust) | ✅ Sin issues si module/helper.rs existe |
| 12 | `import { merge } from 'lodash/fp'` | ✅ Sin issues (npm conocido) |
| 13 | `const img = "icons/hero.png"` | ✅ Sin issues (extensión .png ahora soportada) |
| 14 | `from __future__ import annotations` | ✅ Sin issues (std lib) |
| 15 | `import { defineConfig } from 'vitest/config'` | ✅ Sin issues (npm) |

### Criterios
- Tests 1-6 verifican que los bugs de resolución de paths están arreglados
- Tests 7-9 verifican quality checks
- Tests 10-15 verifican edge cases: 0 issues en todos
