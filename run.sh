#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
if [ ! -x .venv/bin/python ]; then
  echo "[Varagh] Creating Python environment..."
  $PY -m venv .venv
fi
echo "[Varagh] Installing requirements..."
.venv/bin/python -m pip install -q --disable-pip-version-check -r requirements.txt
exec .venv/bin/python run.py "$@"
