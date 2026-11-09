# VPN, Hotspot und wechselnde Adapter

Leise DNS stellt verbundene Adapter auf `127.0.0.1` bzw. `::1` um und sichert vorher die bisherigen Server. Was dabei mit VPN, Hotspot und virtuellen Adaptern passiert, ist hier festgelegt. Die Simulation steckt in `tests/adopt-adapters.ps1` und `tests/core.test.js` (IPv6-Weiterleitung). Ein echtes VPN ersetzt das nicht.

## Verhalten

- **Neue Adapter** (WLAN, VPN, USB-Ethernet) werden übernommen: erst sichern, dann umstellen. Verschwindet ein nachträglich übernommener Adapter, fliegt er aus der Sicherung und blockiert die Wiederherstellung nicht.
- **VPN setzt DNS selbst zurück:** Leise DNS stellt denselben Adapter bis zu dreimal wieder auf den lokalen Dienst. Danach hört es auf, damit die Verbindung nicht flackert, und meldet den Adapter mit dem Text „setzt DNS selbst zurück“. Der Schutz ist auf diesem Adapter dann unvollständig (`nur teilweise verbunden`).
- **Split-DNS:** Hat der VPN-Adapter ein DNS-Suffix (zum Beispiel `firma.example` oder ein einzelnes internes Label wie `corp`), gehen Namen unter diesem Suffix an die **ursprünglichen** DNS-Server des VPN. IPv4 wird bevorzugt. Gibt es nur IPv6-Server, werden die genutzt, außer Link-Local (`fe80:`) und `::1`. Öffentliche Ein-Label-Suffixe wie `com` werden nie umgeleitet. Sperren gelten auch für diese Namen.
- **Nicht übernommen:** Hyper-V, vEthernet, Docker, WSL, VirtualBox, VMware, Bluetooth, Teredo, isatap, Wi-Fi Direct, mobiler Hotspot, Kernel-Debug, Npcap-Loopback. Ein Adapter, der als VPN erkannt wird (WireGuard, TAP, AnyConnect, …), bleibt dabei. Der Hotspot dieses PCs ist das Netz der Gäste, nicht der eigene Browser.

## Manuelle Fälle

Schutz einschalten, bevor das VPN verbunden wird. Nach jedem Fall `Get-DnsClientServerAddress` und eine Namensauflösung prüfen: eine öffentliche Domain läuft über Leise DNS (gesperrte Test-Domain bleibt gesperrt), ein interner Name unter dem VPN-Suffix löst sich auf, wenn das VPN einen liefert.

| Nr. | VPN / Adapter | Aktion | Erwartung |
| --- | --- | --- | --- |
| 1 | WireGuard oder OpenVPN, Split-Tunnel, mit DNS-Suffix | Verbinden, während der Schutz an ist | Neuer Adapter zeigt `127.0.0.1`/`::1`. Interner Name geht, öffentliche gesperrte Domain nicht. |
| 2 | Dasselbe VPN, Client setzt DNS nach einigen Sekunden wieder auf seinen Server | 30 Sekunden warten, Status in der App prüfen | Bis zu drei Rückstellungen, danach der Hinweis, dass das VPN DNS selbst setzt. Kein sekündliches Flackern der Verbindung. |
| 3 | VPN nur mit IPv6-DNS (keine IPv4-Server am Tunnel) | Verbinden | Interner Name wird trotzdem aufgelöst. `recovery` bzw. die Statuszeile nennt den IPv6-Server als Split-Route, nicht `::1`. |
| 4 | VPN trennen | Adapter weg | Sicherung ohne diesen Adapter, Rücksetzen des LAN/WLAN klappt weiter. |
| 5 | Mobiler Hotspot oder Docker/WSL starten | Adapter erscheint | Dessen DNS bleibt unverändert. Ethernet/WLAN bleiben auf dem lokalen Dienst. |
| 6 | WLAN aus und wieder an, Schutz bleibt an | Neu verbinden | WLAN wird wieder übernommen, ursprüngliche Server bleiben in der Sicherung die von vor der Umstellung. |

Die Ergebnisvorlage aus [boot-wiederherstellung.md](boot-wiederherstellung.md) gilt auch hier (Datum, Windows, Fall, DNS danach, Anmerkung). Fälle 1 bis 3 sind ohne ein installiertes VPN nicht prüfbar.
