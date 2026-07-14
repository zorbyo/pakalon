#!/usr/bin/env pwsh
# Pakalon CLI installer for Windows (PowerShell).
# Usage: irm https://pakalon.dev/install.ps1 | iex
#
# Environment variables:
#   $env:PAKALON_VERSION    Pin a specific version (default: latest)
#   $env:PAKALON_INSTALL    Install dir (default: $HOME\.local\bin)
#   $env:PAKALON_NO_ALIAS   If set, skip creating the `omp.exe` copy
#   $env:PAKALON_GITHUB     GitHub repo (default: pakalon/pakalon-cli)
#
# This script never touches PATH. It writes the binary to
# $env:PAKALON_INSTALL and prints a hint.

$ErrorActionPreference = "Stop"

$GITHUB_REPO = if ($env:PAKALON_GITHUB) { $env:PAKALON_GITHUB } else { "pakalon/pakalon-cli" }
$INSTALL_DIR = if ($env:PAKALON_INSTALL) { $env:PAKALON_INSTALL } else { Join-Path $HOME ".local\bin" }
$VERSION = if ($env:PAKALON_VERSION) { $env:PAKALON_VERSION } else { "latest" }
$SKIP_ALIAS = [bool]$env:PAKALON_NO_ALIAS

# Detect platform — Windows only, x64 and arm64.
$ARCH = $env:PROCESSOR_ARCHITECTURE
switch ($ARCH) {
	"AMD64" { $BIN_ARCH = "windows-x64" }
	"ARM64" { $BIN_ARCH = "windows-arm64" }
	default { Write-Error "pakalon: unsupported architecture: $ARCH"; exit 1 }
}
$ASSET = "pakalon-$BIN_ARCH.exe"

# Resolve the version → release tag.
if ($VERSION -eq "latest") {
	$apiUrl = "https://api.github.com/repos/$GITHUB_REPO/releases/latest"
	$release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "pakalon-cli" }
	$TAG = $release.tag_name
} else {
	$TAG = $VERSION
}

$URL = "https://github.com/$GITHUB_REPO/releases/download/$TAG/$ASSET"

# Make sure the install dir exists.
if (-not (Test-Path $INSTALL_DIR)) {
	New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
}

$target = Join-Path $INSTALL_DIR "pakalon.exe"
Write-Host "Installing pakalon $TAG ($BIN_ARCH) → $target"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
	$tmpAsset = Join-Path $tmp $ASSET
	Invoke-WebRequest -Uri $URL -OutFile $tmpAsset -UseBasicParsing
	Move-Item -Path $tmpAsset -Destination $target -Force
} finally {
	Remove-Item -Recurse -Force $tmp
}

# Backward-compat alias
if (-not $SKIP_ALIAS -and -not (Test-Path (Join-Path $INSTALL_DIR "omp.exe"))) {
	Copy-Item -Path $target -Destination (Join-Path $INSTALL_DIR "omp.exe")
	Write-Host "Created 'omp.exe' copy for backward compatibility."
}

Write-Host ""
Write-Host "✓ pakalon installed to $target"
Write-Host ""
$envPath = $env:PATH
if ($envPath -like "*$INSTALL_DIR*") {
	Write-Host "Run: pakalon --help"
} else {
	Write-Host "Add to PATH and run: `$env:PATH = '$INSTALL_DIR;' + `$env:PATH; pakalon --help"
}
