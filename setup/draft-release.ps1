# Turns the release workflow's build of a tag into a draft GitHub release,
# created with your own GitHub account (so the release shows you, not a bot).
# Publish the draft on the Releases page after a look.
#
#   powershell -ExecutionPolicy Bypass -File setup\draft-release.ps1 -Version 1.2.3 [-NotesFile notes.md]
#
# Needs the GitHub CLI, signed in once: winget install GitHub.cli; gh auth login
param(
  [Parameter(Mandatory)][string]$Version,
  [string]$NotesFile
)
. "$PSScriptRoot\lib.ps1"
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\GitHub.cli_*\bin\gh.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
if (-not $gh) { throw 'GitHub CLI not found: winget install GitHub.cli, then gh auth login' }
$repo = (git -C $Root remote get-url origin) -replace '^https://github.com/', '' -replace '\.git$', ''
$tag = "v$Version"

Step "build of $tag"
$run = & $gh run list -R $repo --workflow release.yml --branch $tag --status success -L 1 --json databaseId --jq '.[0].databaseId'
if (-not $run) { throw "no successful release workflow run for $tag yet (Actions tab)" }
$dir = Join-Path $Root "local\release-$Version"
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
Exec { & $gh run download $run -R $repo -n "rig-buddy-$Version" -D $dir } 'gh run download'
$files = 'RigBuddy-Setup.exe', 'RigBuddy.apk' | ForEach-Object { Join-Path $dir $_ }
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "missing in the build: $f" } }

Step "draft release $tag"
$notes = if ($NotesFile) { @('--notes-file', $NotesFile) } else { @('--generate-notes') }
Exec { & $gh release create $tag @files -R $repo --draft --verify-tag --title "Rig Buddy $Version" @notes } 'gh release create'
Write-Host "draft ready: https://github.com/$repo/releases (publish it there)" -ForegroundColor Green
