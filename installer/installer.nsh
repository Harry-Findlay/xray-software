!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var Dialog
Var RadioServer
Var RadioClient
Var InstallType
Var DataDirText
Var DataDirPath
Var ImageDirText
Var ImageDirPath

; ── Page 1: Client vs Server ──────────────────────────────────────────────────
Function InstallTypePage
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 40u "Select installation type:$\r$\nServer: hosts the database on this machine.$\r$\nClient: connects to an existing database server."
  Pop $0

  ${NSD_CreateRadioButton} 10 46u 100% 14u "Server — install PostgreSQL on this machine"
  Pop $RadioServer
  ${NSD_Check} $RadioServer

  ${NSD_CreateRadioButton} 10 64u 100% 14u "Client — connect to an existing database server"
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

; ── Page 2: Storage locations (server only, both on one page) ─────────────────
Function StoragePathsPage
  ${If} $InstallType != "server"
    Abort
  ${EndIf}

  ${If} $DataDirPath == ""
    StrCpy $DataDirPath "C:\DentalXRayStudio\Database"
  ${EndIf}
  ${If} $ImageDirPath == ""
    StrCpy $ImageDirPath "C:\DentalXRayStudio\Images"
  ${EndIf}

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "Database storage location:"
  Pop $0
  ${NSD_CreateText} 0 14u 255u 13u $DataDirPath
  Pop $DataDirText
  ${NSD_CreateButton} 260u 13u 50u 15u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 BrowseDataDir

  ${NSD_CreateLabel} 0 36u 100% 12u "X-Ray image storage location (must be backed up, retained 10 years per GDC/IRR17):"
  Pop $0
  ${NSD_CreateText} 0 50u 255u 13u $ImageDirPath
  Pop $ImageDirText
  ${NSD_CreateButton} 260u 49u 50u 15u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 BrowseImageDir

  nsDialogs::Show
FunctionEnd

Function BrowseDataDir
  nsDialogs::SelectFolderDialog "Select database storage location" $DataDirPath
  Pop $0
  ${If} $0 != error
    StrCpy $DataDirPath $0
    ${NSD_SetText} $DataDirText $0
  ${EndIf}
FunctionEnd

Function BrowseImageDir
  nsDialogs::SelectFolderDialog "Select X-ray image storage location" $ImageDirPath
  Pop $0
  ${If} $0 != error
    StrCpy $ImageDirPath $0
    ${NSD_SetText} $ImageDirText $0
  ${EndIf}
FunctionEnd

Function StoragePathsPageLeave
  ${NSD_GetText} $DataDirText $DataDirPath
  ${NSD_GetText} $ImageDirText $ImageDirPath
  ${If} $DataDirPath == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "Please enter a database storage location."
    Abort
  ${EndIf}
  ${If} $ImageDirPath == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "Please enter an image storage location."
    Abort
  ${EndIf}
FunctionEnd

; ── Inject pages ──────────────────────────────────────────────────────────────
!macro customWelcomePage
  Page custom InstallTypePage    InstallTypePageLeave
  Page custom StoragePathsPage   StoragePathsPageLeave
!macroend

; ── Run setup after files are laid down ───────────────────────────────────────
!macro customInstall
  ${If} $InstallType == "server"
    DetailPrint "Running PostgreSQL setup..."
    CreateDirectory "$ImageDirPath"
    nsExec::ExecToLog '"$INSTDIR\resources\setup-db.bat" "$INSTDIR\resources\postgres\pgsql" "$INSTDIR" "$DataDirPath" "$ImageDirPath"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "PostgreSQL setup failed (exit $0).$\r$\nSee: $DataDirPath\dental-xray-setup.log"
    ${Else}
      DetailPrint "PostgreSQL setup completed successfully."
    ${EndIf}
  ${Else}
    DetailPrint "Client install — skipping database setup."
  ${EndIf}
!macroend

; ── Uninstall ─────────────────────────────────────────────────────────────────
!macro customUnInstall
  ${If} $InstallType == "server"
    MessageBox MB_YESNO|MB_ICONQUESTION "Remove the PostgreSQL database service?$\r$\nChoose No to keep your data." \
      IDNO +3
    nsExec::ExecToLog 'net stop "DentalXRayDB"'
    nsExec::ExecToLog 'sc delete "DentalXRayDB"'
  ${EndIf}
!macroend
