# fix-git.ps1
# Run this from your project root in PowerShell as Administrator
# It removes the postgres binaries from git tracking and fixes long paths

Write-Host "Step 1: Enable long paths in git..." -ForegroundColor Cyan
git config core.longpaths true

Write-Host "Step 2: Remove postgres/pgAdmin from git tracking..." -ForegroundColor Cyan
git rm -r --cached resources/postgres/ 2>$null
git rm -r --cached resources/ 2>$null

Write-Host "Step 3: Remove the large file from git history..." -ForegroundColor Cyan
# This rewrites history to fully remove the large files
git filter-branch --force --index-filter `
  "git rm -r --cached --ignore-unmatch resources/postgres/" `
  --prune-empty --tag-name-filter cat -- --all

Write-Host "Step 4: Clean up refs..." -ForegroundColor Cyan
git for-each-ref --format="delete %(refname)" refs/original | git update-ref --stdin
git reflog expire --expire=now --all
git gc --prune=now --aggressive

Write-Host "Step 5: Force push (this rewrites remote history)..." -ForegroundColor Cyan
git push origin main --force

Write-Host ""
Write-Host "Done! The postgres binaries are no longer in git." -ForegroundColor Green
Write-Host "Your teammates should run: git fetch --all && git reset --hard origin/main" -ForegroundColor Yellow
