param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$previewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$previewExe = Join-Path $previewRoot 'desktop\src-tauri\target\debug\eureka.exe'
$previewLogs = Join-Path $previewRoot '.cache\native-preview'
try {
    $nativeRoot = Join-Path $previewRoot 'desktop\src-tauri'
    $nativeSources = @(Get-ChildItem -LiteralPath (Join-Path $nativeRoot 'src') -Recurse -File)
    foreach ($name in @('Cargo.toml', 'Cargo.lock', 'build.rs', 'tauri.conf.json', 'tauri.dev.conf.json')) {
        $source = Join-Path $nativeRoot $name
        if (Test-Path -LiteralPath $source -PathType Leaf) { $nativeSources += Get-Item -LiteralPath $source }
    }
    $nativeSources += @(Get-ChildItem -LiteralPath (Join-Path $nativeRoot 'capabilities') -Recurse -File -ErrorAction SilentlyContinue)
    $latestSource = $nativeSources | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    $executable = Get-Item -LiteralPath $previewExe -ErrorAction SilentlyContinue
    $needsBuild = -not $executable -or $latestSource.LastWriteTimeUtc -gt $executable.LastWriteTimeUtc
    if ($CheckOnly) {
        [pscustomobject]@{ needsBuild = $needsBuild; executable = $previewExe; executableTime = if ($executable) { $executable.LastWriteTimeUtc.ToString('o') } else { $null }; latestSource = $latestSource.FullName; sourceTime = $latestSource.LastWriteTimeUtc.ToString('o') } | ConvertTo-Json -Compress
        exit 0
    }
    $probe = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $probe.ConnectAsync('127.0.0.1', 8080)
        if (-not $connect.Wait(2000) -or -not $probe.Connected) {
            throw 'The development server is not running. Run npm run dev in E:\Eureka first.'
        }
    } catch {
        throw 'Cannot connect to the development server at 127.0.0.1:8080. Run npm run dev in E:\Eureka first.'
    } finally { $probe.Dispose() }
    if ($needsBuild) {
        $oldPreview = @(Get-Process -Name eureka -ErrorAction SilentlyContinue | Where-Object { [string]::Equals($_.Path, $previewExe, [System.StringComparison]::OrdinalIgnoreCase) })
        if ($oldPreview.Count -gt 0) {
            throw "The native test application is outdated and still running (PID $($oldPreview.Id -join ', ')). Close its desktop window, then run this launcher again to compile the current source."
        }
        if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Rust cargo is missing. Install the desktop build prerequisites before running this launcher.' }
        Write-Host 'Native source changed. Compiling the desktop test application (no release or installer)...'
        $previousTauriConfig = $env:TAURI_CONFIG
        try {
            $env:TAURI_CONFIG = Get-Content -LiteralPath (Join-Path $nativeRoot 'tauri.dev.conf.json') -Raw
            & cargo build --offline --locked --manifest-path (Join-Path $nativeRoot 'Cargo.toml') --target-dir (Join-Path $nativeRoot 'target')
            if ($LASTEXITCODE -ne 0) { throw 'Native test compilation failed. The old executable was not started.' }
        } finally {
            if ($null -eq $previousTauriConfig) { Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue } else { $env:TAURI_CONFIG = $previousTauriConfig }
        }
        if (-not (Test-Path -LiteralPath $previewExe -PathType Leaf)) { throw 'Compilation did not produce the desktop test executable.' }
    }
    New-Item -ItemType Directory -Path $previewLogs -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $previewLogs "$stamp.stdout.log"
    $stderr = Join-Path $previewLogs "$stamp.stderr.log"
    $env:EUREKA_DEV_URL = 'http://127.0.0.1:8080'
    Write-Host 'Starting the Eureka desktop test application...'
    # This is an interactive application. Hidden startup can suppress the
    # first native ShowWindow call, leaving only a background process.
    $previewProcess = Start-Process -FilePath $previewExe -WorkingDirectory $previewRoot -WindowStyle Normal -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    # Keep the process handle open so Windows PowerShell retains ExitCode even
    # when the single-instance launcher exits immediately.
    $null = $previewProcess.Handle
    if ($previewProcess.WaitForExit(4000)) {
        if ($previewProcess.ExitCode -ne 0) {
            Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue | Write-Host
            throw "Eureka exited with code $($previewProcess.ExitCode). Logs: $previewLogs"
        }
    }
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $visiblePreview = Get-Process -Name eureka -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -eq $previewExe -and $_.MainWindowHandle -ne 0
        } | Select-Object -First 1
        if ($visiblePreview) {
            Write-Host "Eureka window is ready (PID $($visiblePreview.Id)). Logs: $previewLogs"
            exit 0
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue | Write-Host
    throw "Eureka did not show a window. Logs: $previewLogs"
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
