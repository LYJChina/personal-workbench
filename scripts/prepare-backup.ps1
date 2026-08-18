[CmdletBinding()]
param(
    [string]$Port = '3001'
)

$ErrorActionPreference = 'Stop'
$TaskNames = @('LYJWorkBench-ReminderRunner', 'LYJWorkBench-OutboundCheckin')
$TaskPath = '\'

if ($Port -notmatch '^[1-9]\d*$') {
    throw 'PORT must be an integer from 1 through 65535.'
}
$ParsedPort = 0
if (-not [int]::TryParse($Port, [ref]$ParsedPort) -or $ParsedPort -gt 65535) {
    throw 'PORT must be an integer from 1 through 65535.'
}

$StoppedTaskNames = @()
foreach ($TaskName in $TaskNames) {
    $Task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $Task) { continue }
    if ($Task.TaskPath -ne $TaskPath -or $Task.TaskName -ne $TaskName) {
        throw 'Scheduled task identity did not match the expected root task.'
    }

    Disable-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName | Out-Null
    if ([string]$Task.State -eq 'Running') {
        Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    }

    $Task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction Stop
    if ($Task.TaskPath -ne $TaskPath -or $Task.TaskName -ne $TaskName) {
        throw 'Scheduled task identity changed during backup preparation.'
    }
    if ([string]$Task.State -eq 'Running') {
        throw 'An exact reminder task is still running. Wait for it to stop, then run backup preparation again.'
    }
    $StoppedTaskNames += $TaskName
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
foreach ($StoppedTaskName in $StoppedTaskNames) {
    Write-Output "After the backup, re-enable only $TaskPath$StoppedTaskName."
}
