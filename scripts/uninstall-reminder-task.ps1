[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

$ErrorActionPreference = 'Stop'
$TaskName = 'LYJWorkBench-OutboundCheckin'
$TaskPath = '\'
$Task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $Task) {
    Write-Output 'The LYJ WorkBench outbound check-in task is not installed.'
    return
}
if ($Task.TaskName -ne $TaskName -or $Task.TaskPath -ne $TaskPath) {
    throw 'Scheduled task identity did not match the expected task name.'
}
if ($PSCmdlet.ShouldProcess("$TaskPath$TaskName", 'Unregister scheduled task')) {
    Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false
}
