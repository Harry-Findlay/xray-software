@echo off
setlocal EnableDelayedExpansion

set PG_DIR=%~1
set DATA_DIR=%PROGRAMDATA%\DentalXRayStudio
set PG_DATA=%DATA_DIR%\pgdata
set PG_LOG=%DATA_DIR%\logs\postgres.log
set SERVICE_NAME=DentalXRayDB
set DB_PASSWORD=DentalXRay2024!
set LOG_FILE=%TEMP%\dental-xray-setup.log

echo Dental X-Ray Studio - PostgreSQL Setup > %LOG_FILE%
echo Started: %DATE% %TIME% >> %LOG_FILE%

:: 1. Check binaries
if not exist "%PG_DIR%\bin\pg_ctl.exe" (
    echo ERROR: pg_ctl.exe not found >> %LOG_FILE%
    exit /b 1
)

:: 2. Create directories
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"

:: 3. Initialise (skip if done)
if not exist "%PG_DATA%\PG_VERSION" (
    "%PG_DIR%\bin\initdb.exe" --pgdata="%PG_DATA%" --username=postgres --encoding=UTF8 --auth=trust >> %LOG_FILE% 2>&1
    
    (
        echo # TYPE  DATABASE    USER        ADDRESS        METHOD
        echo local   all         postgres                   trust
        echo host    all         postgres    127.0.0.1/32   trust
        echo host    all         postgres    ::1/128        trust
        echo host    dental_xray dental      127.0.0.1/32   md5
        echo host    dental_xray dental      ::1/128        md5
        echo host    dental_xray dental      0.0.0.0/0      md5
    ) > "%PG_DATA%\pg_hba.conf"
)

:: 4. Start temp instance to configure DB
"%PG_DIR%\bin\pg_ctl.exe" start --pgdata="%PG_DATA%" --log="%PG_LOG%" -w -t 60 >> %LOG_FILE% 2>&1

:: 5. Wait for readiness (using ping instead of timeout)
ping 127.0.0.1 -n 5 >nul

:: 6. Create user (Safe "If Not Exists" check)
echo Configuring User and Database... >> %LOG_FILE%
"%PG_DIR%\bin\psql.exe" -U postgres -c "DO $body$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'dental') THEN CREATE ROLE dental LOGIN PASSWORD '%DB_PASSWORD%'; END IF; END $body$;" >> %LOG_FILE% 2>&1

:: 7. Create Database (Safe check)
"%PG_DIR%\bin\psql.exe" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'dental_xray'" | findstr /B "1" > nul || "%PG_DIR%\bin\psql.exe" -U postgres -c "CREATE DATABASE dental_xray OWNER dental ENCODING 'UTF8';" >> %LOG_FILE% 2>&1

"%PG_DIR%\bin\psql.exe" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE dental_xray TO dental;" >> %LOG_FILE% 2>&1

:: 8. Stop temp instance
"%PG_DIR%\bin\pg_ctl.exe" stop --pgdata="%PG_DATA%" -m fast -w >> %LOG_FILE% 2>&1

:: 9. Register/Start Service
sc query "%SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
    "%PG_DIR%\bin\pg_ctl.exe" register -N "%SERVICE_NAME%" -D "%PG_DATA%" -S auto >> %LOG_FILE% 2>&1
)

net start "%SERVICE_NAME%" >> %LOG_FILE% 2>&1
:: If net start returns 2, it means already running, which is fine.
if %errorlevel% equ 2 (echo Service already running >> %LOG_FILE%)

:: 10. Always exit with 0 to satisfy NSIS
exit /b 0