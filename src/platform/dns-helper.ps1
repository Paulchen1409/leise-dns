param(
    [switch]$Inspect,
    [switch]$RecoverOnly,
    [string]$Channel,
    [string]$UserSid,
    [string]$Session,
    [string]$TaskName,
    [switch]$Register,
    [string]$StorageRoot
)
$ErrorActionPreference = 'Stop'
$HelperVersion = 3
# Elevated code resolves system locations through Windows APIs, never through
# environment variables, which a normal user process could redirect.
$system32 = [Environment]::GetFolderPath('System')
$programData = [Environment]::GetFolderPath('CommonApplicationData')
$storage = if ($StorageRoot) { $StorageRoot } else { Join-Path $programData 'LeiseDNS' }
$backupFile = Join-Path $storage 'dns-backup.json'
$recoveryTaskName = 'LeiseDNS-RecoverDNS'
$trustedOwners = @('S-1-5-32-544', 'S-1-5-18', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')

function Get-ActiveAdapters {
    @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Loopback' })
}
function Test-VpnAdapter($Adapter) {
    return [string]$Adapter.InterfaceDescription -match 'VPN|WireGuard|Wintun|TAP[- ]|AnyConnect|Fortinet|FortiSSL|GlobalProtect|PANGP|Juniper|Pulse Secure|SonicWall|Tailscale|ZeroTier|Tunnel'
}
function Get-Snapshot {
    $rows = @()
    foreach ($adapter in Get-ActiveAdapters) {
        # Only a VPN's suffix is used for split DNS; a suffix from any other network is ignored.
        $suffix = ''
        if (Test-VpnAdapter $adapter) {
            $suffix = [string](@(Get-DnsClient -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue | Where-Object { $_.ConnectionSpecificSuffix }) | Select-Object -First 1).ConnectionSpecificSuffix
        }
        foreach ($family in @('IPv4','IPv6')) {
            $regBase = if ($family -eq 'IPv4') { 'Tcpip' } else { 'Tcpip6' }
            $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$regBase\Parameters\Interfaces\$($adapter.InterfaceGuid)"
            $static = (Get-ItemProperty -LiteralPath $key -Name NameServer -ErrorAction SilentlyContinue).NameServer
            $servers = @((Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily $family).ServerAddresses)
            $rows += [pscustomobject]@{ Guid = [string]$adapter.InterfaceGuid; Index = $adapter.ifIndex; Name = $adapter.Name; Family = $family; Static = [bool]$static; Servers = $servers; Suffix = $suffix }
        }
    }
    return $rows
}
function Invoke-Netsh([string[]]$Arguments) {
    $output = & (Join-Path $system32 'netsh.exe') @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Windows konnte DNS nicht einstellen: $output" }
}
function Restore-Dns {
    if (!(Test-Path -LiteralPath $backupFile)) { return }
    # Windows PowerShell 5.1 emits the entire JSON array as one pipeline object.
    # Wrapping the pipeline in @() nests it and merges IPv4/IPv6 properties.
    $rows = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json
    $failures = @()
    foreach ($row in $rows) {
        try {
            $adapter = Get-NetAdapter -IncludeHidden | Where-Object { [string]$_.InterfaceGuid -eq $row.Guid } | Select-Object -First 1
            if (!$adapter) {
                # A VPN adapter adopted later may be gone again; there is nothing left to restore.
                if ($row.Adopted) { continue }
                throw "Netzwerkadapter $($row.Name) ist nicht verfügbar."
            }
            $family = $row.Family.ToLowerInvariant()
            $nameArg = "name=$($adapter.ifIndex)"
            if (!$row.Static -or @($row.Servers).Count -eq 0) {
                Invoke-Netsh @('interface', $family, 'set', 'dnsservers', $nameArg, 'source=dhcp')
            } else {
                Invoke-Netsh @('interface', $family, 'set', 'dnsservers', $nameArg, 'source=static', "address=$($row.Servers[0])", 'validate=no')
                for ($i = 1; $i -lt @($row.Servers).Count; $i++) {
                    Invoke-Netsh @('interface', $family, 'add', 'dnsservers', $nameArg, "address=$($row.Servers[$i])", "index=$($i+1)", 'validate=no')
                }
            }
        } catch { $failures += $_.Exception.Message }
    }
    Clear-DnsClientCache
    if ($failures.Count) { throw ($failures -join ' ') }
    Remove-Item -LiteralPath $backupFile -Force
    Unregister-ScheduledTask -TaskName $recoveryTaskName -Confirm:$false -ErrorAction SilentlyContinue
}
function Save-Backup($Rows) {
    # Temporary file + rename: a crash never leaves a half-written backup behind.
    $temp = "$backupFile.tmp"
    [IO.File]::WriteAllText($temp, (ConvertTo-Json -InputObject @($Rows) -Depth 5))
    Move-Item -LiteralPath $temp -Destination $backupFile -Force
}
# Takes over adapters that came up while the protection is on (Wi-Fi, VPN, ...), without
# touching adapters already in the backup: VPN software that sets DNS itself is not fought.
# Returns an error text, or an empty string.
function Sync-NewAdapters {
    if (!(Test-Path -LiteralPath $backupFile)) { return '' }
    # No @() around the pipeline: Windows PowerShell 5.1 would nest the JSON array.
    $parsed = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json
    $saved = @($parsed | ForEach-Object { $_ })
    # An adopted adapter that no longer exists counts as new when it comes back.
    $existing = @(Get-NetAdapter -IncludeHidden | ForEach-Object { [string]$_.InterfaceGuid })
    $kept = @($saved | Where-Object { !$_.Adopted -or $existing -contains $_.Guid })
    $added = @()
    foreach ($row in @(Get-Snapshot)) {
        if (@($kept | Where-Object { $_.Guid -eq $row.Guid -and $_.Family -eq $row.Family }).Count) { continue }
        if (@($row.Servers | Where-Object { $_ -eq '127.0.0.1' -or $_ -eq '::1' }).Count) { continue }
        $row | Add-Member -NotePropertyName Adopted -NotePropertyValue $true
        $added += $row
    }
    if (!$added.Count) {
        if ($kept.Count -ne $saved.Count) { Save-Backup $kept }
        return ''
    }
    # Persist original state BEFORE touching any adapter.
    Save-Backup ($kept + $added)
    $failed = @(); $failures = @()
    foreach ($row in $added) {
        $address = if ($row.Family -eq 'IPv4') {'127.0.0.1'} else {'::1'}
        try { Invoke-Netsh @('interface',$row.Family.ToLowerInvariant(),'set','dnsservers',"name=$($row.Index)",'source=static',"address=$address",'validate=no') }
        catch { $failed += $row; $failures += "$($row.Name): $($_.Exception.Message)" }
    }
    if ($failed.Count) { Save-Backup ($kept + @($added | Where-Object { $failed -notcontains $_ })) }
    Clear-DnsClientCache
    return ($failures -join ' ')
}
# Domains under a connected VPN's DNS suffix, with the VPN's original DNS servers.
function Get-SplitDns {
    if (!(Test-Path -LiteralPath $backupFile)) { return }
    $parsed = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json
    $up = @(Get-ActiveAdapters | ForEach-Object { [string]$_.InterfaceGuid })
    foreach ($row in @($parsed | ForEach-Object { $_ })) {
        if ($row.Family -ne 'IPv4' -or !$row.Suffix -or $up -notcontains $row.Guid) { continue }
        $suffix = ([string]$row.Suffix).ToLowerInvariant().TrimEnd('.')
        # A single public label such as "com" must never redirect every name to a VPN server.
        if ($suffix -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$|^(corp|lan|local|internal|intranet|home)$') { continue }
        $servers = @($row.Servers | Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' -and $_ -ne '127.0.0.1' })
        if ($servers.Count) { [pscustomobject]@{ suffix = $suffix; servers = $servers } }
    }
}
if ($Inspect) {
    $rows = @(Get-Snapshot)
    $local = @($rows | Where-Object { @($_.Servers).Count -gt 0 -and @($_.Servers | Where-Object { $_ -ne '127.0.0.1' -and $_ -ne '::1' }).Count -eq 0 })
    $split = @(); try { $split = @(Get-SplitDns) } catch {}
    [pscustomobject]@{ adapters = $rows; configured = ($rows.Count -gt 0 -and $local.Count -eq $rows.Count); partial = ($local.Count -gt 0); backup = (Test-Path -LiteralPath $backupFile); splitDns = $split } | ConvertTo-Json -Depth 5 -Compress
    exit
}
if ($RecoverOnly) { Restore-Dns; exit }

# ---------------------------------------------------------------------------
# Helper service. Started either through UAC (-Session) or, after a one-time
# approval, through the per-user task "LeiseDNS-Helper-*" without a prompt.
#   Channel   user-writable folder; the helper only READS command.json there.
#   Storage   ProgramData\LeiseDNS, owned by Administrators; the helper writes
#             its state, the DNS backup and its own script copy only there.
# ---------------------------------------------------------------------------
function Test-TrustedOwner([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
    $owner = (Get-Acl -LiteralPath $Path).GetOwner([Security.Principal.SecurityIdentifier]).Value
    return $trustedOwners -contains $owner
}
function Protect-Storage {
    if ($StorageRoot) { New-Item -ItemType Directory -Path $storage -Force | Out-Null; return }
    if (!(Test-TrustedOwner $programData)) { throw "$programData ist nicht geschützt. Leise DNS legt dort keine Hilfsdateien an." }
    if (Test-Path -LiteralPath $storage) {
        # A folder created beforehand by a normal process must never be reused.
        if (!(Test-TrustedOwner $storage)) { throw "Der Ordner $storage gehört nicht den Administratoren. Bitte den Ordner löschen und erneut versuchen." }
    } else {
        New-Item -ItemType Directory -Path $storage | Out-Null
        & (Join-Path $system32 'icacls.exe') $storage '/setowner' '*S-1-5-32-544' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Der Leise-DNS-Ordner konnte nicht den Administratoren zugeordnet werden.' }
    }
    # Only Administrators and SYSTEM may modify the helper script, backup and state.
    & (Join-Path $system32 'icacls.exe') $storage '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Der Leise-DNS-Ordner konnte nicht geschützt werden.' }
}
function Install-HelperScript {
    $target = Join-Path $storage 'dns-helper.ps1'
    if ([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($target)) { Copy-Item -LiteralPath $PSCommandPath -Destination $target -Force }
    return $target
}
function Register-RecoveryTask {
    $recoveryScript = Install-HelperScript
    $action = New-ScheduledTaskAction -Execute (Join-Path $system32 'WindowsPowerShell\v1.0\powershell.exe') -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$recoveryScript`" -RecoverOnly"
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $recoveryTaskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
}
# The one-time approval: a task that starts exactly this protected script with
# fixed arguments and the highest privileges of the user's own account.
function Register-HelperTask {
    if ($StorageRoot) { throw 'Im Testmodus wird keine Windows-Aufgabe angelegt.' }
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($me -ne $UserSid) { throw 'Die Freigabe wurde mit einem anderen Windows-Konto bestätigt. Dauerhaft merken lässt sie sich nur, wenn dein eigenes Konto Administratorrechte hat.' }
    $helperScript = Install-HelperScript
    $account = ([Security.Principal.SecurityIdentifier]$UserSid).Translate([Security.Principal.NTAccount]).Value
    $argument = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$helperScript`" -Channel `"$Channel`" -UserSid $UserSid -TaskName $TaskName"
    $action = New-ScheduledTaskAction -Execute (Join-Path $system32 'WindowsPowerShell\v1.0\powershell.exe') -Argument $argument
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $description = 'Leise DNS: startet den DNS-Hilfsdienst ohne erneute Windows-Abfrage. Abschalten in Leise DNS unter Einstellungen.'
    try {
        # S4U runs without a visible console window.
        $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Highest
        Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Description $description -Force | Out-Null
    } catch {
        $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Highest
        Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Description $description -Force | Out-Null
    }
    # Allow the (non-elevated) account to start the task; nothing else.
    try {
        $service = New-Object -ComObject 'Schedule.Service'; $service.Connect()
        $task = $service.GetFolder('\').GetTask($TaskName)
        $sddl = $task.GetSecurityDescriptor(4)
        if ($sddl -notmatch [regex]::Escape(";GRGX;;;$UserSid)")) { $task.SetSecurityDescriptor($sddl + "(A;;GRGX;;;$UserSid)", 0) }
    } catch {}
}
function Unregister-HelperTask {
    if ($TaskName -and !$StorageRoot) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }
}
function Enable-LocalDns {
    if (Test-Path -LiteralPath $backupFile) { Restore-Dns }
    $rows = @(Get-Snapshot)
    if (!$rows.Count) { throw 'Kein aktiver Netzwerkadapter gefunden.' }
    if (@($rows | Where-Object { @($_.Servers | Where-Object { $_ -eq '127.0.0.1' -or $_ -eq '::1' }).Count -gt 0 }).Count) {
        throw 'Es ist bereits ein lokaler DNS-Server eingetragen, aber keine zugehörige Sicherung vorhanden. Bitte zunächst die ursprünglichen DNS-Einstellungen in Windows wiederherstellen.'
    }
    Protect-Storage
    Register-RecoveryTask
    # Persist original state BEFORE touching any adapter.
    Save-Backup $rows
    foreach ($row in $rows) {
        $address = if ($row.Family -eq 'IPv4') {'127.0.0.1'} else {'::1'}
        Invoke-Netsh @('interface',$row.Family.ToLowerInvariant(),'set','dnsservers',"name=$($row.Index)",'source=static',"address=$address",'validate=no')
    }
    Clear-DnsClientCache
}

if ($Channel -notmatch '^[A-Za-z]:\\[^"*?<>|]+$' -or $UserSid -notmatch '^S-1-5-[0-9-]+$' -or ($TaskName -and $TaskName -notmatch '^LeiseDNS-Helper-[0-9a-f]{12}$') -or ($Session -and $Session -notmatch '^[0-9a-f-]{36}$')) {
    throw 'Ungültige Parameter für den DNS-Hilfsdienst.'
}
Protect-Storage
$stateFile = Join-Path $storage "helper-$UserSid.state.json"
$commandFile = Join-Path $Channel 'command.json'
$script:currentSession = ''
$script:currentSeq = -1
$script:taskState = ''
$script:taskError = ''
$script:adapterError = ''
$script:adapterKey = ''
$nextAdapterCheck = Get-Date
$active = $false
$forget = $false

function Write-State([string]$phase, [string]$message = '') {
    $state = @{session=$script:currentSession; seq=$script:currentSeq; phase=$phase; error=$message; helperPid=$PID; version=$HelperVersion; task=$script:taskState; taskError=$script:taskError; adapterError=$script:adapterError} | ConvertTo-Json -Compress
    # Fresh temporary file + rename: never writes through a pre-existing file.
    $temp = Join-Path $storage ('state-' + [guid]::NewGuid().ToString('N') + '.tmp')
    $stream = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try { $bytes = [Text.Encoding]::UTF8.GetBytes($state); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    Move-Item -LiteralPath $temp -Destination $stateFile -Force
}
function Read-Command {
    try {
        $file = Get-Item -LiteralPath $commandFile -ErrorAction Stop
        if ($file.Length -gt 4096) { return $null }
        return (Get-Content -LiteralPath $commandFile -Raw | ConvertFrom-Json)
    } catch { return $null }
}

# Attach to exactly one app session: the UAC helper to the session it was
# started for, the task helper only to a session that asked for the task.
$attach = $null
$deadline = (Get-Date).AddSeconds(20)
while (!$attach -and (Get-Date) -lt $deadline) {
    $command = Read-Command
    if ($command -and $command.action -eq 'attach' -and [string]$command.session -match '^[0-9a-f-]{36}$') {
        if (($Session -and $command.session -eq $Session) -or (!$Session -and $command.via -eq 'task')) { $attach = $command }
    }
    if (!$attach) { Start-Sleep -Milliseconds 150 }
}
if (!$attach) { exit 3 }
$script:currentSession = [string]$attach.session
$script:currentSeq = [int]$attach.seq
$parentPid = [int]$attach.pid
$parent = Get-Process -Id $parentPid
$parentStart = $parent.StartTime.ToUniversalTime().Ticks

try {
    if ($Register -and $TaskName) {
        try { Register-HelperTask; $script:taskState = 'registered' } catch { $script:taskError = $_.Exception.Message }
    } elseif ($TaskName -and !$Session) { $script:taskState = 'registered' }
    Restore-Dns
    Write-State 'ready'
    $running = $true
    while ($running) {
        $parent = Get-Process -Id $parentPid -ErrorAction SilentlyContinue
        if (!$parent -or $parent.StartTime.ToUniversalTime().Ticks -ne $parentStart) { break }
        $command = Read-Command
        if ($command) {
            # Another app instance took over: hand back the original DNS settings.
            if ([string]$command.session -ne $script:currentSession) { break }
            if ([int]$command.seq -gt $script:currentSeq) {
                $script:currentSeq = [int]$command.seq
                try {
                    switch ([string]$command.action) {
                        'activate' { if (!$active) { Enable-LocalDns; $active = $true }; Write-State 'active' }
                        'deactivate' { Restore-Dns; $active = $false; if ($forget) { $running = $false } else { Write-State 'ready' } }
                        'stop' { $running = $false }
                        'forget' {
                            # Removed when the helper exits, never while DNS still points here.
                            $forget = $true; $script:taskState = 'removing'
                            if ($active) { Write-State 'active' } else { $running = $false }
                        }
                        default { throw 'Unbekannter DNS-Auftrag.' }
                    }
                } catch {
                    $reason = $_.Exception.Message
                    try { Restore-Dns; $active = $false } catch { $reason += ' Wiederherstellung: ' + $_.Exception.Message }
                    Write-State 'error' $reason
                }
            }
        }
        # Cheap check of which adapters are up; the full comparison only runs when that changes.
        if ($running -and $active -and (Get-Date) -ge $nextAdapterCheck) {
            $nextAdapterCheck = (Get-Date).AddSeconds(5)
            $message = ''
            try {
                $key = @(Get-ActiveAdapters | ForEach-Object { [string]$_.InterfaceGuid } | Sort-Object) -join ','
                if ($key -ne $script:adapterKey) {
                    $message = [string](Sync-NewAdapters)
                    # After a failure the key stays unset, so the next check tries again.
                    $script:adapterKey = if ($message) { '' } else { $key }
                } else { $message = $script:adapterError }
            } catch { $message = $_.Exception.Message; $script:adapterKey = '' }
            if ($message -ne $script:adapterError) { $script:adapterError = $message; Write-State 'active' }
        }
        if ($running) { Start-Sleep -Milliseconds 300 }
    }
} finally {
    $stopError = ''
    try { Restore-Dns } catch { $stopError = $_.Exception.Message }
    if ($forget) { try { Unregister-HelperTask; $script:taskState = 'removed' } catch { $script:taskError = $_.Exception.Message } }
    if ($stopError) { Write-State 'error' $stopError } else { Write-State 'stopped' }
}
