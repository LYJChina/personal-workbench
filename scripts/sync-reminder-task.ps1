[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$ProjectRoot,
    [string]$NodePath,
    [string]$ReminderEntryPath,
    [string]$LauncherPath,
    [switch]$StatusOnly
)

$ErrorActionPreference = 'Stop'
$TaskName = 'LYJWorkBench-ReminderRunner'
$LegacyTaskName = 'LYJWorkBench-OutboundCheckin'
$TaskPath = '\'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Join-Path $PSScriptRoot '..' }
$ResolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if ([string]::IsNullOrWhiteSpace($NodePath)) { $NodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source }
$ResolvedNodePath = [System.IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $ResolvedNodePath -PathType Leaf)) { throw 'node.exe was not found.' }
if ([string]::IsNullOrWhiteSpace($ReminderEntryPath)) { $ReminderEntryPath = Join-Path $ResolvedProjectRoot 'apps\server\dist\reminder-entry.js' }
$ResolvedReminderEntryPath = [System.IO.Path]::GetFullPath($ReminderEntryPath)
if (-not (Test-Path -LiteralPath $ResolvedReminderEntryPath -PathType Leaf)) { throw 'The reminder runner is not built. Run pnpm build first.' }
if ([string]::IsNullOrWhiteSpace($LauncherPath)) { $LauncherPath = Join-Path $ResolvedProjectRoot 'scripts\run-reminders-hidden.vbs' }
$ResolvedLauncherPath = [System.IO.Path]::GetFullPath($LauncherPath)
if (-not (Test-Path -LiteralPath $ResolvedLauncherPath -PathType Leaf)) { throw 'The hidden reminder launcher was not found.' }
$ResolvedSyncScriptPath = [System.IO.Path]::GetFullPath($PSCommandPath)
$ResolvedWscriptPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $ResolvedWscriptPath -PathType Leaf)) { throw 'wscript.exe was not found.' }

function Write-Status([bool]$Installed, [bool]$Synchronized, [string]$Message, [AllowNull()][string]$NextRun) {
    [pscustomobject]@{ installed = $Installed; synchronized = $Synchronized; taskName = $TaskName; message = $Message; nextRun = $NextRun } | ConvertTo-Json -Compress
}

$NextWakeOutput = & $ResolvedNodePath $ResolvedReminderEntryPath '--next-wake'
if ($LASTEXITCODE -ne 0) { throw 'The reminder runner could not calculate the next wake-up.' }
$NextWakeLine = @($NextWakeOutput)[-1]
$NextWake = $NextWakeLine | ConvertFrom-Json
if ($null -ne $NextWake.nextRun -and [string]$NextWake.nextRun -notmatch '^\d{4}-\d{2}-\d{2}T') { throw 'The reminder runner returned an invalid next wake-up.' }
$NextRun = if ($null -eq $NextWake.nextRun) { $null } else { [string]$NextWake.nextRun }

$Existing = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing -and ($Existing.TaskPath -ne $TaskPath -or $Existing.TaskName -ne $TaskName)) { throw 'The scheduler returned a task outside the expected identity.' }

if ($StatusOnly) {
    if ($null -eq $NextRun) {
        Write-Status ([bool]$Existing) (-not [bool]$Existing) $(if ($Existing) { 'Scheduler has no pending wake-up' } else { 'No pending reminders' }) $null
        return
    }
    $ExpectedAction = $Existing -and $Existing.Actions -and ([string]$Existing.Actions[0].Execute -ieq $ResolvedWscriptPath)
    $ExpectedLauncher = $Existing -and $Existing.Actions -and ([string]$Existing.Actions[0].Arguments -like "*$ResolvedLauncherPath*")
    $NonRepeating = $Existing -and $Existing.Triggers -and [string]::IsNullOrWhiteSpace([string]$Existing.Triggers[0].Repetition.Interval)
    $Synchronized = [bool]($Existing -and $ExpectedAction -and $ExpectedLauncher -and $NonRepeating)
    Write-Status ([bool]$Existing) $Synchronized $(if ($Synchronized) { 'Scheduler synchronized' } else { 'Scheduler not synchronized' }) $NextRun
    return
}

if ($null -eq $NextRun) {
    if ($Existing -and $PSCmdlet.ShouldProcess("$TaskPath$TaskName", 'Remove reminder task with no pending wake-up')) {
        Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false
    }
    $Remaining = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Status ([bool]$Remaining) (-not [bool]$Remaining) $(if ($Remaining) { 'Scheduler cleanup incomplete' } else { 'No pending reminders' }) $null
    return
}

$ActionArguments = '//B //NoLogo "' + $ResolvedLauncherPath + '" "' + $ResolvedNodePath + '" "' + $ResolvedReminderEntryPath + '" "' + $ResolvedSyncScriptPath + '" "' + $ResolvedProjectRoot + '"'
$Action = New-ScheduledTaskAction -Execute $ResolvedWscriptPath -Argument $ActionArguments -WorkingDirectory $ResolvedProjectRoot
$StartAt = [DateTimeOffset]::Parse($NextRun).LocalDateTime
$Trigger = New-ScheduledTaskTrigger -Once -At $StartAt
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -Hidden
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Target = "$TaskName | once=$StartAt | launcher=$ResolvedLauncherPath"
if ($PSCmdlet.ShouldProcess($Target, 'Register current-user reminder task')) {
    Register-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Run the next due LYJ Workbench email reminder invisibly.' -Force | Out-Null
}
$Installed = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Installed) {
    $LegacyTask = Get-ScheduledTask -TaskPath $TaskPath -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    if ($LegacyTask -and ($LegacyTask.TaskPath -ne $TaskPath -or $LegacyTask.TaskName -ne $LegacyTaskName)) { throw 'The scheduler returned a legacy task outside the expected identity.' }
    if ($LegacyTask -and $PSCmdlet.ShouldProcess("$TaskPath$LegacyTaskName", 'Remove superseded reminder task')) {
        Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $LegacyTaskName -Confirm:$false
    }
}
Write-Status ([bool]$Installed) ([bool]$Installed) $(if ($Installed) { 'Scheduler synchronized' } else { 'Scheduler synchronization incomplete' }) $NextRun
