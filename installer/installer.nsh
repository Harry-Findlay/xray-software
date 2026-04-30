!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; ── Variables ────────────────────────────────────────────────────────────────
; InstallType is only relevant for the server build (where this .nsh is
; included). The client build uses package.json nsis.script instead, so
; this page is never shown on client installs.
Var Dialog
Var RadioServer
Var RadioClient
Var InstallType

; ── Custom page: Client vs Server choice ─────────────────────────────────────
Function InstallTypePage
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 30u "Select installation type:$\r$\nChoose Server on the machine that will host the database. Choose Client on workstations that will connect to it."
  Pop $0

  ${NSD_CreateRadioButton} 10 38u 100% 14u "Server — installs PostgreSQL database service on this machine"
  Pop $RadioServer
  ${NSD_Check} $RadioServer   ; default to Server since this IS the server installer

  ${NSD_CreateRadioButton} 10 56u 100% 14u "Client — this machine will connect to an existing database server"
  Pop $RadioClient

  nsDialogs::Show
FunctionEnd

Function InstallTypePageLeave
  ${NSD_GetState} $RadioServer $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallType "server"
  ${Else}
    StrCpy $InstallType "client"
  ${EndIf}
FunctionEnd

; ── Hook: inject our page before the install page ────────────────────────────
!macro customWelcomePage
  Page custom InstallTypePage InstallTypePageLeave
!macroend

; ── Hook: run after files are laid down ───────────────────────────────────────
; FIX: Pass $INSTDIR as second argument so setup-db.bat knows where to write
;      db-server.json. Original passed only the PG bin path.
!macro customInstall
  ${If} $InstallType == "server"
    DetailPrint "Running PostgreSQL setup — this may take up to 60 seconds..."

    ; ExecToLog captures stdout+stderr into the NSIS detail log.
    ; We pass two arguments:
    ;   %1 = path to pgsql binaries
    ;   %2 = app install directory (for db-server.json placement)
    nsExec::ExecToLog '"$INSTDIR\resources\setup-db.bat" \
      "$INSTDIR\resources\postgres\pgsql" \
      "$INSTDIR"'
    Pop $0

    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "PostgreSQL setup encountered an issue (exit code $0).$\r$\n$\r$\nThe application was installed but the database may need manual configuration.$\r$\n$\r$\nSee the setup log at:$\r$\n%TEMP%\dental-xray-setup.log"
    ${Else}
      DetailPrint "PostgreSQL setup completed successfully."
    ${EndIf}
  ${Else}
    DetailPrint "Client install — skipping database setup."
  ${EndIf}
!macroend

; ── Hook: customise uninstall if needed ───────────────────────────────────────
!macro customUnInstall
  ; Offer to stop and remove the DB service on uninstall
  ${If} $InstallType == "server"
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Do you want to stop and remove the PostgreSQL database service?$\r$\n$\r$\nChoose No to keep your data intact." \
      IDNO skip_service_removal

    DetailPrint "Stopping service $SERVICE_NAME..."
    nsExec::ExecToLog 'net stop "DentalXRayDB"'
    nsExec::ExecToLog 'sc delete "DentalXRayDB"'

    skip_service_removal:
  ${EndIf}
!macroend