# Leise DNS

Ein lokaler DNS-Adblocker für **diesen Windows-PC**. Electron, Vanilla JavaScript, Chart.js und SQLite. Kein Docker, kein Webkonto, kein Server im Heimnetz.

## Direkt starten

`Start-LeiseDNS.cmd` doppelklicken. Alternativ `dist/win-unpacked/Leise DNS.exe` starten; dafür muss der ganze Ordner `win-unpacked` zusammenbleiben. Der aktuelle Installer liegt unter `dist/Leise DNS Setup 0.6.1.exe`.

Version 0.7.0 prüft unter Einstellungen, ob es auf GitHub eine neuere Version gibt, und zeigt die Änderungsnotizen. Installiert wird nichts automatisch. Die Versionszeile in der Seitenleiste kommt aus der App selbst.

Version 0.1.2 korrigiert das Einlesen der DNS-Sicherung unter Windows PowerShell 5.1. Eine zusätzliche Array-Klammer fasste IPv4 und IPv6 versehentlich zusammen und verursachte die Meldung „Netzwerkadapter Ethernet Ethernet ist nicht verfügbar“. Ein neuer Test prüft die echte Wiederherstellungsfunktion mit simulierten Adaptern: DHCP, statische Serverreihenfolge, geänderte Adapterindizes und den Erhalt der Sicherung bei fehlenden Adaptern. Alle 13 Tests bestehen. Die vorhandene DNS-Sicherung auf dem Entwicklungs-PC wurde mit dem korrigierten Skript erfolgreich wiederhergestellt; die erledigte Boot-Aufgabe wurde entfernt und der DNS-Status anschließend geprüft.

Version 0.1.1 behebt den Abbruch nach der Admin-Freigabe: Eine normale PowerShell-Fortschrittsmeldung auf `stderr` wurde als Fehler interpretiert. Der Launcher entscheidet jetzt anhand der Hilfsprozess-Antwort und des echten Exitcodes. Vorzeitig beendete Helfer werden sofort gemeldet; verspätete Helfer erhalten einen Stoppauftrag. Für bestehende Installationen die alte App über das Tray beenden und den Installer 0.1.1 ausführen. Regeln und Statistiken bleiben im bisherigen Benutzerdatenordner.

1. Die App prüft den lokalen DNS-Dienst und die aktuellen Adaptereinstellungen. StevenBlack wird beim ersten Start heruntergeladen; Cloudflare ist vorausgewählt.
2. Im Dashboard **„Mit einem Klick einrichten“** wählen und die Windows-Abfrage für Administratorrechte bestätigen. Ein echter DNS-Verbindungstest muss vorher erfolgreich sein.
3. Das Fenster darf geschlossen werden: Der Dienst läuft im Infobereich weiter. Ein Klick auf das Tray-Symbol öffnet den Schnellzugriff; ein Doppelklick das Dashboard.
4. **Pausieren**, **dauerhaft ausschalten** oder **„Beenden & DNS zurücksetzen“** stellt die gesicherten DNS-Einstellungen wieder her. Zeitpausen aktivieren den Schutz anschließend automatisch. „Bis App-Neustart“ bezieht sich auf einen Neustart dieser App.

Nach einer erfolgreichen Einrichtung nimmt die App einen zuvor eingeschalteten Schutz beim nächsten App-Start wieder auf. Dazu kann Windows erneut Administratorrechte anfordern. „Dauerhaft aus“ bleibt aus. Unter Einstellungen → Start lässt sich „Mit Windows starten“ einschalten: Leise DNS startet dann nach der Anmeldung ohne Fenster im Infobereich (Eintrag unter `HKCU\…\Run`, Startargument `--autostart`). Ein eingeschalteter Schutz wird fortgesetzt.

**Windows-Freigabe merken** (Einstellungen → Start, standardmäßig an): Beim ersten Einschalten bestätigst du die Windows-Abfrage ein letztes Mal. Der erhöhte Hilfsprozess legt dabei die Aufgabe `LeiseDNS-Helper-…` für dein eigenes Konto mit höchsten Rechten an. Danach startet Leise DNS den Hilfsprozess über diese Aufgabe – ohne Abfrage, auch nach einem Neustart. Das funktioniert nur für Konten, die selbst Administratoren sind; bestätigt jemand anderes die Abfrage, fragt Windows weiterhin jedes Mal. Schlägt der Start über die Aufgabe fehl (oder gehört die Kopie zu einer älteren Version), erscheint wieder die normale Windows-Abfrage, die die Aufgabe dabei erneuert.

Absicherung: Die Aufgabe startet ausschließlich `C:\ProgramData\LeiseDNS\dns-helper.ps1` mit festen Argumenten. Dieser Ordner gehört den Administratoren; ein vorher von einem normalen Prozess angelegter Ordner wird nicht verwendet. Der erhöhte Prozess *liest* Aufträge nur aus `…\helper\command.json` im Benutzerordner (nur „einschalten“, „ausschalten“, „beenden“, „Freigabe entfernen“) und *schreibt* nur in den geschützten Ordner. Systempfade ermittelt er über Windows-APIs statt über Umgebungsvariablen. Verbleibendes Risiko: Ein Programm, das bereits unter deinem Konto läuft, könnte über die Aufgabe den DNS dieses PCs auf den lokalen Dienst umstellen – sonst nichts. Abschalten des Schalters entfernt die Aufgabe (sobald der Schutz aus ist). Vor einer Deinstallation den Schalter ausschalten; sonst bleibt die Aufgabe in der Aufgabenplanung stehen und kann dort gelöscht werden.

## 1. Grundstruktur

```text
DNS ADBLOCK 2/
├── package.json                  Start, Tests und Windows-Paket
├── pnpm-lock.yaml                Exakte Abhängigkeiten
├── Start-LeiseDNS.cmd            Start per Doppelklick
├── assets/                       App- und Tray-Symbole (generiert)
├── scripts/make-icon.js          Rendert das Markenzeichen in ICO/PNG
├── src/
│   ├── main/
│   │   ├── main.js               Electron, Tray, Fenster, Lebenszyklus
│   │   ├── preload.js            Begrenzte Schnittstelle zur Oberfläche
│   │   └── smoke.js              Oberflächentest und Screenshots (nur Testmodus)
│   ├── core/
│   │   ├── dns-proxy.js          Lokaler UDP-/TCP-DNS-Proxy
│   │   ├── domains.js            Domainprüfung und Filterparser
│   │   ├── store.js              SQLite, Regeln, Anfragen, Statistik
│   │   ├── filters.js            Download und atomare Listenupdates
│   │   └── service.js            Pausen, Anbieter und App-Aktionen
│   ├── platform/
│   │   ├── windows-dns.js        Status und erhöhter Hilfsprozess
│   │   └── dns-helper.ps1        Sichern, Umstellen, Wiederherstellen
│   └── renderer/
│       ├── index.html            Dashboard und alle Verwaltungsseiten
│       ├── app.js                Vanilla JS, Chart.js, Live-Aktualisierung
│       ├── ui.js                 Statusmodell und Darstellungseinstellungen (geteilt)
│       ├── icons.js              Lokales SVG-Icon-System und Markenzeichen
│       ├── lens.js               Optionale Lichtbrechung an Glaskanten
│       ├── popup.html / popup.js Tray-Schnellzugriff
│       └── styles/
│           ├── tokens.css        Design-Tokens: Farben, Material, Radien, Abstände, Typo, Bewegung
│           ├── materials.css     Hintergrund, Inhaltsflächen, Glas, Scroll-Kante
│           ├── components.css    Buttons, Schalter, Segmente, Felder, Toast, Dialog
│           ├── app.css           Fenster, Navigation und Seiten
│           └── popup.css         Tray-Popup
└── tests/                        Kern-, Windows-DNS- und Statusmodell-Tests
```

## 2. DNS-Proxy-Kern

`dns-proxy.js` bindet **ausschließlich 127.0.0.1:53 und [::1]:53**, jeweils für UDP und TCP. Es gibt keinen HTTP-Verwaltungsport und keine Bindung an `0.0.0.0` oder LAN-Adressen.

Reihenfolge pro Anfrage:

1. Wenn der Schutz pausiert ist: unverändert weiterleiten.
2. Domain mit der Whitelist vergleichen. Einträge gelten auch für Unterdomains und haben Vorrang vor allen Sperren.
3. Eigene Blacklist und aktivierte Filterlisten prüfen. Eine Sperre liefert `NXDOMAIN` ohne Anfrage an den Anbieter.
4. Erlaubte Anfragen an Cloudflare, Google oder Quad9 weiterleiten. Transaktions-ID, Absender und ursprüngliche Frage werden geprüft. Abgeschnittene UDP-Antworten werden über TCP erneut angefordert.
5. CNAME-Ziele ebenfalls auf Sperren prüfen; eine explizit erlaubte Ursprungsdomain bleibt erlaubt. Zeitüberschreitungen liefern `SERVFAIL` und werden als Fehler protokolliert.

Verbindungsgrenzen, Zeitlimits und Größenlimits begrenzen offene DNS-Verbindungen. DNSSEC-Daten erlaubter Antworten werden durchgereicht; die App ist kein eigener DNSSEC-Validator. Erlaubte Antworten liegen zusätzlich in einem kurzen Speicher: die TTL des Anbieters, gedeckelt auf 60 Sekunden (im Bereich 30–120 Sekunden), höchstens 2048 Einträge, getrennt nach Anbieter bzw. VPN-Server und Record-Typ. Sperren, Fehler und abgeschnittene Antworten werden nicht gespeichert. Unter Einstellungen steht, wie voll der Speicher ist.

**Windows-Anbindung:** Der Hilfsprozess läuft nur für die Lebensdauer der App mit Administratorrechten. Vor jeder Aktivierung werden aktive Netzwerkadapter mit GUID, Adressfamilie, automatischem/statischem DNS und Serverreihenfolge gesichert. Beide Adressfamilien werden umgestellt. Beim Ausschalten werden die Originalwerte zurückgeschrieben.

Der Hilfsprozess überwacht den Elternprozess und stellt nach dessen Ende die Einstellungen wieder her. Zusätzlich wird während aktiven Schutzes eine Wiederherstellungsaufgabe registriert, damit ein harter Neustart nicht dauerhaft auf einen fehlenden lokalen DNS-Dienst verweist. Sie läuft als SYSTEM beim Windows-Start (45 Sekunden verzögert) und bei der Anmeldung, wartet bis zu 90 Sekunden auf die Adapter aus der Sicherung und versucht es bis zu fünfmal erneut. Jeder Versuch landet in `%ProgramData%\LeiseDNS\recovery.log`. Die Sicherung wird geschrieben, bevor die Aufgabe angelegt und bevor ein Adapter angefasst wird. Sicherung und Skript liegen in einem gegen Schreibzugriffe normaler Benutzer geschützten Ordner `%ProgramData%\LeiseDNS`. Nach erfolgreicher Rücksetzung werden Sicherung und Aufgabe entfernt; ohne Sicherung entfernt die Aufgabe sich selbst. Bei Rücksetzungsfehlern bleibt die App beim normalen Beenden geöffnet und zeigt den Fehler. Der konkrete Prüfplan für Stromausfall, WLAN und VPN steht in [docs/tests/boot-wiederherstellung.md](docs/tests/boot-wiederherstellung.md).

**Neu verbundene Adapter:** Während der Schutz läuft, prüft der Hilfsprozess alle fünf Sekunden, welche Adapter verbunden sind. Kommt einer dazu (WLAN, VPN), werden seine ursprünglichen DNS-Werte zuerst gesichert und er dann auf den lokalen Dienst umgestellt. Schlägt das fehl, zeigt die App den Fehler und versucht es erneut. Virtuelle Adapter, die nicht der eigene Netzzugang sind (Docker, WSL, Hyper-V, VirtualBox, VMware, Bluetooth, mobiler Hotspot, Teredo), werden ausgelassen. Ein bereits gesicherter Adapter, dessen DNS von VPN-Software zurückgesetzt wird, wird bis zu dreimal wieder auf den lokalen Dienst gestellt und danach in Ruhe gelassen; die App erklärt das und zeigt „nur teilweise verbunden“. Ein später übernommener Adapter, den es nicht mehr gibt (viele VPNs entfernen ihren Adapter beim Trennen), verschwindet aus der Sicherung und blockiert keine Wiederherstellung.

**VPN-Split-DNS:** Bringt ein VPN-Adapter einen eigenen DNS-Suffix mit (z. B. `firma.example`), gehen Namen unter diesem Suffix an den ursprünglichen DNS-Server des VPN. IPv4-Server werden bevorzugt; gibt es nur IPv6-Server, werden die verwendet (nicht Link-Local und nicht `::1`). Alles andere geht an den gewählten Anbieter. Sperren gelten auch dort. Das gilt nur für Adapter, die sich anhand ihrer Beschreibung als VPN erkennen lassen, solange sie verbunden sind; einzelne öffentliche Endungen wie `com` werden nie umgeleitet. Interne Namen ohne Suffix-Angabe des VPN werden nicht abgedeckt. VPN-Software kann DNS außerdem selbst verwalten oder fremde Anbieter blockieren; ein fehlgeschlagener Verbindungstest verhindert die Einrichtung. Der manuelle Prüfplan steht in [docs/tests/vpn-adapter.md](docs/tests/vpn-adapter.md).

## 3. Oberfläche und Designsystem

Die Oberfläche orientiert sich an Apples Liquid-Glass-Designsprache (Desktop-Ausprägung), bleibt aber eine eigenständige Windows-App mit eigener Marke.

**Drei Materialebenen** (`styles/materials.css`):

- **Hintergrund:** ruhiger, bläulicher Graphit mit wenigen großen, weichen Farbflächen (Blau, Petrol, etwas Violett, Mint) und feinem Korn gegen Farbstufen. Nicht animiert.
- **Inhalt:** dichtere, ruhige Flächen für Zahlen, Diagramme, Tabellen und Listen – ohne Hintergrund-Blur, damit Daten klar bleiben.
- **Glas:** schwebende Navigation, Statusfläche, Toolbar, Status-Kapsel, Dialog und Toast. Tönung + Weichzeichnung + Sättigung, eine rundum modulierte Lichtkante (hell oben links und unten rechts), innere Reflexe sowie Kontakt- und Umgebungsschatten. Kein Glas auf Glas: Bedienelemente auf Glas verwenden Füllungen.

Die Schutzfarbe liegt als Licht *hinter* der Statusfläche und wird vom Glas weich durchgelassen (Mint = aktiv, Amber = pausiert, Rot = Fehler, Blau = Vorgang läuft). Status wird immer zusätzlich mit Text und Symbol gezeigt.

**Lichtbrechung:** An der schwebenden Log-Toolbar, der Status-Kapsel und am gedrückten Hauptschalter bricht eine SVG-Verschiebungskarte den Hintergrund an den Kanten (`lens.js`, Chromium `backdrop-filter: url()`). Text und Symbole liegen darüber und werden nie verzerrt. Das ist eine Annäherung – keine native Materialdarstellung. Bei reduzierter Transparenz oder abgeschaltet in den Einstellungen bleibt das normale Glasmaterial.

**Fenster:** Die Windows-Titelleiste ist ausgeblendet; die Seitenkopfzeile ist Zugfläche. Minimieren, Maximieren (inkl. Snap-Layouts) und Schließen sind die echten Windows-Schaltflächen (Window Controls Overlay).

**Tokens** (`styles/tokens.css`) zentralisieren Farben, Glas-Tönungen, Lichtkanten, Schatten, Blur-Stärken, Radien (konzentrisch), Abstände (4-px-Raster), Typografie (Segoe UI Variable, tabellarische Ziffern) sowie Dauer und Easing (140–240 ms).

**Barrierefreiheit:** Einstellungen → Darstellung bietet „Transparenz reduzieren“, „Bewegung reduzieren“ und „Lichtbrechung“; „Automatisch“ folgt den Windows-Einstellungen. Sichtbare Tastaturfokusse, beschriftete Schalter und Symbolbuttons, Klickflächen ab 44 px (Tabellenaktionen kompakter). Fallback ohne `backdrop-filter`: deckende Flächen.

**Dashboard:** Schutzstatus mit großem Schalter (echter Zwischenzustand während der Aktivierung) und allen Zuständen – Einrichtung erforderlich, aktiv, zeitlich pausiert, bis App-Neustart pausiert, dauerhaft aus, Aktivierung läuft, Windows-Freigabe erforderlich, Dienst nicht erreichbar, Einrichtung/Zurücksetzen fehlgeschlagen. Darunter die Pausenoptionen, Kennzahlen (Heute/7/30 Tage), Chart.js-Verlauf (7 Tage in 3-Stunden-, 30 Tage in 12-Stunden-Blöcken; Zeiten ohne Aufzeichnung, etwa weil der PC oder der Schutz aus war, erscheinen als Lücke und nicht als 0), Top 8 blockierte Domains und die letzten fünf Anfragen. SQLite ist die einzige Quelle für Verkehrsdaten; keine Demo-Zahlen.

**Query-Log:** Neue Einträge werden einzeln oben eingefügt. Wer weiter unten liest, bleibt exakt an seiner Position; ein Hinweis „N neue Anfragen“ führt zurück nach oben.

Die Oberfläche lädt keine Schriftarten, Skripte oder Statistikdienste aus dem Internet. Electron verwendet isolierte Renderer ohne Node-Zugriff, Sandbox und eine begrenzte IPC-Schnittstelle; die Content Security Policy blieb unverändert streng (keine Inline-Skripte oder -Styles).

## 3a. Sperrseite für Malware und Phishing

Zwei zusätzliche, standardmäßig aktive Listen schützen vor gefährlichen Seiten: **URLhaus** (Malware; Daten von abuse.ch, bezogen über [urlhaus-filter](https://gitlab.com/malware-filter/urlhaus-filter), weil abuse.ch für direkte Downloads inzwischen einen persönlichen Schlüssel verlangt) und **Phishing Army** (Phishing). Jede Liste hat eine Kategorie (Werbung & Tracker, Malware, Phishing); das Query-Log zeigt solche Sperren als „Malware“ bzw. „Phishing“ mit Listennamen.

Für Domains dieser beiden Kategorien antwortet der DNS-Dienst nicht mit NXDOMAIN, sondern mit der lokalen Adresse `127.53.0.1` (TTL 60 s, IPv6-Anfragen ohne Daten). Dort liefert Leise DNS eine Hinweisseite aus: gesperrte Domain, Grund, Quelle, warum man die Seite sieht und was jetzt zu tun ist. Die Seite enthält kein JavaScript, setzt eine strikte CSP und lässt sich nicht einbetten. Eine Ausnahme ist bewusst nur in der App möglich (Anfragen → Erlauben, mit zusätzlicher Bestätigung) – nie über die Webseite selbst. Läuft der Hinweisserver nicht (z. B. Port 80 belegt), bleibt es bei NXDOMAIN. Werbung und Tracker werden weiterhin still mit NXDOMAIN blockiert.

**https (optional, Einstellungen → Sperrseite):** Für verschlüsselte Seiten braucht der Browser ein gültiges Zertifikat. Leise DNS erzeugt dafür auf diesem PC eine eigene Zertifizierungsstelle (EC P-256, zwei Jahre gültig, keine Unter-CAs) und installiert sie nach einer Windows-Abfrage ausschließlich in den Speicher *Vertrauenswürdige Stammzertifizierungsstellen* des eigenen Windows-Kontos. Der private Schlüssel liegt mit Windows DPAPI verschlüsselt in `blockpage-ca.json` im Benutzerdatenordner. Zertifikate (7 Tage gültig) werden nur im Speicher und nur für Host-Namen ausgestellt, die gerade als Malware oder Phishing gesperrt sind. Ausschalten entfernt das Zertifikat (erneute Windows-Abfrage) und löscht den Schlüssel.

Risiko: Wer den Schlüssel stehlen kann – also Schadsoftware, die bereits unter deinem Konto läuft –, könnte für dieses Konto beliebige Webseiten fälschen. Ohne die Option gibt es dieses Risiko nicht; gesperrte https-Seiten zeigen dann nur die Fehlermeldung des Browsers. Chrome und Edge nutzen den Windows-Zertifikatspeicher; Firefox übernimmt ihn je nach Einstellung (`security.enterprise_roots.enabled`) und zeigt sonst eine Zertifikatswarnung.



StevenBlack ist voreingestellt und aktiv. EasyList und EasyPrivacy können zugeschaltet werden. Jede Liste hat ihren eigenen Schalter, Update-Button, Zeitstempel, Domainzähler und Fehlerstatus. „Alle aktualisieren“ lädt auch ausgeschaltete Listen, ohne sie dabei einzuschalten. Eigene Listen lassen sich per HTTPS-URL hinzufügen und nach Bestätigung löschen.

Unterstützt werden Hosts-Dateien, eine Domain pro Zeile, `||domain.example^` und dieselbe Regel mit Optionen, die weiterhin die ganze Domain meinen (`$third-party`, `$script`, `$image` und die anderen üblichen Typen). **Ausnahmen (`@@`), Pfade, Platzhalter, kosmetische Filter und Regeln mit `domain=` oder `~` werden nicht als komplette Domain-Sperren interpretiert.** Jede Regelzeile zählt als genutzt oder übersprungen. Die Filterseite zeigt `genutzt / Regeln` und den Prozentanteil; EasyList und EasyPrivacy bleiben damit unvollständig, aber der genutzte Anteil ist sichtbar. Eine leere, ungültige oder fehlgeschlagene neue Liste ersetzt niemals eine funktionierende Liste. Downloads sind auf 32 MB und 45 Sekunden begrenzt.

**Automatische Updates** (Filterlisten, standardmäßig an): Eingeschaltete Listen werden aktualisiert, sobald ihr letztes Update mehr als einen Tag zurückliegt. Die App prüft das eine Minute nach dem Start und danach alle 15 Minuten; war der PC aus, wird das Update nachgeholt. Schlägt ein Versuch fehl, steht der Grund bei der Liste und der nächste Versuch folgt frühestens nach einer Stunde. Hat eine neue Liste weniger als die Hälfte der bisherigen Domains (ab 1.000 Einträgen), wird sie nicht automatisch übernommen, weil das eher auf einen kaputten Download hindeutet; „Aktualisieren“ übernimmt sie von Hand. Damit der DNS-Dienst während eines Updates weiter antwortet, werden nur geänderte Domains geschrieben und die Listen schrittweise neu eingelesen; die bisherigen Sperren gelten, bis das abgeschlossen ist. Die aktiven Domains liegen in einem Label-Trie: gemeinsame Endungen teilen sich Knoten, die Suche bleibt exakt, und der fertige Trie ersetzt den alten erst am Ende des schrittweisen Ladens. Die Übersicht nennt den belegten Arbeitsspeicher des Prozesses.

Domainzähler pro Liste zählen eindeutige Domains innerhalb dieser Liste; eine Domain kann in mehreren Listen vorkommen. Die Dashboard-Zahl entfernt Überschneidungen zwischen aktivierten Listen. Eigene Blacklist-Einträge werden separat gehalten und sind nicht Teil dieser Filterlisten-Zahl.

Whitelist und Blacklist haben je eine eigene Seite mit Live-Suche. Ein Eintrag schließt Unterdomains ein; `example.com` trifft `a.example.com`, aber nicht `notexample.com`. Dieselbe exakte Domain wird beim Hinzufügen in die andere Liste verschoben. Eine erlaubte übergeordnete Domain hat weiterhin Vorrang vor einer spezielleren Sperre. Unter Einstellungen → Regeln sichern lassen sich beide Listen als JSON speichern und auf einem anderen PC zusammenführen oder ersetzen. Filterlisten sind nicht Teil der Datei.

## 5. Query-Log und Speicherung

Das Query-Log zeigt Zeit, Domain, Status und eine direkte Whitelist-/Blacklist-Aktion. Suchfeld und Statusfilter arbeiten ohne Neuladen. Der Live-Feed lässt sich unabhängig vom Schutz anhalten. Fehlergrund und DNS-Typ stehen zusätzlich im Tooltip.

Die SQLite-Datei `leise.sqlite` liegt im Electron-Benutzerdatenordner (`app.getPath('userData')`, typischerweise unter `%APPDATA%`). WAL-Transaktionen sichern Regeln und Zähler sofort. Einzelanfragen bleiben für sieben Tage bzw. ungefähr 10.000 Einträge erhalten, stündliche Statistiken und Domain-Ranglisten für 90 Tage. Die Aufräumroutine läuft jede Minute. Das Query-Log zeigt die neuesten 200 passenden Einträge.

DNS-Sperren können Werbung und Inhalt derselben Domain nicht trennen. Apps mit eigenem DNS-over-HTTPS oder DNS-over-TLS können System-DNS umgehen. Die Übersicht zeigt deshalb den Hinweis „Einige Apps können den Schutz umgehen“ mit den Schaltern in Chrome, Edge, Firefox, Brave und Windows 11; die Hilfeseiten öffnet nur eine feste Adressliste. Bereits von Windows oder einer Anwendung zwischengespeicherte Antworten können nach Regeländerungen noch bis zum Ablauf ihres Caches verwendet werden. Beim Umstellen des System-DNS leert der Hilfsprozess den Windows-DNS-Cache.

## Entwickeln und prüfen

Voraussetzung für die Entwicklung: Windows und Node.js ab 22.16. Die gepackte App bringt Node/Electron mit.

```powershell
npm install
npm start
npm test
npm run smoke
npm run pack
npm run dist
```

Für reproduzierbare Installationen mit dem vorhandenen Lockfile: `pnpm install --frozen-lockfile`. Der Oberflächentest (`npm run smoke`) verwendet einen separaten, bei jedem Lauf geleerten Datenordner, Port 15353 und einen simulierten Windows-Adapterdienst, der keine DNS-Änderungen zulässt. Er prüft Chart.js, Formularaktionen und Validierung, befüllt die Testdatenbank mit synthetischen Anfragen, fotografiert alle Seiten bei 1280×900, 1440×900, 880×650 sowie 125 %/150 % Skalierung, alle Schutzzustände in Dashboard und Tray-Popup, reduzierte Transparenz, Tastaturfokus und das echte Fensterrahmen-Bild. Außerdem prüft er horizontales Überlaufen, abgeschnittene Bedienelemente und die stabile Leseposition im Query-Log. Ergebnisse: `artifacts/screens/` und `artifacts/smoke.json`.

Icons neu erzeugen: `npx electron scripts/make-icon.js`.

**Verifiziert:** Zwölf erfolgreiche Kern-/Integrationstests für UDP und TCP mit lokalem Test-Upstream, Sperrantworten, Whitelist-Priorität, CNAME, TCP-Fallback, Timeout, fehlerhafte Pakete, Parsergrenzen, SQLite-Persistenz, Listenupdate-Rollback, Pausenübergänge und automatische Wiederaufnahme. Hinzu kommen der PowerShell-Fortschrittsfehler, abgebrochene Freigaben, vorzeitig beendete Helfer und der echte PowerShell-Start/Stopp-Ablauf mit isoliertem Sicherungsordner ohne UAC und ohne DNS-Änderung. Electron-Oberfläche inklusive Chart.js, Hinzufügen und Filtern einer Domain geprüft, auch in der gepackten Windows-App. Windows-Adapterstatus auf dem Entwicklungs-PC erfolgreich ausgelesen. Alle drei vordefinierten Filterlisten erfolgreich von ihren echten URLs geladen und verarbeitet.

**Version 0.2.0:** Alle 18 Tests bestehen (13 bisherige plus 5 für das Statusmodell der Oberfläche). Der erweiterte Oberflächentest läuft ohne Layoutbefunde. Das Redesign ändert keine DNS-, Datenbank- oder Wiederherstellungslogik; neu im Backend ist nur das Statusfeld `helper` (Windows-Freigabe steht noch aus) und die Popup-Höhenanpassung `popup:fit`, die nur vom Popup-Fenster akzeptiert wird.

**Version 0.3.0:** Autostart und gemerkte Windows-Freigabe. 28 automatisierte Tests bestehen, darunter Start über die Aufgabe, Rückfall auf die Windows-Abfrage, Erneuern veralteter Aufgaben, Entfernen der Freigabe, Sitzungsübernahme und ein echter Hilfsprozess, der im Testmodus keine Aufgabe anlegt. Die echte Aufgabenregistrierung mit Administratorrechten ist nicht automatisiert getestet, weil sie eine Windows-Abfrage erfordert.

**Version 0.4.0:** Sperrseite für Malware und Phishing. 34 automatisierte Tests bestehen, unter anderem DNS-Antworten, Inhalt und Sicherheits-Header der Hinweisseite, TLS mit vollständiger Zertifikatsprüfung, Ausstellung nur für gesperrte Namen, verschlüsselte Ablage und abgebrochene Windows-Abfrage. Der Oberflächentest prüft die echte DNS-Antwort und die ausgelieferte Seite auf Testports. Das Installieren des Zertifikats in Windows ist nicht automatisiert getestet, weil es eine Windows-Abfrage erfordert.

**Version 0.5.0:** Lücken im Verlauf, automatische Übernahme neuer Adapter und VPN-Split-DNS. 37 automatisierte Tests bestehen; die Adapter-Übernahme läuft dabei mit simulierten Adaptern, Split-DNS mit lokalem Test-Server, nicht mit einem echten VPN. Weil sich der Hilfsprozess geändert hat, fragt Windows nach dem Update einmal erneut nach der Freigabe.

**Version 0.6.0:** Automatische Updates für Filterlisten. Der Hilfsprozess ist unverändert, deshalb fragt Windows beim Update nicht erneut nach der Freigabe. Live geprüft: Vier Listen wurden etwa eine Minute nach dem Start von selbst erneuert; alle 114 parallelen DNS-Anfragen wurden beantwortet (Median 19 ms, langsamste 362 ms).

**Version 0.6.1:** Neue Adresse für URLhaus, weil die alte mit HTTP 410 abgeschaltet ist. Bestehende Installationen übernehmen sie automatisch.

**Live auf dem Entwicklungs-PC geprüft (0.5.0, Ethernet):** Umstellung auf den lokalen Dienst, harter Abbruch der App (Original-DNS nach etwa einer Sekunde zurück, Sicherung und Boot-Aufgabe entfernt), Neustart mit gemerkter Freigabe ohne Windows-Abfrage, Sperren von Werbung (NXDOMAIN) und Phishing (`127.53.0.1`), die http- und https-Sperrseite mit Windows-Zertifikatsprüfung.

**Noch nicht live geprüft:** Die Boot-Wiederherstellung nach Stromausfall oder Neustart bei aktivem Schutz und das Verhalten mit einem echten VPN-Client. Dafür gibt es auszufüllende Prüfpläne: [docs/tests/boot-wiederherstellung.md](docs/tests/boot-wiederherstellung.md) und [docs/tests/vpn-adapter.md](docs/tests/vpn-adapter.md). Die Simulationen ersetzen keinen echten Reset und kein echtes VPN. Die https-Sperrseite wurde mit `curl` und ohne Sperrlistenprüfung getestet, nicht in einem Browser.

**Virenschutz mit TLS-Prüfung:** ESET Security lief beim Test mit. In einer Stichprobe aus 80 gelisteten Domains erhielten 52 beim Verbindungsaufbau `access denied`, bevor die Sperrseite erscheinen konnte; das hängt allein von der Domain ab und passt zu ESETs eigener Sperrliste, ist aber nicht direkt nachgewiesen. Geschützt ist man in beiden Fällen, nur erscheint dann nicht die Hinweisseite von Leise DNS.

Der Installer ist nicht mit einem Herausgeberzertifikat signiert. Windows SmartScreen warnt deshalb beim Installieren und beim ersten Start. Anwender klicken auf **Weitere Informationen** und dann **Trotzdem ausführen**. Die vollständige Anleitung, die Zertifikatsoptionen (OV, EV, Azure Trusted Signing) und wie die Signierung per Umgebungsvariable in `npm run dist` einrastet, stehen in [docs/smartscreen-und-signierung.md](docs/smartscreen-und-signierung.md). Ohne gesetztes Zertifikat wird der Schritt übersprungen; `npm run sign:check` zeigt die gewählte Art, ohne Geheimnisse auszugeben.

Der Hintergrunddienst ist ein Electron-Prozess mit separatem Wiederherstellungshelfer, kein dauerhaft installierter Windows-Service.

Technische Referenzen: [Electron-Tray](https://www.electronjs.org/docs/latest/tutorial/tray), [Electron-App-Lebenszyklus](https://www.electronjs.org/docs/latest/api/app), [Node.js SQLite](https://nodejs.org/api/sqlite.html), [Windows DNS-Einstellungen](https://learn.microsoft.com/en-us/powershell/module/dnsclient/set-dnsclientserveraddress?view=windowsserver2025-ps).
