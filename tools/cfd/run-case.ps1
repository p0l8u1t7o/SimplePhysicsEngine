# 在 OpenFOAM 環境執行產生好的案例（OpenFOAM 是 GPL 的外部程式：這裡只呼叫它，不安裝、不內嵌、不複製它的任何檔案）。
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\cfd\run-case.ps1 -Case TEMP\cfd-cases\pv-row-wind            # 自動選 Docker 或 WSL，都沒有就印出步驟
#   ... -Mode docker -Cpus 4 -Import        # 指定 Docker、限制 4 核，跑完自動匯入成 results.cfdpack
#   ... -Mode wsl -Distro Ubuntu-24.04      # 指定 WSL 發行版（裡面要先裝好 OpenFOAM）
#   ... -Mode print                         # 只印出三種執行方式的指令
#   ... -DryRun                             # 偵測後只印出將要執行的指令
# 偵測：docker version（要能連到 Docker 引擎）、wsl -l -q（有發行版，且裡面找得到 OpenFOAM 的 etc/bashrc）。
# CPU：Docker 用 --cpus 限制整個容器；WSL 的上限要在 %UserProfile%\.wslconfig 設 processors（Windows 的 Job 上限管不到 WSL／Docker 的虛擬機）。
param(
    [Parameter(Mandatory = $true)][string]$Case,
    [ValidateSet('auto', 'docker', 'wsl', 'print')][string]$Mode = 'auto',
    [string]$Image = 'opencfd/openfoam-default:2412',
    [int]$Cpus = 0,
    [string]$Distro = '',
    [string]$Bashrc = '',
    [switch]$Import,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path (Join-Path $Case 'cfd-case.json'))) { throw "找不到 $Case\cfd-case.json：先用 gen-case.mjs 產生案例" }
$caseAbs = (Resolve-Path $Case).ProviderPath
$meta = Get-Content -Raw -Encoding UTF8 (Join-Path $caseAbs 'cfd-case.json') | ConvertFrom-Json
$nProcs = [int]$meta.solver.nProcs
if ($Cpus -le 0) { $Cpus = [Math]::Max(1, [int]([Environment]::ProcessorCount / 2)) }

# Allrun 不能有 CR（在 Windows 編輯過會出現）
$allrun = [IO.File]::ReadAllText((Join-Path $caseAbs 'Allrun'))
if ($allrun.Contains("`r")) { throw 'Allrun 含 Windows 換行（CR），Linux 無法執行；重新產生案例或轉成 LF' }
if ($nProcs -gt $Cpus) { Write-Warning "案例設定 $nProcs 個行程，但只給 $Cpus 核；可以重新產生案例（solver.nProcs）或加大 -Cpus" }

function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $null }
    try {
        $v = & docker version --format '{{.Server.Version}}' 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) { return [string]$v }
    } catch { }
    return $null
}

function Get-WslDistros {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return @() }
    $old = [Console]::OutputEncoding
    try {
        # wsl.exe 的輸出是 UTF-16LE
        [Console]::OutputEncoding = [Text.Encoding]::Unicode
        $list = & wsl.exe -l -q 2>$null
        if ($LASTEXITCODE -ne 0) { return @() }
        return @($list | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ -and $_ -notmatch '^docker-desktop' })
    } catch { return @() } finally { [Console]::OutputEncoding = $old }
}

function Find-WslBashrc([string]$d) {
    $probe = 'ls -1 /usr/lib/openfoam/openfoam*/etc/bashrc /opt/openfoam*/etc/bashrc $HOME/OpenFOAM/OpenFOAM-*/etc/bashrc 2>/dev/null | sort | tail -n 1'
    try {
        $r = & wsl.exe -d $d -e bash -lc $probe 2>$null
        if ($LASTEXITCODE -eq 0 -and $r) { return ([string]$r).Trim() }
    } catch { }
    return $null
}

function Show-Instructions {
    $wslPath = '/mnt/' + $caseAbs.Substring(0, 1).ToLower() + ($caseAbs.Substring(2) -replace '\\', '/')
    Write-Host ''
    Write-Host '== 執行方式（擇一）=='
    Write-Host ''
    Write-Host '1) Docker Desktop（建議；映像約 1～2 GB，第一次會下載）'
    Write-Host "   docker run --rm --cpus $Cpus -v `"${caseAbs}:/case`" -w /case -e OMPI_ALLOW_RUN_AS_ROOT=1 -e OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1 --entrypoint /bin/bash $Image -lc 'for f in /usr/lib/openfoam/openfoam*/etc/bashrc; do . `$f; break; done; bash ./Allrun'"
    Write-Host ''
    Write-Host '2) WSL2（Ubuntu 裡安裝 OpenFOAM.com：https://develop.openfoam.com/Development/openfoam/-/wikis/precompiled/debian）'
    Write-Host "   wsl -d <發行版> -e bash -lc `"source /usr/lib/openfoam/openfoam2412/etc/bashrc; cd '$wslPath'; bash ./Allrun`""
    Write-Host '   （/mnt/<磁碟> 上跑比較慢；大案例先複製到 WSL 自己的檔案系統，例如 ~/cases/，跑完把 postProcessing/ 與 log.* 複製回來）'
    Write-Host ''
    Write-Host '3) Linux 主機：把整個案例資料夾複製過去，在 OpenFOAM 環境裡執行 ./Allrun，跑完把 postProcessing/ 複製回來'
    Write-Host ''
    Write-Host "跑完後匯入：node `"$here\import-results.mjs`" `"$caseAbs`""
}

$docker = $null; $distros = @()
if ($Mode -eq 'auto' -or $Mode -eq 'docker') { $docker = Test-Docker }
if ($Mode -eq 'auto' -or $Mode -eq 'wsl') { $distros = Get-WslDistros }
Write-Host "案例：$caseAbs（$($meta.name)，$($meta.solver.application)，$nProcs 行程，粗估 $($meta.estimate.cells) 格）"
Write-Host ("Docker：" + $(if ($docker) { "引擎 $docker" } else { '沒有（或引擎沒啟動）' }))
Write-Host ("WSL：" + $(if ($distros.Count) { ($distros -join ', ') } else { '沒有發行版' }))

$use = $null
if ($Mode -eq 'docker' -or ($Mode -eq 'auto' -and $docker)) {
    if (-not $docker) { Show-Instructions; throw '指定 docker，但偵測不到 Docker 引擎' }
    $use = 'docker'
} elseif ($Mode -eq 'wsl' -or ($Mode -eq 'auto' -and $distros.Count)) {
    if (-not $distros.Count) { Show-Instructions; throw '指定 wsl，但沒有 WSL 發行版' }
    if (-not $Distro) { $Distro = $distros[0] }
    if (-not $Bashrc) { $Bashrc = Find-WslBashrc $Distro }
    if (-not $Bashrc) {
        if ($Mode -eq 'wsl') { Show-Instructions; throw "WSL 發行版 $Distro 裡找不到 OpenFOAM（etc/bashrc）；可用 -Bashrc 指定" }
        Write-Host "WSL 發行版 $Distro 裡找不到 OpenFOAM。"
    } else { $use = 'wsl' }
}

if (-not $use) { Show-Instructions; exit 0 }

$start = Get-Date
if ($use -eq 'docker') {
    $inner = 'for f in /usr/lib/openfoam/openfoam*/etc/bashrc; do . $f; break; done; bash ./Allrun'
    $dargs = @('run', '--rm', '--cpus', "$Cpus", '-v', "${caseAbs}:/case", '-w', '/case', '-e', 'OMPI_ALLOW_RUN_AS_ROOT=1', '-e', 'OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1', '--entrypoint', '/bin/bash', $Image, '-lc', $inner)
    Write-Host ("docker " + ($dargs -join ' '))
    if ($DryRun) { exit 0 }
    & docker image inspect $Image *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host "第一次使用，會下載映像 $Image（約 1～2 GB）" }
    & docker @dargs
    $code = $LASTEXITCODE
} else {
    $wslPath = (& wsl.exe -d $Distro -e wslpath -a ($caseAbs -replace '\\', '/')).Trim()
    $inner = "source $Bashrc; cd '$wslPath'; nice -n 10 bash ./Allrun"
    Write-Host "wsl -d $Distro -e bash -lc `"$inner`""
    if ($DryRun) { exit 0 }
    & wsl.exe -d $Distro -e bash -lc $inner
    $code = $LASTEXITCODE
}
$min = [Math]::Round(((Get-Date) - $start).TotalMinutes, 1)
Write-Host "Allrun 結束（$min 分鐘，結束碼 $code）；記錄檔在 $caseAbs\log.*"
if ($code -ne 0) { exit $code }

# Allrun 的 runApplication 失敗時不會讓整個腳本失敗：檢查求解器的記錄檔
$log = Join-Path $caseAbs ('log.' + $meta.solver.application)
if (-not (Test-Path $log)) { throw "沒有 $log：網格或求解器沒有跑起來，看 log.blockMesh、log.snappyHexMesh、log.checkMesh" }
$tail = Get-Content $log -Tail 5
if (-not ($tail -match '^End')) { Write-Warning "$log 沒有以 End 結束，可能發散或中斷" }

if ($Import) {
    & node (Join-Path $here 'import-results.mjs') $caseAbs
    exit $LASTEXITCODE
}
