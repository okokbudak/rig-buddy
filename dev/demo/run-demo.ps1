# Demo mode for screenshots: Rig Buddy (dev build, bin\RigBuddy.exe) with a
# made-up profile and a truck driving Berlin -> Hamburg, without the game.
#   - make-demo-save.mjs: your newest save with the personal parts replaced
#   - demo-telemetry.mjs: telemetry frames, played into the game plugin's
#     shared memory (Local\SCSTelemetry), which RigBuddy.exe reads as usual
#   - media.json: shown as "now playing" instead of this PC's media, and a
#     sample LAN address in the PC window (the app itself still connects)
# Runs until -Minutes are over; the game must not be running.
#
#   powershell -ExecutionPolicy Bypass -File dev\demo\run-demo.ps1 [-Minutes 20] [-Start 0.55]
#   -Start: where on the Berlin -> Hamburg recording the truck starts (0..1)
param([int]$Minutes = 20, [double]$Start = 0.55)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath("$PSScriptRoot\..\..")
$node = "$root\vendor\node\node.exe"
$demo = "$root\local\demo"
if (Get-Process eurotrucks2, amtrucks -ErrorAction SilentlyContinue) { throw 'close the game first' }

& $node "$PSScriptRoot\make-demo-save.mjs" "$demo\steam"
& $node "$PSScriptRoot\demo-telemetry.mjs" "$demo\telemetry.bin" ([string]$Start).Replace(',', '.')
if ($LASTEXITCODE -ne 0) { throw 'demo data failed' }

# Rig Buddy with the demo save (the agent inherits STEAM_PATH)
if (Get-Process RigBuddy -ErrorAction SilentlyContinue) {
  & "$root\bin\RigBuddy.exe" --quit | Out-Null
  Get-Process RigBuddy -ErrorAction SilentlyContinue | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
}
$env:STEAM_PATH = "$demo\steam"
$env:RIGBUDDY_DEMO_MEDIA = "$PSScriptRoot\media.json" # not what this PC is playing
$env:RIGBUDDY_DEMO_ADDRESS = '192.168.1.50'           # shown instead of this PC's address
Start-Process "$root\bin\RigBuddy.exe"

$size = 21600
$frames = [IO.File]::ReadAllBytes("$demo\telemetry.bin")
$count = $frames.Length / $size
$mmf = [IO.MemoryMappedFiles.MemoryMappedFile]::CreateNew('Local\SCSTelemetry', 32 * 1024)
$view = $mmf.CreateViewAccessor()
Write-Host "playing $count frames for $Minutes min (Ctrl+C to stop)"
try {
  $end = (Get-Date).AddMinutes($Minutes)
  $i = 0
  while ((Get-Date) -lt $end) {
    # drives to the end of the recording, then stands there (no jump back: the route stays valid)
    $view.WriteArray(0, $frames, [Math]::Min($i, $count - 1) * $size, $size)
    $i++
    Start-Sleep -Milliseconds 500
  }
} finally {
  $view.Dispose()
  $mmf.Dispose()
  Write-Host 'demo telemetry stopped; restart Rig Buddy to leave the demo save'
}
