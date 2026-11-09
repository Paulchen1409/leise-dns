$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('leise-adopt-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    # Load only the real functions, never run the helper entrypoint. Windows is simulated below.
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../src/platform/dns-helper.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'PowerShell syntax error' }
    foreach ($name in 'Test-VpnAdapter','Test-IgnoredAdapter','Test-IgnoredRow','Test-HasForeignDns','Test-LocalServers','Save-Backup','Sync-NewAdapters','Restore-Dns','Get-SplitDns','Repair-ContestedDns') {
        $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
        . ([scriptblock]::Create($definition.Extent.Text))
    }
    $backupFile = Join-Path $testRoot 'backup.json'
    $recoveryTaskName = 'test-only'
    $lan = '{11111111-1111-1111-1111-111111111111}'
    $vpn = '{22222222-2222-2222-2222-222222222222}'
    $script:calls = @(); $script:snapshot = @(); $script:adapters = @($lan); $script:failNetsh = $false; $script:backupAtNetsh = $null

    function Row($Guid, $Index, $Name, $Family, $Servers, $Suffix = '', $Description = '', $Vpn = $false) { [pscustomobject]@{ Guid=$Guid; Index=$Index; Name=$Name; Family=$Family; Static=$false; Servers=@($Servers); Suffix=$Suffix; Description=$Description; Vpn=$Vpn } }
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

    # Already adopted, and VPN software changed DNS itself: put it back, but only three times.
    $script:calls = @()
    $script:dnsContest = @{}
    $script:snapshot[2].Servers = @('10.8.0.53')
    if (Sync-NewAdapters) { throw 'The first reapply must not be reported as a hard error' }
    if ($script:calls.Count -ne 1 -or $script:calls[0] -notmatch 'address=127.0.0.1') { throw "VPN reset must be reapplied once: $($script:calls -join ' | ')" }
    $script:calls = @(); Sync-NewAdapters; Sync-NewAdapters
    if ($script:calls.Count -ne 2) { throw "Expected two further reapplies, got $($script:calls.Count)" }
    $script:calls = @()
    $givenUp = Sync-NewAdapters
    if ($script:calls.Count) { throw 'After three reapplies the VPN must be left alone' }
    if ($givenUp -notmatch 'setzt DNS selbst zurück') { throw "Give-up must be explained: $givenUp" }

    # Docker, Hyper-V and a mobile hotspot are not adopted.
    $script:dnsContest = @{}
    $script:snapshot[2].Servers = @('127.0.0.1')
    if ($script:snapshot.Count -gt 3) { $script:snapshot[3].Servers = @('::1') }
    $docker = '{33333333-3333-3333-3333-333333333333}'
    $script:calls = @()
    $beforeDocker = (Read-Backup).Count
    $script:adapters = @($lan, $vpn, $docker)
    $script:snapshot = @($script:snapshot | Where-Object { $_.Guid -ne $docker }) + @((Row $docker 30 'vEthernet (WSL)' 'IPv4' '172.16.0.1' '' 'Hyper-V Virtual Ethernet Adapter'))
    if (Sync-NewAdapters) { throw 'An ignored adapter must not report an error' }
    if ($script:calls.Count -or (Read-Backup).Count -ne $beforeDocker -or @((Read-Backup) | Where-Object { $_.Guid -eq $docker }).Count) { throw 'Hyper-V/Docker/hotspot adapters must not be adopted' }

    # A Hyper-V external switch carries the real internet path: adopted despite its name.
    $ext = '{44444444-4444-4444-4444-444444444444}'
    $script:adapters = @($lan, $vpn, $docker, $ext)
    $script:snapshot += @(((Row $ext 31 'vEthernet (Extern)' 'IPv4' '192.168.2.1' '' 'Hyper-V Virtual Ethernet Adapter #2') | Add-Member -NotePropertyName Gateway -NotePropertyValue $true -PassThru))
    $script:calls = @()
    Sync-NewAdapters | Out-Null
    if (@($script:calls | Where-Object { $_ -match 'name=31 ' }).Count -ne 1) { throw "An external switch with a default route must be adopted: $($script:calls -join ' | ')" }

    # Public single-label suffix is ignored.
    $script:adapters = @($lan, $vpn)
    $rows = Read-Backup; ($rows | Where-Object { $_.Guid -eq $vpn -and $_.Family -eq 'IPv4' }).Suffix = 'com'; Save-Backup $rows
    if (@(Get-SplitDns).Count) { throw 'A public single label must never become a route' }
    ($rows | Where-Object { $_.Guid -eq $vpn -and $_.Family -eq 'IPv4' }).Suffix = 'corp.example'; Save-Backup $rows

    # IPv6-only VPN DNS is a route. Link-local is not. IPv4 wins when both exist.
    $savedBackup = Get-Content -LiteralPath $backupFile -Raw
    $script:adapters = @($vpn)
    Save-Backup @((Row $vpn 21 'VPN' 'IPv6' '2001:db8::53' 'corp.example'))
    $routes = @(Get-SplitDns)
    if ($routes.Count -ne 1 -or $routes[0].servers[0] -ne '2001:db8::53') { throw 'IPv6-only VPN DNS must be used' }
    Save-Backup @((Row $vpn 21 'VPN' 'IPv6' 'fe80::1' 'corp.example'))
    if (@(Get-SplitDns).Count) { throw 'Link-local VPN DNS must not be a route' }
    Save-Backup @((Row $vpn 21 'VPN' 'IPv4' '10.8.0.1' 'corp.example'), (Row $vpn 21 'VPN' 'IPv6' '2001:db8::53' 'corp.example'))
    $routes = @(Get-SplitDns)
    if ($routes.Count -ne 1 -or $routes[0].servers[0] -ne '10.8.0.1') { throw 'IPv4 must be preferred over IPv6' }
    [IO.File]::WriteAllText($backupFile, $savedBackup)
    $script:adapters = @($lan, $vpn)

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

    Write-Output 'PASS: adoption, backup first, split DNS, bounded VPN reapply, ignored adapters, vanished adapter, retry'
} finally {
    # Only remove this test's exact, newly created temporary directory.
    if ((Split-Path $testRoot -Leaf) -like 'leise-adopt-*' -and (Split-Path $testRoot -Parent) -eq ([IO.Path]::GetTempPath()).TrimEnd('\')) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
