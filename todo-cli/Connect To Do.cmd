@echo off
setlocal
cd /d "%~dp0"
title Connect Microsoft To Do
echo ============================================================
echo   Career Advisor  ^>  Microsoft To Do setup
echo ============================================================
echo.

rem ---- 1. Python ------------------------------------------------
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  python --version >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python isn't installed yet.
  echo.
  echo Install it by running this in PowerShell, then double-click this file again:
  echo     winget install Python.Python.3.12
  echo.
  echo Or download it from https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('%PY% --version 2^>^&1') do echo Found %%v
echo.

rem ---- 2. Sign in (only if needed) ------------------------------
%PY% todo.py whoami >nul 2>nul
if errorlevel 1 (
  echo STEP 1 of 3: sign in to Microsoft
  echo A link and a code will appear below. Open the link in your browser,
  echo enter the code, and sign in with the account your To Do is on.
  echo.
  %PY% todo.py login
  if errorlevel 1 (
    echo.
    echo Sign-in didn't finish. If it said your organization needs admin approval,
    echo try a personal Microsoft account: open PowerShell here and run
    echo     .\todo login --tenant consumers
    echo or see "If sign-in is blocked" in README.md.
    echo.
    pause
    exit /b 1
  )
) else (
  for /f "delims=" %%w in ('%PY% todo.py whoami') do echo Already signed in as %%w
)
echo.

rem ---- 3. Preview ----------------------------------------------
echo STEP 2 of 3: preview (nothing changes yet)
echo.
%PY% todo.py sync recruiting-sync.json --dry-run
if errorlevel 1 ( echo. & pause & exit /b 1 )
echo.
choice /c YN /m "STEP 3 of 3: add these to your Recruiting list in To Do"
if errorlevel 2 (
  echo Skipped. Nothing was changed.
  echo.
  pause
  exit /b 0
)
echo.
%PY% todo.py sync recruiting-sync.json
echo.
echo Your Recruiting list now has:
%PY% todo.py tasks
echo.
echo Done. Open Microsoft To Do to see the Recruiting list.
echo.
pause
