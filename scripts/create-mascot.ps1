[CmdletBinding()]
param(
    [string]$SourcePath
)

if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    $SourcePath = Read-Host 'Enter the source image path'
}
if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    throw "Source image was not found: $SourcePath"
}

Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public\mori-wildman-transparent.png'))

Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class MoriMascotCutout
{
    public static void Create(string inputPath, string outputPath)
    {
        using (var original = new Bitmap(inputPath))
        {
        var width = original.Width;
        var height = original.Height;
        var rect = new Rectangle(0, 0, width, height);
        using (var source = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        using (var mask = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        using (var output = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        {
        using (var graphics = Graphics.FromImage(source))
        {
            graphics.DrawImage(original, rect, rect, GraphicsUnit.Pixel);
        }

        using (var graphics = Graphics.FromImage(mask))
        using (var path = new GraphicsPath())
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.Clear(Color.Transparent);
            path.AddBeziers(new[] {
                new PointF(270,55), new PointF(420,10), new PointF(850,8), new PointF(1015,75),
                new PointF(1165,135), new PointF(1200,290), new PointF(1212,455),
                new PointF(1240,650), new PointF(1228,870), new PointF(1140,1050),
                new PointF(1075,1190), new PointF(900,1250), new PointF(640,1263),
                new PointF(420,1268), new PointF(258,1220), new PointF(165,1120),
                new PointF(70,1010), new PointF(58,820), new PointF(55,650),
                new PointF(50,455), new PointF(90,278), new PointF(140,180),
                new PointF(175,105), new PointF(225,80), new PointF(270,55)
            });
            path.CloseFigure();
            graphics.FillPath(Brushes.White, path);
        }

        var sourceData = source.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var maskData = mask.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var pixelCount = Math.Abs(sourceData.Stride) * height;
        var pixels = new byte[pixelCount];
        var maskPixels = new byte[pixelCount];
        Marshal.Copy(sourceData.Scan0, pixels, 0, pixelCount);
        Marshal.Copy(maskData.Scan0, maskPixels, 0, pixelCount);
        source.UnlockBits(sourceData);
        mask.UnlockBits(maskData);

        for (var index = 0; index < pixelCount; index += 4)
            pixels[index + 3] = (byte)((pixels[index + 3] * maskPixels[index + 3] + 127) / 255);

        var outputData = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(pixels, 0, outputData.Scan0, pixelCount);
        output.UnlockBits(outputData);
        output.Save(outputPath, ImageFormat.Png);
        }
        }
    }
}
'@

[MoriMascotCutout]::Create($sourcePath, $outputPath)
