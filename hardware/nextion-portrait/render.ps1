# Draws the Nextion pictures of the portrait Scania cluster from layout.json:
#   out\pictures\<id>_<page>_bg.png / _lit.png   (import into Nextion Editor in this id order)
#   out\preview\<page>.png                        (the page with sample values, for checking the design)
# Run "node layout.mjs" and "node preview-values.mjs" first.
param([string]$Dir = $PSScriptRoot)
Add-Type -AssemblyName System.Drawing
$L = [IO.File]::ReadAllText("$Dir\layout.json", [Text.Encoding]::UTF8) | ConvertFrom-Json
$V = [IO.File]::ReadAllText("$Dir\preview-values.json", [Text.Encoding]::UTF8) | ConvertFrom-Json
$ErrorActionPreference = 'Stop'
$PW = [int]$L.size[0]; $PH = [int]$L.size[1]
New-Item -ItemType Directory -Force "$Dir\out\pictures", "$Dir\out\preview" | Out-Null
Get-ChildItem "$Dir\out\pictures", "$Dir\out\preview" -Filter *.png | Remove-Item

function Col($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }
function NewCanvas { $b = [System.Drawing.Bitmap]::new([int]$PW, [int]$PH, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($b); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.Clear((Col $L.bg)); @($b, $g) }
function RRect($g, $brush, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  if (-not $r -or $r -le 0) { $g.FillRectangle($brush, [single]$x, [single]$y, [single]$w, [single]$h); return }
  $r = [Math]::Min($r, [Math]::Min($w, $h) / 2); $d = 2 * $r
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90); $p.CloseFigure()
  $g.FillPath($brush, $p); $p.Dispose()
}
function Text($g, [string]$text, [single]$x, [single]$y, $w, $h, [single]$px, $bold, $color, $align) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = New-Object System.Drawing.Font 'Arial', ([single]$px), $style, ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = switch ($align) { 'c' { 'Center' } 'r' { 'Far' } default { 'Near' } }
  $sf.LineAlignment = 'Center'; $sf.FormatFlags = 'NoWrap'; $sf.Trimming = 'None'
  if (-not $h) { $h = [Math]::Ceiling($px * 1.3) }
  if (-not $w) { $w = $PW - $x }
  $br = New-Object System.Drawing.SolidBrush (Col $color)
  $g.DrawString($text, $font, $br, (New-Object System.Drawing.RectangleF ([single]$x), ([single]$y), ([single]$w), ([single]$h)), $sf)
  $br.Dispose(); $font.Dispose()
}
function Icon($g, $name, [single]$x, [single]$y, $color) {
  $c = Col $color
  $pen = New-Object System.Drawing.Pen $c, 2; $br = New-Object System.Drawing.SolidBrush $c
  switch ($name) {
    'park' { $g.DrawEllipse($pen, $x + 2, $y + 2, 20, 20); Text $g 'P' $x ($y + 1) 24 22 14 $true $color 'c' }
    'battery' { $g.DrawRectangle($pen, $x + 2, $y + 7, 20, 13); $g.FillRectangle($br, $x + 5, $y + 4, 4, 3); $g.FillRectangle($br, $x + 15, $y + 4, 4, 3)
                $g.DrawLine($pen, $x + 6, $y + 13, $x + 10, $y + 13); $g.DrawLine($pen, $x + 14, $y + 13, $x + 18, $y + 13); $g.DrawLine($pen, $x + 16, $y + 11, $x + 16, $y + 15) }
    'air' { $g.DrawEllipse($pen, $x + 5, $y + 4, 14, 14); $g.DrawArc($pen, $x + 1, $y + 1, 22, 20, 120, 120); $g.DrawArc($pen, $x + 1, $y + 1, 22, 20, -60, 120)
            Text $g '!' $x ($y + 1) 24 20 12 $true $color 'c' }
    'fuel' { $g.DrawRectangle($pen, $x + 4, $y + 4, 10, 17); $g.FillRectangle($br, $x + 6, $y + 7, 6, 4); $g.DrawLine($pen, $x + 14, $y + 9, $x + 19, $y + 12); $g.DrawLine($pen, $x + 19, $y + 12, $x + 19, $y + 19) }
    'lowbeam' { $g.DrawArc($pen, $x + 10, $y + 4, 12, 16, -90, 180); $g.DrawLine($pen, $x + 16, $y + 4, $x + 16, $y + 20)
                foreach ($k in 0..2) { $g.DrawLine($pen, $x + 2, $y + 7 + $k * 5, $x + 10, $y + 10 + $k * 5) } }
    'highbeam' { $g.DrawArc($pen, $x + 10, $y + 4, 12, 16, -90, 180); $g.DrawLine($pen, $x + 16, $y + 4, $x + 16, $y + 20)
                 foreach ($k in 0..2) { $g.DrawLine($pen, $x + 2, $y + 7 + $k * 5, $x + 10, $y + 7 + $k * 5) } }
  }
  $pen.Dispose(); $br.Dispose()
}
function Draw($g, $items) {
  foreach ($it in $items) {
    switch ($it.t) {
      'text' { Text $g $it.text $it.x $it.y $it.w $null $it.s $it.b $it.c $it.a }
      'rect' { $br = New-Object System.Drawing.SolidBrush (Col $it.c); RRect $g $br $it.x $it.y $it.w $it.h $it.r; $br.Dispose() }
      'line' { $pen = New-Object System.Drawing.Pen (Col $it.c), ([single]$it.wd); $g.DrawLine($pen, [single]$it.x1, [single]$it.y1, [single]$it.x2, [single]$it.y2); $pen.Dispose() }
      'circle' {
        if ($it.fill) { $br = New-Object System.Drawing.SolidBrush (Col $it.c); $g.FillEllipse($br, [single]($it.cx - $it.r), [single]($it.cy - $it.r), [single](2 * $it.r), [single](2 * $it.r)); $br.Dispose() }
        else { $pen = New-Object System.Drawing.Pen (Col $it.c), ([single]$it.wd); $g.DrawEllipse($pen, [single]($it.cx - $it.r), [single]($it.cy - $it.r), [single](2 * $it.r), [single](2 * $it.r)); $pen.Dispose() } }
      'poly' { $br = New-Object System.Drawing.SolidBrush (Col $it.c); $pts = @($it.pts | % { New-Object System.Drawing.PointF ([single]$_[0]), ([single]$_[1]) }); $g.FillPolygon($br, $pts); $br.Dispose() }
      'image' { $f = Join-Path $Dir $it.file
        if (-not (Test-Path $f)) { Write-Warning "missing $($it.file) (see assets\README.md): that picture is left out" }
        else { $img = [System.Drawing.Image]::FromFile($f); $g.DrawImage($img, [int]$it.x, [int]$it.y, $img.Width, $img.Height); $img.Dispose() } }
      'icon' { Icon $g $it.name ([single]$it.x) ([single]$it.y) $it.c }
    }
  }
}

$FONTPX = @{}; $FONTB = @{}; foreach ($f in $L.fonts) { $FONTPX[[int]$f.id] = $f.px; $FONTB[[int]$f.id] = $f.bold }
foreach ($p in $L.pages) {
  $bg, $g = NewCanvas; Draw $g $p.bg; $g.Dispose()
  $bg.Save("$Dir\out\pictures\{0:D2}_$($p.name)_bg.png" -f $p.pic, [System.Drawing.Imaging.ImageFormat]::Png)
  $lit = $null
  if ($p.lit) { $lit = $bg.Clone(); $g = [System.Drawing.Graphics]::FromImage($lit); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; Draw $g $p.lit; $g.Dispose()
    $lit.Save("$Dir\out\pictures\{0:D2}_$($p.name)_lit.png" -f $p.litPic, [System.Drawing.Imaging.ImageFormat]::Png) }

  # preview: what Studio's xstr / xpic / fill commands will draw over the background
  $pv = $bg.Clone(); $g = [System.Drawing.Graphics]::FromImage($pv); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  foreach ($w in $p.widgets) {
    $val = $V | ? { $_.page -eq $p.name -and $_.id -eq $w.id } | Select -First 1
    switch ($w.k) {
      'lamp' { if ($val.value -and $lit) { $g.DrawImage($lit, (New-Object System.Drawing.Rectangle ([int]$w.x), ([int]$w.y), ([int]$w.w), ([int]$w.h)), [single]$w.x, [single]$w.y, [single]$w.w, [single]$w.h, ([System.Drawing.GraphicsUnit]::Pixel)) } }
      'bar' { $fw = [Math]::Round($w.w * $val.value / 100); if ($fw -gt 0) { $br = New-Object System.Drawing.SolidBrush (Col $val.color); $g.FillRectangle($br, [single]$w.x, [single]$w.y, [single]$fw, [single]$w.h); $br.Dispose() } }
      'text' { $color = if ($val.color) { $val.color } else { $w.color }
        Text $g $val.value $w.x $w.y $w.w $w.h ([Math]::Round($FONTPX[[int]$w.font] * 0.86)) $FONTB[[int]$w.font] $color $w.align }
    }
  }
  $g.Dispose(); $pv.Save("$Dir\out\preview\$($p.name).png", [System.Drawing.Imaging.ImageFormat]::Png); $pv.Dispose()
  $bg.Dispose(); if ($lit) { $lit.Dispose() }
}
Get-ChildItem "$Dir\out\pictures" | Select Name, Length | Format-Table -AutoSize | Out-String
