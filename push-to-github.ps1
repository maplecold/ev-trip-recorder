<#
Push ev-trip-recorder to your GitHub account.

Usage:
    cd C:\Users\Administrator\Documents\deepseek-harness\default-workspace\ev-trip-recorder
    pwsh -File .\push-to-github.ps1

What it does:
  1. asks for a GitHub Personal Access Token (hidden input, never written to disk);
  2. creates the repository through the GitHub API (public by default, use -Private otherwise);
  3. adds the remote and pushes the main branch;
  4. strips the token from .git/config afterwards.

Token scopes:
  - Fine-grained token: "Repository creation" + target repo "Contents: Read and write".
  - Classic token: `repo`.
#>

param(
    [string]$RepoName = 'ev-trip-recorder',
    [string]$Description = 'Vehicle-agnostic EV trip recording: start/end detection, distance fusion, energy estimation, route simplification',
    [switch]$Private
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host 'Paste a GitHub Personal Access Token (input is hidden):'
$secure = Read-Host -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($token)) { throw 'no token provided' }

$headers = @{
    Authorization          = "Bearer $token"
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'ev-trip-recorder-push'
}

$me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 30
Write-Host "account: $($me.login)"

$repoExists = $true
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$($me.login)/$RepoName" -Headers $headers -TimeoutSec 30 | Out-Null
} catch {
    $repoExists = $false
}

if (-not $repoExists) {
    $body = @{
        name        = $RepoName
        description = $Description
        private     = [bool]$Private
        has_issues  = $true
        has_wiki    = $false
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $headers -Body $body -TimeoutSec 60 | Out-Null
    Write-Host "created: https://github.com/$($me.login)/$RepoName"
} else {
    Write-Host "exists, pushing to: https://github.com/$($me.login)/$RepoName"
}

if (-not (Test-Path '.git')) { throw 'not a git repository (missing .git)' }

$ErrorActionPreference = 'Continue'
git remote remove origin 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
$authUrl = "https://x-access-token:$token@github.com/$($me.login)/$RepoName.git"
git remote add origin $authUrl
git push -u origin main
git remote set-url origin "https://github.com/$($me.login)/$RepoName.git"

Write-Host ''
Write-Host "done: https://github.com/$($me.login)/$RepoName"
