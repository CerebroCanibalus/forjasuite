@echo off
setlocal enabledelayedexpansion
REM ============================================================================
REM setup.bat — Instalador unificado de Forja-Suite
REM Uso: setup.bat [--clean]
REM   Sin flags  = install + typecheck + verify
REM   --clean    = borra node_modules, reinstall desde cero, typecheck, verify
REM ============================================================================

set "PLUGIN_DIR=C:\Users\Lord Gatito\.config\opencode\plugins\forja-suite"
set "CLEAN_MODE=0"

if /i "%~1"=="--clean" set "CLEAN_MODE=1"

echo.
echo ============================================
echo   🏗️  FORJA-SUITE :: Setup
echo ============================================
echo.
echo   Plugin dir: %PLUGIN_DIR%
echo   Clean mode: %CLEAN_MODE%
echo.

REM ── STEP 1: Clean (optional) ──────────────────────────────────────────────
if "%CLEAN_MODE%"=="1" (
    echo [1/4] Limpiando node_modules...
    if exist "%PLUGIN_DIR%\node_modules" (
        rmdir /s /q "%PLUGIN_DIR%\node_modules"
        echo [OK] node_modules eliminado
    ) else (
        echo [OK] No habia node_modules
    )
) else (
    echo [1/4] Saltando limpieza (usa --clean para forzar)
)
echo.

REM ── STEP 2: Install dependencies ──────────────────────────────────────────
echo [2/4] Instalando dependencias...
cd /d "%PLUGIN_DIR%"
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install fallo
    exit /b 1
)
echo [OK] Dependencias instaladas
echo.

REM ── STEP 3: Typecheck ─────────────────────────────────────────────────────
echo [3/4] Verificando tipos TypeScript...
call npx tsc --noEmit
if %ERRORLEVEL% neq 0 (
    echo [ERROR] TypeScript encontro errores de tipo
    exit /b 1
)
echo [OK] TypeScript compila limpio
echo.

REM ── STEP 4: Verify structure ──────────────────────────────────────────────
echo [4/4] Verificando estructura del plugin...

set "ALL_OK=1"

if not exist "%PLUGIN_DIR%\src\index.ts" (
    echo [ERROR] Falta src\index.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\core\forja-read.ts" (
    echo [ERROR] Falta src\core\forja-read.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\core\forja-sieve.ts" (
    echo [ERROR] Falta src\core\forja-sieve.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\core\forja-guard.ts" (
    echo [ERROR] Falta src\core\forja-guard.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\core\forja-skill.ts" (
    echo [ERROR] Falta src\core\forja-skill.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\core\forja-refactor.ts" (
    echo [ERROR] Falta src\core\forja-refactor.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\core\forja-build.ts" (
    echo [ERROR] Falta src\core\forja-build.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\shared\types.ts" (
    echo [ERROR] Falta src\shared\types.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\shared\logger.ts" (
    echo [ERROR] Falta src\shared\logger.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\shared\response.ts" (
    echo [ERROR] Falta src\shared\response.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\shared\proyector.ts" (
    echo [ERROR] Falta src\shared\proyector.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\src\shared\forja-remind.ts" (
    echo [ERROR] Falta src\shared\forja-remind.ts
    set "ALL_OK=0"
)
if not exist "%PLUGIN_DIR%\node_modules\@opencode-ai\plugin" (
    echo [ERROR] SDK @opencode-ai/plugin no instalado
    set "ALL_OK=0"
)

if "%ALL_OK%"=="0" (
    echo.
    echo [ERROR] Faltan archivos. Corrige antes de continuar.
    exit /b 1
)

echo [OK] Todos los archivos presentes
echo.

REM ── DONE ──────────────────────────────────────────────────────────────────
echo ============================================
echo   ✅  Forja-Suite v1.3.0 lista
echo ============================================
echo.
echo   Tools activas:
echo     - forja_read     (lector universal: 80+ extensions, encoding fallback, hex dump binario)
echo     - forja_project  (escaneo de estructura/deps del proyecto)
echo     - forja_check    (balance llaves/parentesis, calidad codigo)
echo     - forja_skill    (crear/editar/listar skills)
echo     - forja_refactor (edicion batch multi-archivo: diff unificado + Jaccard + rollback)
echo     - forja_build    (creacion batch multi-archivo: scaffolding, componentes, migraciones)
echo     - forja_remind   (recordatorios programados)
echo     - forja_debug    (estado interno del plugin)
echo.
echo   Hooks activos:
echo     - event          (detectar session/tool events)
echo     - system.transform (proyector + hints al inicio de cada turno)
echo     - compacting     (proyector + hints en compresion)
echo     - tool.execute.before (lazy scan en read/edit/write)
echo.
echo   Proyector: eager scan al iniciar + fallback lazy en file tools
echo.
echo   Para activar en OpenCode, agrega al plugin array:
echo     "C:\\Users\\Lord Gatito\\.config\\opencode\\plugins\\forja-suite"
echo.
echo   ⚠️  Reinicia OpenCode despues de modificar opencode.jsonc
echo.
exit /b 0
