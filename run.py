"""Start Varagh: python run.py  (then open http://127.0.0.1:8765)"""
import os
import sys
import threading
import webbrowser

import uvicorn

from backend.config import load_settings

_lan = load_settings()["server"].get("lan")
HOST = os.environ.get("VARAGH_HOST", "0.0.0.0" if _lan else "127.0.0.1")
PORT = int(os.environ.get("VARAGH_PORT", "8765"))

if __name__ == "__main__":
    url = f"http://127.0.0.1:{PORT}"
    print(f"\n  Varagh is running → {url}")
    if HOST == "0.0.0.0" and not os.environ.get("VARAGH_TRUST_ALL"):
        print("  Phone access is on; the link and QR code are on the Settings page.")
    print("  (Ctrl+C to stop)\n")
    from backend.api import app
    app.state.bound_host = HOST
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
