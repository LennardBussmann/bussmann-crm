# Bussmann CRM - Einrichtung auf einem Windows-PC (Windows 10/11, 64 Bit)
# Start per Doppelklick auf Installieren.bat (fragt nach Administrator-Rechten).
$here = $PSScriptRoot
. (Join-Path $here 'common.ps1')

function Ask([string]$Text, [string]$Default) {
  $a = Read-Host ($Text + $(if ($Default) { " [$Default]" } else { '' }))
  if ($a) { return $a.Trim() } else { return $Default }
}
function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }

try {
  Write-Host '=============================================' -ForegroundColor Green
  Write-Host '   Bussmann CRM - Einrichtung auf diesem PC' -ForegroundColor Green
  Write-Host '=============================================' -ForegroundColor Green
  Write-Host 'Die Fragen in [Klammern] koennen mit Enter uebernommen werden.'
  Write-Host ''

  $cfg = Get-Config
  if (-not $cfg) { $cfg = [pscustomobject]@{} }
  function Prop($name, $value) { $cfg | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }

  $domain = Ask 'Adresse des CRM' $(if ($cfg.domain) { $cfg.domain } else { 'crm.bussmann-maschinen.de' })
  $parts = $domain.Split('.')
  $zone = ($parts[($parts.Length - 2)..($parts.Length - 1)] -join '.')
  $test = Ask 'Test-Adresse fuer den Probebetrieb' $(if ($cfg.test_domain) { $cfg.test_domain } else { 'crm-neu.' + $zone })
  Write-Host ''
  Write-Host 'Strato-DynDNS: Das Passwort legst du im Strato-Kundenlogin unter'
  Write-Host 'Domains > Verwaltung > Subdomain > DNS > DynDNS fest (siehe Anleitung).'
  $dynUser = Ask 'DynDNS-Benutzername (bei Strato = die Domain)' $(if ($cfg.dyndns_user) { $cfg.dyndns_user } else { $zone })
  $dynPass = Read-Host 'DynDNS-Passwort (leer lassen = spaeter eintragen)'
  if (-not $dynPass -and $cfg.dyndns_password) { $dynPass = $cfg.dyndns_password }
  Write-Host ''
  Write-Host 'Zweiter Sicherungsort: z. B. ein USB-Stick (E:\CRM-Sicherung) oder ein NAS-Ordner.'
  $copy = Ask 'Ordner fuer die zweite Sicherungskopie (leer = keiner)' $cfg.backup_copy_dir
  $mail = Ask 'E-Mail fuer Hinweise zum HTTPS-Zertifikat (optional)' $cfg.acme_email

  Prop 'domain' $domain
  Prop 'test_domain' $test
  Prop 'dyndns_user' $dynUser
  Prop 'dyndns_password' $dynPass
  if (-not $cfg.dyndns_hosts) { Prop 'dyndns_hosts' @($test) }
  Prop 'backup_copy_dir' $copy
  Prop 'acme_email' $mail
  if ($copy -and -not (Test-Path $copy)) { New-Item -ItemType Directory -Path $copy -Force -ErrorAction SilentlyContinue | Out-Null }
  Save-Config $cfg
  # Konfiguration enthaelt das DynDNS-Passwort: nur Administratoren und SYSTEM duerfen sie lesen
  & icacls $ConfigFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null

  Step 'Skripte kopieren'
  Get-ChildItem $here -File | Where-Object { $_.Extension -in '.ps1', '.js', '.bat' } | Copy-Item -Destination $ScriptDir -Force

  Step 'Node.js herunterladen (Laufzeit fuer das CRM)'
  $idx = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60
  $nv = ($idx | Where-Object { $_.version -like 'v22.*' -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1).version
  $haveNode = if (Test-Path $NodeExe) { (& $NodeExe --version) } else { '' }
  if ($haveNode -ne $nv) {
    $z = Join-Path $env:TEMP 'node.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$nv/node-$nv-win-x64.zip" -OutFile $z
    Expand-Zip $z (Join-Path $ToolsDir 'node-tmp')
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    Move-Item (Get-ChildItem (Join-Path $ToolsDir 'node-tmp') -Directory | Select-Object -First 1).FullName $NodeDir
    Remove-Item (Join-Path $ToolsDir 'node-tmp') -Recurse -Force
    Remove-Item $z -Force
  }
  Write-Host ('Node.js ' + (& $NodeExe --version))

  $gh = @{ 'User-Agent' = 'bussmann-crm-windows' }
  Step 'Caddy herunterladen (sichere HTTPS-Verbindung)'
  if (-not (Test-Path $CaddyExe)) {
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/caddyserver/caddy/releases/latest' -Headers $gh
    $asset = $rel.assets | Where-Object { $_.name -like '*_windows_amd64.zip' } | Select-Object -First 1
    $z = Join-Path $env:TEMP 'caddy.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $z
    Expand-Zip $z (Join-Path $ToolsDir 'caddy')
    Remove-Item $z -Force
  }
  Write-Host (& $CaddyExe version)

  Step 'Poppler herunterladen (zum Auslesen von Angebots-PDFs)'
  if (-not (Get-PopplerBin)) {
    try {
      $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest' -Headers $gh
      $asset = $rel.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
      $z = Join-Path $env:TEMP 'poppler.zip'
      Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $z
      Expand-Zip $z (Join-Path $ToolsDir 'poppler')
      Remove-Item $z -Force
    } catch { Write-Host 'Poppler konnte nicht geladen werden - Angebots-PDFs werden dann nicht automatisch ausgelesen.' -ForegroundColor Yellow }
  }

  Step 'CRM herunterladen und einrichten (dauert ein paar Minuten)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'update.ps1') -Force
  if (-not (Test-Path (Join-Path $AppDir 'server.js'))) { throw 'Das CRM konnte nicht heruntergeladen werden (siehe C:\BussmannCRM\logs\update.log).' }

  Step 'Webserver-Konfiguration'
  Write-Caddyfile $cfg

  Step 'Windows-Firewall: Ports 80 und 443 freigeben'
  foreach ($port in 80, 443) {
    $n = "Bussmann CRM ($port)"
    if (-not (Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $n -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any | Out-Null
    }
  }

  Step 'Energiesparen abschalten (PC darf nicht einschlafen)'
  $ErrorActionPreference = 'Continue'
  & powercfg /change standby-timeout-ac 0
  & powercfg /change hibernate-timeout-ac 0
  & powercfg /hibernate off
  $ErrorActionPreference = 'Stop'

  Step 'Automatischen Start einrichten'
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $user = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $forever = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  $short = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  function Act($file) { New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $ScriptDir $file) + '"') -WorkingDirectory $Root }
  function Every($minutes) {
    $t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $minutes) -RepetitionDuration (New-TimeSpan -Days 3650)
    return $t
  }
  $tasks = @(
    @{ n = 'Bussmann CRM';            a = (Act 'start-crm.ps1');   t = (New-ScheduledTaskTrigger -AtStartup); s = $forever },
    @{ n = 'Bussmann CRM Web';        a = (Act 'start-caddy.ps1'); t = (New-ScheduledTaskTrigger -AtStartup); s = $forever },
    @{ n = 'Bussmann CRM Update';     a = (Act 'update.ps1');      t = (Every 10); s = $short },
    @{ n = 'Bussmann CRM DynDNS';     a = (Act 'dyndns.ps1');      t = (Every 5);  s = $short },
    @{ n = 'Bussmann CRM Sicherung';  a = (Act 'backup.ps1');      t = (New-ScheduledTaskTrigger -Daily -At '03:00'); s = $short }
  )
  foreach ($x in $tasks) {
    Stop-ScheduledTask -TaskName $x.n -TaskPath '\Bussmann\' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $x.n -TaskPath '\Bussmann\' -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $x.n -TaskPath '\Bussmann\' -Action $x.a -Trigger $x.t -Principal $user -Settings $x.s | Out-Null
    Write-Host ('  ' + $x.n)
  }
  Stop-CrmNode
  Restart-Caddy
  Start-ScheduledTask -TaskPath '\Bussmann\' -TaskName 'Bussmann CRM'
  Start-ScheduledTask -TaskPath '\Bussmann\' -TaskName 'Bussmann CRM Web'
  if ($cfg.dyndns_password) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'dyndns.ps1') -Force }

  Step 'Pruefen, ob das CRM laeuft'
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    Start-Sleep -Seconds 2
    try { $ok = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/healthz' -TimeoutSec 5).StatusCode -eq 200 } catch { }
  }
  if (-not $ok) { throw 'Das CRM antwortet nicht. Bitte C:\BussmannCRM\logs\crm-fehler.log ansehen.' }

  $nic = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex
  $lan = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $nic | Select-Object -First 1).IPAddress
  Write-Host ''
  Write-Host '=============================================' -ForegroundColor Green
  Write-Host '   Fertig! Das CRM laeuft auf diesem PC.' -ForegroundColor Green
  Write-Host '=============================================' -ForegroundColor Green
  Write-Host ''
  Write-Host 'Jetzt noch im Router (z. B. FRITZ!Box) einstellen:'
  Write-Host ("  1. Diesem PC immer dieselbe Adresse geben: $lan")
  Write-Host ("  2. Portfreigabe: Port 80 und 443 (TCP) an $lan")
  Write-Host ''
  Write-Host 'Danach:'
  Write-Host ('  - Probebetrieb: https://' + $test + '  (leer, bis die Daten uebernommen sind)')
  Write-Host '  - Daten vom alten Server holen: Doppelklick auf "Daten-uebernehmen.bat"'
  Write-Host ''
  Write-Host 'Protokolle: C:\BussmannCRM\logs   Sicherungen: C:\BussmannCRM\backups'
} catch {
  Write-Host ''
  Write-Host ('FEHLER: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Bitte ein Foto/Screenshot dieses Fensters schicken.'
  exit 1
}
