$ErrorActionPreference = "Stop"

$path = "C:\Users\jeffl\.config\modelhub-proxy\config.json"
if (-not (Test-Path $path)) {
    throw "Config not found: $path"
}

$cfg = Get-Content $path -Raw | ConvertFrom-Json
$cfg.maxWaitBeforeErrorMs = 0
$cfg.switchAccountDelayMs = 100
$cfg.defaultCooldownMs = 1000
$cfg.rateLimitDedupWindowMs = 1000

$cfg | ConvertTo-Json -Depth 20 | Set-Content $path -Encoding UTF8
Write-Host "Updated loop tuning in $path"
