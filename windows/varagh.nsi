Unicode true
Target amd64-unicode
ManifestDPIAware true
!include "MUI2.nsh"

!define APPNAME "Varagh"
!define APPNAME_FA "ورق"
!define VERSION "1.0.0"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Varagh"

Name "${APPNAME_FA}"
Caption "نصب ${APPNAME_FA}"
OutFile "Varagh-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Varagh"
InstallDirRegKey HKCU "Software\Varagh" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APPNAME_FA} ${VERSION}"

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Varagh"
VIAddVersionKey "FileDescription" "Varagh installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Varagh"

!define MUI_ICON "varagh.ico"
!define MUI_UNICON "varagh.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "به ورق خوش آمدی"
!define MUI_WELCOMEPAGE_TEXT "ورق، کتاب‌خوان دوزبانه‌ی تو، روی این کامپیوتر نصب می‌شود.$\r$\n$\r$\nبرای نصب به دسترسی مدیر (Administrator) نیازی نیست و پایتون هم همراه برنامه است.$\r$\n$\r$\nکتاب‌ها و داده‌هایت در پوشه‌ی %LOCALAPPDATA%\Varagh نگه داشته می‌شوند و با به‌روزرسانی پاک نمی‌شوند."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Varagh.exe"
!define MUI_FINISHPAGE_RUN_TEXT "اجرای ورق"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Farsi"

!macro StopVaragh
  ; close a running Varagh (only the copy in this folder)
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process pythonw,python -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Sleep 800
!macroend

Section "Varagh" SecMain
  SectionIn RO
  !insertmacro StopVaragh
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\python"
  File "stage\Varagh.exe"
  File "stage\varagh.ico"
  File /r "stage\python"
  File /r "stage\app"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$SMPROGRAMS\${APPNAME_FA}.lnk" "$INSTDIR\Varagh.exe" "" "$INSTDIR\varagh.ico" 0
  CreateShortcut "$DESKTOP\${APPNAME_FA}.lnk" "$INSTDIR\Varagh.exe" "" "$INSTDIR\varagh.ico" 0

  WriteRegStr HKCU "Software\Varagh" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME_FA} (Varagh)"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Varagh"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\varagh.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" 230000
SectionEnd

Section "Uninstall"
  !insertmacro StopVaragh
  Delete "$SMPROGRAMS\${APPNAME_FA}.lnk"
  Delete "$DESKTOP\${APPNAME_FA}.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Varagh"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Varagh"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\python"
  Delete "$INSTDIR\Varagh.exe"
  Delete "$INSTDIR\varagh.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  IfSilent keep
  MessageBox MB_YESNO|MB_ICONQUESTION "کتاب‌ها، ترجمه‌ها، کارت‌ها و تنظیماتت هم پاک شوند؟$\r$\n(اگر «خیر» بزنی، با نصب دوباره همه‌چیز سر جایش است.)" /SD IDNO IDNO keep
    RMDir /r "$LOCALAPPDATA\Varagh"
  keep:
SectionEnd
