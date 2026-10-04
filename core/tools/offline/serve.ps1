# 離線展示用的本機網頁伺服器（網站壓縮檔附帶；不需要安裝任何軟體）。
# 由 open-demo.cmd 啟動：.\serve.ps1 -Page "<專案>/"。關掉這個視窗就會停止。
# ES 模組不能從 file:// 載入，所以要經過本機伺服器；只聽本機（localhost），外部連不進來。
param([string]$Page = '', [int]$Port = 0, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
if ($Port -eq 0) {
  $probe = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0
  $probe.Start(); $Port = $probe.LocalEndpoint.Port; $probe.Stop()
}
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'; '.gif' = 'image/gif'
  '.glb' = 'model/gltf-binary'; '.bin' = 'application/octet-stream'; '.mp4' = 'video/mp4'; '.woff2' = 'font/woff2'; '.txt' = 'text/plain; charset=utf-8'
}
$http = New-Object System.Net.HttpListener
$http.Prefixes.Add("http://localhost:$Port/")
$http.Start()
$url = "http://localhost:$Port/$Page"
Write-Host "展示網站：$url"
Write-Host '關掉這個視窗就會停止。'
if (-not $NoBrowser) { Start-Process $url }
while ($http.IsListening) {
  $ctx = $http.GetContext(); $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/')).Replace('/', '\')
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and $file.TrimEnd('\') + '\' -ne $root) { $res.StatusCode = 403 }
    elseif (Test-Path -LiteralPath $file -PathType Container) {
      if (-not $ctx.Request.Url.AbsolutePath.EndsWith('/')) { $res.StatusCode = 301; $res.RedirectLocation = $ctx.Request.Url.AbsolutePath + '/' }
      else { $file = Join-Path $file 'index.html' }
    }
    if ($res.StatusCode -eq 200) {
      if (Test-Path -LiteralPath $file -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($file); $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $res.ContentLength64 = $bytes.Length; $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $res.StatusCode = 404 }
    }
  } catch { try { $res.StatusCode = 500 } catch {} }
  finally { $res.Close() }
}
