$out = @()
$out += "GITHUB_TOKEN: " + [bool]$env:GITHUB_TOKEN
$out += "GH_TOKEN: " + [bool]$env:GH_TOKEN
$cm = git config --system --get credential.helper 2>&1
$cmg = git config --global --get credential.helper 2>&1
$out += "CRED_HELPER_SYSTEM: $cm"
$out += "CRED_HELPER_GLOBAL: $cmg"
# 检查 Git Credential Manager 是否存在
$gcm = Get-Command "git-credential-manager" -ErrorAction SilentlyContinue
$out += "GCM_EXISTS: " + [bool]$gcm
# 检查 GitHub 相关凭据文件
$credFile = "$env:APPDATA\GitCredentialManager\hosts.xml"
$out += "GCM_HOSTS_FILE: " + (Test-Path $credFile)
# 检查 .git-credentials
$out += "GIT_CREDENTIALS: " + (Test-Path "$env:USERPROFILE\.git-credentials")
$out | Out-File -FilePath "$env:TEMP\cred-check.txt" -Encoding UTF8
Get-Content "$env:TEMP\cred-check.txt"
