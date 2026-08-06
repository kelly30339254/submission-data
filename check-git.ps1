$ErrorActionPreference = "Continue"
$out = @()
$out += "GIT_VERSION: " + (git --version 2>&1)
$out += "GIT_USER_NAME: " + (git config --global user.name 2>&1)
$out += "GIT_USER_EMAIL: " + (git config --global user.email 2>&1)
$out += "CRED_HELPER: " + (git config --global credential.helper 2>&1)
$out | Out-File -FilePath "$env:TEMP\git-check.txt" -Encoding UTF8
Get-Content "$env:TEMP\git-check.txt"
