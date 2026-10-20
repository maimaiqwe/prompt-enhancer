param(
    [string]$InstallDir,
    [string]$PythonPath,
    [ValidateSet("Skill", "Hotkey", "Bundle")]
    [string]$Mode = "Bundle",
    [string]$SkillsDir,
    [switch]$NoStartup,
    [switch]$NoStart,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($InstallDir) {
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
} else {
    $InstallDir = $here
}
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Prompt Enhancer Hotkey.lnk"
$watchdogSource = Join-Path $InstallDir "watchdog.cs"
$watchdogExe = Join-Path $InstallDir "watchdog.exe"
$pidPath = Join-Path $InstallDir "enhancer.pid"

function Resolve-Pythonw {
    param([string]$Requested)
    if ($Requested) {
        $resolved = [IO.Path]::GetFullPath($Requested)
        if (Test-Path -LiteralPath $resolved) { return $resolved }
        throw "Python path not found: $resolved"
    }
    $candidates = @(
        (Join-Path $InstallDir "pythonw.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\pythonw.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\pythonw.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python310\pythonw.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $command = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "pythonw.exe not found; pass -PythonPath or install Python 3.10+"
}

function Sync-InstallDir {
    if ($InstallDir -eq $here) { return }
    if ($Mode -eq "Skill") { return }
    if (-not (Test-Path -LiteralPath $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    $items = @(
        "enhance_hotkey.py", "watchdog.cs", "run.cmd",
        "install.ps1", "LICENSE", "README.md"
    )
    foreach ($item in $items) {
        $source = Join-Path $here $item
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination $InstallDir -Force
        }
    }
    $directories = if ($Mode -eq "Bundle") { @("core", "skills") } else { @("core") }
    foreach ($directoryName in $directories) {
        $source = Join-Path $here $directoryName
        if (-not (Test-Path -LiteralPath $source)) { continue }
        $target = Join-Path $InstallDir $directoryName
        if (-not (Test-Path -LiteralPath $target)) {
            Copy-Item -LiteralPath $source -Destination $InstallDir -Recurse -Force
        } else {
            Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
        }
    }
}

function StopOwnedWatchdog {
    Get-Process -Name watchdog -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and (
                [string]::Equals($_.Path, $watchdogExe, [StringComparison]::OrdinalIgnoreCase) -or
                $_.Path.StartsWith(
                    $InstallDir.TrimEnd("\") + "\",
                    [StringComparison]::OrdinalIgnoreCase
                )
            )
        } |
        ForEach-Object { Stop-Process -Id $_.Id -Force }
}

function StopOwnedEnhancer {
    if (-not (Test-Path -LiteralPath $pidPath)) { return }
    try {
        $raw = (Get-Content -LiteralPath $pidPath -Raw).Trim()
        $id = 0
        $scriptPath = ""
        if ($raw.StartsWith("{")) {
            $state = $raw | ConvertFrom-Json
            $id = [int]$state.pid
            $scriptPath = [string]$state.script_path
        } else {
            $id = [int]$raw
        }
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        $owned = $proc -and $proc.ProcessName -eq "pythonw"
        if ($owned -and $scriptPath) {
            $expected = [IO.Path]::GetFullPath((Join-Path $InstallDir "enhance_hotkey.py"))
            $owned = [string]::Equals(
                [IO.Path]::GetFullPath($scriptPath),
                $expected,
                [StringComparison]::OrdinalIgnoreCase
            )
        }
        if ($owned) {
            Stop-Process -Id $id -Force
        }
    } catch {}
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

function Resolve-SkillsDir {
    param([string]$Requested)
    if ($Requested) { return [IO.Path]::GetFullPath($Requested) }
    $codexHome = if ($env:CODEX_HOME) {
        [IO.Path]::GetFullPath($env:CODEX_HOME)
    } else {
        Join-Path $HOME ".codex"
    }
    return (Join-Path $codexHome "skills")
}

function Install-Skills {
    $targetRoot = Resolve-SkillsDir -Requested $SkillsDir
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
    foreach ($name in @("prompt-enhancer", "p")) {
        $source = Join-Path $here (Join-Path "skills" $name)
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Skill source not found: $source"
        }
        $target = Join-Path $targetRoot $name
        if (Test-Path -LiteralPath $target) {
            $item = Get-Item -LiteralPath $target -Force
            $marker = Join-Path $target ".prompt-enhancer-installed"
            $managed = $item.LinkType -eq "Junction" -or (Test-Path -LiteralPath $marker)
            if (-not $managed) {
                throw "Refusing to replace non-junction Skill: $target"
            }
            Remove-Item -LiteralPath $target -Recurse -Force
        }
        Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
        [IO.File]::WriteAllText(
            (Join-Path $target ".prompt-enhancer-installed"),
            "managed by prompt-enhancer install.ps1`n",
            (New-Object System.Text.UTF8Encoding($false))
        )
    }
    Write-Host "SKILLS $targetRoot"
}

function Remove-Skills {
    $targetRoot = Resolve-SkillsDir -Requested $SkillsDir
    foreach ($name in @("prompt-enhancer", "p")) {
        $target = Join-Path $targetRoot $name
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $marker = Join-Path $target ".prompt-enhancer-installed"
        $item = Get-Item -LiteralPath $target -Force
        if ($item.LinkType -eq "Junction" -or (Test-Path -LiteralPath $marker)) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
    Write-Host "SKILLS_REMOVED $targetRoot"
}

if ($Uninstall) {
    StopOwnedWatchdog
    StopOwnedEnhancer
    if (Test-Path -LiteralPath $shortcutPath) {
        $shortcutTarget = ""
        try {
            $shell = New-Object -ComObject WScript.Shell
            $shortcutTarget = $shell.CreateShortcut($shortcutPath).TargetPath
        } catch {}
        if ($shortcutTarget -and
            [string]::Equals($shortcutTarget, $watchdogExe, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $shortcutPath -Force
        }
    }
    if ($Mode -in @("Skill", "Bundle")) {
        Remove-Skills
    }
    Write-Host "UNINSTALLED startup and running processes; config/log/api key kept"
    exit 0
}

if ($Mode -eq "Skill") {
    Install-Skills
    Write-Host "MODE Skill"
    exit 0
}

$pythonw = Resolve-Pythonw -Requested $PythonPath
$configPath = Join-Path $InstallDir "config.json"
$existingConfig = if (Test-Path -LiteralPath $configPath) {
    [IO.File]::ReadAllBytes($configPath)
} else {
    $null
}
Sync-InstallDir
if ($null -ne $existingConfig) {
    # 重装时原样恢复用户配置，避免升级覆盖白名单、模型或 Key 变量名。
    [IO.File]::WriteAllBytes($configPath, $existingConfig)
} else {
    $configSource = Join-Path $here "config.json"
    if (Test-Path -LiteralPath $configSource) {
        Copy-Item -LiteralPath $configSource -Destination $configPath -Force
    }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText(
    (Join-Path $InstallDir "pythonw.path"),
    $pythonw,
    $utf8NoBom
)

if (Test-Path -LiteralPath $configPath) {
    $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $keyName = if ($cfg.api_key_env) { [string]$cfg.api_key_env } else { "DEEPSEEK_API_KEY" }
    if (-not [Environment]::GetEnvironmentVariable($keyName, "User")) {
        Write-Warning "$keyName is not set. The app starts, but enhancement will fail."
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
    $shortcut.TargetPath = $watchdogExe
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Ctrl+Shift+Alt+A prompt enhancer (starts with an agent)"
    $shortcut.Save()
    Write-Host "STARTUP $shortcutPath"
}

if (-not $NoStart) {
    $env:PROMPT_ENHANCER_PYTHONW = $pythonw
    Start-Process -FilePath $watchdogExe -WorkingDirectory $InstallDir -WindowStyle Hidden
    Write-Host "WATCHDOG_STARTED"
}

if ($Mode -eq "Bundle") {
    Install-Skills
}

Write-Host "PYTHONW $pythonw"
Write-Host "INSTALL_DIR $InstallDir"
