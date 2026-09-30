# Aulora one-command self-host installer (Windows PowerShell).
#
#   pwsh ./install.ps1 [options]
#
# It checks Docker, writes infra/docker/.env (reusing an existing one), builds
# and starts the Compose stack, runs first-run setup, and prints the URL. It is
# idempotent: re-running reuses .env and is a no-op for data.
#
# Options (or the matching AULORA_* environment variable):
#   -Name <name>        workspace name            (AULORA_WORKSPACE_NAME)
#   -Instance <name>    instance/database name    (AULORA_INSTANCE_NAME)
#   -Email <email>      owner email               (AULORA_OWNER_EMAIL)
#   -Password <pw>      owner password, 16+ chars (AULORA_OWNER_PASSWORD)
#   -Port <port>        host web port, default 8080 (AULORA_WEB_PORT)
#   -SiteUrl <url>      public origin             (AULORA_SITE_URL)
#   -Backups            also start the nightly backup runner
#   -NoStart            write .env and stop before docker compose
#   -DryRun             print the plan; change nothing
#   -Help

[CmdletBinding()]
param(
  [string]$Name = $env:AULORA_WORKSPACE_NAME,
  [string]$Instance = $env:AULORA_INSTANCE_NAME,
  [string]$Email = $env:AULORA_OWNER_EMAIL,
  [string]$Password = $env:AULORA_OWNER_PASSWORD,
  [string]$Port = $(if ($env:AULORA_WEB_PORT) { $env:AULORA_WEB_PORT } else { "8080" }),
  [string]$SiteUrl = $env:AULORA_SITE_URL,
  [switch]$Backups,
  [switch]$NoStart,
  [switch]$DryRun,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) { Write-Host "[install] $Message" }
function Stop-Install([string]$Message) { Write-Error "[install] $Message"; exit 1 }
function Get-Slug([string]$Value) {
  return ($Value.ToLower() -replace "[^a-z0-9]+", "-").Trim("-")
}

if ($Help) {
  Get-Content -LiteralPath $MyInvocation.MyCommand.Path | Select-Object -Skip 1 -First 20 |
    ForEach-Object { $_ -replace "^# ?", "" }
  exit 0
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DockerDir = Join-Path $Root "infra\docker"
$EnvFile = if ($env:AULORA_ENV_FILE) { $env:AULORA_ENV_FILE } else { Join-Path $DockerDir ".env" }
$EnvExample = Join-Path $DockerDir ".env.example"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Stop-Install "Docker is not installed or not on PATH"
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Stop-Install "Docker Compose v2 is required (docker compose)" }
docker compose wait --help *> $null
if ($LASTEXITCODE -ne 0) { Stop-Install "update Docker Compose: the installer requires the wait command" }
if (-not (Test-Path -LiteralPath $EnvExample)) { Stop-Install "missing $EnvExample" }

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $pattern = "^\s*(export\s+)?$([regex]::Escape($Key))="
  $found = $false
  $updated = foreach ($line in (Get-Content -LiteralPath $Path)) {
    if ($line -match $pattern) { $found = $true; "$Key=$Value" } else { $line }
  }
  $updated = @($updated)
  if (-not $found) { $updated += "$Key=$Value" }
  Set-Content -LiteralPath $Path -Value $updated -Encoding utf8
}

if (Test-Path -LiteralPath $EnvFile) {
  Write-Log "using the existing $EnvFile (idempotent re-run)"
  foreach ($line in (Get-Content -LiteralPath $EnvFile)) {
    if ($line -match '^\s*(?:export\s+)?(SITE_URL|WEB_PORT|OWNER_EMAIL)=(.*)$') {
      $value = $Matches[2].Trim().Trim('"').Trim("'")
      switch ($Matches[1]) {
        'SITE_URL' { $SiteUrl = $value }
        'WEB_PORT' { if ($value) { $Port = $value } }
        'OWNER_EMAIL' { $Email = $value }
      }
    }
  }
} else {
  if (-not $Name) { $Name = "Aulora" }
  if (-not $Instance) { $Instance = Get-Slug $Name; if (-not $Instance) { $Instance = "aulora" } }
  if (-not $Email) { $Email = Read-Host "Owner email" }
  if (-not $Email) { Stop-Install "set -Email (or AULORA_OWNER_EMAIL) for the owner account" }
  if (-not $Password) {
    $secure = Read-Host "Owner password (16+ chars)" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
  }
  if (-not $Password) { Stop-Install "set -Password (or AULORA_OWNER_PASSWORD)" }
  if ($Password.Length -lt 16) { Stop-Install "owner password must be at least 16 characters" }
}

if (-not $SiteUrl) { $SiteUrl = "http://localhost:$Port" }
$OwnerName = if ($env:AULORA_OWNER_NAME) { $env:AULORA_OWNER_NAME } else { $Name }

function Invoke-Compose([string[]]$Arguments) {
  Push-Location $DockerDir
  try { & docker compose --env-file $EnvFile @Arguments } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Stop-Install "docker compose $($Arguments -join ' ') failed" }
}

if ($DryRun) {
  if (Test-Path -LiteralPath $EnvFile) {
    Write-Log "DRY RUN: would reuse $EnvFile"
  } else {
    Write-Log "DRY RUN: would write $EnvFile (workspace=$Name, instance=$Instance, site=$SiteUrl, port=$Port)"
  }
  Write-Log "DRY RUN: docker compose up -d --build"
  Write-Log "DRY RUN: docker compose wait setup"
  if ($Backups) { Write-Log "DRY RUN: docker compose --profile backups up -d --build" }
  Write-Log "DRY RUN: done; no changes made"
  exit 0
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
  Set-EnvValue $EnvFile "INSTANCE_NAME" $Instance
  Set-EnvValue $EnvFile "WORKSPACE_NAME" $Name
  Set-EnvValue $EnvFile "OWNER_EMAIL" $Email
  Set-EnvValue $EnvFile "OWNER_PASSWORD" $Password
  Set-EnvValue $EnvFile "OWNER_NAME" $OwnerName
  Set-EnvValue $EnvFile "SITE_URL" $SiteUrl
  Set-EnvValue $EnvFile "WEB_PORT" $Port
  Write-Log "wrote $EnvFile"
}

if ($NoStart) {
  Write-Log "config ready; skipping docker compose (-NoStart)"
  exit 0
}

Write-Log "building and starting the stack (this can take a few minutes)..."
Invoke-Compose @("up", "-d", "--build")
Write-Log "waiting for first-run setup (idempotent)..."
Invoke-Compose @("wait", "setup")
if ($Backups) {
  Write-Log "starting the nightly backup runner..."
  Invoke-Compose @("--profile", "backups", "up", "-d", "--build")
}

Write-Log "ready. Open $SiteUrl and sign in as $Email."
Write-Log "Logs: (cd infra/docker; docker compose logs -f setup)"
