$ErrorActionPreference = "Continue"
$out = @()
Set-Location "C:\Users\20440\Desktop\爬虫"

git config user.name "submission-bot"
git config user.email "submission-bot@users.noreply.github.com"
$out += "USER_CONFIG: done"

if (-not (Test-Path ".git")) {
    git init -b main
    $out += "INIT: done"
} else {
    $out += "INIT: already exists"
}

git add -A
$statusLines = @(git status --short)
$out += "STATUS_FILES: $($statusLines.Count)"

if ($statusLines.Count -gt 0) {
    git commit -m "init: short-story submission data crawler with daily update"
    $out += "COMMIT: done"
} else {
    $out += "COMMIT: nothing to commit"
}

$out += "BRANCH: " + (git branch --show-current)
$out += "LOG: " + (git log --oneline -1)
$out | Out-File -FilePath "$env:TEMP\git-init-out.txt" -Encoding UTF8
Get-Content "$env:TEMP\git-init-out.txt"
