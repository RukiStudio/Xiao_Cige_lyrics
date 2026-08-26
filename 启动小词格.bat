@echo off
setlocal enabledelayedexpansion
title Xiao Ci Ge - Quick Launcher (Multi-Check)

set "SCRIPT_DIR=%~dp0"
set "BAIL_OUT=0"
set "RETRY_MAX=3"

echo.
echo ============================================================
echo   Xiao Ci Ge  -  AI Lyric Generator
echo                    Quick Launcher
echo   (Dependency auto-fix + multi-check enabled)
echo ============================================================
echo.
echo   Folder  : %SCRIPT_DIR%
echo   URL     : http://localhost:3000
echo.

rem ------------------------------------------------------------
rem CHECK 1: project file existence
rem ------------------------------------------------------------
if not exist "%SCRIPT_DIR%package.json" (
    echo [CHECK 1 / FAIL] package.json NOT found.
    echo            Expected at: %SCRIPT_DIR%package.json
    echo            Put this bat inside the XiaoCiGe project folder.
    set "BAIL_OUT=1"
    goto :END
)
echo [CHECK 1 / OK] package.json found.

rem ------------------------------------------------------------
rem CHECK 2: Node.js availability (search PATH + common locations)
rem ------------------------------------------------------------
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 (
    for /f "tokens=*" %%a in ('where node 2^>nul') do (
        if not defined NODE_EXE set "NODE_EXE=%%a"
    )
)
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_EXE (
    for /d %%d in ("%APPDATA%\nvm\*") do (
        if exist "%%d\node.exe" if not defined NODE_EXE set "NODE_EXE=%%d\node.exe"
    )
)
if not defined NODE_EXE (
    echo [CHECK 2 / FAIL] Node.js not found on PATH, not in common install dirs.
    echo            Install Node.js 18.17+ LTS from https://nodejs.org/
    echo            After installation, re-run this launcher.
    set "BAIL_OUT=1"
    goto :END
)
for /f "tokens=*" %%a in ('"%NODE_EXE%" -v 2^>nul') do set "NODE_VER=%%a"
echo [CHECK 2 / OK] Node found: "%NODE_EXE%"  (version %NODE_VER%)

rem Make sure this Node is on PATH for all sub-processes.
for %%p in ("%NODE_EXE%") do set "NODE_DIR=%%~dp"
set "PATH=%NODE_DIR%;%PATH%"

rem ------------------------------------------------------------
rem CHECK 3: npm availability (PATH already updated, just verify)
rem ------------------------------------------------------------
where npm >nul 2>nul
if errorlevel 1 (
    where npm.cmd >nul 2>nul
)
if errorlevel 1 (
    echo [CHECK 3 / FAIL] npm not found even after adding Node dir to PATH.
    echo            Please repair your Node.js installation.
    set "BAIL_OUT=1"
    goto :END
)
echo [CHECK 3 / OK] npm available.

rem ------------------------------------------------------------
rem CHECK 4: node_modules existence + resolvable next package
rem          Missing dependencies trigger MULTI-PASS auto-install.
rem ------------------------------------------------------------
set "NEED_INSTALL=0"

if not exist "%SCRIPT_DIR%node_modules" (
    set "NEED_INSTALL=1"
    echo [CHECK 4 / WARN] node_modules folder missing.
) else (
    echo [CHECK 4 /   ] node_modules exists. Checking if "next" resolves ...
    pushd "%SCRIPT_DIR%"
    call npm ls next --depth=0 >nul 2>nul
    if not errorlevel 1 (
        echo [CHECK 4 / OK]   "next" package resolves.
    ) else (
        set "NEED_INSTALL=1"
        echo [CHECK 4 / WARN] "next" package missing or broken.
    )
    popd
)

if "%NEED_INSTALL%"=="0" (
    echo [CHECK 4 / OK] Dependencies look good.
    goto :AFTER_INSTALL
)

echo.
echo ============================================================
echo   Dependency auto-fix: installing node_modules ...
echo   Will retry up to %RETRY_MAX% times with fallback flags.
echo ============================================================
call :DO_INSTALL
set "INSTALL_RC=%ERRORLEVEL%"
if not "%INSTALL_RC%"=="0" (
    echo.
    echo [INSTALL / FAIL] Could not install dependencies after %RETRY_MAX% retries.
    echo            You can try manually:
    echo              1^) Open this folder in cmd or PowerShell
    echo              2^) Run:  rd /s /q node_modules package-lock.json
    echo              3^) Run:  npm cache clean --force
    echo              4^) Run:  npm install --legacy-peer-deps
    set "BAIL_OUT=1"
    goto :END
)
echo [INSTALL / OK] Dependencies installed successfully.
echo.

:AFTER_INSTALL

rem ------------------------------------------------------------
rem CHECK 5: free port 3000 (warn if occupied)
rem ------------------------------------------------------------
call :CHECK_PORT 3000

rem ------------------------------------------------------------
rem CHECK 6: stale .next cache info
rem ------------------------------------------------------------
if exist "%SCRIPT_DIR%.next" (
    echo [CHECK 6 / INFO] Found previous .next build cache.
)

rem ------------------------------------------------------------
rem MENU
rem ------------------------------------------------------------
echo.
echo ============================================================
echo  Launch mode:
echo    [1] Dev mode       (npm run dev, hot reload)      DEFAULT
echo    [2] Production     (npm run build, then npm start)
echo    [3] Build only     (npm run build)
echo    [4] Force reinstall(wipe node_modules/.next + install)
echo    [Q] Quit
echo ============================================================
echo.
set "choice="
set /p "choice=Choose [1 / 2 / 3 / 4 / Q, default=1]: "

if "%choice%"=="" set "choice=1"
if /i "%choice%"=="q" goto :END
if /i "%choice%"=="exit" goto :END

pushd "%SCRIPT_DIR%"

if "%choice%"=="4" goto :MODE_FORCE_REINSTALL
if "%choice%"=="1" goto :MODE_DEV
if "%choice%"=="2" goto :MODE_PROD
if "%choice%"=="3" goto :MODE_BUILD_ONLY
echo [ERROR] Invalid option: "%choice%"
goto :END_POPD

:MODE_FORCE_REINSTALL
echo.
echo [Force reinstall] Wiping node_modules, .next, package-lock.json ...
if exist "node_modules"     rd /s /q "node_modules"     >nul 2>nul
if exist ".next"            rd /s /q ".next"            >nul 2>nul
if exist "package-lock.json" del /f /q "package-lock.json" >nul 2>nul
call npm cache clean --force >nul 2>nul
echo [Force reinstall] Running fresh npm install ...
call :DO_INSTALL
set "INSTALL_RC=%ERRORLEVEL%"
if not "%INSTALL_RC%"=="0" (
    echo [Force reinstall / FAIL] Install still failed.
    goto :END_POPD
)
echo [Force reinstall / OK] Done. Re-run launcher and pick 1/2/3.
goto :END_POPD

:MODE_DEV
echo.
echo [Dev mode] Starting "npm run dev" ...
echo Browser opens http://localhost:3000 after ~5 seconds.
echo.
call :OPEN_LATER
call npm run dev
if errorlevel 1 (
    echo.
    echo [Dev mode / WARN] Dev server exited with non-zero code.
    echo            Common fixes:
    echo             - Kill any process on port 3000 ^(we showed PID above^)
    echo             - Run option [4] Force reinstall then retry
    echo             - Delete folder .next manually then retry
)
goto :END_POPD

:MODE_PROD
echo.
echo [Production] Step 1: running "npm run build" (attempt 1) ...
echo.
call npm run build
if errorlevel 1 goto :PROD_RETRY
echo.
echo Build OK. Starting production server ...
call :OPEN_LATER
call npm start
goto :END_POPD

:PROD_RETRY
echo.
echo [Production / RETRY] Build failed on first attempt.
echo                     Clearing .next cache and retrying ...
if exist ".next" rd /s /q ".next" >nul 2>nul
call npm run build
if errorlevel 1 goto :PROD_FAIL
echo.
echo Build OK (after retry). Starting production server ...
call :OPEN_LATER
call npm start
goto :END_POPD

:PROD_FAIL
echo.
echo [Production / FAIL] Build still failed after clearing .next.
echo            Try option [4] Force reinstall or run npm run build manually.
goto :END_POPD

:MODE_BUILD_ONLY
echo.
echo [Build only] Step 1: "npm run build" ...
call npm run build
if not errorlevel 1 goto :BUILD_ONLY_OK
echo.
echo [Build only / RETRY] Clearing .next and retrying ...
if exist ".next" rd /s /q ".next" >nul 2>nul
call npm run build
if errorlevel 1 goto :BUILD_ONLY_FAIL
:BUILD_ONLY_OK
echo [Build only / OK] Build succeeded.
goto :END_POPD

:BUILD_ONLY_FAIL
echo [Build only / FAIL] Still failed. Try option [4] Force reinstall.
goto :END_POPD

:END_POPD
popd
goto :END

rem ============================================================
rem SUBROUTINE: DO_INSTALL - multi-pass dependency install
rem   Returns ERRORLEVEL 0 on success, 1 on failure.
rem   Uses GOTO-based flow (NOT if/else chains) to avoid
rem   bracket-matching corruption when expanding variables.
rem ============================================================
:DO_INSTALL
set "ATTEMPT=0"
pushd "%SCRIPT_DIR%"

:INSTALL_LOOP
set /a ATTEMPT+=1
echo.
echo --- Install attempt %ATTEMPT% / %RETRY_MAX% ---

if "%ATTEMPT%"=="1" goto :INST_NORMAL
if "%ATTEMPT%"=="2" goto :INST_LEGACY
if "%ATTEMPT%"=="3" goto :INST_FORCE
goto :INST_GIVEUP

:INST_NORMAL
call npm install --no-audit --no-fund
set "INST_RC=%ERRORLEVEL%"
goto :INST_CHECK

:INST_LEGACY
echo (fallback: clear node_modules + cache, use --legacy-peer-deps)
if exist "node_modules"      rd /s /q "node_modules"      >nul 2>nul
if exist "package-lock.json" del /f /q "package-lock.json" >nul 2>nul
call npm cache clean --force >nul 2>nul
call npm install --legacy-peer-deps --no-audit --no-fund
set "INST_RC=%ERRORLEVEL%"
goto :INST_CHECK

:INST_FORCE
echo (last resort: clear everything + --force)
if exist "node_modules"      rd /s /q "node_modules"      >nul 2>nul
if exist "package-lock.json" del /f /q "package-lock.json" >nul 2>nul
call npm cache clean --force >nul 2>nul
call npm install --force --no-audit --no-fund
set "INST_RC=%ERRORLEVEL%"
goto :INST_CHECK

:INST_CHECK
if not "%INST_RC%"=="0" goto :INST_RETRY
echo Verifying "next" package resolvable ...
call npm ls next --depth=0 >nul 2>nul
if errorlevel 1 goto :INST_RETRY
echo "next" resolves OK. Install verified.
popd
exit /b 0

:INST_RETRY
if "%ATTEMPT%"=="1" echo Attempt 1 failed. Will retry with legacy-peer-deps.
if "%ATTEMPT%"=="2" echo Attempt 2 failed. Will retry with --force.
if "%ATTEMPT%"=="3" echo Attempt 3 failed. Giving up.
if %ATTEMPT% LSS %RETRY_MAX% goto :INSTALL_LOOP

:INST_GIVEUP
popd
exit /b 1

rem ============================================================
rem SUBROUTINE: CHECK_PORT <port>
rem ============================================================
:CHECK_PORT
set "PORT=%~1"
set "PID_HOLD="
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    set "PID_HOLD=%%p"
)
if defined PID_HOLD (
    echo [CHECK 5 / WARN] Port %PORT% is IN USE by PID !PID_HOLD!.
    echo            If you proceed the server may fail or bind another port.
    echo.
    echo   Suggestions:
    echo     - Reboot; or
    echo     - Kill it manually in Task Manager ^(Details tab, PID !PID_HOLD!^); or
    echo     - Run this command as ADMIN:  taskkill /F /PID !PID_HOLD!
    echo.
) else (
    echo [CHECK 5 / OK] Port %PORT% is free.
)
exit /b 0

rem ============================================================
rem SUBROUTINE: OPEN_LATER - open browser after small delay
rem ============================================================
:OPEN_LATER
start "" /b cmd /c ping 127.0.0.1 -n 6 ^> nul ^& start http://localhost:3000
exit /b 0

rem ============================================================
rem END / Always pause so the window never flashes shut
rem ============================================================
:END
echo.
if "%BAIL_OUT%"=="0" (
    echo =========== Launcher finished ===========
) else (
    echo ====== Launcher stopped due to errors ======
)
echo Press any key to close this window ...
pause > nul
endlocal