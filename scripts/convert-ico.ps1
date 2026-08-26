Add-Type -AssemblyName System.Drawing
$srcPath = "C:\temp\icon\src.jpg"
$outPath = "C:\temp\icon\icon.ico"
$src = [System.Drawing.Image]::FromFile($srcPath)
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($src, 0, 0, 256, 256)
$g.Dispose()

# 用 GetHicon + Icon.Save 创建 ICO
$hicon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$fs = [System.IO.File]::OpenWrite($outPath)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
$src.Dispose()
Write-Output "ICO created at $outPath"
