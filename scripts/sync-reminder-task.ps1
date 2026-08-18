[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$ProjectRoot,
    [string]$NodePath,
    [string]$ReminderEntryPath,
    [switch]$StatusOnly
)

$ErrorActionPreference = 'Stop'
$TaskName = 'LYJWorkBench-ReminderRunner'
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
    Write-Status ([bool]$Existing) ([bool]$Existing) $(if ($Existing) { '系统计划已同步' } else { '系统计划尚未同步' })
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
    throw '提醒执行程序尚未构建。请先运行 pnpm build。'
}

$Action = New-ScheduledTaskAction -Execute $ResolvedNodePath -Argument ('"' + $ResolvedReminderEntryPath + '" --run-due') -WorkingDirectory $ResolvedProjectRoot
$StartAt = (Get-Date).AddMinutes(1)
$Trigger = New-ScheduledTaskTrigger -Once -At $StartAt
$Trigger.Repetition.Interval = 'PT1M'
$Trigger.Repetition.Duration = 'P3650D'
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Target = "$TaskName | every minute | node=$ResolvedNodePath | entry=$ResolvedReminderEntryPath | cwd=$ResolvedProjectRoot"
if ($PSCmdlet.ShouldProcess($Target, 'Register current-user reminder task')) {
    Register-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Description 'Run due LYJ Workbench email reminders.' -Force | Out-Null
}
$Installed = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
Write-Status ([bool]$Installed) ([bool]$Installed) $(if ($Installed) { '系统计划已同步' } else { '系统计划同步未完成' })
