[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

$ErrorActionPreference = 'Stop'
$TaskNames = @('LYJWorkBench-ReminderRunner', 'LYJWorkBench-OutboundCheckin')
$TaskPath = '\'
$RemovedAny = $false
foreach ($TaskName in $TaskNames) {
    $Task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $Task) { continue }
    if ($Task.TaskName -ne $TaskName -or $Task.TaskPath -ne $TaskPath) {
        throw 'Scheduled task identity did not match the expected task name.'
    }
    if ($PSCmdlet.ShouldProcess("$TaskPath$TaskName", 'Unregister scheduled task')) {
        Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false
        $RemovedAny = $true
    }
}
if (-not $RemovedAny) {
    Write-Output 'No LYJ WorkBench reminder task is installed.'
}
