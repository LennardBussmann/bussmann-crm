# Startet das CRM und startet es nach einem Absturz automatisch neu.
# Wird von der geplanten Aufgabe "Bussmann CRM" beim Hochfahren gestartet.
. (Join-Path $PSScriptRoot 'common.ps1')
$ErrorActionPreference = 'Continue'
Set-Location $Root

while ($true) {
  # waehrend eines Updates warten (hoechstens 15 Minuten, falls ein Update haengen bleibt)
  if (Test-Path $UpdateFlag) {
    if (((Get-Date) - (Get-Item $UpdateFlag).LastWriteTime).TotalMinutes -lt 15) { Start-Sleep -Seconds 3; continue }
    Remove-Item $UpdateFlag -Force -ErrorAction SilentlyContinue
  }
  $cfg = Get-Config
  $env:NODE_ENV = 'production'
  $env:DATA_DIR = $DataDir
  $env:PORT = '3000'
  $env:TRUST_PROXY = '1'
  $env:COOKIE_SECURE = '1'
  if ($cfg -and $cfg.domain) { $env:APP_URL = 'https://' + $cfg.domain }
  $pop = Get-PopplerBin
  $env:PATH = $NodeDir + $(if ($pop) { ';' + $pop } else { '' }) + ';' + [Environment]::GetEnvironmentVariable('PATH', 'Machine')

  if (Test-Path (Join-Path $AppDir 'server.js')) {
    foreach ($f in @('crm.log', 'crm-fehler.log')) {
      $p = Join-Path $LogDir $f
      if (Test-Path $p) { Move-Item $p ($p + '.alt') -Force }
    }
    Write-Log 'start.log' 'CRM startet'
    Start-Process -FilePath $NodeExe -ArgumentList '--disable-warning=ExperimentalWarning', 'server.js' `
      -WorkingDirectory $AppDir -NoNewWindow -Wait `
      -RedirectStandardOutput (Join-Path $LogDir 'crm.log') -RedirectStandardError (Join-Path $LogDir 'crm-fehler.log')
    Write-Log 'start.log' 'CRM wurde beendet - Neustart in 5 Sekunden'
  }
  Start-Sleep -Seconds 5
}
