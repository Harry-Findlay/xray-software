; ============================================================
;  Dental X-Ray Studio — NSIS Installer Script
;  Extends electron-builder with Server vs Client install types
;  and PostgreSQL bundling for the Server option.
; ============================================================

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define APP_NAME        "Dental X-Ray Studio"
!define APP_VERSION     "1.0.0"
!define PUBLISHER       "IT INFINITY LIMITED"
!define APP_EXE         "DentalXRayStudio.exe"
!define UNINSTALL_KEY   "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define REG_KEY         "Software\${APP_NAME}"
!define PG_VERSION      "16"
!define PG_DATA_DIR     "$COMMONAPPDATA\${APP_NAME}\pgdata"
!define PG_LOG          "$COMMONAPPDATA\${APP_NAME}\logs\postgres.log"
!define DATA_ROOT       "$COMMONAPPDATA\${APP_NAME}"
!define SERVICE_NAME    "DentalXRayDB"

; ── MUI Pages ──────────────────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"

Page custom InstallTypePage InstallTypeLeave

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Variables ──────────────────────────────────────────────────────────────
Var InstallType   ; "client" or "server"
Var PgPassword    ; chosen during server setup

; ── Custom install-type selection page ────────────────────────────────────
Function InstallTypePage
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 30u "Select installation type:"
  ${NSD_CreateRadioButton} 10 35u 80% 14u "Client Workstation — connect to an existing database server"
  Pop $R0
  ${NSD_CreateRadioButton} 10 55u 80% 14u "Database Server — install PostgreSQL and the application (first machine on the network)"
  Pop $R1

  ; Default to client
  ${NSD_Check} $R0

  nsDialogs::Show
FunctionEnd

Function InstallTypeLeave
  ${NSD_GetState} $R0 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallType "client"
  ${Else}
    StrCpy $InstallType "server"
    ; Prompt for PostgreSQL superuser password
    nsDialogs::InputBox "Database Server Setup" \
      "Enter a password for the PostgreSQL 'dental' database user:" "" 256
    Pop $PgPassword
    ${If} $PgPassword == ""
      StrCpy $PgPassword "DentalXRay2024!"
    ${EndIf}
  ${EndIf}
FunctionEnd

; ── Core section (both types) ─────────────────────────────────────────────
Section "Core Application" SecCore
  SectionIn RO

  SetOutPath "$INSTDIR"

  ; electron-builder places the app files here already;
  ; we just add our registry keys and data directories.

  WriteRegStr HKLM "${REG_KEY}" "InstallType"  "$InstallType"
  WriteRegStr HKLM "${REG_KEY}" "Version"      "${APP_VERSION}"
  WriteRegStr HKLM "${REG_KEY}" "InstallPath"  "$INSTDIR"

  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1

  ; Create shared data directories
  CreateDirectory "${DATA_ROOT}"
  CreateDirectory "${DATA_ROOT}\images"
  CreateDirectory "${DATA_ROOT}\backups"
  CreateDirectory "${DATA_ROOT}\logs"

  ; Grant Users full access to data root
  AccessControl::GrantOnFile "${DATA_ROOT}" "(S-1-5-32-545)" "FullAccess"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; ── PostgreSQL Server section (server type only) ──────────────────────────
Section "PostgreSQL Database Server" SecServer

  ${If} $InstallType != "server"
    Return  ; skip silently for client installs
  ${EndIf}

  DetailPrint "Installing PostgreSQL ${PG_VERSION}..."

  ; ── 1. Extract bundled PostgreSQL binaries ────────────────────────────
  ;   Place the extracted PostgreSQL zip at:
  ;     resources\postgres\  (relative to this script)
  ;   electron-builder copies it to $INSTDIR\resources\postgres\
  ;   It should contain: bin\, lib\, share\ etc.

  SetOutPath "${DATA_ROOT}\postgres"
  File /r "$INSTDIR\resources\postgres\*.*"

  ; ── 2. Initialise the database cluster ───────────────────────────────
  CreateDirectory "${PG_DATA_DIR}"
  AccessControl::GrantOnFile "${PG_DATA_DIR}" "(S-1-5-32-545)" "FullAccess"

  nsExec::ExecToLog '"${DATA_ROOT}\postgres\pgsql\bin\initdb.exe" \
    --pgdata="${PG_DATA_DIR}" \
    --username=postgres \
    --encoding=UTF8 \
    --locale=en_GB.UTF-8 \
    --auth=md5'

  ; ── 3. Configure pg_hba.conf for local + LAN access ──────────────────
  FileOpen $0 "${PG_DATA_DIR}\pg_hba.conf" w
  FileWrite $0 "# TYPE  DATABASE    USER       ADDRESS          METHOD$\r$\n"
  FileWrite $0 "local   all         postgres                    trust$\r$\n"
  FileWrite $0 "host    all         all        127.0.0.1/32     md5$\r$\n"
  FileWrite $0 "host    all         all        ::1/128          md5$\r$\n"
  FileWrite $0 "host    dental_xray dental     0.0.0.0/0        md5$\r$\n"
  FileClose $0

  ; ── 4. Start PostgreSQL temporarily to create DB + user ───────────────
  nsExec::ExecToLog '"${DATA_ROOT}\postgres\pgsql\bin\pg_ctl.exe" start \
    --pgdata="${PG_DATA_DIR}" \
    --log="${PG_LOG}" \
    -w -t 60'

  ; Create application database and user
  nsExec::ExecToLog '"${DATA_ROOT}\postgres\pgsql\bin\psql.exe" \
    -U postgres \
    -c "CREATE USER dental WITH PASSWORD ''$PgPassword'';"'

  nsExec::ExecToLog '"${DATA_ROOT}\postgres\pgsql\bin\psql.exe" \
    -U postgres \
    -c "CREATE DATABASE dental_xray OWNER dental ENCODING ''UTF8'';"'

  nsExec::ExecToLog '"${DATA_ROOT}\postgres\pgsql\bin\psql.exe" \
    -U postgres \
    -c "GRANT ALL PRIVILEGES ON DATABASE dental_xray TO dental;"'

  ; Stop temporary instance — service will manage it from now on
  nsExec::ExecToLog '"${DATA_ROOT}\postgres\pgsql\bin\pg_ctl.exe" stop \
    --pgdata="${PG_DATA_DIR}" -m fast -w'

  ; ── 5. Register Windows service ───────────────────────────────────────
  nsExec::ExecToLog '"${DATA_ROOT}\postgres\pgsql\bin\pg_ctl.exe" register \
    --pgdata="${PG_DATA_DIR}" \
    -N "${SERVICE_NAME}" \
    -D "${PG_DATA_DIR}" \
    -l "${PG_LOG}" \
    -S auto'

  nsExec::ExecToLog 'sc description "${SERVICE_NAME}" "Dental X-Ray Studio — PostgreSQL database"'
  nsExec::ExecToLog 'net start "${SERVICE_NAME}"'

  ; ── 6. Windows Firewall rules ─────────────────────────────────────────
  nsExec::ExecToLog 'netsh advfirewall firewall add rule \
    name="${APP_NAME} PostgreSQL" protocol=TCP dir=in localport=5432 action=allow'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule \
    name="${APP_NAME} DICOM" protocol=TCP dir=in localport=4242 action=allow'

  ; ── 7. Write server config so the app can pre-fill the setup wizard ───
  FileOpen $0 "${DATA_ROOT}\db-server.json" w
  FileWrite $0 '{"engine":"postgres","host":"localhost","port":5432,'
  FileWrite $0 '"database":"dental_xray","user":"dental"}'
  FileClose $0

  WriteRegStr HKLM "${REG_KEY}" "DBEngine"   "postgres"
  WriteRegStr HKLM "${REG_KEY}" "DBHost"     "localhost"
  WriteRegStr HKLM "${REG_KEY}" "DBPort"     "5432"
  WriteRegStr HKLM "${REG_KEY}" "DBDatabase" "dental_xray"
  WriteRegStr HKLM "${REG_KEY}" "DBUser"     "dental"

  DetailPrint "PostgreSQL installed and service started."

  MessageBox MB_OK \
    "PostgreSQL is installed and running.$\n$\n\
    When Dental X-Ray Studio first launches, the database connection wizard$\n\
    will appear. Use:$\n\
    $\n  Host:      localhost\
    $\n  Port:      5432\
    $\n  Database:  dental_xray\
    $\n  User:      dental\
    $\n  Password:  (the password you set during this installer)$\n\
    $\nThe default admin login is: admin / admin$\n\
    Change this password immediately after first login."

SectionEnd

; ── Uninstaller ───────────────────────────────────────────────────────────
Section "Uninstall"

  ; Read install type from registry
  ReadRegStr $InstallType HKLM "${REG_KEY}" "InstallType"

  ${If} $InstallType == "server"
    ; Stop and remove PostgreSQL service
    nsExec::ExecToLog 'net stop "${SERVICE_NAME}"'
    nsExec::ExecToLog '"$INSTDIR\resources\postgres\pgsql\bin\pg_ctl.exe" unregister -N "${SERVICE_NAME}"'

    ; Remove firewall rules
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${APP_NAME} PostgreSQL"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${APP_NAME} DICOM"'

    MessageBox MB_YESNO \
      "Remove the PostgreSQL data directory and all patient data?$\n$\n\
      ${PG_DATA_DIR}$\n$\n\
      Choose NO to keep your data (recommended)." \
      IDNO +3
      RMDir /r "${PG_DATA_DIR}"
      RMDir /r "${DATA_ROOT}\postgres"
  ${EndIf}

  ; Remove registry
  DeleteRegKey HKLM "${REG_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"

  ; Remove uninstaller
  Delete "$INSTDIR\Uninstall.exe"

  MessageBox MB_OK \
    "Uninstall complete.$\n\
    Patient data in ${DATA_ROOT} has been preserved.$\n\
    Delete that folder manually if you want to remove all data."

SectionEnd
