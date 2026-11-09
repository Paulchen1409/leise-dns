# Signs an already built Leise DNS file with signtool.
# No certificate configured: exits 0 and signs nothing.
# Password is read from the environment, never from a script argument.
#   LEISE_SIGN_PFX + LEISE_SIGN_PASSWORD
#   LEISE_SIGN_THUMBPRINT
#   LEISE_AZURE_SIGN=1 + LEISE_AZURE_ACCOUNT/PROFILE/PUBLISHER/DLIB + AZURE_* 
param(
    [Parameter(Mandatory = $true)][string]$File
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $File)) { throw "Datei nicht gefunden: $File" }
$node = Get-Command node -ErrorAction SilentlyContinue
if (!$node) { throw 'Node.js wird für die Signierung gebraucht (scripts/sign-windows.js).' }
& node (Join-Path $PSScriptRoot 'sign-windows.js') --file $File
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
