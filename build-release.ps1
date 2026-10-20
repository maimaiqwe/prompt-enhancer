param(
    [string]$Version,
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Version) {
    $Version = "dev"
}
if ($Version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') {
    throw "Invalid version: $Version"
}
if (-not $OutputDir) {
    $OutputDir = Join-Path $here "dist"
}
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
if (Test-Path -LiteralPath $OutputDir) {
    Remove-Item -LiteralPath $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$staging = Join-Path ([IO.Path]::GetTempPath()) (
    "prompt-enhancer-build-" + [Guid]::NewGuid().ToString("N")
)
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$blockedNames = @(
    "__pycache__", "*.pyc", "*.pyo", "log.txt", "watchdog.log",
    "history.jsonl", "last-enhanced.md", "last-original.md",
    "last-state.json", "enhancer.pid", "pythonw.path", "watchdog.exe",
    ".env", "*.key", "*.pem", ".prompt-enhancer-installed"
)
$blockedDirectories = @(".git", "dist", ".venv")

function Copy-Whitelist {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Required source not found: $Source"
    }
    $item = Get-Item -LiteralPath $Source -Force
    if ($blockedNames -contains $item.Name) { return }
    if ($item.PSIsContainer) {
        if ($blockedDirectories -contains $item.Name) { return }
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        foreach ($child in Get-ChildItem -LiteralPath $Source -Force) {
            Copy-Whitelist -Source $child.FullName -Destination (Join-Path $Destination $child.Name)
        }
        return
    }
    foreach ($pattern in $blockedNames) {
        if ($item.Name -like $pattern) { return }
    }
    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function New-Package {
    param(
        [string]$Name,
        [scriptblock]$Populate
    )
    $root = Join-Path $staging $Name
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    & $Populate $root
    $zip = Join-Path $OutputDir ($Name + ".zip")
    Compress-Archive -Path (Join-Path $root "*") -DestinationPath $zip -CompressionLevel Optimal
    return $zip
}

function Populate-Skill {
    param([string]$Root)
    Copy-Whitelist -Source (Join-Path $here "install.ps1") -Destination (Join-Path $Root "install.ps1")
    Copy-Whitelist -Source (Join-Path $here "skills") -Destination (Join-Path $Root "skills")
    Copy-Whitelist -Source (Join-Path $here "LICENSE") -Destination (Join-Path $Root "LICENSE")
    Copy-Whitelist -Source (Join-Path $here "README.md") -Destination (Join-Path $Root "README.md")
}

function Populate-Hotkey {
    param([string]$Root)
    foreach ($name in @(
        "enhance_hotkey.py", "watchdog.cs", "run.cmd", "install.ps1",
        "config.json", "LICENSE", "README.md"
    )) {
        Copy-Whitelist -Source (Join-Path $here $name) -Destination (Join-Path $Root $name)
    }
    Copy-Whitelist -Source (Join-Path $here "core") -Destination (Join-Path $Root "core")
}

function Populate-Bundle {
    param([string]$Root)
    Populate-Hotkey -Root $Root
    Copy-Whitelist -Source (Join-Path $here "skills") -Destination (Join-Path $Root "skills")
}

try {
    $packages = @(
        (New-Package -Name "prompt-enhancer-skill-v$Version" -Populate ${function:Populate-Skill}),
        (New-Package -Name "prompt-enhancer-hotkey-windows-v$Version" -Populate ${function:Populate-Hotkey}),
        (New-Package -Name "prompt-enhancer-bundle-v$Version" -Populate ${function:Populate-Bundle})
    )
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $hashLines = foreach ($package in $packages) {
        $stream = [IO.File]::OpenRead($package)
        try {
            $hash = ([BitConverter]::ToString(
                $sha256.ComputeHash($stream)
            ) -replace '-', '').ToLowerInvariant()
        } finally {
            $stream.Dispose()
        }
        "$hash  $([IO.Path]::GetFileName($package))"
    }
    $sha256.Dispose()
    $hashPath = Join-Path $OutputDir "SHA256SUMS.txt"
    [IO.File]::WriteAllLines(
        $hashPath,
        $hashLines,
        (New-Object System.Text.UTF8Encoding($false))
    )
    Write-Output "BUILT $OutputDir"
    $hashLines
} finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
