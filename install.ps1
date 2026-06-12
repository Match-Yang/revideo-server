#Requires -Version 5.1
# Revideo Server — one-click installer (Windows)
# Usage: iex (irm https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.ps1)
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$InstallDir = "$env:USERPROFILE\.revideo-server",
    [int]$Port = 3001,
    [string]$Version = "latest",
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# --- Constants ---
$AppName = "revideo-server"
$MinNodeMajor = 22
$GitHubRepo = if ($env:GITHUB_REPO) { $env:GITHUB_REPO } else { "Match-Yang/revideo-server" }

# --- Helpers ---
function Write-Info($msg)    { Write-Host "==> $msg" -ForegroundColor Blue }
function Write-Success($msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "==> $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "==> $msg" -ForegroundColor Red }

function Get-NodePath {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }
    # Check common install locations
    foreach ($p in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\nodejs\node.exe"
    )) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Test-NodeVersion {
    $nodePath = Get-NodePath
    if (-not $nodePath) { return $false }
    $version = & $nodePath -v 2>$null
    if (-not $version) { return $false }
    $major = ($version -replace '^v', '').Split('.')[0]
    return [int]$major -ge $MinNodeMajor
}

function Get-PackageManager {
    if (Get-Command winget -ErrorAction SilentlyContinue) { return "winget" }
    if (Get-Command choco -ErrorAction SilentlyContinue)  { return "choco" }
    if (Get-Command scoop -ErrorAction SilentlyContinue)  { return "scoop" }
    return $null
}

# --- Prerequisites ---

function Ensure-Node {
    if (Test-NodeVersion) {
        $v = & (Get-NodePath) -v
        Write-Success "Node.js $v found"
        return
    }

    Write-Info "Installing Node.js $MinNodeMajor..."
    $pm = Get-PackageManager

    switch ($pm) {
        "winget" {
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        }
        "choco" {
            choco install nodejs-lts -y
        }
        "scoop" {
            scoop install nodejs-lts
        }
        default {
            # Download MSI directly
            Write-Info "Downloading Node.js LTS..."
            $msiUrl = "https://nodejs.org/dist/latest-v22.x/"
            $page = Invoke-RestMethod $msiUrl -UseBasicParsing
            # Find the latest version
            $match = [regex]::Match($page, 'node-v(\d+\.\d+\.\d+)-x64\.msi')
            if ($match.Success) {
                $ver = $match.Groups[1].Value
                $url = "https://nodejs.org/dist/v${ver}/node-v${ver}-x64.msi"
                $msiPath = "$env:TEMP\node-install.msi"
                Invoke-WebRequest $url -OutFile $msiPath
                Start-Process msiexec.exe -ArgumentList "/i", $msiPath, "/quiet", "/norestart" -Wait
                Remove-Item $msiPath -Force
            } else {
                Write-Err "Could not find Node.js download. Install manually from https://nodejs.org"
                exit 1
            }
        }
    }

    # Refresh PATH
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")

    if (-not (Test-NodeVersion)) {
        Write-Err "Node.js installation failed. Install manually from https://nodejs.org"
        exit 1
    }
    Write-Success "Node.js $(& (Get-NodePath) -v) installed"
}

function Ensure-YtDlp {
    if (Get-Command yt-dlp -ErrorAction SilentlyContinue) {
        Write-Success "yt-dlp found"
        return
    }

    Write-Info "Installing yt-dlp..."
    $pm = Get-PackageManager

    switch ($pm) {
        "winget" { winget install yt-dlp.yt-dlp --accept-source-agreements --accept-package-agreements }
        "choco"  { choco install yt-dlp -y }
        "scoop"  { scoop install yt-dlp }
        default {
            # Download directly
            $url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
            $binDir = "$env:USERPROFILE\.local\bin"
            New-Item -ItemType Directory -Path $binDir -Force | Out-Null
            Invoke-WebRequest $url -OutFile "$binDir\yt-dlp.exe"
            $env:Path = "$binDir;$env:Path"
            # Persist PATH
            $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
            if ($userPath -notlike "*$binDir*") {
                [Environment]::SetEnvironmentVariable("Path", "$binDir;$userPath", "User")
            }
        }
    }
    Write-Success "yt-dlp installed"
}

function Ensure-Ffmpeg {
    if ((Get-Command ffmpeg -ErrorAction SilentlyContinue) -and
        (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
        Write-Success "ffmpeg found"
        return
    }

    Write-Info "Installing ffmpeg..."
    $pm = Get-PackageManager

    switch ($pm) {
        "winget" { winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements }
        "choco"  { choco install ffmpeg -y }
        "scoop"  { scoop install ffmpeg }
        default {
            Write-Warn "Cannot auto-install ffmpeg. Install from https://ffmpeg.org/download.html"
            return
        }
    }

    # Refresh PATH after install
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    Write-Success "ffmpeg installed"
}

function Test-Chrome {
    $paths = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) {
            Write-Success "Chrome found: $p"
            return
        }
    }
    Write-Warn "Chrome not found. Browser-based publishing will not work."
    Write-Warn "Install Chrome from https://www.google.com/chrome/"
}

# --- Download & Extract ---

function Get-LatestVersion {
    # Follow GitHub's /releases/latest redirect — no API, no rate limits
    try {
        $resp = Invoke-WebRequest "https://github.com/$GitHubRepo/releases/latest" -Method Head -MaximumRedirection 0 -ErrorAction Stop
    } catch {
        $url = $_.Exception.Response.Headers.Location.AbsoluteUri
    }
    if ($url) {
        $version = $url.Split("/")[-1]
    }
    if (-not $version) {
        Write-Err "Could not determine latest version. Specify with -Version <tag>"
        exit 1
    }
    return $version
}
    return $version
}

function Download-AndExtract {
    $ver = $Version
    if ($ver -eq "latest") {
        $ver = Get-LatestVersion
        Write-Info "Latest version: $ver"
    }

    $filename = "revideo-$ver-win-x64.zip"
    $url = "https://github.com/$GitHubRepo/releases/download/$ver/$filename"

    Write-Info "Downloading $AppName $ver for Windows..."
    Write-Info "URL: $url"

    $tmpDir = [System.IO.Path]::GetTempPath() + "revideo-install"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $archive = "$tmpDir\$filename"

    Invoke-WebRequest $url -OutFile $archive

    Write-Info "Extracting to $InstallDir..."

    # Backup data if updating
    $dataBackup = $null
    if (Test-Path "$InstallDir\data") {
        $dataBackup = "$InstallDir\data-backup-$(Get-Random)"
        Move-Item "$InstallDir\data" $dataBackup
    }

    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

    Expand-Archive $archive -DestinationPath $InstallDir -Force

    # Restore data backup
    if ($dataBackup -and (Test-Path $dataBackup)) {
        if (Test-Path "$InstallDir\data") { Remove-Item "$InstallDir\data" -Recurse -Force }
        Move-Item $dataBackup "$InstallDir\data"
    }

    # Ensure data directories
    New-Item -ItemType Directory -Path "$InstallDir\data\browser\profile" -Force | Out-Null

    Remove-Item $tmpDir -Recurse -Force
    Write-Success "Extracted to $InstallDir"
}

# --- Setup ---

function Setup-Service {
    Write-Info "Setting up scheduled task for auto-start..."

    $taskName = "RevideoServer"
    $nodePath = Get-NodePath

    # Remove existing task
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction `
        -Execute $nodePath `
        -Argument "dist\server.js" `
        -WorkingDirectory $InstallDir

    $trigger = New-ScheduledTaskTrigger -AtLogOn

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)

    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "Revideo Server - Video rendering, translation and republishing" | Out-Null

    Start-ScheduledTask -TaskName $taskName
    Write-Success "Scheduled task '$taskName' created and started"
}

function Test-Health {
    Write-Info "Waiting for server to start..."
    $url = "http://localhost:$Port/api/health"

    for ($i = 1; $i -le 30; $i++) {
        try {
            Invoke-RestMethod $url -TimeoutSec 2 -ErrorAction Stop | Out-Null
            Write-Success "Server is running at http://localhost:$Port"
            return
        } catch {}
        Start-Sleep -Seconds 1
    }

    Write-Warn "Server did not respond within 30 seconds."
    Write-Warn "Check log: $InstallDir\data\server-error.log"
}

# --- Uninstall ---

function Do-Uninstall {
    Write-Info "Uninstalling $AppName..."

    # Stop scheduled task
    Unregister-ScheduledTask -TaskName "RevideoServer" -Confirm:$false -ErrorAction SilentlyContinue

    # Kill process on port
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }

    if (Test-Path $InstallDir) {
        if ($NonInteractive) {
            Remove-Item $InstallDir -Recurse -Force
        } else {
            $confirm = Read-Host "Remove installation directory $InstallDir? [y/N]"
            if ($confirm -match '^[yY]') {
                Remove-Item $InstallDir -Recurse -Force
                Write-Success "Removed $InstallDir"
            } else {
                Write-Info "Kept $InstallDir"
            }
        }
    }

    Write-Success "Uninstall complete"
    exit 0
}

# --- Banner ---
function Print-Banner {
    Write-Host ""
    Write-Host "  Revideo Server Installer" -ForegroundColor Cyan
    Write-Host "  Video rendering, translation & republishing service" -ForegroundColor DarkGray
    Write-Host ""
}

# --- Main ---

Print-Banner

if ($Uninstall) { Do-Uninstall }

Ensure-Node
Ensure-YtDlp
Ensure-Ffmpeg
Download-AndExtract
Test-Chrome
Setup-Service
Test-Health

Write-Host ""
Write-Success "Installation complete!"
Write-Host ""
Write-Host "  Dashboard:  http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  Health:     http://localhost:$Port/api/health" -ForegroundColor Cyan
Write-Host "  Data:       $InstallDir\data\"
Write-Host ""
Write-Host "  Service:    Get-ScheduledTask -TaskName RevideoServer"
Write-Host "  Stop:       Stop-ScheduledTask -TaskName RevideoServer"
Write-Host "  Start:      Start-ScheduledTask -TaskName RevideoServer"
Write-Host ""
