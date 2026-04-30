@echo off
setlocal EnableDelayedExpansion

set "PG_DIR=%~1"
set "APP_DIR=%~2"
set "DATA_DIR=%PROGRAMDATA%\DentalXRayStudio"
set "PG_DATA=%DATA_DIR%\pgdata"
set "PG_LOG=%DATA_DIR%\logs\postgres.log"
set "SERVICE_NAME=DentalXRayDB"
set "SERVICE_DISPLAY=Dental X-Ray Database"
set "SERVICE_DESC=PostgreSQL database service for Dental X-Ray Studio"
set "LOG_FILE=C:\ProgramData\DentalXRayStudio\dental-xray-setup.log"
set "SQL_FILE=C:\ProgramData\DentalXRayStudio\dental-xray-setup.sql"
set "DB_PASSWORD=DentalXRay2024!"
set "PG_PORT=5432"
set "PG_CONF=%PG_DATA%\postgresql.conf"
set "PG_CONF_TMP=%PG_DATA%\postgresql.conf.tmp"

if not exist "C:\ProgramData\DentalXRayStudio" mkdir "C:\ProgramData\DentalXRayStudio"

(
    echo ============================================
    echo  Dental X-Ray Studio - PostgreSQL Setup
    echo  Started: %DATE% %TIME%
    echo  PG_DIR : %PG_DIR%
    echo  APP_DIR: %APP_DIR%
    echo  DATA   : %DATA_DIR%
    echo  SERVICE: %SERVICE_NAME%
    echo ============================================
    echo(
) > "%LOG_FILE%"

:: STEP 0 - Stop any existing instance
echo [STEP 0] Stopping any existing PostgreSQL instance... >> "%LOG_FILE%"
sc query "%SERVICE_NAME%" >nul 2>&1
if not errorlevel 1 (
    net stop "%SERVICE_NAME%" >nul 2>&1
    echo [INFO] Stopped service %SERVICE_NAME%. >> "%LOG_FILE%"
)
if exist "%PG_DATA%\postmaster.pid" (
    echo [INFO] postmaster.pid found - running pg_ctl stop... >> "%LOG_FILE%"
    "%PG_DIR%\bin\pg_ctl.exe" stop --pgdata="%PG_DATA%" -m fast -w -t 30 >nul 2>&1
    echo [INFO] pg_ctl stop done. >> "%LOG_FILE%"
)
ping 127.0.0.1 -n 4 >nul
echo [OK] Pre-existing instance shutdown complete. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 1 - Validate binaries
echo [STEP 1] Validating PostgreSQL binaries... >> "%LOG_FILE%"
if not exist "%PG_DIR%\bin\pg_ctl.exe"     ( echo [ERROR] pg_ctl.exe not found     >> "%LOG_FILE%" & exit /b 1 )
if not exist "%PG_DIR%\bin\initdb.exe"     ( echo [ERROR] initdb.exe not found     >> "%LOG_FILE%" & exit /b 1 )
if not exist "%PG_DIR%\bin\psql.exe"       ( echo [ERROR] psql.exe not found       >> "%LOG_FILE%" & exit /b 1 )
if not exist "%PG_DIR%\bin\pg_isready.exe" ( echo [ERROR] pg_isready.exe not found >> "%LOG_FILE%" & exit /b 1 )
echo [OK] All binaries present. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 2 - Create directories
echo [STEP 2] Creating data directories... >> "%LOG_FILE%"
if not exist "%DATA_DIR%"       mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\logs"  mkdir "%DATA_DIR%\logs"
if not exist "%DATA_DIR%" ( echo [ERROR] Failed to create %DATA_DIR% >> "%LOG_FILE%" & exit /b 1 )
echo [OK] Directories ready. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 3 - Check port
echo [STEP 3] Checking port %PG_PORT%... >> "%LOG_FILE%"
netstat -an | findstr ":%PG_PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port %PG_PORT% still in use. >> "%LOG_FILE%"
) else (
    echo [OK] Port %PG_PORT% is available. >> "%LOG_FILE%"
)
echo( >> "%LOG_FILE%"

:: STEP 4 - Set permissions
echo [STEP 4] Setting directory permissions... >> "%LOG_FILE%"
icacls "%DATA_DIR%" /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F"    /T /Q >> "%LOG_FILE%" 2>&1
icacls "%DATA_DIR%" /grant "BUILTIN\Administrators:(OI)(CI)F" /T /Q >> "%LOG_FILE%" 2>&1
echo [OK] Permissions set. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 5 - initdb
echo [STEP 5] Initialising database cluster... >> "%LOG_FILE%"
if not exist "%PG_DATA%\PG_VERSION" (
    "%PG_DIR%\bin\initdb.exe" --pgdata="%PG_DATA%" --username=postgres --encoding=UTF8 --locale=C --auth=trust >> "%LOG_FILE%" 2>&1
    if errorlevel 1 ( echo [ERROR] initdb failed. >> "%LOG_FILE%" & exit /b 1 )
    icacls "%PG_DATA%" /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F"    /T /Q >> "%LOG_FILE%" 2>&1
    icacls "%PG_DATA%" /grant "BUILTIN\Administrators:(OI)(CI)F" /T /Q >> "%LOG_FILE%" 2>&1
    echo [OK] initdb complete. >> "%LOG_FILE%"
) else (
    echo [INFO] Existing cluster found - skipping initdb. >> "%LOG_FILE%"
)
echo( >> "%LOG_FILE%"

:: STEP 6 - Write pg_hba.conf
echo [STEP 6] Writing pg_hba.conf... >> "%LOG_FILE%"
(
    echo # Dental X-Ray Studio - pg_hba.conf
    echo # TYPE  DATABASE        USER        ADDRESS          METHOD
    echo host    all             postgres    127.0.0.1/32     trust
    echo host    all             postgres    ::1/128          trust
    echo host    dental_xray     dental      127.0.0.1/32     scram-sha-256
    echo host    dental_xray     dental      ::1/128          scram-sha-256
    echo host    dental_xray     dental      0.0.0.0/0        scram-sha-256
) > "%PG_DATA%\pg_hba.conf"
echo [OK] pg_hba.conf written. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 7 - Patch postgresql.conf
echo [STEP 7] Patching postgresql.conf... >> "%LOG_FILE%"
if not exist "%PG_CONF%" ( echo [ERROR] postgresql.conf not found. >> "%LOG_FILE%" & exit /b 1 )
findstr /v /i /r /c:"^[ 	#]*listen_addresses[ 	]*=" /c:"^[ 	#]*port[ 	]*=" /c:"^[ 	#]*logging_collector[ 	]*=" /c:"^[ 	#]*log_directory[ 	]*=" /c:"^[ 	#]*log_filename[ 	]*=" /c:"^[ 	#]*log_truncate_on_rotation[ 	]*=" "%PG_CONF%" > "%PG_CONF_TMP%"
if errorlevel 1 ( echo [ERROR] findstr failed - conf may be locked. >> "%LOG_FILE%" & exit /b 1 )
(
    echo(
    echo # Dental X-Ray Studio installer overrides
    echo listen_addresses = '*'
    echo port = 5432
    echo logging_collector = off
    echo log_directory = 'C:/ProgramData/DentalXRayStudio/logs'
    echo log_filename = 'postgres.log'
    echo log_truncate_on_rotation = off
) >> "%PG_CONF_TMP%"
move /y "%PG_CONF_TMP%" "%PG_CONF%" >nul 2>&1
if errorlevel 1 ( echo [ERROR] Failed to replace postgresql.conf >> "%LOG_FILE%" & exit /b 1 )
echo [OK] postgresql.conf patched. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 8 - Clear stale files
echo [STEP 8] Clearing stale files... >> "%LOG_FILE%"
if exist "%PG_DATA%\postmaster.pid" ( del /f /q "%PG_DATA%\postmaster.pid" >nul 2>&1 & echo [OK] Removed stale postmaster.pid. >> "%LOG_FILE%" )
if exist "%PG_LOG%"                 ( del /f /q "%PG_LOG%" >nul 2>&1 & echo [OK] Removed stale postgres.log. >> "%LOG_FILE%" )
if exist "%PG_DATA%\log\"             del /f /q "%PG_DATA%\log\*.log" >nul 2>&1
echo [OK] Stale file cleanup done. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 9 - Start temporary instance
:: pg_ctl output goes to a separate temp log, NOT to our log file.
:: This prevents the pg_ctl process from holding our log file open
:: while we try to append to it in subsequent steps.
echo [STEP 9] Starting temporary PostgreSQL instance... >> "%LOG_FILE%"
set "PGCTL_LOG=C:\ProgramData\DentalXRayStudio\pgctl-start.log"
"%PG_DIR%\bin\pg_ctl.exe" start --pgdata="%PG_DATA%" --options="-p %PG_PORT% -c logging_collector=off" -w -t 120 > "%PGCTL_LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] pg_ctl start failed. >> "%LOG_FILE%"
    type "%PGCTL_LOG%" >> "%LOG_FILE%"
    exit /b 1
)
echo [OK] pg_ctl reports server started. >> "%LOG_FILE%"
type "%PGCTL_LOG%" >> "%LOG_FILE%"
del "%PGCTL_LOG%" >nul 2>&1

:: Single readiness check - pg_ctl -w already waited but we confirm
ping 127.0.0.1 -n 3 >nul
"%PG_DIR%\bin\pg_isready.exe" -h 127.0.0.1 -p %PG_PORT% -U postgres -q >nul 2>&1
if errorlevel 1 ( echo [ERROR] pg_isready check failed after startup. >> "%LOG_FILE%" & exit /b 1 )
echo [OK] PostgreSQL is accepting connections. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 10 - Create dental role
echo [STEP 10] Creating role 'dental'... >> "%LOG_FILE%"
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
"%PG_DIR%\bin\psql.exe" -U postgres -h 127.0.0.1 -p %PG_PORT% -f "%SQL_FILE%" >> "%LOG_FILE%" 2>&1
if errorlevel 1 ( echo [WARN] Role creation returned non-zero. >> "%LOG_FILE%" ) else ( echo [OK] Role 'dental' ready. >> "%LOG_FILE%" )
echo( >> "%LOG_FILE%"

:: STEP 11 - Create dental_xray database
echo [STEP 11] Creating database 'dental_xray'... >> "%LOG_FILE%"
(
    echo SELECT 'CREATE DATABASE dental_xray OWNER dental ENCODING ''UTF8'' LC_COLLATE ''C'' LC_CTYPE ''C'' TEMPLATE template0'
    echo WHERE NOT EXISTS ^(SELECT FROM pg_database WHERE datname = 'dental_xray'^)\gexec
) > "%SQL_FILE%"
"%PG_DIR%\bin\psql.exe" -U postgres -h 127.0.0.1 -p %PG_PORT% -f "%SQL_FILE%" >> "%LOG_FILE%" 2>&1
if errorlevel 1 ( echo [WARN] Database creation returned non-zero. >> "%LOG_FILE%" ) else ( echo [OK] Database 'dental_xray' ready. >> "%LOG_FILE%" )
echo( >> "%LOG_FILE%"

:: STEP 12 - Grant schema privileges
echo [STEP 12] Granting schema privileges... >> "%LOG_FILE%"
(
    echo GRANT ALL PRIVILEGES ON DATABASE dental_xray TO dental;
    echo \connect dental_xray
    echo GRANT USAGE  ON SCHEMA public TO dental;
    echo GRANT CREATE ON SCHEMA public TO dental;
    echo ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO dental;
    echo ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO dental;
    echo ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO dental;
) > "%SQL_FILE%"
"%PG_DIR%\bin\psql.exe" -U postgres -h 127.0.0.1 -p %PG_PORT% -f "%SQL_FILE%" >> "%LOG_FILE%" 2>&1
if errorlevel 1 ( echo [WARN] Privilege grants returned non-zero. >> "%LOG_FILE%" ) else ( echo [OK] Privileges granted. >> "%LOG_FILE%" )
del "%SQL_FILE%" >nul 2>&1
echo( >> "%LOG_FILE%"

:: STEP 13 - Stop temp instance and re-enable logging_collector
echo [STEP 13] Stopping temporary instance... >> "%LOG_FILE%"
"%PG_DIR%\bin\pg_ctl.exe" stop --pgdata="%PG_DATA%" -m fast -w -t 60 >nul 2>&1
if errorlevel 1 ( echo [WARN] pg_ctl stop returned non-zero. >> "%LOG_FILE%" ) else ( echo [OK] Stopped cleanly. >> "%LOG_FILE%" )
ping 127.0.0.1 -n 4 >nul
echo [INFO] Re-enabling logging_collector... >> "%LOG_FILE%"
findstr /v /i /r /c:"^[ 	#]*logging_collector[ 	]*=" "%PG_CONF%" > "%PG_CONF_TMP%"
echo logging_collector = on >> "%PG_CONF_TMP%"
move /y "%PG_CONF_TMP%" "%PG_CONF%" >nul 2>&1
echo [OK] logging_collector = on for permanent service. >> "%LOG_FILE%"
echo( >> "%LOG_FILE%"

:: STEP 14 - Register Windows service
echo [STEP 14] Registering Windows service '%SERVICE_NAME%'... >> "%LOG_FILE%"
sc query "%SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
    "%PG_DIR%\bin\pg_ctl.exe" register -N "%SERVICE_NAME%" -U "NT AUTHORITY\SYSTEM" -D "%PG_DATA%" -S auto >> "%LOG_FILE%" 2>&1
    if errorlevel 1 (
        echo [WARN] pg_ctl register failed - trying sc.exe... >> "%LOG_FILE%"
        sc create "%SERVICE_NAME%" binPath= "\"%PG_DIR%\bin\pg_ctl.exe\" runservice -N \"%SERVICE_NAME%\" -D \"%PG_DATA%\" -w" obj= LocalSystem start= auto DisplayName= "%SERVICE_DISPLAY%" >> "%LOG_FILE%" 2>&1
        if errorlevel 1 ( echo [ERROR] Service creation failed. >> "%LOG_FILE%" & exit /b 1 )
        echo [OK] Service created via sc.exe. >> "%LOG_FILE%"
    ) else (
        echo [OK] Service registered via pg_ctl. >> "%LOG_FILE%"
    )
    sc description "%SERVICE_NAME%" "%SERVICE_DESC%" >nul 2>&1
) else (
    echo [INFO] Service already registered - skipping. >> "%LOG_FILE%"
)
echo( >> "%LOG_FILE%"

:: STEP 15 - Start service and verify
echo [STEP 15] Starting service '%SERVICE_NAME%'... >> "%LOG_FILE%"
net start "%SERVICE_NAME%" >> "%LOG_FILE%" 2>&1
set "SVC_ERR=%errorlevel%"
if "%SVC_ERR%"=="0"    ( echo [OK] Service started.         >> "%LOG_FILE%" )
if "%SVC_ERR%"=="1056" ( echo [OK] Service already running. >> "%LOG_FILE%" )
if "%SVC_ERR%" gtr "0" if not "%SVC_ERR%"=="1056" ( echo [WARN] net start returned %SVC_ERR%. >> "%LOG_FILE%" )
ping 127.0.0.1 -n 5 >nul
"%PG_DIR%\bin\pg_isready.exe" -h 127.0.0.1 -p %PG_PORT% -U postgres -q >nul 2>&1
if not errorlevel 1 ( echo [OK] Service verified - accepting connections. >> "%LOG_FILE%" ) else ( echo [WARN] pg_isready check failed after service start. >> "%LOG_FILE%" )
echo( >> "%LOG_FILE%"

:: STEP 16 - Write db-server.json
echo [STEP 16] Writing db-server.json... >> "%LOG_FILE%"
if not "%APP_DIR%"=="" ( set "JSON_DIR=%APP_DIR%\resources" ) else ( for %%I in ("%PG_DIR%\..\..") do set "JSON_DIR=%%~fI" )
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
if errorlevel 1 ( echo [WARN] Could not write db-server.json. >> "%LOG_FILE%" ) else ( echo [OK] db-server.json written to %JSON_DIR% >> "%LOG_FILE%" )
echo( >> "%LOG_FILE%"

:: STEP 17 - Firewall rules
echo [STEP 17] Configuring firewall... >> "%LOG_FILE%"
netsh advfirewall firewall show rule name="Dental X-Ray PostgreSQL" >nul 2>&1
if errorlevel 1 ( netsh advfirewall firewall add rule name="Dental X-Ray PostgreSQL" dir=in action=allow protocol=TCP localport=5432 >> "%LOG_FILE%" 2>&1 & echo [OK] Port 5432 opened. >> "%LOG_FILE%" ) else ( echo [INFO] Port 5432 rule exists. >> "%LOG_FILE%" )
netsh advfirewall firewall show rule name="Dental X-Ray DICOM" >nul 2>&1
if errorlevel 1 ( netsh advfirewall firewall add rule name="Dental X-Ray DICOM" dir=in action=allow protocol=TCP localport=4242 >> "%LOG_FILE%" 2>&1 & echo [OK] Port 4242 opened. >> "%LOG_FILE%" ) else ( echo [INFO] Port 4242 rule exists. >> "%LOG_FILE%" )
echo( >> "%LOG_FILE%"

:: DONE
(
    echo ============================================
    echo  SETUP COMPLETE
    echo  Finished: %DATE% %TIME%
    echo  Service : %SERVICE_NAME%  [NT AUTHORITY\SYSTEM]
    echo  Host    : localhost:%PG_PORT%
    echo  Database: dental_xray
    echo  User    : dental
    echo  Data    : %PG_DATA%
    echo ============================================
) >> "%LOG_FILE%"

exit /b 0