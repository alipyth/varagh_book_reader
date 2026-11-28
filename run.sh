#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
if [ -x .venv/bin/python ] && ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  echo "[Varagh] Existing .venv has no pip (incomplete); recreating..."
  rm -rf .venv
fi
if [ ! -x .venv/bin/python ]; then
  echo "[Varagh] Creating Python environment..."
  if ! $PY -m venv .venv; then
    rm -rf .venv
    echo "[Varagh] Failed to create venv. On Debian/Ubuntu install: sudo apt install python3-venv" >&2
    exit 1
  fi
fi
echo "[Varagh] Installing requirements..."
.venv/bin/python -m pip install -q --disable-pip-version-check -r requirements.txt
exec .venv/bin/python run.py "$@"
