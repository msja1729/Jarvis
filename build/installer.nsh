; Jarvis: uninstalling removes everything Jarvis put on the computer, as if it had never been installed.
; (Not on an update: the old version's uninstaller runs with --updated and must keep the user's data.)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DetailPrint "Removing Jarvis sign-ins, settings, chats, team folders and voices..."
    ; run the cleanup with Electron as plain Node, before the app's files are removed
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
    nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app\dist\app\uninstall-cleanup.cjs" "$APPDATA\Jarvis"'
    Pop $0
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'
    ; and in case anything was still locked
    RMDir /r "$APPDATA\Jarvis"
    RMDir /r "$LOCALAPPDATA\Jarvis"
    RMDir /r "$LOCALAPPDATA\jarvis-updater"
  ${endIf}
!macroend
