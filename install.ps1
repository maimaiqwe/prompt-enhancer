param(
    [switch]$NoStartup,
    [switch]$NoStart,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pool = Split-Path -Parent (Split-Path -Parent $here)
$sharedLayout = Test-Path -LiteralPath (Join-Path $pool "prompt-enhancer\SKILL.md")
$codexSkills = Join-Path $env:USERPROFILE ".codex\skills"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Prompt Enhancer Hotkey.lnk"
$watchdogSource = Join-Path $here "watchdog.cs"
$watchdogExe = Join-Path $here "watchdog.exe"
$pidPath = Join-Path $here "enhancer.pid"

function StopOwnedWatchdog {
    Get-Process -Name watchdog -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and $_.Path.StartsWith($here, [StringComparison]::OrdinalIgnoreCase)
        } |
        ForEach-Object { Stop-Process -Id $_.Id -Force }
}

function StopOwnedEnhancer {
    if (-not (Test-Path -LiteralPath $pidPath)) { return }
    try {
        $id = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "pythonw") {
            Stop-Process -Id $id -Force
        }
    } catch {}
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

if ($Uninstall) {
    StopOwnedWatchdog
    StopOwnedEnhancer
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
    }
    Write-Host "UNINSTALLED startup and running processes; config/log/api key kept"
    exit 0
}

if (-not [Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User")) {
    Write-Warning "DEEPSEEK_API_KEY is not set. The app starts, but enhancement will fail."
}

if ($sharedLayout -and (Test-Path -LiteralPath $codexSkills)) {
    Get-ChildItem -LiteralPath $pool -Directory | ForEach-Object {
        $link = Join-Path $codexSkills $_.Name
        if (-not (Test-Path -LiteralPath $link)) {
            cmd /c mklink /J "`"$link`"" "`"$($_.FullName)`"" | Out-Null
            Write-Host "LINK $link"
        }
    }
}

$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $watchdogExe) -or
    (Get-Item -LiteralPath $watchdogSource).LastWriteTimeUtc -gt (Get-Item -LiteralPath $watchdogExe).LastWriteTimeUtc) {
    if (-not (Test-Path -LiteralPath $compiler)) {
        throw "C# compiler not found: $compiler"
    }
    & $compiler /nologo /target:winexe /out:"$watchdogExe" "$watchdogSource"
    if ($LASTEXITCODE -ne 0) { throw "watchdog.exe compilation failed" }
    Write-Host "COMPILED $watchdogExe"
}

if (-not $NoStartup) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $here "run.cmd"
    $shortcut.WorkingDirectory = $here
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Ctrl+Shift+Alt+A prompt enhancer (starts with an agent)"
    $shortcut.Save()
    Write-Host "STARTUP $shortcutPath"
}

if (-not $NoStart) {
    Start-Process -FilePath $watchdogExe -WorkingDirectory $here -WindowStyle Hidden
    Write-Host "WATCHDOG_STARTED"
}
