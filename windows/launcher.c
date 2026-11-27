#include <windows.h>
#include <wchar.h>

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR args, int show) {
    wchar_t dir[MAX_PATH];
    GetModuleFileNameW(NULL, dir, MAX_PATH);
    wchar_t *slash = wcsrchr(dir, L'\\');
    if (slash) *slash = 0;
    /* keep a user's own Python settings from leaking into the bundled interpreter */
    SetEnvironmentVariableW(L"PYTHONHOME", NULL);
    SetEnvironmentVariableW(L"PYTHONPATH", NULL);
    SetEnvironmentVariableW(L"PYTHONUTF8", L"1");
    wchar_t cmd[8192];
    swprintf(cmd, 8192, L"\"%ls\\python\\pythonw.exe\" -I \"%ls\\app\\desktop\\launcher.py\" %ls", dir, dir, args ? args : L"");
    STARTUPINFOW si; PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si)); si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));
    if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
        MessageBoxW(NULL, L"\x0648\x0631\x0642 \x0627\x062C\x0631\x0627 \x0646\x0634\x062F. \x06CC\x06A9 \x0628\x0627\x0631 \x062F\x06CC\x06AF\x0631 \x0646\x0635\x0628\x0634 \x06A9\x0646.", L"\x0648\x0631\x0642", MB_ICONERROR);
        return 1;
    }
    CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    return 0;
}
