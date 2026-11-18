# Startet Caddy (HTTPS mit kostenlosem Zertifikat) vor dem CRM.
# Wird von der geplanten Aufgabe "Bussmann CRM Web" beim Hochfahren gestartet.
. (Join-Path $PSScriptRoot 'common.ps1')
$ErrorActionPreference = 'Continue'
Set-Location $Root
$env:XDG_DATA_HOME = Join-Path $Root 'caddy-daten'
$env:XDG_CONFIG_HOME = Join-Path $Root 'caddy-daten'

while ($true) {
  $p = Join-Path $LogDir 'web.log'
  if (Test-Path $p) { Move-Item $p ($p + '.alt') -Force }
  Start-Process -FilePath $CaddyExe -ArgumentList 'run', '--config', (Join-Path $Root 'Caddyfile'), '--adapter', 'caddyfile' `
    -WorkingDirectory $Root -NoNewWindow -Wait -RedirectStandardError $p -RedirectStandardOutput (Join-Path $LogDir 'web-ausgabe.log')
  Start-Sleep -Seconds 5
}
