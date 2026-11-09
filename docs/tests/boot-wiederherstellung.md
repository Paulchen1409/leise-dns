# Boot- und Absturz-Wiederherstellung

Leise DNS stellt die gesicherten DNS-Server wieder her, wenn die App endet. Zusätzlich legt der Hilfsprozess die Aufgabe `LeiseDNS-RecoverDNS` an (Konto SYSTEM, höchste Rechte). Sie startet `dns-helper.ps1 -RecoverOnly`:

- beim Windows-Start, 45 Sekunden verzögert
- bei der Anmeldung, 20 Sekunden verzögert
- bis zu fünfmal im Abstand von einer Minute, falls ein Versuch scheitert (`StartWhenAvailable`, auch im Akkubetrieb)

Die Sicherung liegt in `%ProgramData%\LeiseDNS\dns-backup.json` und wird erst geschrieben, bevor die Aufgabe registriert und bevor irgendein Adapter umgestellt wird. Erst nach einer vollständigen Rücksetzung werden Sicherung und Aufgabe entfernt. Fehlt die Sicherung, entfernt die Aufgabe sich selbst. Jeder Versuch schreibt nach `%ProgramData%\LeiseDNS\recovery.log` (die Datei wird bei etwa 64 KB gekürzt).

Nach einem harten Neustart sind Adapter oft noch nicht aufgezählt, besonders WLAN. Die Wiederherstellung wartet bis zu 90 Sekunden, bis jede **nicht nachträglich übernommene** Adapter-GUID aus der Sicherung in `Get-NetAdapter -IncludeHidden` sichtbar ist. Getrenntes WLAN zählt mit: die Einstellung gilt für die nächste Verbindung. Ein VPN-Adapter, der erst während des Schutzes dazukam und beim Start weg ist, wird übersprungen und blockiert die Rücksetzung nicht.

Das ist der kritischste Pfad der Windows-Anbindung. Die Simulation in `tests/recovery-boot.ps1` prüft Warten, Protokoll, Behalten der Sicherung und das Entfernen einer leeren Aufgabe. Sie ersetzt keinen echten Neustart.

## Was nur an einem echten Windows-PC geht

Stromverlust, Reset-Taste und „Energie – Herunterfahren“ lassen sich hier nicht ausführen. Diesen Plan am Entwicklungs-PC abarbeiten und die Vorlage unten ausfüllen. Vorher eine aktuelle unsignierte oder signierte Version installieren, die den Hilfsprozess der Version 4 enthält (die App fragt nach dem Update einmal erneut nach der Windows-Freigabe). Schutz einschalten, im Protokoll `dns-backup.json` und in der Aufgabenplanung `LeiseDNS-RecoverDNS` sehen.

Nach jedem Fall prüfen:

1. `Get-DnsClientServerAddress` zeigt wieder die Server von **vor** dem Einschalten (nicht `127.0.0.1` / `::1`), für IPv4 und IPv6, an Ethernet und an WLAN.
2. `%ProgramData%\LeiseDNS\dns-backup.json` ist weg.
3. Die Aufgabe `LeiseDNS-RecoverDNS` ist weg (`Get-ScheduledTask -TaskName LeiseDNS-RecoverDNS` meldet sie nicht).
4. `recovery.log` enthält `DNS wiederhergestellt` bzw. beim Fehlversuch den genannten Grund.
5. `nslookup example.com` (oder der Browser) löst Namen auf. Eine zuvor gesperrte Domain ist nicht mehr gesperrt, weil der Schutz aus ist.

## Fälle

| Nr. | Ausgang | Aktion | Erwartung |
| --- | --- | --- | --- |
| 1 | Schutz an, Ethernet, App-Fenster offen | App über „Beenden & DNS zurücksetzen“ beenden | Sofortige Rücksetzung, keine Boot-Aufgabe mehr. Vergleichswert für die harten Fälle. |
| 2 | Schutz an | App im Task-Manager beenden (`Leise DNS.exe`) | Der Hilfsprozess bemerkt das Ende und setzt innerhalb weniger Sekunden zurück. Aufgabe und Sicherung weg. |
| 3 | Schutz an, App läuft | Startmenü → Herunterfahren, danach normal starten, anmelden | Rücksetzung, bevor oder kurz nachdem die Anmeldung da ist. `recovery.log` hat einen Eintrag mit Uhrzeit des Starts. |
| 4 | Schutz an | Reset-Taste oder langes Drücken des Einschalters, danach starten | Wie 3. Das ist der eigentliche Stromausfall-Fall. Nicht nur „Neu starten“ aus dem Startmenü. |
| 5 | Schutz an, nur WLAN (Ethernet-Kabel gezogen oder Adapter deaktiviert) | Wie 4, WLAN erst nach der Anmeldung verbunden | Auch das getrennte WLAN-Profil zeigt wieder den alten DNS-Server, sobald es sichtbar ist. Bis zu etwa zwei Minuten und die Wiederholungen der Aufgabe abwarten, bevor es als Fehler gilt. |
| 6 | Schutz an, Ethernet, zusätzlich WLAN verbunden | Wie 4 | Beide Adapter zurück, nicht nur der, der beim Start zuerst da war. |
| 7 | Schutz an, dann VPN verbinden (siehe `vpn-adapter.md`), Schutz bleibt an | Reset wie 4, VPN ist nach dem Start getrennt | LAN/WLAN zurück. Der verschwundene VPN-Adapter verhindert die Rücksetzung nicht. Sicherung weg. |
| 8 | Schutz an | Während `recovery.log` noch nicht „wiederhergestellt“ sagt, ein zweites Mal hart aus- und einschalten | Die Sicherung bleibt liegen, bis ein Versuch wirklich durchläuft. Kein leeres oder halbes `dns-backup.json`. |
| 9 | Schutz aus | Normaler Neustart | Keine Aufgabe `LeiseDNS-RecoverDNS`, DNS unverändert. |

Fall 4 und Fall 5 sind die, die bisher nicht live geprüft sind. Ohne sie gilt die Boot-Wiederherstellung nicht als abgenommen.

## Ergebnisvorlage

Eine Zeile pro Fall. Datum, Windows-Ausgabe (`winver`), Rechner (nur eine kurze Bezeichnung, keine Seriennummer), Tester.

| Datum | Windows | Rechner | Fall | Erwartung getroffen | DNS danach | Sicherung weg | Aufgabe weg | Log-Zeile | Anmerkung |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  | 1 | ja/nein |  | ja/nein | ja/nein |  |  |
|  |  |  | 2 |  |  |  |  |  |  |
|  |  |  | 3 |  |  |  |  |  |  |
|  |  |  | 4 Stromverlust |  |  |  |  |  |  |
|  |  |  | 5 WLAN |  |  |  |  |  |  |
|  |  |  | 6 Ethernet und WLAN |  |  |  |  |  |  |
|  |  |  | 7 VPN war verbunden |  |  |  |  |  |  |
|  |  |  | 8 zweiter Stromverlust |  |  |  |  |  |  |
|  |  |  | 9 Schutz aus |  |  |  |  |  |  |

Kommandos, die die Spalten füllen:

```powershell
Get-DnsClientServerAddress | Select-Object InterfaceAlias, AddressFamily, ServerAddresses | Format-Table -AutoSize
Test-Path "$env:ProgramData\LeiseDNS\dns-backup.json"
Get-ScheduledTask -TaskName 'LeiseDNS-RecoverDNS' -ErrorAction SilentlyContinue
Get-Content "$env:ProgramData\LeiseDNS\recovery.log" -Tail 20
```
