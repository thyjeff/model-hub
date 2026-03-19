$ErrorActionPreference = "Stop"

$taskName = "ModelHubServer"
$startupCmd = "D:\Pro\model-hub-proxy\start-modelhub.cmd"

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c ""$startupCmd"""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$startupShortcut = "C:\Users\jeffl\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\start-modelhub.cmd"
if (Test-Path $startupShortcut) {
    Remove-Item $startupShortcut -Force
}

Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, TaskPath | Format-List
