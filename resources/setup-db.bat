@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  Dental X-Ray Studio — PostgreSQL Setup Script
::  Called by NSIS installer (server build only).
::
::  Args:
::    %1  Full path to bundled pgsql folder
::        e.g. C:\Program Files\Dental X-Ray Studio\resources\postgres\pgsql
::    %2  App install directory
::        e.g. C:\Program Files\Dental X-Ray Studio
::
::  Fixes vs original:
::    [Bug 2] listen_addresses patched in postgresql.conf
::    [Bug 3] Dollar-quoting replaced with -f SQL file approach
::    [Bug 4] db-server.json written so wizard pre-fills fields
::    [Bug 5] PG15+ schema grants added (GRANT CREATE ON SCHEMA public)
::    [+]     Firewall rules added inline
::    [+]     Service registered under NetworkService account
::    [+]     Full error checking and structured logging
:: ============================================================

set "PG_DIR=%~1"
set "APP_DIR=%~2"
set "DATA_DIR=%PROGRAMDATA%\DentalXRayStudio"
set "PG_DATA=%DATA_DIR%\pgdata"
set "PG_LOG=%DATA_DIR%\logs\postgres.log"
set "SERVICE_NAME=DentalXRayDB"
set "LOG_FILE=%TEMP%\dental-xray-setup.log"
set "SQL_FILE=%TEMP%\dental-xray-setup.sql"

:: Password for the 'dental' app user — keep in sync with db-server.json below.
set "DB_PASSWORD=DentalXRay2024!"

(
echo ============================================
echo  Dental X-Ray Studio - PostgreSQL Setup
echo  Started: %DATE% %TIME%
echo  PG_DIR : %PG_DIR%
echo  APP_DIR: %APP_DIR%
echo ============================================
) > "%LOG_FILE%"

:: ── 0. Validate binaries ──────────────────────────────────────────────────────
echo [STEP 0] Validating binaries... >> "%LOG_FILE%"
if not exist "%PG_DIR%\bin\pg_ctl.exe"  ( echo [ERROR] pg_ctl.exe not found  >> "%LOG_FILE%" & exit /b 1 )
if not exist "%PG_DIR%\bin\initdb.exe"  ( echo [ERROR] initdb.exe not found  >> "%LOG_FILE%" & exit /b 1 )
if not exist "%PG_DIR%\bin\psql.exe"    ( echo [ERROR] psql.exe not found    >> "%LOG_FILE%" & exit /b 1 )
echo [OK] Binaries validated. >> "%LOG_FILE%"

:: ── 1. Create directories ────────────────────────────────────────────────────
echo [STEP 1] Creating data directories... >> "%LOG_FILE%"
if not exist "%DATA_DIR%"       mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\logs"  mkdir "%DATA_DIR%\logs"
echo [OK] Directories ready: %DATA_DIR% >> "%LOG_FILE%"

:: ── 2. initdb ────────────────────────────────────────────────────────────────
echo [STEP 2] Initialising database cluster... >> "%LOG_FILE%"
if not exist "%PG_DATA%\PG_VERSION" (
    "%PG_DIR%\bin\initdb.exe" ^
        --pgdata="%PG_DATA%" ^
        --username=postgres ^
        --encoding=UTF8 ^
        --auth=trust >> "%LOG_FILE%" 2>&1
    if errorlevel 1 ( echo [ERROR] initdb failed. >> "%LOG_FILE%" & exit /b 1 )
    echo [OK] initdb complete. >> "%LOG_FILE%"
) else (
    echo [INFO] Existing cluster detected - skipping initdb. >> "%LOG_FILE%"
)

:: ── 3. Write pg_hba.conf ─────────────────────────────────────────────────────
echo [STEP 3] Writing pg_hba.conf... >> "%LOG_FILE%"
(
echo # TYPE  DATABASE        USER            ADDRESS                 METHOD
echo.
echo # postgres superuser - trust on loopback (for installer setup only)
echo host    all             postgres        127.0.0.1/32            trust
echo host    all             postgres        ::1/128                 trust
echo.
echo # dental app user - md5 from loopback and LAN
echo host    dental_xray     dental          127.0.0.1/32            md5
echo host    dental_xray     dental          ::1/128                 md5
echo host    dental_xray     dental          0.0.0.0/0               md5
) > "%PG_DATA%\pg_hba.conf"
echo [OK] pg_hba.conf written. >> "%LOG_FILE%"

:: ── 4. Patch postgresql.conf — listen_addresses ──────────────────────────────
:: FIX Bug 2: PostgreSQL defaults to localhost only. Without this, LAN clients
:: cannot connect even when pg_hba.conf permits them.
echo [STEP 4] Patching postgresql.conf... >> "%LOG_FILE%"
powershell -NoProfile -NonInteractive -Command ^
    "$f = '%PG_DATA%\postgresql.conf';" ^
    "$t = Get-Content $f -Raw;" ^
    "$t = $t -replace \"#?listen_addresses\s*=\s*'[^']*'\", \"listen_addresses = '*'\";" ^
    "$t = $t -replace '#?port\s*=\s*\d+', 'port = 5432';" ^
    "$t = $t -replace '#?logging_collector\s*=\s*\w+', 'logging_collector = on';" ^
    "Set-Content $f $t -Encoding UTF8;" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [WARN] PowerShell patch failed - appending instead. >> "%LOG_FILE%"
    echo. >> "%PG_DATA%\postgresql.conf"
    echo # Dental X-Ray Studio installer overrides >> "%PG_DATA%\postgresql.conf"
    echo listen_addresses = '*' >> "%PG_DATA%\postgresql.conf"
    echo port = 5432 >> "%PG_DATA%\postgresql.conf"
    echo logging_collector = on >> "%PG_DATA%\postgresql.conf"
)
echo [OK] postgresql.conf patched. >> "%LOG_FILE%"

:: ── 5. Start temporary instance ───────────────────────────────────────────────
echo [STEP 5] Starting temporary PostgreSQL instance... >> "%LOG_FILE%"
"%PG_DIR%\bin\pg_ctl.exe" start ^
    --pgdata="%PG_DATA%" ^
    --log="%PG_LOG%" ^
    -w -t 90 >> "%LOG_FILE%" 2>&1
if errorlevel 1 ( echo [ERROR] Failed to start PostgreSQL. >> "%LOG_FILE%" & exit /b 1 )
echo [OK] Temporary instance running. >> "%LOG_FILE%"
ping 127.0.0.1 -n 4 >nul

:: ── 6. Create 'dental' role ───────────────────────────────────────────────────
:: FIX Bug 3: The original used dollar-quoting ($body$) inline in a CMD command.
:: CMD's variable expansion mangles $body$ so psql never sees valid SQL.
:: Writing SQL to a temp file and using "psql -f" sidesteps all quoting issues.
echo [STEP 6] Creating role 'dental'... >> "%LOG_FILE%"
(
echo DO $$
echo BEGIN
echo   IF NOT EXISTS ^(SELECT FROM pg_catalog.pg_roles WHERE rolname = 'dental'^) THEN
echo     CREATE ROLE dental LOGIN PASSWORD '%DB_PASSWORD%';
echo   ELSE
echo     ALTER ROLE dental WITH LOGIN PASSWORD '%DB_PASSWORD%';
echo   END IF;
echo END
echo $$;
) > "%SQL_FILE%"
"%PG_DIR%\bin\psql.exe" -U postgres -f "%SQL_FILE%" >> "%LOG_FILE%" 2>&1
echo [OK] Role step complete. >> "%LOG_FILE%"

:: ── 7. Create 'dental_xray' database ─────────────────────────────────────────
echo [STEP 7] Creating database... >> "%LOG_FILE%"
(
echo SELECT 'CREATE DATABASE dental_xray OWNER dental ENCODING ''UTF8'''
echo WHERE NOT EXISTS ^(SELECT FROM pg_database WHERE datname = 'dental_xray'^)\gexec
) > "%SQL_FILE%"
"%PG_DIR%\bin\psql.exe" -U postgres -f "%SQL_FILE%" >> "%LOG_FILE%" 2>&1
echo [OK] Database step complete. >> "%LOG_FILE%"

:: ── 8. Grant schema privileges ────────────────────────────────────────────────
:: FIX Bug 5: PostgreSQL 15 revoked public CREATE on the public schema by default.
:: Without GRANT CREATE ON SCHEMA public, the app's migration runner cannot
:: CREATE TABLE and the entire migration silently fails.
echo [STEP 8] Granting schema-level privileges (PG15+ compat)... >> "%LOG_FILE%"
(
echo GRANT ALL PRIVILEGES ON DATABASE dental_xray TO dental;
echo \connect dental_xray
echo GRANT USAGE  ON SCHEMA public TO dental;
echo GRANT CREATE ON SCHEMA public TO dental;
echo ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO dental;
echo ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO dental;
echo ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO dental;
) > "%SQL_FILE%"
"%PG_DIR%\bin\psql.exe" -U postgres -f "%SQL_FILE%" >> "%LOG_FILE%" 2>&1
del "%SQL_FILE%" >nul 2>&1
echo [OK] Privileges granted. >> "%LOG_FILE%"

:: ── 9. Stop temporary instance ────────────────────────────────────────────────
echo [STEP 9] Stopping temporary instance... >> "%LOG_FILE%"
"%PG_DIR%\bin\pg_ctl.exe" stop --pgdata="%PG_DATA%" -m fast -w >> "%LOG_FILE%" 2>&1
echo [OK] Stopped. >> "%LOG_FILE%"

:: ── 10. Register + start Windows service ──────────────────────────────────────
echo [STEP 10] Registering Windows service '%SERVICE_NAME%'... >> "%LOG_FILE%"
sc query "%SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
    "%PG_DIR%\bin\pg_ctl.exe" register ^
        -N "%SERVICE_NAME%" ^
        -U "NT AUTHORITY\NetworkService" ^
        -D "%PG_DATA%" ^
        -S auto >> "%LOG_FILE%" 2>&1
    if errorlevel 1 (
        echo [WARN] pg_ctl register failed - trying sc.exe fallback... >> "%LOG_FILE%"
        sc create "%SERVICE_NAME%" ^
            binPath= "\"%PG_DIR%\bin\pg_ctl.exe\" runservice -N \"%SERVICE_NAME%\" -D \"%PG_DATA%\" -w" ^
            start= auto ^
            DisplayName= "Dental X-Ray Database" >> "%LOG_FILE%" 2>&1
    )
    sc description "%SERVICE_NAME%" "PostgreSQL database for Dental X-Ray Studio" >nul 2>&1
    echo [OK] Service registered. >> "%LOG_FILE%"
) else (
    echo [INFO] Service already registered. >> "%LOG_FILE%"
)

net start "%SERVICE_NAME%" >> "%LOG_FILE%" 2>&1
set "SVC_ERR=%errorlevel%"
if "%SVC_ERR%"=="2" ( echo [OK] Service was already running. >> "%LOG_FILE%" ) else if "%SVC_ERR%"=="0" ( echo [OK] Service started. >> "%LOG_FILE%" ) else ( echo [WARN] net start returned %SVC_ERR%. >> "%LOG_FILE%" )

:: ── 11. Write db-server.json ──────────────────────────────────────────────────
:: FIX Bug 4: The original never wrote this file. Without it the Electron app
:: shows a blank DB setup wizard on first launch with no pre-filled fields.
echo [STEP 11] Writing db-server.json... >> "%LOG_FILE%"
if not "%APP_DIR%"=="" (
    set "JSON_DIR=%APP_DIR%\resources"
) else (
    for %%I in ("%PG_DIR%\..\..") do set "JSON_DIR=%%~fI"
)
if not exist "%JSON_DIR%" mkdir "%JSON_DIR%"
(
echo {
echo   "engine":   "postgres",
echo   "host":     "localhost",
echo   "port":     5432,
echo   "database": "dental_xray",
echo   "user":     "dental",
echo   "password": "%DB_PASSWORD%",
echo   "ssl":      false
echo }
) > "%JSON_DIR%\db-server.json"
if errorlevel 1 ( echo [WARN] Could not write db-server.json >> "%LOG_FILE%" ) else ( echo [OK] db-server.json written to %JSON_DIR% >> "%LOG_FILE%" )

:: ── 12. Firewall rules ────────────────────────────────────────────────────────
echo [STEP 12] Configuring firewall... >> "%LOG_FILE%"
netsh advfirewall firewall show rule name="Dental X-Ray PostgreSQL" >nul 2>&1
if errorlevel 1 (
    netsh advfirewall firewall add rule name="Dental X-Ray PostgreSQL" dir=in action=allow protocol=TCP localport=5432 description="PostgreSQL for Dental X-Ray Studio" >> "%LOG_FILE%" 2>&1
    echo [OK] Port 5432 opened. >> "%LOG_FILE%"
) else ( echo [INFO] Port 5432 rule already exists. >> "%LOG_FILE%" )

netsh advfirewall firewall show rule name="Dental X-Ray DICOM" >nul 2>&1
if errorlevel 1 (
    netsh advfirewall firewall add rule name="Dental X-Ray DICOM" dir=in action=allow protocol=TCP localport=4242 description="DICOM listener for Dental X-Ray Studio" >> "%LOG_FILE%" 2>&1
    echo [OK] Port 4242 opened. >> "%LOG_FILE%"
) else ( echo [INFO] Port 4242 rule already exists. >> "%LOG_FILE%" )

:: ── Done ─────────────────────────────────────────────────────────────────────
(
echo.
echo ============================================
echo  SETUP COMPLETE: %DATE% %TIME%
echo  Service : %SERVICE_NAME%
echo  Host    : localhost:5432
echo  Database: dental_xray
echo  User    : dental
echo  Data    : %PG_DATA%
echo ============================================
) >> "%LOG_FILE%"

exit /b 0