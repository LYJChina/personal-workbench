[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$ProjectRoot,
    [string]$NodePath,
    [string]$ReminderEntryPath,
    [string]$LocalTime = '09:00'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'LYJWorkBench-OutboundCheckin'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Join-Path $PSScriptRoot '..'
}
$ResolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)

if ($LocalTime -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$') {
    throw 'LocalTime must use HH:mm in 24-hour time.'
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $NodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source
}
$ResolvedNodePath = [System.IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $ResolvedNodePath -PathType Leaf)) {
    throw "node.exe was not found at the configured path."
}

if ([string]::IsNullOrWhiteSpace($ReminderEntryPath)) {
    $ReminderEntryPath = Join-Path $ResolvedProjectRoot 'apps\server\dist\reminder-entry.js'
}
$ResolvedReminderEntryPath = [System.IO.Path]::GetFullPath($ReminderEntryPath)
if (-not (Test-Path -LiteralPath $ResolvedReminderEntryPath -PathType Leaf)) {
    throw 'The compiled reminder entry was not found. Run pnpm build first.'
}

$ActionArguments = '"' + $ResolvedReminderEntryPath + '" --reminder outbound-checkin'
$Action = New-ScheduledTaskAction -Execute $ResolvedNodePath -Argument $ActionArguments -WorkingDirectory $ResolvedProjectRoot
$TriggerAt = [datetime]::Today.Add([TimeSpan]::ParseExact($LocalTime, 'hh\:mm', $null))
$Trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At $TriggerAt
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Target = "$TaskName | Monday $LocalTime | node=$ResolvedNodePath | entry=$ResolvedReminderEntryPath | cwd=$ResolvedProjectRoot"
if ($PSCmdlet.ShouldProcess($Target, 'Register current-user scheduled task')) {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Description 'Send the weekly outbound check-in reminder.' -Force | Out-Null
}
