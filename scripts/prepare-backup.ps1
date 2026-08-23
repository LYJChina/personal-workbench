[CmdletBinding()]
param(
    [string]$Port = '3001'
)

$ErrorActionPreference = 'Stop'
if ($Port -notmatch '^[1-9]\d*$') {
    throw 'PORT must be an integer from 1 through 65535.'
}
$ParsedPort = 0
if (-not [int]::TryParse($Port, [ref]$ParsedPort) -or $ParsedPort -gt 65535) {
    throw 'PORT must be an integer from 1 through 65535.'
}

$Listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $ParsedPort -State Listen -ErrorAction SilentlyContinue
if ($null -ne $Listener) {
    throw "The LYJ Workbench loopback server is still listening on 127.0.0.1:$ParsedPort. Stop it before copying local data."
}

$DataRoot = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
    $DataRoot = $env:APPDATA
}
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
    throw 'LOCALAPPDATA or APPDATA is required to locate LYJ Workbench data.'
}
$DataDirectory = Join-Path $DataRoot 'LYJWorkBench'
Write-Output "Backup preparation complete. No LYJ Workbench server is listening on 127.0.0.1:$ParsedPort."
Write-Output "Copy SQLite and uploads from: $DataDirectory"
