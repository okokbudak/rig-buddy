# Shared helpers for the setup / pipeline scripts (Windows PowerShell 5.1+).
# Dot-source it: . "$PSScriptRoot\..\setup\lib.ps1"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest crawls with the progress bar on
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path $PSScriptRoot -Parent # $PSScriptRoot is setup\ even when dot-sourced
$TmMapsRepo = 'https://github.com/truckermudgeon/maps.git'
$TmMapsRev = 'd56d0e3' # the patches in pc/patches/tm-maps apply on top of this
$GradleVersion = '8.14.5'
$PluginUrl = 'https://github.com/truckermudgeon/scs-sdk-plugin/releases/download/v1.12.1/build-windows-latest.zip'

function Step($msg) { Write-Host "`n=== $msg" -ForegroundColor Cyan }

# Runs a native command and throws if it exits non-zero.
function Exec([scriptblock]$Block, [string]$What) {
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

function Get-File([string]$Url, [string]$OutFile) {
  Write-Host "  download $Url"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
}

function Get-SteamPath {
  $p = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  if (-not $p) { $p = 'C:\Program Files (x86)\Steam' }
  return ($p -replace '/', '\')
}

# Finds ETS2 / ATS in every Steam library. Override with $env:ETS2_DIR / $env:ATS_DIR.
function Find-TruckSimGames {
  $steam = Get-SteamPath
  $libs = @($steam)
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) {
    $libs += Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' -AllMatches |
      ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' }
  }
  $found = @{ ETS2 = $env:ETS2_DIR; ATS = $env:ATS_DIR }
  foreach ($lib in ($libs | Select-Object -Unique)) {
    $e = Join-Path $lib 'steamapps\common\Euro Truck Simulator 2'
    $a = Join-Path $lib 'steamapps\common\American Truck Simulator'
    if (-not $found.ETS2 -and (Test-Path "$e\base.scs")) { $found.ETS2 = $e }
    if (-not $found.ATS -and (Test-Path "$a\base.scs")) { $found.ATS = $a }
  }
  return $found
}

# JDK 17 (Android build, sprite tool). Honors JAVA_HOME.
function Get-JavaHome {
  if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe")) { return $env:JAVA_HOME }
  $jdk = Get-ChildItem 'C:\Program Files\Microsoft', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Java' `
    -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($jdk) { return $jdk.FullName }
  throw 'JDK 17 not found. Install it (winget install Microsoft.OpenJDK.17) or set JAVA_HOME.'
}

function Get-AndroidSdk {
  foreach ($p in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk")) {
    if ($p -and (Test-Path "$p\platform-tools")) { return $p }
  }
  return $null
}

function Get-Adb {
  $sdk = Get-AndroidSdk
  if ($sdk) { return "$sdk\platform-tools\adb.exe" }
  $c = Get-Command adb -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  throw 'adb not found. Install Android SDK platform-tools (Android Studio, or winget install Google.PlatformTools).'
}

# D:\foo bar -> /mnt/d/foo bar
function ConvertTo-WslPath([string]$p) {
  $full = [IO.Path]::GetFullPath($p)
  return '/mnt/' + $full.Substring(0, 1).ToLower() + ($full.Substring(2) -replace '\\', '/')
}
