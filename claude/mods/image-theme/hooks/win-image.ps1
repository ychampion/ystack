# image-theme's picture work on Windows, with the System.Drawing that ships with Windows PowerShell.
#   pick                         a file dialog; prints the chosen path (nothing when cancelled)
#   swatch -In <img> -Out <bmp>  a 16x16 24-bit bitmap of the picture, for its palette
#   bake -In <img> -Out <jpg> -Tint '#rrggbb' -Veil 0.2 -Column 1
#                                the background: at most 2560 wide and 1 MiB, a light veil of the tint over all of it and,
#                                with -Column 1, a frosted column (blurred and tinted, soft at both sides) behind the chat
#   copy -In <file> -Out <file>  copies one file, making the folder
#   remove -In <file>            deletes one file
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [string]$In = '',
  [string]$Out = '',
  [string]$Tint = '#101420',
  [double]$Veil = 0.2,
  [int]$Column = 1
)
$ErrorActionPreference = 'Stop'
# Any failure: one plain line on stderr, for the mod to show as it is.
trap { $m = $_.Exception; while ($m.InnerException) { $m = $m.InnerException }; [Console]::Error.WriteLine(($m.Message -replace '^Exception calling .*?: "|"$', '')); exit 1 }

function Color-Of([string]$hex, [int]$alpha) {
  $h = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb($alpha, [Convert]::ToInt32($h.Substring(0, 2), 16), [Convert]::ToInt32($h.Substring(2, 2), 16), [Convert]::ToInt32($h.Substring(4, 2), 16))
}

# Opens a picture without locking it. GDI+ first; for what it can't read (WebP, HEIC, AVIF: it answers "Out of
# memory"), Windows Imaging Component, which uses every codec installed on the machine.
function Open-Picture([string]$path) {
  Add-Type -AssemblyName System.Drawing
  $bytes = [System.IO.File]::ReadAllBytes($path)
  try {
    return [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream (, $bytes)))
  } catch {
    Add-Type -AssemblyName PresentationCore, WindowsBase
    try {
      $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create((New-Object System.IO.MemoryStream (, $bytes)), 'IgnoreColorProfile', 'OnLoad')
    } catch {
      throw "Windows can't read this picture's format. Save it as JPEG or PNG, or install the codec for it (HEIF or AV1 Image Extensions from the Microsoft Store)."
    }
    $frame = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap ($decoder.Frames[0], [System.Windows.Media.PixelFormats]::Bgr24, $null, 0)
    $png = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $png.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($frame))
    $out = New-Object System.IO.MemoryStream
    $png.Save($out)
    $out.Position = 0
    return [System.Drawing.Image]::FromStream($out)
  }
}

function Save-Jpeg([System.Drawing.Bitmap]$bmp, [string]$path, [long]$quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $quality
  $bmp.Save($path, $codec, $params)
}

switch ($Mode) {
  'pick' {
    Add-Type -AssemblyName System.Windows.Forms
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.Title = 'Choose a picture for your Claude theme'
    $d.Filter = 'Pictures|*.jpg;*.jpeg;*.png;*.bmp;*.gif;*.tif;*.tiff|All files|*.*'
    $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }
    if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.FileName) }
    $owner.Dispose()
  }
  'swatch' {
    Add-Type -AssemblyName System.Drawing
    $src = Open-Picture $In
    try {
      $bmp = New-Object System.Drawing.Bitmap 16, 16, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = 'HighQualityBicubic'
      $g.DrawImage($src, 0, 0, 16, 16)
      $g.Dispose()
      New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
      $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Bmp)
      $bmp.Dispose()
    } finally { $src.Dispose() }
  }
  'bake' {
    Add-Type -AssemblyName System.Drawing
    $src = Open-Picture $In
    try {
      # EXIF orientation: turn the picture upright before anything else.
      if ($src.PropertyIdList -contains 0x0112) {
        switch ([int]$src.GetPropertyItem(0x0112).Value[0]) { 3 { $src.RotateFlip('Rotate180FlipNone') } 6 { $src.RotateFlip('Rotate90FlipNone') } 8 { $src.RotateFlip('Rotate270FlipNone') } }
      }
      $scale = [Math]::Min(1.0, [Math]::Min(2560.0 / $src.Width, 4096.0 / $src.Height))
      $w = [int][Math]::Max(1, [Math]::Round($src.Width * $scale)); $h = [int][Math]::Max(1, [Math]::Round($src.Height * $scale))
      $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'
      $g.DrawImage($src, 0, 0, $w, $h)
      # The veil over everything.
      $veilBrush = New-Object System.Drawing.SolidBrush (Color-Of $Tint ([int](255 * [Math]::Max(0, [Math]::Min(0.8, $Veil)))))
      $g.FillRectangle($veilBrush, 0, 0, $w, $h)
      $g.Dispose()
      if ($Column -eq 1) {
        # The frosted column: a wide blur, tinted, blended in per pixel with a weight that eases in from the column's
        # sides, so there is no edge and no seam.
        Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class ImageThemeFrost {
  static void Box(byte[] src, byte[] dst, int w, int h, int stride, int r, bool across) {
    int n = across ? w : h, lines = across ? h : w;
    for (int line = 0; line < lines; line++) {
      for (int c = 0; c < 3; c++) {
        int sum = 0;
        for (int i = -r; i <= r; i++) sum += src[Idx(Math.Max(0, Math.Min(n - 1, i)), line, c, stride, across)];
        for (int i = 0; i < n; i++) {
          dst[Idx(i, line, c, stride, across)] = (byte)(sum / (2 * r + 1));
          sum += src[Idx(Math.Min(n - 1, i + r + 1), line, c, stride, across)] - src[Idx(Math.Max(0, i - r), line, c, stride, across)];
        }
      }
    }
  }
  static int Idx(int i, int line, int c, int stride, bool across) { return across ? line * stride + i * 3 + c : i * stride + line * 3 + c; }
  public static void Frost(Bitmap bmp, int tr, int tg, int tb, double tintA, double peak) {
    int w = bmp.Width, h = bmp.Height;
    var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
    int stride = data.Stride; var orig = new byte[stride * h]; Marshal.Copy(data.Scan0, orig, 0, orig.Length);
    var a = (byte[])orig.Clone(); var b = new byte[orig.Length];
    int r = Math.Max(4, w / 48);
    for (int pass = 0; pass < 3; pass++) { Box(a, b, w, h, stride, r, true); Box(b, a, w, h, stride, r, false); }
    double x0 = .15 * w, x1 = .29 * w, x2 = .71 * w, x3 = .85 * w;
    for (int x = 0; x < w; x++) {
      double t = x <= x0 || x >= x3 ? 0 : x < x1 ? (x - x0) / (x1 - x0) : x > x2 ? (x3 - x) / (x3 - x2) : 1;
      double k = t * t * (3 - 2 * t) * peak;
      if (k <= 0) continue;
      for (int y = 0; y < h; y++) {
        int o = y * stride + x * 3;
        double fb = a[o] * (1 - tintA) + tb * tintA, fg = a[o + 1] * (1 - tintA) + tg * tintA, fr = a[o + 2] * (1 - tintA) + tr * tintA;
        orig[o] = (byte)(orig[o] * (1 - k) + fb * k); orig[o + 1] = (byte)(orig[o + 1] * (1 - k) + fg * k); orig[o + 2] = (byte)(orig[o + 2] * (1 - k) + fr * k);
      }
    }
    Marshal.Copy(orig, 0, data.Scan0, orig.Length); bmp.UnlockBits(data);
  }
}
'@
        $tc = Color-Of $Tint 255
        [ImageThemeFrost]::Frost($bmp, $tc.R, $tc.G, $tc.B, 0.42, 0.94)
      }
      New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
      foreach ($q in 86, 76, 66, 56) {
        Save-Jpeg $bmp $Out $q
        if ((Get-Item -LiteralPath $Out).Length -le 1000000) { break }
      }
      while ((Get-Item -LiteralPath $Out).Length -gt 1000000) {
        $nw = [int]($bmp.Width * 0.85); $nh = [int]($bmp.Height * 0.85)
        $smaller = New-Object System.Drawing.Bitmap $bmp, $nw, $nh
        $bmp.Dispose(); $bmp = $smaller
        Save-Jpeg $bmp $Out 66
      }
      [Console]::Out.Write("$($bmp.Width)x$($bmp.Height)")
      $bmp.Dispose()
    } finally { $src.Dispose() }
  }
  'copy' {
    New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
    Copy-Item -LiteralPath $In -Destination $Out -Force
  }
  'remove' {
    if (Test-Path -LiteralPath $In) { Remove-Item -LiteralPath $In -Force }
  }
  default { throw "unknown mode $Mode" }
}
