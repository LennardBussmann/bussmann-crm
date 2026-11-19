# Holt alle Daten vom bisherigen Linux-Server (Hetzner) auf diesen PC.
#  - Probelauf: der alte Server laeuft weiter, hier entsteht eine Kopie zum Testen.
#  - Endgueltiger Umzug: der alte Server wird angehalten, die Daten kommen hierher,
#    und crm.<domain> wird auf diesen PC umgestellt.
. (Join-Path $PSScriptRoot 'common.ps1')
$cfg = Get-Config
if (-not $cfg) { throw 'Bitte zuerst Installieren.bat ausfuehren.' }

Write-Host ''
Write-Host '=== Daten vom bisherigen Server uebernehmen ===' -ForegroundColor Cyan
$server = Read-Host 'Adresse des alten Servers [91.99.146.99]'
if (-not $server) { $server = '91.99.146.99' }
Write-Host ''
Write-Host '1 = Probelauf (alter Server laeuft weiter, ihr arbeitet dort normal weiter)'
Write-Host '2 = Endgueltiger Umzug (alter Server wird angehalten, ab jetzt laeuft alles hier)'
$mode = Read-Host 'Bitte 1 oder 2 eingeben'
$final = $mode -eq '2'
if ($final) {
  Write-Host ''
  Write-Host 'Vorher bei Strato fuer die Subdomain' $cfg.domain 'DynDNS einschalten (siehe Anleitung).' -ForegroundColor Yellow
  $ok = Read-Host 'Ist das erledigt und soll der alte Server jetzt angehalten werden? (ja/nein)'
  if ($ok -ne 'ja') { Write-Host 'Abgebrochen.'; exit 0 }
}

$compose = 'docker compose -f deploy/compose.prod.yml --env-file deploy/.env'
$excl = '--exclude=./crm.sqlite --exclude=./crm.sqlite-wal --exclude=./crm.sqlite-shm --exclude=./version.json'
if ($final) {
  # Auto-Update abschalten, damit der alte Server nicht von selbst wieder startet
  $remote = "cd /root/bussmann-crm && rm -f /etc/cron.d/bussmann-crm-update && $compose stop crm && $compose run --rm --no-deps crm node deploy/backup.js && tar czf /tmp/crm-umzug.tar.gz -C data $excl . && rm -f data/backup.sqlite"
} else {
  $remote = "cd /root/bussmann-crm && $compose exec -T crm node deploy/backup.js && tar czf /tmp/crm-umzug.tar.gz -C data $excl . && rm -f data/backup.sqlite"
}

Write-Host ''
Write-Host 'Verbinde mit dem alten Server. Gleich wird zweimal das Server-Passwort (root) abgefragt.' -ForegroundColor Cyan
& ssh -o StrictHostKeyChecking=accept-new "root@$server" $remote
if ($LASTEXITCODE -ne 0) { throw 'Auf dem alten Server ist etwas schiefgegangen (siehe Meldungen oben).' }
$local = Join-Path $Root 'crm-umzug.tar.gz'
& scp -o StrictHostKeyChecking=accept-new "root@${server}:/tmp/crm-umzug.tar.gz" $local
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $local)) { throw 'Herunterladen fehlgeschlagen.' }

# bisherige lokale Daten zur Sicherheit aufheben
Write-Host 'Spiele die Daten ein ...'
Set-Content $UpdateFlag 'x'
try {
  Stop-CrmNode
  Start-Sleep -Seconds 2
  $keep = Join-Path $Root ('data-vorher-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
  $ver = Join-Path $DataDir 'version.json'
  $verText = if (Test-Path $ver) { Get-Content $ver -Raw } else { $null }
  Rename-Item $DataDir (Split-Path $keep -Leaf)
  New-Item -ItemType Directory $DataDir | Out-Null
  & (Join-Path $env:WINDIR 'System32\tar.exe') -xzf $local -C $DataDir
  if ($LASTEXITCODE -ne 0) { throw 'Entpacken fehlgeschlagen' }
  Move-Item (Join-Path $DataDir 'backup.sqlite') (Join-Path $DataDir 'crm.sqlite')
  if ($verText) { [IO.File]::WriteAllText($ver, $verText, (New-Object Text.UTF8Encoding $false)) }
  Remove-Item $local -Force
} finally {
  Remove-Item $UpdateFlag -Force -ErrorAction SilentlyContinue
}

if ($final) {
  $hosts = @($cfg.domain)
  if ($cfg.test_domain) { $hosts += $cfg.test_domain }
  $cfg.dyndns_hosts = $hosts
  Save-Config $cfg
  Write-Caddyfile $cfg
  Restart-Caddy
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'dyndns.ps1') -Force
  Write-Host ''
  Write-Host 'Umzug abgeschlossen!' -ForegroundColor Green
  Write-Host ('In 5 bis 30 Minuten zeigt https://' + $cfg.domain + ' auf diesen PC.')
  Write-Host 'Den Hetzner-Server erst nach ein paar Tagen ohne Probleme kuendigen.'
} else {
  Write-Host ''
  Write-Host 'Probelauf fertig!' -ForegroundColor Green
  Write-Host ('Zum Testen: https://' + $cfg.test_domain + '  (Anmeldung wie gewohnt)')
  Write-Host 'Achtung: Was ihr hier im Test aendert, wird beim endgueltigen Umzug ueberschrieben.'
}
Write-Host ('Die vorherigen Daten dieses PCs liegen unter ' + $keep)
