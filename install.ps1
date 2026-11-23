# Aulora one-command self-host installer (Windows PowerShell).
#
#   pwsh ./install.ps1 [options]
#
# Run it from a checkout of a release tag (vX.Y.Z). On any other ref with a
# clean tree it first checks out the newest published release and re-runs
# itself. It checks Docker, writes infra/docker/.env (reusing an existing one),
# pulls the release images from ghcr.io (a development checkout builds them
# instead), starts the Compose stack, runs first-run setup, and prints the URL.
# It is idempotent: re-running reuses .env and is a no-op for data.
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
#   -AllowAnyBranch     install this checkout as is, even if it is not a release
#                       tag; builds images locally (AULORA_ALLOW_ANY_BRANCH)
#   -Help

[CmdletBinding()]
param(
  [string]$Name = $env:AULORA_WORKSPACE_NAME,
  [string]$Instance = $env:AULORA_INSTANCE_NAME,
  [string]$Email = $env:AULORA_OWNER_EMAIL,
  [Alias("Password")]
  [string]$OwnerPassword = $env:AULORA_OWNER_PASSWORD,
  [string]$Port = $(if ($env:AULORA_WEB_PORT) { $env:AULORA_WEB_PORT } else { "8080" }),
  [string]$SiteUrl = $env:AULORA_SITE_URL,
  [switch]$Backups,
  [switch]$NoStart,
  [switch]$DryRun,
  [switch]$AllowAnyBranch,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$ScriptParameters = $PSBoundParameters

$AllowAny = $AllowAnyBranch -or ($env:AULORA_ALLOW_ANY_BRANCH -match '^(1|true|yes|on)$')

function Write-Log([string]$Message) { Write-Output "[install] $Message" }
function Write-InstallError([string]$Message) { Write-Error "[install] $Message"; exit 1 }
function Get-Slug([string]$Value) {
  return ($Value.ToLower() -replace "[^a-z0-9]+", "-").Trim("-")
}
$StableTagPattern = '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
function Get-HeadStableTag {
  $tags = @(& git -C $Root tag --points-at HEAD 2>$null | Where-Object { $_ -match $StableTagPattern })
  if ($tags.Count -eq 0) { return $null }
  return ($tags | Sort-Object { [version]($_.Substring(1)) } | Select-Object -Last 1)
}
# Installs come from a GitHub release: a checkout whose HEAD is exactly a stable
# vX.Y.Z tag. On any other ref a clean checkout moves to the newest stable tag
# (detached) and the installer runs again from there. A dirty tree, a failed
# fetch, or -AllowAnyBranch leaves the checkout alone.
function Initialize-ReleaseCheckout {
  if ($AllowAny) { return }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return }
  & git -C $Root rev-parse --is-inside-work-tree *> $null
  if ($LASTEXITCODE -ne 0) { return }
  if (Get-HeadStableTag) { return }
  $ref = (& git -C $Root rev-parse --abbrev-ref HEAD 2>$null)
  if (-not $ref) { $ref = "HEAD" }
  if (& git -C $Root status --porcelain 2>$null) {
    Write-Warning "[install] this checkout is on '$ref' with local changes, so it cannot switch to a release. Commit or discard them, or clone a release: git clone https://github.com/chark1es/Aulora.git (-AllowAnyBranch installs this checkout as is; images are built locally)."
    return
  }
  $env:GIT_TERMINAL_PROMPT = "0"
  & git -C $Root fetch --tags --force --quiet origin *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "[install] could not fetch release tags from origin; installing '$ref' as is (images are built locally)."
    return
  }
  $latest = @(& git -C $Root tag --list 'v*' 2>$null | Where-Object { $_ -match $StableTagPattern } |
    Sort-Object { [version]($_.Substring(1)) } | Select-Object -Last 1)[0]
  if (-not $latest) {
    Write-Warning "[install] no stable release tag found; installing '$ref' as is (images are built locally)."
    return
  }
  if ($DryRun) {
    Write-Log "DRY RUN: would check out release $latest (currently on '$ref') and re-run the installer"
    return
  }
  if ($env:AULORA_INSTALL_REEXEC) { Write-InstallError "still not on a release tag after checkout" }
  Write-Log "checking out release $latest (was on '$ref')"
  & git -C $Root -c advice.detachedHead=false checkout --quiet --detach "refs/tags/$latest"
  if ($LASTEXITCODE -ne 0) { Write-InstallError "could not check out $latest" }
  # The checkout replaced this script; run the release's installer instead.
  $forward = foreach ($entry in $ScriptParameters.GetEnumerator()) {
    "-$($entry.Key)"
    if ($entry.Value -isnot [System.Management.Automation.SwitchParameter]) { [string]$entry.Value }
  }
  $env:AULORA_INSTALL_REEXEC = "1"
  & (Get-Process -Id $PID).Path -NoProfile -File (Join-Path $Root "install.ps1") @forward
  exit $LASTEXITCODE
}
# Release images exist only for the release this checkout is exactly at.
# Anything else builds locally (AULORA_IMAGE_TAG=local) so it never runs a stale one.
function Test-AtReleaseTag {
  $envTs = Join-Path $Root "packages/convex/convex/lib/env.ts"
  if (-not (Test-Path -LiteralPath $envTs)) { return $false }
  $m = Select-String -LiteralPath $envTs -Pattern '^export const AULORA_VERSION = "([^"]*)";' | Select-Object -First 1
  if (-not $m) { return $false }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $false }
  & git -C $Root describe --tags --exact-match --match "v$($m.Matches[0].Groups[1].Value)" HEAD *> $null
  return ($LASTEXITCODE -eq 0)
}

if ($Help) {
  Get-Content -LiteralPath $MyInvocation.MyCommand.Path | Select-Object -Skip 1 -First 24 |
    ForEach-Object { $_ -replace "^# ?", "" }
  exit 0
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DockerDir = Join-Path $Root "infra\docker"
$EnvFile = if ($env:AULORA_ENV_FILE) { $env:AULORA_ENV_FILE } else { Join-Path $DockerDir ".env" }
$EnvExample = Join-Path $DockerDir ".env.example"

Initialize-ReleaseCheckout

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-InstallError "Docker is not installed or not on PATH"
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Write-InstallError "Docker Compose v2 is required (docker compose)" }
$ComposeVersion = (docker compose version --short 2>$null | Out-String).Trim()
if ($ComposeVersion -notmatch '^v?(\d+)\.(\d+)' -or [int]$Matches[1] -lt 2 -or ([int]$Matches[1] -eq 2 -and [int]$Matches[2] -lt 24)) {
  Write-InstallError "Docker Compose 2.24 or newer is required (found $(if ($ComposeVersion) { $ComposeVersion } else { 'unknown' })). Upgrade the Compose plugin."
}
docker compose wait --help *> $null
if ($LASTEXITCODE -ne 0) { Write-InstallError "update Docker Compose: the installer requires the wait command" }
if (-not (Test-Path -LiteralPath $EnvExample)) { Write-InstallError "missing $EnvExample" }

function Write-EnvValue([string]$Path, [string]$Key, [string]$Value) {
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
  if (-not $Email) { Write-InstallError "set -Email (or AULORA_OWNER_EMAIL) for the owner account" }
  if (-not $OwnerPassword) {
    $secure = Read-Host "Owner password (16+ chars)" -AsSecureString
    $OwnerPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
  }
  if (-not $OwnerPassword) { Write-InstallError "set -Password (or AULORA_OWNER_PASSWORD)" }
  if ($OwnerPassword.Length -lt 16) { Write-InstallError "owner password must be at least 16 characters" }
}

if (-not $SiteUrl) { $SiteUrl = "http://localhost:$Port" }
$OwnerName = if ($env:AULORA_OWNER_NAME) { $env:AULORA_OWNER_NAME } else { $Name }

function Invoke-Compose([string[]]$Arguments) {
  Push-Location $DockerDir
  try { & docker compose --env-file $EnvFile @Arguments } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Write-InstallError "docker compose $($Arguments -join ' ') failed" }
}

if ($DryRun) {
  if (Test-Path -LiteralPath $EnvFile) {
    Write-Log "DRY RUN: would reuse $EnvFile"
  } else {
    Write-Log "DRY RUN: would write $EnvFile (workspace=$Name, instance=$Instance, site=$SiteUrl, port=$Port)"
  }
  if (Test-AtReleaseTag) {
    Write-Log "DRY RUN: docker compose pull (release images from ghcr.io)"
    Write-Log "DRY RUN: docker compose up -d --no-build"
  } else {
    Write-Log "DRY RUN: docker compose up -d --build (local images; this checkout is not a release tag)"
  }
  Write-Log "DRY RUN: docker compose wait setup"
  if ($Backups) { Write-Log "DRY RUN: docker compose --profile backups up -d" }
  Write-Log "DRY RUN: done; no changes made"
  exit 0
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
  # Generate the bot runner token now so Compose has it when it first creates the
  # runner; `setup` keeps an existing value instead of generating its own.
  $tokenBytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
  $runnerToken = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Write-EnvValue $EnvFile "BOT_RUNNER_TOKEN" $runnerToken
  Write-EnvValue $EnvFile "INSTANCE_NAME" $Instance
  Write-EnvValue $EnvFile "WORKSPACE_NAME" $Name
  Write-EnvValue $EnvFile "OWNER_EMAIL" $Email
  Write-EnvValue $EnvFile "OWNER_PASSWORD" $OwnerPassword
  Write-EnvValue $EnvFile "OWNER_NAME" $OwnerName
  Write-EnvValue $EnvFile "SITE_URL" $SiteUrl
  Write-EnvValue $EnvFile "WEB_PORT" $Port
  Write-Log "wrote $EnvFile"
}

if ($NoStart) {
  Write-Log "config ready; skipping docker compose (-NoStart)"
  exit 0
}

# A release checkout pulls the published images. Anything else (or a failed
# pull) builds from source, tagged `local` so it never reuses a release image.
$UpFlag = "--no-build"
if (Test-AtReleaseTag) {
  Write-Log "pulling the release images (this can take a few minutes)..."
  Push-Location $DockerDir
  try { & docker compose --env-file $EnvFile pull web setup smtp-gateway bot-runner transcriber } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) {
    Write-Log "WARNING: could not pull the published images; building locally instead"
    $env:AULORA_IMAGE_TAG = "local"
    $UpFlag = "--build"
  }
} else {
  $env:AULORA_IMAGE_TAG = "local"
  $UpFlag = "--build"
}
Write-Log "starting the stack..."
Invoke-Compose @("up", "-d", $UpFlag)
Write-Log "waiting for first-run setup (idempotent)..."
Invoke-Compose @("wait", "setup")
# A fresh install already has BOT_RUNNER_TOKEN in the env file. An older env file
# may not, and `setup` writes one then, but Compose resolved the token when the
# stack was created. Recreate the runner so it reads the current value; it idles
# safely if no token exists or BOT_RUNNER_ENABLED=false.
Write-Log "starting the bot runner..."
Invoke-Compose @("up", "-d", "--no-deps", "--force-recreate", "bot-runner")
if ($Backups) {
  Write-Log "starting the nightly backup runner..."
  if ($UpFlag -eq "--no-build") { Invoke-Compose @("--profile", "backups", "pull", "backup") }
  Invoke-Compose @("--profile", "backups", "up", "-d", $UpFlag)
}

Write-Log "ready. Open $SiteUrl and sign in as $Email."
Write-Log "Logs: (cd infra/docker; docker compose logs -f setup)"
