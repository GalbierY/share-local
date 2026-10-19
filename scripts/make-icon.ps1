Add-Type -AssemblyName System.Drawing
$iconTarget = Join-Path $PSScriptRoot '../src/assets/icon.ico'
$iconFrames = @()
foreach ($iconSize in @(16, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($iconSize / 256.0, $iconSize / 256.0)
    $background = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#33283F'))
    $foreground = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#DBB8E2'))
    $graphics.FillEllipse($background, 0, 0, 256, 256)
    $graphics.FillEllipse($foreground, 43, 76, 39, 55)
    $graphics.FillEllipse($foreground, 88, 43, 39, 56)
    $graphics.FillEllipse($foreground, 137, 49, 39, 56)
    $graphics.FillEllipse($foreground, 179, 84, 34, 51)
    $graphics.FillEllipse($foreground, 73, 110, 110, 92)
    $memory = New-Object System.IO.MemoryStream
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $iconFrames += ,@{ Size = $iconSize; Bytes = $memory.ToArray() }
    $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $background.Dispose(); $foreground.Dispose()
}
$stream = [System.IO.File]::Create($iconTarget)
$writer = New-Object System.IO.BinaryWriter($stream)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$iconFrames.Count)
    $iconOffset = 6 + 16 * $iconFrames.Count
    foreach ($frame in $iconFrames) {
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$iconOffset)
        $iconOffset += $frame.Bytes.Length
    }
    foreach ($frame in $iconFrames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $stream.Dispose() }
Write-Output 'Ícone de patinha gerado.'
