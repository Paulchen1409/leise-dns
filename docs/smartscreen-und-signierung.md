# SmartScreen und Code-Signierung

Leise DNS ist ein lokales Programm für deinen eigenen Windows-PC. Solange der Installer **nicht** mit einem gekauften Herausgeberzertifikat signiert ist, zeigt Windows beim Start eine SmartScreen-Warnung. Das ist keine Fehlfunktion der App und kein Hinweis, dass die Datei verändert wurde. Windows kennt den Herausgeber schlicht noch nicht.

Diese Anleitung gilt für `Leise DNS Setup ….exe` und für `Leise DNS.exe` aus dem Ordner `win-unpacked`.

## Warnung überwinden (ohne Zertifikat)

1. Doppelklick auf die heruntergeladene Setup-Datei.
2. SmartScreen zeigt **„Der Computer wurde durch Windows geschützt“** bzw. **„Windows hat den PC geschützt“**. Der Herausgeber steht als unbekannt.
3. Auf **Weitere Informationen** klicken (nicht auf „Nicht ausführen“).
4. Prüfen, dass der Dateiname `Leise DNS Setup` lautet und die Datei von der Stelle stammt, von der du sie bewusst geholt hast (GitHub-Release von [Paulchen1409/leise-dns](https://github.com/Paulchen1409/leise-dns/releases) oder ein eigener Build).
5. Auf **Trotzdem ausführen** klicken.
6. Der Installer fragt nach dem Zielordner. Danach kann Windows beim **ersten Start der App** noch einmal fragen. Dieselbe Folge: Weitere Informationen → Trotzdem ausführen.

Die Warnung erscheint erneut, wenn eine neue unsignierte Version installiert wird. Sie verschwindet nicht durch einen Neustart.

SmartScreen prüft den Ruf des Zertifikats, nicht den Inhalt der Filterlisten. Ein selbst signiertes Zertifikat (selbst erstellt, ohne anerkannte Zertifizierungsstelle) beseitigt die Warnung **nicht**.

## Was der Betreiber noch selbst tun muss

Ein Zertifikat kann aus dieser Entwicklungsumgebung nicht gekauft, beantragt oder an einen HSM angeschlossen werden. Sobald eines vorliegt, signiert der vorhandene Build-Schritt damit. Bis dahin bleibt der Installer unsigniert, und die Schritte oben sind der vorgesehene Weg für Anwender.

## Zertifikatsoptionen

| Weg | SmartScreen | Aufwand | Passt zu Leise DNS |
| --- | --- | --- | --- |
| Unsigniert | Warnung bei jedem neuen Build, „Trotzdem ausführen“ | keiner | heutiger Zustand |
| Selbst signiert | Warnung bleibt | gering, aber wirkungslos für SmartScreen | nicht verwenden |
| OV Code Signing (z. B. Sectigo, Certum, SSL.com) | Warnung, bis der Herausgeber Ruf aufgebaut hat (oft einige Wochen und viele Installationen) | Zertifikat kaufen, Identität nachweisen, PFX oder Cloud-Schlüssel | sinnvoll für ein kleines Projekt |
| EV Code Signing | seit 2024 **kein** sofortiger SmartScreen-Vertrauensvorschuss mehr; Ruf zählt auch hier. Schlüssel liegt auf einem Hardware-Token | teurer, Token am Build-Rechner | nur, wenn der Token beim Bauen verfügbar ist |
| [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) | ebenfalls Ruf-basiert, Microsoft sagt ausdrücklich, dass es **keinen** sofortigen SmartScreen-Vertrauensvorschuss gibt. Dafür kein USB-Token, gut für Builds | Azure-Abonnement, Identitätsprüfung, Code-Signing-Konto und Zertifikatsprofil | gut, wenn der Build in der Cloud laufen soll |

Für ein einzelnes Desktop-Programm ist OV oder Azure Trusted Signing der übliche nächste Schritt. Den Ruf baut nur die echte Verbreitung signierter Dateien auf; ein frisches Zertifikat warnt anfangs weiter.

## Signierung einschalten

`npm run dist` ruft `scripts/dist-windows.js` auf. Ohne die Variablen unten wird **nicht** signiert (`CSC_IDENTITY_AUTO_DISCOVERY=false`, damit nicht zufällig ein anderes Zertifikat im Windows-Speicher verwendet wird). `npm run sign:check` zeigt nur die gewählte Art, nie das Passwort.

Eine schon gebaute Datei signiert `scripts/sign-windows.ps1 -File "dist\Leise DNS Setup 0.7.0.exe"` bzw. `node scripts/sign-windows.js --file <datei>`. Auch hier passiert ohne Zertifikat nichts, der Aufruf endet erfolgreich.

Der Build muss auf **Windows** laufen. `signtool.exe` kommt aus dem Windows SDK (oder `SIGNTOOL` zeigt auf die exe).

### PFX (OV, exportierbarer Schlüssel)

| Variable | Bedeutung |
| --- | --- |
| `LEISE_SIGN_PFX` | Pfad zur `.pfx`-Datei |
| `LEISE_SIGN_PASSWORD` | Passwort, nur als Umgebungsvariable, nie als Skriptargument |
| `LEISE_SIGN_PFX_BASE64` | alternativ der Base64-Inhalt (z. B. GitHub-Secret) |
| `WIN_CSC_LINK` / `CSC_LINK` und `WIN_CSC_KEY_PASSWORD` / `CSC_KEY_PASSWORD` | dieselben Angaben im electron-builder-Format, werden ebenfalls gelesen |
| `LEISE_TIMESTAMP_URL` | optional, Standard `http://timestamp.digicert.com` |

Fehlt das Passwort oder die Datei, bricht der Build **vor** dem Packen ab, statt einen unsignierten Installer als signiert auszugeben.

### Zertifikat im Windows-Zertifikatspeicher (auch EV-Token)

| Variable | Bedeutung |
| --- | --- |
| `LEISE_SIGN_THUMBPRINT` | SHA-1-Fingerabdruck, 40 Hex-Zeichen |

Der Token muss am Build-Rechner stecken und entsperrt sein. electron-builder erhält den Fingerabdruck als `signtoolOptions.certificateSha1`.

### Azure Trusted Signing

| Variable | Bedeutung |
| --- | --- |
| `LEISE_AZURE_SIGN` | `1`, damit dieser Weg auch bei zusätzlich gesetztem PFX gewinnt |
| `LEISE_AZURE_ACCOUNT` | Code Signing Account |
| `LEISE_AZURE_PROFILE` | Certificate Profile |
| `LEISE_AZURE_PUBLISHER` | Herausgebername **exakt** wie im Zertifikat |
| `LEISE_AZURE_ENDPOINT` | optional, Standard `https://eus.codesigning.azure.net` |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Anmeldung, von electron-builder bzw. dem Azure-SDK gelesen |

`npm run dist` reicht das an `win.azureSignOptions` weiter. Für das einzelne Nachsignieren mit signtool zusätzlich `LEISE_AZURE_DLIB` auf `Azure.CodeSigning.Dlib.dll` setzen.

Ist ein Zertifikat konfiguriert, setzt der Build `forceCodeSigning`: Schlägt signtool fehl, gibt es keinen stillen unsignierten Installer.

### Beispiel für ein späteres GitHub-Actions-Secret (nicht eingerichtet)

```yaml
# Erst anlegen, wenn das Zertifikat existiert. Ohne Secrets bleibt der Installer unsigniert.
env:
  LEISE_SIGN_PFX_BASE64: ${{ secrets.LEISE_SIGN_PFX_BASE64 }}
  LEISE_SIGN_PASSWORD: ${{ secrets.LEISE_SIGN_PASSWORD }}
steps:
  - run: npm run sign:check
  - run: npm run dist
```

Release-Text für unsignierte Versionen, zum Kopieren:

> Windows SmartScreen warnt, weil der Installer noch kein Herausgeberzertifikat hat. Auf „Weitere Informationen“ und dann „Trotzdem ausführen“ klicken. Die Schritte stehen in `docs/smartscreen-und-signierung.md`.
