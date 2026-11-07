<#
  停止 scripts\start.ps1 啟動的網頁：
    .\scripts\stop.ps1            全部停止（展示網站＋vs3d 介面，含介面的 3D 預覽與正在跑的代理）
    .\scripts\stop.ps1 -Site      只停展示網站
    .\scripts\stop.ps1 -Studio    只停 vs3d 介面
  也可以點兩下 scripts\stop.cmd。vs3d 正在跑的專案會被中斷，狀態已保存，之後在介面按「續跑」或執行 vs3d resume。
#>
param(
  [switch]$Site,
  [switch]$Studio
)
$Root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $Root 'logs\web.pids'
if (-not $Site -and -not $Studio) { $Site = $true; $Studio = $true }
$want = @(); if ($Site) { $want += 'site' }; if ($Studio) { $want += 'studio' }

$entries = @()
if (Test-Path $pidFile) {
  $entries = @(Get-Content $pidFile | Where-Object { $_ -match '^\w+ \d+ \d+$' } | ForEach-Object { $a = $_ -split ' '; [pscustomobject]@{ Name = $a[0]; Id = [int]$a[1]; Port = [int]$a[2] } })
}
$stopped = 0
# PID 檔可能是舊的（重開機或 node 當掉後 PID 被別的程式重用）：命令列要是本專案的 serve.mjs／vs3d.mjs 才停
function Test-Ours([int]$Id) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue
  return [bool]($p -and $p.CommandLine -and $p.CommandLine -match 'serve\.mjs|vs3d\.mjs')
}
foreach ($e in $entries | Where-Object { $want -contains $_.Name }) {
  if (-not (Get-Process -Id $e.Id -ErrorAction SilentlyContinue)) { continue }
  if (-not (Test-Ours $e.Id)) { Write-Host "PID $($e.Id) 已經不是 $($e.Name) 的程序（PID 檔過期），略過" -ForegroundColor Yellow; continue }
  if ($e.Name -eq 'studio') {
    try {
      $info = Invoke-RestMethod -Uri "http://127.0.0.1:$($e.Port)/api/info" -TimeoutSec 2
      if ($info.running) { Write-Host "注意：正在執行的專案 $($info.running.id)（$($info.running.cmd)）會被中斷，狀態已保存，之後可以續跑。" -ForegroundColor Yellow }
    } catch { }
  }
  # /T 連子程序一起停（node、介面的 3D 預覽伺服器、正在跑的代理）
  & taskkill /PID $e.Id /T /F 2>&1 | Out-Null
  Write-Host "已停止 $($e.Name)（PID $($e.Id)，port $($e.Port)）" -ForegroundColor Green
  $stopped++
}

# 保險：pid 檔不見或不準時，依命令列找本專案的程序
$patterns = @()
if ($Site) { $patterns += 'core\\tools\\serve\.mjs --port \d+ --no-open' }
if ($Studio) { $patterns += 'studio\\vs3d\.mjs ui' }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $cl = $_.CommandLine; $cl -and ($patterns | Where-Object { $cl -match $_ }) } | ForEach-Object {
  & taskkill /PID $_.ProcessId /T /F 2>&1 | Out-Null
  Write-Host "已停止殘留的程序 $($_.ProcessId)" -ForegroundColor Green
  $stopped++
}

$rest = @($entries | Where-Object { $want -notcontains $_.Name } | ForEach-Object { "$($_.Name) $($_.Id) $($_.Port)" })
if ($rest.Count) { $rest | Set-Content -Path $pidFile -Encoding ascii } elseif (Test-Path $pidFile) { Remove-Item $pidFile -Force }
if (-not $stopped) { Write-Host '沒有正在執行的網頁。' }
