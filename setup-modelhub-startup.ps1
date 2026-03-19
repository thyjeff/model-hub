$ErrorActionPreference = "Stop"

$taskName = "ModelHubServer"
$startupCmd = "D:\Pro\model-hub-proxy\start-modelhub.cmd"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c ""$startupCmd"""

function Register-AsSystemStartup {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    Write-Host "Scheduled task '$taskName' registered as SYSTEM (AtStartup)."
}

function Register-AsCurrentUserLogon {
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    # Register under current user without requiring admin privileges.
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description "Start Model Hub at user logon" -Force | Out-Null
    Write-Host "Scheduled task '$taskName' registered for current user (AtLogOn)."
}

try {
    Register-AsSystemStartup
}
catch {
    Write-Host "SYSTEM startup registration failed: $($_.Exception.Message)"
    Write-Host "Falling back to current-user logon startup task..."
    Register-AsCurrentUserLogon
}
