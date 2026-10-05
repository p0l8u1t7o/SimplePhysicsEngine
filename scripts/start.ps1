<#
  啟動本機網頁（Windows PowerShell 5.1 以上）：
    .\scripts\start.ps1                                  vs3d 介面（8780），並開瀏覽器（不帶參數的預設）
    .\scripts\start.ps1 -Site                            只開展示網站（8770，各站首頁與模型目錄）
    .\scripts\start.ps1 -All                             展示網站＋ vs3d 介面都開
    .\scripts\start.ps1 -Studio                          只開 vs3d 介面（和不帶參數相同；可以和 -Site、-Station 一起用）
    .\scripts\start.ps1 -Station MilitaryGradePC         開展示網站並直接打開某一站（名稱可以只打開頭，不分大小寫）
    .\scripts\start.ps1 -Studio -Workspace D:\3D-Studio  vs3d 介面改用指定的工作區（預設 Documents\3D-Studio）
  也可以點兩下 scripts\start.cmd（參數相同，例如 scripts\start.cmd -Station shutter）。
  選項：-SitePort 8770、-StudioPort 8780、-NoOpen（不開瀏覽器）、-Rebuild（重新建置 vs3d 介面）
  停止：.\scripts\stop.ps1（或 scripts\stop.cmd）。輸出記錄在 logs\（不進版控）。
#>
param(
  [switch]$Site,
  [switch]$Studio,
  [switch]$All,
  [string]$Station = '',
  [string]$Workspace = '',
  [int]$SitePort = 8770,
  [int]$StudioPort = 8780,
  [switch]$NoOpen,
  [switch]$Rebuild
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot      # 本檔在 scripts\，專案根目錄在上一層
Set-Location $Root
$logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$pidFile = Join-Path $logs 'web.pids'

function Fail([string]$Message) { Write-Host $Message -ForegroundColor Red; exit 1 }
function Test-Port([int]$Port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $c.Close() }
}
function Wait-Port([int]$Port, [int]$Seconds = 30) {
  for ($i = 0; $i -lt $Seconds * 4; $i++) { if (Test-Port $Port) { return $true }; Start-Sleep -Milliseconds 250 }
  return $false
}
# web.pids 每行：名稱 PID port（stop.ps1 依這個檔停止）
function Read-Pids {
  if (-not (Test-Path $pidFile)) { return @() }
  return @(Get-Content $pidFile | Where-Object { $_ -match '^\w+ \d+ \d+$' } | ForEach-Object { $a = $_ -split ' '; [pscustomobject]@{ Name = $a[0]; Id = [int]$a[1]; Port = [int]$a[2] } })
}
function Save-Pid([string]$Name, [int]$Id, [int]$Port) {
  $rest = @(Read-Pids | Where-Object { $_.Name -ne $Name } | ForEach-Object { "$($_.Name) $($_.Id) $($_.Port)" })
  ($rest + "$Name $Id $Port") | Set-Content -Path $pidFile -Encoding ascii
}
function Get-Running([string]$Name) {
  $p = Read-Pids | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
  if ($p -and (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) -and (Test-Port $p.Port)) { return $p }
  return $null
}
# 用 cmd /c 啟動並把輸出導到 logs\（Start-Process 在 PS 5.1 不幫參數加引號，路徑一律加引號）
function Start-Node([string]$Name, [string]$Arguments, [int]$Port) {
  $log = Join-Path $logs "$Name.log"
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c node $Arguments > `"$log`" 2>&1" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  if (-not (Wait-Port $Port)) {
    & taskkill /PID $p.Id /T /F 2>&1 | Out-Null
    Fail "$Name 沒有在 $Port 啟動，請看 $log"
  }
  Save-Pid $Name $p.Id $Port
  return $p
}

# ---------------------------------------------------------------- 要開哪些
if ($Station) { $Site = $true }
if ($All) { $Site = $true; $Studio = $true }
if (-not $Site -and -not $Studio) { $Studio = $true }      # 不帶參數：只開 vs3d 介面
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail '找不到 node（需要 Node.js 22 以上）。先執行 scripts\setup.ps1 檢查環境。' }

$stationPath = ''
if ($Station) {
  $stations = @(Get-ChildItem -Directory (Join-Path $Root 'project-site') | Where-Object { Test-Path (Join-Path $_.FullName 'web\index.html') } | ForEach-Object { $_.Name })
  $hit = $stations | Where-Object { $_ -ieq $Station } | Select-Object -First 1
  if (-not $hit) { $hit = $stations | Where-Object { $_ -ilike "$Station*" } | Select-Object -First 1 }
  if (-not $hit) { Fail "找不到專案「$Station」（可用：$($stations -join '、')）" }
  $stationPath = [uri]::EscapeDataString($hit) + '/'
}

$urls = @()
# ---------------------------------------------------------------- 展示網站
if ($Site) {
  $url = "http://127.0.0.1:$SitePort/$stationPath"
  if (Get-Running 'site') { Write-Host "展示網站已在執行：http://127.0.0.1:$SitePort/" -ForegroundColor Cyan }
  elseif (Test-Port $SitePort) { Fail "port $SitePort 已被其他程式使用；可用 -SitePort 換一個，或先執行 scripts\stop.ps1" }
  else {
    $p = Start-Node 'site' "core\tools\serve.mjs --port $SitePort --no-open" $SitePort
    Write-Host "展示網站：http://127.0.0.1:$SitePort/（PID $($p.Id)）" -ForegroundColor Green
  }
  $urls += $url
}

# ---------------------------------------------------------------- vs3d 介面
if ($Studio) {
  if (Get-Running 'studio') { Write-Host "vs3d 介面已在執行：http://127.0.0.1:$StudioPort/" -ForegroundColor Cyan }
  elseif (Test-Port $StudioPort) { Fail "port $StudioPort 已被其他程式使用；可用 -StudioPort 換一個，或先執行 scripts\stop.ps1" }
  else {
    $ui = Join-Path $Root 'studio\ui'
    if ($Rebuild -or -not (Test-Path (Join-Path $ui 'dist\index.html'))) {
      if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail '找不到 npm，無法建置 vs3d 介面（Node.js 安裝時會附 npm）。' }
      if (-not (Test-Path (Join-Path $ui 'node_modules'))) {
        Write-Host '安裝 vs3d 介面的套件（第一次，只裝在 studio\ui）…'
        & npm --prefix "$ui" install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Fail "npm install 失敗（離開碼 $LASTEXITCODE），請看上方訊息" }
      }
      Write-Host '建置 vs3d 介面…'
      & npm --prefix "$ui" run build
      if ($LASTEXITCODE -ne 0) { Fail "建置失敗（離開碼 $LASTEXITCODE），請看上方訊息" }
    }
    $ws = if ($Workspace) { " --workspace `"$Workspace`"" } else { '' }
    $p = Start-Node 'studio' "studio\vs3d.mjs ui --port $StudioPort --no-open$ws" $StudioPort
    Write-Host "vs3d 介面：http://127.0.0.1:$StudioPort/（PID $($p.Id)）" -ForegroundColor Green
  }
  $urls += "http://127.0.0.1:$StudioPort/"
}

if (-not $NoOpen) { foreach ($u in $urls) { Start-Process $u } }
Write-Host "輸出記錄：$logs\$(if ($Site -and $Studio) { 'site.log、studio.log' } elseif ($Site) { 'site.log' } else { 'studio.log' })"
Write-Host '停止：scripts\stop.cmd（或 .\scripts\stop.ps1）'
