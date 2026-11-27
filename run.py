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
    print(f"\n  ورق اجرا شد → {url}")
    if HOST == "0.0.0.0":
        print("  دسترسی از گوشی روشن است؛ لینک و QR در صفحه‌ی تنظیمات است.")
    print("  (برای توقف Ctrl+C)\n")
    from backend.api import app
    app.state.bound_host = HOST
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
