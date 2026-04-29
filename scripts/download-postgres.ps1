# scripts/download-postgres.ps1
#
# Downloads the PostgreSQL Windows binaries (zip) into resources/postgres/pgsql/
# Run this once after cloning, and again when you want to update the PG version.
#
# Usage (PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\download-postgres.ps1

$PG_VERSION   = "16.3-1"           # Update this to use a different version
$PG_ARCH      = "windows-x64"
$DOWNLOAD_URL = "https://get.enterprisedb.com/postgresql/postgresql-$PG_VERSION-$PG_ARCH-binaries.zip"
$DEST_DIR     = "$PSScriptRoot\..\resources\postgres"
$ZIP_PATH     = "$DEST_DIR\pg-binaries.zip"

Write-Host ""
Write-Host "PostgreSQL Binary Downloader" -ForegroundColor Cyan
Write-Host "Version: $PG_VERSION" -ForegroundColor Gray
Write-Host "Destination: $DEST_DIR" -ForegroundColor Gray
Write-Host ""

# Create destination directory
if (-not (Test-Path $DEST_DIR)) {
    New-Item -ItemType Directory -Path $DEST_DIR -Force | Out-Null
}

# Check if already downloaded
if (Test-Path "$DEST_DIR\pgsql\bin\pg_ctl.exe") {
    Write-Host "PostgreSQL binaries already present at $DEST_DIR\pgsql\" -ForegroundColor Green
    Write-Host "Delete $DEST_DIR\pgsql\ and re-run to force a fresh download." -ForegroundColor Gray
    exit 0
}

Write-Host "Downloading PostgreSQL $PG_VERSION (~150MB)..." -ForegroundColor Yellow
Write-Host "URL: $DOWNLOAD_URL" -ForegroundColor Gray
Write-Host ""

try {
    # Use BITS for faster/resumable download
    Import-Module BitsTransfer -ErrorAction SilentlyContinue
    $bitsAvailable = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue

    if ($bitsAvailable) {
        Start-BitsTransfer -Source $DOWNLOAD_URL -Destination $ZIP_PATH -DisplayName "Downloading PostgreSQL"
    } else {
        $ProgressPreference = 'SilentlyContinue'   # speeds up Invoke-WebRequest significantly
        Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $ZIP_PATH -UseBasicParsing
    }

    Write-Host "Download complete. Extracting..." -ForegroundColor Yellow

    # Extract — the zip contains a pgsql\ folder at root
    Expand-Archive -Path $ZIP_PATH -DestinationPath $DEST_DIR -Force

    # Clean up zip
    Remove-Item $ZIP_PATH -Force

    Write-Host ""
    Write-Host "Done! PostgreSQL binaries extracted to:" -ForegroundColor Green
    Write-Host "  $DEST_DIR\pgsql\" -ForegroundColor White
    Write-Host ""
    Write-Host "You can now build the installer with: npm run build:win:server" -ForegroundColor Cyan

} catch {
    Write-Host "Download failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Manual download steps:" -ForegroundColor Yellow
    Write-Host "  1. Go to: https://www.enterprisedb.com/download-postgresql-binaries"
    Write-Host "  2. Download: PostgreSQL $PG_VERSION for Windows x86-64 (zip)"
    Write-Host "  3. Extract it so you have: resources\postgres\pgsql\bin\pg_ctl.exe"
    exit 1
}
