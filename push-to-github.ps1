<#
把 ev-trip-recorder 推送到你的 GitHub。

用法（在 PowerShell 里运行）：
    cd C:\Users\Administrator\Documents\deepseek-harness\default-workspace\ev-trip-recorder
    pwsh -File .\push-to-github.ps1

脚本会：
  1. 让你粘贴一个 GitHub Personal Access Token（不会回显、不会写进任何文件）；
  2. 用该 token 调 GitHub API 创建仓库（默认 public，可改）；
  3. 添加 remote 并推送 main 分支；
  4. 推送完成后把 remote URL 里的 token 去掉，避免留在 .git/config 里。

Token 权限：Fine-grained token 勾选 "Repository creation" + 目标仓库的 Contents: Read and write 即可；
或者用经典 token，勾选 `repo`。
#>

param(
    [string]$RepoName = 'ev-trip-recorder',
    [string]$Description = 'Vehicle-agnostic EV trip recording: start/end detection, distance fusion, energy estimation, route simplification',
    [switch]$Private
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host '把 GitHub Personal Access Token 粘贴进来（输入不回显）：'
$secure = Read-Host -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
)

if ([string]::IsNullOrWhiteSpace($token)) { throw '没有拿到 token' }

$headers = @{
    Authorization          = "Bearer $token"
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'ev-trip-recorder-push'
}

# 1) 当前账号
$me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 30
Write-Host "账号: $($me.login)"

# 2) 创建仓库（已存在则跳过）
$exists = $true
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$($me.login)/$RepoName" -Headers $headers -TimeoutSec 30 | Out-Null
} catch {
    $exists = $false
}

if (-not $exists) {
    $body = @{
        name        = $RepoName
        description = $Description
        private     = [bool]$Private
        has_issues  = $true
        has_wiki    = $false
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $headers -Body $body -TimeoutSec 60 | Out-Null
    Write-Host "已创建仓库: https://github.com/$($me.login)/$RepoName"
} else {
    Write-Host "仓库已存在，直接推送: https://github.com/$($me.login)/$RepoName"
}

# 3) 推送
if (Test-Path '.git') {
    git remote remove origin 2>$null
    $authUrl = "https://x-access-token:$token@github.com/$($me.login)/$RepoName.git"
    git remote add origin $authUrl
    git push -u origin main
    # 4) 去掉 token
    git remote set-url origin "https://github.com/$($me.login)/$RepoName.git"
    Write-Host ''
    Write-Host "完成: https://github.com/$($me.login)/$RepoName"
} else {
    Write-Host '当前目录不是 git 仓库（缺少 .git）'
}
