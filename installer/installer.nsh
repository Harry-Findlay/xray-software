!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var InstallType
Var Dialog
Var RadioClient
Var RadioServer

Function customPage
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Select installation type:"
  Pop $0

  ${NSD_CreateRadioButton} 10 30u 100% 14u "Client — connects to an existing database server"
  Pop $RadioClient
  ${NSD_Check} $RadioClient

  ${NSD_CreateRadioButton} 10 50u 100% 14u "Server — installs PostgreSQL"
  Pop $RadioServer

  nsDialogs::Show
FunctionEnd

Function customPageLeave
  ${NSD_GetState} $RadioServer $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallType "server"
  ${Else}
    StrCpy $InstallType "client"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $InstallType == "server"
    DetailPrint "Running PostgreSQL setup..."
    
    nsExec::ExecToLog '"$INSTDIR\resources\setup-db.bat" "$INSTDIR\resources\postgres\pgsql"'
    
    # Check if the batch script failed and tell the user
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK "PostgreSQL setup failed. Please check %TEMP%\dental-xray-setup.log"
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageCallbacks
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW customPage
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE customPageLeave
!macroend

!macro customWelcomePage
  Page custom customPage customPageLeave
!macroend