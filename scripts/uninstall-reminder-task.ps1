[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

$ErrorActionPreference = 'Stop'
$TaskName = 'LYJWorkBench-OutboundCheckin'
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $Task) {
    Write-Output 'The LYJ WorkBench outbound check-in task is not installed.'
    return
}
if ($Task.TaskName -ne $TaskName) {
    throw 'Scheduled task identity did not match the expected task name.'
}
if ($PSCmdlet.ShouldProcess($TaskName, 'Unregister scheduled task')) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
