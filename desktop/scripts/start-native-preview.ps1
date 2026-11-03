$ErrorActionPreference = 'Stop'
$previewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$previewExe = Join-Path $previewRoot 'desktop\src-tauri\target\debug\eureka.exe'
$previewLogs = Join-Path $previewRoot '.cache\native-preview'
try {
    if (-not (Test-Path -LiteralPath $previewExe -PathType Leaf)) {
        throw 'The desktop test executable is missing. It must be compiled first.'
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
