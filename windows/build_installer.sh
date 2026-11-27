#!/usr/bin/env bash
# Builds windows/Varagh-Setup-<version>.exe on Linux (Ubuntu): needs nsis, mingw-w64, pip, curl.
#   sudo apt install nsis mingw-w64
#   ./windows/build_installer.sh
set -euo pipefail
cd "$(dirname "$0")"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20250612/cpython-3.12.11+20250612-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
rm -rf stage && mkdir -p stage
echo "[1/5] Windows Python 3.12"
curl -sL "$PY_URL" | tar xz -C stage
rm -rf stage/python/{tcl,include,libs} stage/python/Lib/{test,idlelib,tkinter,turtledemo}
echo "[2/5] Windows packages"
pip install -q --target stage/python/Lib/site-packages --platform win_amd64 --python-version 3.12 \
  --implementation cp --abi cp312 --only-binary=:all: -r ../requirements.txt pystray==0.19.5 pillow colorama
SP=stage/python/Lib/site-packages
rm -rf $SP/{Xlib,python_xlib-*,pip,pip-*,bin} $SP/PIL/{_avif*,_imagingft*,_webp*,_imagingcms*,_imagingtk*}
rm -rf stage/python/DLLs/{tcl86t.dll,tk86t.dll,_tkinter.pyd,_test*.pyd,_ctypes_test.pyd,xxlimited*} stage/python/Lib/{ensurepip,lib2to3,pydoc_data} stage/python/Scripts
echo "[3/5] app"
mkdir -p stage/app && cp -r ../backend ../frontend ../desktop ../README.md stage/app/
find stage -name "__pycache__" -prune -exec rm -rf {} +
echo "[4/5] Varagh.exe"
x86_64-w64-mingw32-windres launcher.rc -O coff -o launcher.res
x86_64-w64-mingw32-gcc -municode -mwindows -O2 -s launcher.c launcher.res -o stage/Varagh.exe
cp varagh.ico stage/
echo "[5/5] installer"
makensis -V2 varagh.nsi
ls -la Varagh-Setup-*.exe
