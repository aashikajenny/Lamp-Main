# WebP converter server: serves lamp-main on http://localhost:5560 and saves the WebP files
# that tools/webp.html encodes in the browser (POST /save?path=images/...webp).
# Only .webp files inside lamp-main/images, and the design list images/designs/designs.json, can be written;
# a converted design's original goes to the Recycle Bin, so images/designs ends up holding only WebP files.
Add-Type -AssemblyName Microsoft.VisualBasic # for sending replaced originals to the Recycle Bin
$root = Split-Path -Parent $PSScriptRoot
$images = Join-Path $root "images"
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:5560/")
$l.Start()
Write-Host "WebP tool on http://localhost:5560/tools/webp.html"
$types = @{ ".html"="text/html"; ".css"="text/css"; ".js"="application/javascript"; ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".webp"="image/webp"; ".json"="application/json" }
while ($l.IsListening) {
  $ctx = $l.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  $res.Headers.Add("Cache-Control", "no-store")
  try {
    $p = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ($req.HttpMethod -eq "POST" -and $p -eq "save") {
      $rel = $req.QueryString["path"]
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      $manifest = Join-Path (Join-Path $images "designs") "designs.json"
      if (-not $full.StartsWith($images + [IO.Path]::DirectorySeparatorChar) -or ([IO.Path]::GetExtension($full) -ne ".webp" -and $full -ne $manifest)) {
        $res.StatusCode = 403
      } else {
        $ms = New-Object IO.MemoryStream
        $req.InputStream.CopyTo($ms)
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($full)) | Out-Null
        [IO.File]::WriteAllBytes($full, $ms.ToArray())
        Write-Host "saved $rel ($([int]($ms.Length / 1KB)) KB)"
        $res.StatusCode = 200
      }
    } elseif ($req.HttpMethod -eq "POST" -and $p -eq "recycle") {
      # once a design's WebP is saved, its original (.jpg/.jpeg/.png in images/designs) goes to the
      # Recycle Bin, so the folder holds only the WebP and the original can still be restored
      $rel = $req.QueryString["path"]
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      $ok = $full.StartsWith((Join-Path $images "designs") + "\") -and @(".jpg", ".jpeg", ".png") -contains [IO.Path]::GetExtension($full).ToLower()
      if ($ok -and (Test-Path $full -PathType Leaf)) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($full, 'OnlyErrorDialogs', 'SendToRecycleBin')
        Write-Host "recycled $rel"
        $res.StatusCode = 200
      } else { $res.StatusCode = 403 }
    } elseif ($req.HttpMethod -eq "POST" -and $p -eq "prune") {
      # delete the .webp files in images/<dir> that aren't in the posted list (left by removed or
      # renamed images); only .webp files, which the converter makes, are ever deleted
      $dir = Join-Path $images ($req.QueryString["dir"] -replace '[\\/.]', '')
      $keep = (New-Object IO.StreamReader($req.InputStream)).ReadToEnd() | ConvertFrom-Json
      $gone = @()
      if (Test-Path $dir) {
        Get-ChildItem $dir -File -Filter *.webp | ? { $keep -notcontains $_.Name } | % { Remove-Item $_.FullName; $gone += $_.Name; Write-Host "removed images/$($req.QueryString["dir"])/$($_.Name)" }
      }
      $b = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $gone -Compress))
      $res.ContentType = "application/json"
      $res.OutputStream.Write($b, 0, $b.Length)
    } elseif ($p -eq "list") {
      # the .jpg/.png/.webp files in images/<dir> with when each was last changed, as JSON
      $dir = Join-Path $images ($req.QueryString["dir"] -replace '[\\/.]', '')
      $names = @(if (Test-Path $dir) { Get-ChildItem $dir -File | ? { @(".jpg", ".jpeg", ".png", ".webp") -contains $_.Extension.ToLower() } | % { @{ name = $_.Name; mtime = [long]($_.LastWriteTimeUtc - [datetime]'1970-01-01').TotalMilliseconds } } })
      $b = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $names -Compress))
      $res.ContentType = "application/json"
      $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      if ($p -eq "") { $p = "index.html" }
      $f = Join-Path $root $p
      if (Test-Path $f -PathType Leaf) {
        $b = [IO.File]::ReadAllBytes($f)
        $ext = [IO.Path]::GetExtension($f)
        $res.ContentType = if ($types[$ext]) { $types[$ext] } else { "application/octet-stream" }
        $res.OutputStream.Write($b, 0, $b.Length)
      } else { $res.StatusCode = 404 }
    }
  } catch { $res.StatusCode = 500; Write-Host $_ }
  $res.Close()
}
