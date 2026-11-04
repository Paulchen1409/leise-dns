$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('leise-adopt-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    # Load only the real functions, never run the helper entrypoint. Windows is simulated below.
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../src/platform/dns-helper.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'PowerShell syntax error' }
    foreach ($name in 'Save-Backup','Sync-NewAdapters','Restore-Dns','Get-SplitDns') {
        $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
        . ([scriptblock]::Create($definition.Extent.Text))
    }
    $backupFile = Join-Path $testRoot 'backup.json'
    $recoveryTaskName = 'test-only'
    $lan = '{11111111-1111-1111-1111-111111111111}'
    $vpn = '{22222222-2222-2222-2222-222222222222}'
    $script:calls = @(); $script:snapshot = @(); $script:adapters = @($lan); $script:failNetsh = $false; $script:backupAtNetsh = $null

    function Row($Guid, $Index, $Name, $Family, $Servers, $Suffix = '') { [pscustomobject]@{ Guid=$Guid; Index=$Index; Name=$Name; Family=$Family; Static=$false; Servers=@($Servers); Suffix=$Suffix } }
    function Get-Snapshot { $script:snapshot }
    function Get-ActiveAdapters { $script:adapters | ForEach-Object { [pscustomobject]@{ InterfaceGuid=$_; ifIndex=7 } } }
    function Get-NetAdapter { param([switch]$IncludeHidden) $script:adapters | ForEach-Object { [pscustomobject]@{ InterfaceGuid=$_; ifIndex=7 } } }
    function Invoke-Netsh([string[]]$Arguments) {
        if ($null -eq $script:backupAtNetsh) { $script:backupAtNetsh = Get-Content -LiteralPath $backupFile -Raw }
        if ($script:failNetsh) { throw 'Zugriff verweigert' }
        $script:calls += ,($Arguments -join ' ')
    }
    function Clear-DnsClientCache {}
    function Unregister-ScheduledTask { param($TaskName,[switch]$Confirm,$ErrorAction) }
    function Read-Backup { $parsed = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json; @($parsed | ForEach-Object { $_ }) }
    function Initial { Save-Backup @((Row $lan 7 'Ethernet' 'IPv4' '192.168.2.1'), (Row $lan 7 'Ethernet' 'IPv6' 'fe80::1')) }

    # Nothing new: no command, backup unchanged.
    Initial
    $script:snapshot = @((Row $lan 7 'Ethernet' 'IPv4' '127.0.0.1'), (Row $lan 7 'Ethernet' 'IPv6' '::1'))
    if (Sync-NewAdapters) { throw 'No change must not report an error' }
    if ($script:calls.Count) { throw 'Known adapters must not be changed' }

    # New adapter: both families switched, original servers saved before the first change.
    $script:adapters = @($lan, $vpn)
    $script:snapshot += @((Row $vpn 21 'VPN' 'IPv4' '10.8.0.1' 'corp.example'), (Row $vpn 21 'VPN' 'IPv6' @()))
    if (Sync-NewAdapters) { throw 'Adoption must not report an error' }
    if ($script:calls.Count -ne 2) { throw "Expected 2 commands, got $($script:calls.Count)" }
    if ($script:calls[0] -ne 'interface ipv4 set dnsservers name=21 source=static address=127.0.0.1 validate=no') { throw "Wrong IPv4 command: $($script:calls[0])" }
    if ($script:calls[1] -ne 'interface ipv6 set dnsservers name=21 source=static address=::1 validate=no') { throw "Wrong IPv6 command: $($script:calls[1])" }
    if ($script:backupAtNetsh -notmatch '10\.8\.0\.1') { throw 'Backup must be written before an adapter is changed' }
    $rows = Read-Backup
    if ($rows.Count -ne 4 -or @($rows | Where-Object Adopted).Count -ne 2) { throw 'Backup must hold the adopted rows' }

    # Split DNS: VPN suffix with its original server; IPv6 and suffix-less rows give no route.
    $routes = @(Get-SplitDns)
    if ($routes.Count -ne 1 -or $routes[0].suffix -ne 'corp.example' -or $routes[0].servers[0] -ne '10.8.0.1') { throw 'Split DNS route is wrong' }
    $script:adapters = @($lan)
    if (@(Get-SplitDns).Count) { throw 'A disconnected VPN must not keep its route' }
    $script:adapters = @($lan, $vpn)

    # Already adopted, and VPN software changed DNS itself: it is not fought.
    $script:calls = @()
    $script:snapshot[2].Servers = @('10.8.0.53')
    if (Sync-NewAdapters) { throw 'Known adapter must not report an error' }
    if ($script:calls.Count) { throw 'A VPN managing its own DNS must not be overwritten' }

    # Public single-label suffix is ignored.
    $rows = Read-Backup; ($rows | Where-Object { $_.Guid -eq $vpn -and $_.Family -eq 'IPv4' }).Suffix = 'com'; Save-Backup $rows
    if (@(Get-SplitDns).Count) { throw 'A public single label must never become a route' }

    # A vanished adopted adapter leaves the backup, so it is adopted again when it returns.
    $script:adapters = @($lan); $script:snapshot = @((Row $lan 7 'Ethernet' 'IPv4' '127.0.0.1'), (Row $lan 7 'Ethernet' 'IPv6' '::1'))
    if (Sync-NewAdapters) { throw 'Vanished adapter must not report an error' }
    if ((Read-Backup).Count -ne 2) { throw 'Vanished adopted adapter must be removed from the backup' }

    # Restore skips an adopted adapter that is gone and still removes the backup.
    Save-Backup @((Row $lan 7 'Ethernet' 'IPv4' '192.168.2.1'), ((Row $vpn 21 'VPN' 'IPv4' '10.8.0.1') | Add-Member -NotePropertyName Adopted -NotePropertyValue $true -PassThru))
    $script:calls = @()
    Restore-Dns
    if ($script:calls.Count -ne 1 -or (Test-Path -LiteralPath $backupFile)) { throw 'Restore must skip a vanished adopted adapter and finish' }

    # Failure: reported, and the row is dropped from the backup so the next check retries.
    Initial
    $script:adapters = @($lan, $vpn); $script:failNetsh = $true; $script:calls = @()
    $script:snapshot = @((Row $lan 7 'Ethernet' 'IPv4' '127.0.0.1'), (Row $vpn 21 'VPN' 'IPv4' '10.8.0.1'))
    $message = Sync-NewAdapters
    if ($message -notmatch 'Zugriff verweigert') { throw 'A failed change must be reported' }
    if (@(Read-Backup | Where-Object { $_.Guid -eq $vpn }).Count) { throw 'A failed adapter must not stay in the backup' }
    $script:failNetsh = $false

    # An adapter already pointing to the local service is never saved as its "original".
    Initial
    $script:calls = @(); $script:snapshot = @((Row $vpn 21 'VPN' 'IPv4' '127.0.0.1'))
    if (Sync-NewAdapters) { throw 'Local adapter must not report an error' }
    if ($script:calls.Count -or (Read-Backup).Count -ne 2) { throw 'A local DNS entry must not become the saved original' }

    Write-Output 'PASS: adoption, backup first, split DNS, no fight with VPN, vanished adapter, retry'
} finally {
    # Only remove this test's exact, newly created temporary directory.
    if ((Split-Path $testRoot -Leaf) -like 'leise-adopt-*' -and (Split-Path $testRoot -Parent) -eq ([IO.Path]::GetTempPath()).TrimEnd('\')) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
