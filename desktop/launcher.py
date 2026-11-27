"""Varagh desktop launcher for Windows.

Starts the local server in the background (no terminal), opens Varagh in its own
app window (Microsoft Edge in app mode, falling back to the default browser), and
puts an icon next to the clock with: open, data folder, start with Windows, quit.

    Varagh.exe               start (or, if already running, just open the window)
    Varagh.exe --background  start without opening a window (used for auto-start)
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent          # …\Varagh\app
INSTALL_DIR = APP_DIR.parent                               # …\Varagh
LOCAL = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Varagh"
LOCAL.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("VARAGH_DATA", str(LOCAL / "data"))
STATE = LOCAL / "launcher.json"

# pythonw has no console: send all output to a log file before anything prints
_log = open(LOCAL / "varagh.log", "a", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr = _log
print(f"\n--- start {time.strftime('%Y-%m-%d %H:%M:%S')} ---")
sys.path.insert(0, str(APP_DIR))

TITLE = "ورق"


def _state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _save_state(**kw) -> None:
    s = _state(); s.update(kw)
    STATE.write_text(json.dumps(s), encoding="utf-8")


def alive(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1.5) as r:
            return json.loads(r.read().decode()).get("app") == "varagh"
    except Exception:  # noqa: BLE001
        return False


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port)); return True
        except OSError:
            return False


def find_browser() -> str | None:
    pf = [os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")]
    rel = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe", r"BraveSoftware\Brave-Browser\Application\brave.exe"]
    for r in rel:
        for base in pf:
            if base and Path(base, r).exists():
                return str(Path(base, r))
    return None


def open_window(port: int) -> None:
    url = f"http://127.0.0.1:{port}/"
    exe = find_browser()
    if exe:
        try:
            subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={LOCAL / 'window'}", "--no-first-run",
                              "--no-default-browser-check", "--window-size=1440,920"], close_fds=True)
            return
        except OSError:
            traceback.print_exc()
    webbrowser.open(url)


# ------------------------------------------------------------------ start with Windows
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def _autostart_cmd() -> str:
    exe = INSTALL_DIR / "Varagh.exe"
    return f'"{exe}" --background'


def autostart_enabled() -> bool:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, "Varagh"); return True
    except OSError:
        return False


def set_autostart(on: bool) -> None:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, "Varagh", 0, winreg.REG_SZ, _autostart_cmd())
        else:
            try:
                winreg.DeleteValue(k, "Varagh")
            except OSError:
                pass


# ------------------------------------------------------------------ main
def main() -> None:
    background = "--background" in sys.argv
    port = int(_state().get("port") or 8765)

    if alive(port):                       # already running: just show the window
        if not background:
            open_window(port)
        return

    if not port_free(port):               # something else uses the port: pick another
        for p in range(8766, 8800):
            if port_free(p):
                port = p; break
    _save_state(port=port)

    import uvicorn
    from backend.config import load_settings
    from backend.api import app

    host = "0.0.0.0" if load_settings()["server"].get("lan") else "127.0.0.1"
    app.state.bound_host = host
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning", log_config=None))
    th = threading.Thread(target=server.run, daemon=True, name="varagh-server")
    th.start()
    for _ in range(100):
        if alive(port):
            break
        time.sleep(0.2)
    print(f"server on {host}:{port}")
    if not background:
        open_window(port)

    try:
        import pystray
        from PIL import Image
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        th.join(); return

    def quit_app(icon, _item=None):
        server.should_exit = True
        icon.stop()

    def toggle_auto(icon, item):
        try:
            set_autostart(not autostart_enabled())
        except OSError:
            traceback.print_exc()

    image = Image.open(APP_DIR / "desktop" / "tray.png")
    menu = pystray.Menu(
        pystray.MenuItem("باز کردن ورق", lambda i, _: open_window(port), default=True),
        pystray.MenuItem("باز کردن در مرورگر", lambda i, _: webbrowser.open(f"http://127.0.0.1:{port}/")),
        pystray.MenuItem("پوشه‌ی داده‌ها", lambda i, _: os.startfile(os.environ["VARAGH_DATA"])),  # noqa: S606
        pystray.MenuItem("اجرا هنگام روشن شدن ویندوز", toggle_auto, checked=lambda item: autostart_enabled()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("خروج از ورق", quit_app),
    )
    try:
        icon = pystray.Icon("Varagh", image, f"{TITLE} — در حال اجرا", menu)
        icon.run()
    except Exception:  # noqa: BLE001
        traceback.print_exc()          # no tray available: keep serving until the process is ended
        th.join()
        return
    server.should_exit = True
    th.join(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, "ورق اجرا نشد. جزئیات در فایل varagh.log در پوشه‌ی %LOCALAPPDATA%\\Varagh است.", TITLE, 0x10)
        except Exception:  # noqa: BLE001
            pass
