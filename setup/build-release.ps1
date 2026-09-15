# Builds the two release files into local\release (also used by the GitHub
# release workflow):
#   RigBuddy-Setup.exe   PC installer (Inno Setup, setup\rigbuddy.iss)
#   RigBuddy.apk         Android app (release signing: see android\app\build.gradle)
#
#   powershell -ExecutionPolicy Bypass -File setup\build-release.ps1 -Version 0.1.0
#
# Needs setup\setup-pc.ps1 done (vendor\node, vendor\tm-maps), the Windows
# addons in pc\native\win-x64 (pc\native\build-addons.sh), Inno Setup 6 and,
# for the APK, JDK 17 + the Android SDK.
param(
  [Parameter(Mandatory)][string]$Version,
  [switch]$SkipApk,
  [switch]$SkipInstaller
)
. "$PSScriptRoot\lib.ps1"
$out = Join-Path $Root 'local\release'
$app = Join-Path $out 'app'
$node = Join-Path $Root 'vendor\node\node.exe'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "version must look like 1.2.3 (got '$Version')" }
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $app | Out-Null

if (-not $SkipInstaller) {
  Step 'Node services (setup\bundle.mjs -> dist)'
  foreach ($f in 'cityhash.node', 'gdeflate.node') {
    if (-not (Test-Path "$Root\pc\native\win-x64\$f")) { throw "pc\native\win-x64\$f missing: run pc/native/build-addons.sh (WSL or Linux)" }
  }
  Exec { & $node "$Root\setup\bundle.mjs" } 'bundle'

  Step 'PC app (self-contained, no .NET install needed)'
  Exec {
    dotnet publish "$Root\pc\host\RigBuddy.csproj" -c Release -o "$out\publish" --nologo -v q `
      -p:SelfContained=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
      -p:DebugType=none -p:Version=$Version
  } 'dotnet publish'

  Step 'stage files'
  Copy-Item "$out\publish\RigBuddy.exe" $app
  New-Item -ItemType Directory -Force "$app\node", "$app\plugin", "$app\licenses" | Out-Null
  Copy-Item $node "$app\node\"
  Copy-Item "$Root\dist" "$app\dist" -Recurse
  $dll = Get-ChildItem "$Root\vendor\scs-sdk-plugin" -Recurse -Filter 'scs-telemetry.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $dll) {
    $zip = Join-Path $out 'plugin.zip'
    Get-File $PluginUrl $zip
    Expand-Archive $zip "$out\plugin" -Force
    $dll = Get-ChildItem "$out\plugin" -Recurse -Filter 'scs-telemetry.dll' | Select-Object -First 1
  }
  Copy-Item $dll.FullName "$app\plugin\"
  Copy-Item "$Root\LICENSE" "$app\licenses\LICENSE.txt"
  Move-Item "$app\dist\THIRD-PARTY-LICENSES.txt" "$app\licenses\THIRD-PARTY-LICENSES.txt"
  Copy-Item (Join-Path (Split-Path $node) 'LICENSE') "$app\licenses\node.js-LICENSE.txt"
  # raw file, not the API: the API's anonymous rate limit is often used up on shared CI machines
  Get-File 'https://raw.githubusercontent.com/truckermudgeon/scs-sdk-plugin/HEAD/LICENSE' "$app\licenses\scs-sdk-plugin-LICENSE.txt"
  $size = (Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
  Write-Host ("  {0:N0} MB staged" -f $size)

  Step 'installer (Inno Setup)'
  $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) { throw 'Inno Setup 6 not found (winget install JRSoftware.InnoSetup)' }
  Exec { & $iscc /Q "/DAppVersion=$Version" "/DSourceDir=$app" "/DOutputDir=$out" "$Root\setup\rigbuddy.iss" } 'ISCC'
  Write-Host "  $out\RigBuddy-Setup.exe"
}

if (-not $SkipApk) {
  Step 'Android app (release APK)'
  $env:JAVA_HOME = Get-JavaHome
  $gradle = Join-Path $Root 'vendor\gradle\bin\gradle.bat'
  if (-not (Test-Path $gradle)) { $gradle = 'gradle' }
  $signed = (Test-Path "$Root\android\keystore.properties") -or $env:RIGBUDDY_KEYSTORE
  if (-not $signed) { Write-Warning 'no release keystore (android\keystore.properties): the APK is signed with the debug key, fine for testing only' }
  Push-Location "$Root\android"
  try { Exec { & $gradle assembleRelease "-PappVersion=$Version" -q --console=plain } 'gradle assembleRelease' } finally { Pop-Location }
  Copy-Item "$Root\android\app\build\outputs\apk\release\app-release.apk" "$out\RigBuddy.apk"
  Write-Host "  $out\RigBuddy.apk"
}

Get-ChildItem $out -File | ForEach-Object { '{0,-22} {1,8:N1} MB  sha256 {2}' -f $_.Name, ($_.Length / 1MB), (Get-FileHash $_.FullName).Hash.ToLower() }
