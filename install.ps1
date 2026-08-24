$ErrorActionPreference = "Stop"

$Repository = if ($env:RAPP_ZOO_REPOSITORY) { $env:RAPP_ZOO_REPOSITORY } else { "kody-w/rappid" }
$RequestedRef = if ($env:RAPP_ZOO_REF) { $env:RAPP_ZOO_REF } else { "main" }
$InstallRoot = if ($env:RAPP_ZOO_INSTALL_ROOT) { $env:RAPP_ZOO_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "RAPP-Zoo-v2" }
$BinDir = if ($env:RAPP_ZOO_BIN_DIR) { $env:RAPP_ZOO_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps" }
$Source = $env:RAPP_ZOO_SOURCE

$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt 24 -or $nodeMajor -ge 27) {
  throw "Node.js must be >=24.19.0 and <27."
}

$Stage = "$InstallRoot.stage.$PID"
$Backup = $null
if (Test-Path $Stage) { throw "Staging path already exists: $Stage" }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

try {
  if ($Source) {
    if (-not (Test-Path (Join-Path $Source "package.json"))) {
      throw "RAPP_ZOO_SOURCE is not a source checkout."
    }
    Get-ChildItem -Force $Source |
      Where-Object { $_.Name -notin @(".git", "node_modules", "proof", "release") } |
      Copy-Item -Destination $Stage -Recurse -Force
    $ResolvedRef = "local-source"
  } else {
    if ($RequestedRef -match "^[0-9a-f]{40}$") {
      $ResolvedRef = $RequestedRef
    } else {
      $commit = Invoke-RestMethod "https://api.github.com/repos/$Repository/commits/$RequestedRef"
      $ResolvedRef = $commit.sha
    }
    if ($ResolvedRef -notmatch "^[0-9a-f]{40}$") {
      throw "Could not resolve an immutable repository commit."
    }
    $archive = Join-Path $env:TEMP "rapp-zoo-v2-$PID.zip"
    Invoke-WebRequest "https://github.com/$Repository/archive/$ResolvedRef.zip" -OutFile $archive
    Expand-Archive $archive -DestinationPath $Stage
    $expanded = Get-ChildItem $Stage | Select-Object -First 1
    Get-ChildItem -Force $expanded.FullName | Move-Item -Destination $Stage
    Remove-Item $expanded.FullName -Recurse -Force
    Remove-Item $archive -Force
  }
  Push-Location $Stage
  npm ci --no-audit --no-fund
  npm run check
  npm run test:unit
  Pop-Location

  $Backup = "$InstallRoot.previous.$PID"
  if (Test-Path $InstallRoot) { Move-Item $InstallRoot $Backup }
  try {
    Move-Item $Stage $InstallRoot
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    @"
@echo off
node "$InstallRoot\bin\rapp-zoo-v2.mjs" %*
"@ | Set-Content -Encoding ASCII (Join-Path $BinDir "rapp-zoo-v2.cmd")
    if (-not (Test-Path (Join-Path $InstallRoot "package.json")) -or
        -not (Test-Path (Join-Path $BinDir "rapp-zoo-v2.cmd"))) {
      throw "Installed app or launcher validation failed."
    }
  } catch {
    if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
    if ($Backup -and (Test-Path $Backup)) {
      Move-Item $Backup $InstallRoot
    }
    throw
  }
  if ($Backup -and (Test-Path $Backup)) { Remove-Item $Backup -Recurse -Force }
  Write-Host "RAPP Zoo v2 installed. Run: rapp-zoo-v2 start"
} finally {
  if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
}
