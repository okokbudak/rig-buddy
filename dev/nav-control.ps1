# Dot-source from dev scripts: Send-Nav 'status' / 'restart server' / 'stop telemetry' ...
# Talks to the running RigBuddy.exe on its control port (a GUI exe can't hand
# its output back to PowerShell, so scripts don't call `RigBuddy.exe --status`).
function Send-Nav([string]$Command) {
  try {
    $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 62845)
    $s = $c.GetStream()
    $w = New-Object IO.StreamWriter($s); $w.WriteLine($Command); $w.Flush()
    $reply = (New-Object IO.StreamReader($s)).ReadLine()
    $c.Close()
    return $reply
  } catch { return $null }
}
