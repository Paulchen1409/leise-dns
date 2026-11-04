$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('leise-restore-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    # Load only the actual restoration function, never run the helper entrypoint.
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../src/platform/dns-helper.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'PowerShell syntax error' }
    $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Restore-Dns'}, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
    $backupFile = Join-Path $testRoot 'backup.json'
    $recoveryTaskName = 'test-only'
    $script:calls = @()
    $script:missing = $false
    function Get-NetAdapter { param([switch]$IncludeHidden) if (!$script:missing) { [pscustomobject]@{InterfaceGuid='{0E5F2C1A-3B4D-4E6F-8A9B-1C2D3E4F5A6B}'; ifIndex=19} } }
    function Invoke-Netsh([string[]]$Arguments) { $script:calls += ,$Arguments }
    function Clear-DnsClientCache {}
    function Unregister-ScheduledTask { param($TaskName,[switch]$Confirm,$ErrorAction) }
    $fixture = @'
[
 {"Guid":"{0E5F2C1A-3B4D-4E6F-8A9B-1C2D3E4F5A6B}","Index":7,"Name":"Ethernet","Family":"IPv4","Static":false,"Servers":["192.168.2.1"]},
 {"Guid":"{0E5F2C1A-3B4D-4E6F-8A9B-1C2D3E4F5A6B}","Index":7,"Name":"Ethernet","Family":"IPv6","Static":true,"Servers":["2606:4700:4700::1111","2606:4700:4700::1001"]}
]
'@
    [IO.File]::WriteAllText($backupFile,$fixture)
    Restore-Dns
    if ($script:calls.Count -ne 3) { throw "Expected 3 restore commands, got $($script:calls.Count)" }
    if (($script:calls[0] -join ' ') -ne 'interface ipv4 set dnsservers name=19 source=dhcp') { throw 'IPv4/DHCP or changed adapter index not restored correctly' }
    if (($script:calls[1] -join ' ') -ne 'interface ipv6 set dnsservers name=19 source=static address=2606:4700:4700::1111 validate=no') { throw 'IPv6 primary DNS not restored correctly' }
    if (($script:calls[2] -join ' ') -ne 'interface ipv6 add dnsservers name=19 address=2606:4700:4700::1001 index=2 validate=no') { throw 'IPv6 secondary DNS not restored correctly' }
    if (Test-Path -LiteralPath $backupFile) { throw 'Successful restoration must remove backup' }
    [IO.File]::WriteAllText($backupFile,$fixture)
    $script:missing = $true
    $failed = $false
    try { Restore-Dns } catch { $failed = $true }
    if (!$failed -or !(Test-Path -LiteralPath $backupFile)) { throw 'Missing adapter must preserve backup and report failure' }
    Write-Output 'PASS: IPv4, IPv6, DHCP, static DNS order, changed index, missing adapter'
} finally {
    # Only remove this test's exact, newly created temporary directory.
    if ((Split-Path $testRoot -Leaf) -like 'leise-restore-*' -and (Split-Path $testRoot -Parent) -eq ([IO.Path]::GetTempPath()).TrimEnd('\')) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
