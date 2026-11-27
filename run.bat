@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo [Varagh] Creating Python environment...
  set PYCMD=python
  where python >nul 2>nul || set PYCMD=py -3
  %PYCMD% -m venv .venv
  if errorlevel 1 (
    echo Python 3.10 or newer is required: https://www.python.org/downloads/
    pause
    exit /b 1
  )
)
echo [Varagh] Installing requirements...
.venv\Scripts\python.exe -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo pip install failed. Check your internet connection and try again.
  pause
  exit /b 1
)
.venv\Scripts\python.exe run.py
pause
