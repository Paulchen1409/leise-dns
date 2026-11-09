$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('leise-recovery-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../src/platform/dns-helper.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'PowerShell syntax error' }
    foreach ($name in 'Restore-Dns','Write-RecoveryLog','Wait-RecoveryAdapters','Test-LiveHelper','Invoke-Recovery') {
        $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
        if (!$definition) { throw "Missing function $name" }
        . ([scriptblock]::Create($definition.Extent.Text))
    }
    $backupFile = Join-Path $testRoot 'backup.json'
    $storage = $testRoot
    $recoveryTaskName = 'test-only'
    $script:recoveryPollSeconds = 0
    $script:recoveryWaitSeconds = 30
    $script:recoveryMaxAttempts = 3
    $script:calls = @()
    $script:unregistered = 0
    $script:seen = 0
    $guid = '{0E5F2C1A-3B4D-4E6F-8A9B-1C2D3E4F5A6B}'
    $fixture = @"
[
 {"Guid":"$guid","Index":7,"Name":"WLAN","Family":"IPv4","Static":false,"Servers":["192.168.1.1"]}
]
"@
    function Get-NetAdapter { param([switch]$IncludeHidden)
        $script:seen++
        if ($script:seen -ge 3) { [pscustomobject]@{ InterfaceGuid = $guid; ifIndex = 12 } }
    }
    function Invoke-Netsh([string[]]$Arguments) { $script:calls += ,($Arguments -join ' ') }
    function Clear-DnsClientCache {}
    function Unregister-ScheduledTask { param($TaskName,[switch]$Confirm,$ErrorAction) $script:unregistered++ }
    function Read-Log { if (Test-Path (Join-Path $testRoot 'recovery.log')) { Get-Content (Join-Path $testRoot 'recovery.log') -Raw } else { '' } }

    # No backup: the boot task must remove itself instead of staying forever.
    Invoke-Recovery
    if ($script:unregistered -ne 1) { throw 'Missing backup must unregister the boot task' }
    if ((Read-Log) -notmatch 'Keine Sicherung') { throw 'Missing backup must be logged' }

    # Adapters show up on the third look (WLAN after a hard reboot). Index is the live one.
    [IO.File]::WriteAllText($backupFile, $fixture)
    $script:seen = 0; $script:calls = @()
    Invoke-Recovery
    if ($script:calls.Count -ne 1) { throw "Expected one restore command, got $($script:calls.Count)" }
    if ($script:calls[0] -ne 'interface ipv4 set dnsservers name=12 source=dhcp') { throw "Wrong restore: $($script:calls[0])" }
    if (Test-Path -LiteralPath $backupFile) { throw 'Successful recovery must remove the backup' }
    if ((Read-Log) -notmatch 'DNS wiederhergestellt') { throw 'Success must be logged' }
    if ($script:seen -lt 3) { throw 'Recovery must wait until the adapter is enumerated' }

    # Still missing when the wait ends: backup stays so the scheduled task can retry.
    [IO.File]::WriteAllText($backupFile, $fixture)
    $script:seen = 0
    function Get-NetAdapter { param([switch]$IncludeHidden) }
    $failed = $false
    try { Invoke-Recovery } catch { $failed = $true }
    if (!$failed -or !(Test-Path -LiteralPath $backupFile)) { throw 'A not-yet-visible adapter must keep the backup and fail' }
    if ((Read-Log) -notmatch 'noch nicht sichtbar') { throw 'The retry must be logged' }

    # Only an adopted adapter is left, and it is gone: nothing to restore, backup is removed.
    $adopted = @"
[
 {"Guid":"{22222222-2222-2222-2222-222222222222}","Index":9,"Name":"VPN","Family":"IPv4","Static":true,"Servers":["10.8.0.1"],"Adopted":true}
]
"@
    [IO.File]::WriteAllText($backupFile, $adopted)
    $script:calls = @()
    Invoke-Recovery
    if ($script:calls.Count -or (Test-Path -LiteralPath $backupFile)) { throw 'A vanished adopted adapter must not block recovery' }

    # A running helper owns the backup: the sign-in run must not undo live protection.
    [IO.File]::WriteAllText($backupFile, $fixture)
    function Get-NetAdapter { param([switch]$IncludeHidden) [pscustomobject]@{ InterfaceGuid = $guid; ifIndex = 12 } }
    $stateFile = Join-Path $testRoot 'helper-S-1-5-21-1.state.json'
    [IO.File]::WriteAllText($stateFile, (@{ phase = 'active'; helperPid = $PID } | ConvertTo-Json -Compress))
    $script:calls = @()
    Invoke-Recovery
    if ($script:calls.Count -or !(Test-Path -LiteralPath $backupFile)) { throw 'A live helper must keep protection and the backup' }
    if ((Read-Log) -notmatch 'Hilfsdienst l') { throw 'Skipping for a live helper must be logged' }

    # The helper has stopped: recovery runs.
    [IO.File]::WriteAllText($stateFile, (@{ phase = 'stopped'; helperPid = $PID } | ConvertTo-Json -Compress))
    Invoke-Recovery
    if ($script:calls.Count -ne 1 -or (Test-Path -LiteralPath $backupFile)) { throw 'A stopped helper must not block recovery' }

    Write-Output 'PASS: boot recovery waits, logs, keeps the backup, drops an empty task'
} finally {
    if ((Split-Path $testRoot -Leaf) -like 'leise-recovery-*' -and (Split-Path $testRoot -Parent) -eq ([IO.Path]::GetTempPath()).TrimEnd('\')) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
