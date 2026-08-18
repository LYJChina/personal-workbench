[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$ProjectRoot,
    [string]$NodePath,
    [string]$ReminderEntryPath,
    [switch]$StatusOnly
)

$ErrorActionPreference = 'Stop'
$TaskName = 'LYJWorkBench-ReminderRunner'
$LegacyTaskName = 'LYJWorkBench-OutboundCheckin'
$TaskPath = '\'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Join-Path $PSScriptRoot '..' }
$ResolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)

function Write-Status([bool]$Installed, [bool]$Synchronized, [string]$Message) {
    [pscustomobject]@{
        installed = $Installed
        synchronized = $Synchronized
        taskName = $TaskName
        message = $Message
    } | ConvertTo-Json -Compress
}

$Existing = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing -and ($Existing.TaskPath -ne $TaskPath -or $Existing.TaskName -ne $TaskName)) {
    throw 'The scheduler returned a task outside the expected identity.'
}
if ($StatusOnly) {
    Write-Status ([bool]$Existing) ([bool]$Existing) $(if ($Existing) { 'Scheduler synchronized' } else { 'Scheduler not synchronized' })
    return
}

if ([string]::IsNullOrWhiteSpace($NodePath)) { $NodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source }
$ResolvedNodePath = [System.IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $ResolvedNodePath -PathType Leaf)) { throw 'node.exe was not found.' }
if ([string]::IsNullOrWhiteSpace($ReminderEntryPath)) {
    $ReminderEntryPath = Join-Path $ResolvedProjectRoot 'apps\server\dist\reminder-entry.js'
}
$ResolvedReminderEntryPath = [System.IO.Path]::GetFullPath($ReminderEntryPath)
if (-not (Test-Path -LiteralPath $ResolvedReminderEntryPath -PathType Leaf)) {
    throw 'The reminder runner is not built. Run pnpm build first.'
}

$Action = New-ScheduledTaskAction -Execute $ResolvedNodePath -Argument ('"' + $ResolvedReminderEntryPath + '" --run-due') -WorkingDirectory $ResolvedProjectRoot
$StartAt = (Get-Date).AddMinutes(1)
$Trigger = New-ScheduledTaskTrigger -Once -At $StartAt -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Target = "$TaskName | every minute | node=$ResolvedNodePath | entry=$ResolvedReminderEntryPath | cwd=$ResolvedProjectRoot"
if ($PSCmdlet.ShouldProcess($Target, 'Register current-user reminder task')) {
    Register-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Description 'Run due LYJ Workbench email reminders.' -Force | Out-Null
}
$Installed = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Installed) {
    $LegacyTask = Get-ScheduledTask -TaskPath $TaskPath -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    if ($LegacyTask -and ($LegacyTask.TaskPath -ne $TaskPath -or $LegacyTask.TaskName -ne $LegacyTaskName)) {
        throw 'The scheduler returned a legacy task outside the expected identity.'
    }
    if ($LegacyTask -and $PSCmdlet.ShouldProcess("$TaskPath$LegacyTaskName", 'Remove superseded reminder task')) {
        Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $LegacyTaskName -Confirm:$false
    }
}
Write-Status ([bool]$Installed) ([bool]$Installed) $(if ($Installed) { 'Scheduler synchronized' } else { 'Scheduler synchronization incomplete' })
