# Holt neue Versionen des CRM von GitHub und spielt sie ein.
# Laeuft alle 10 Minuten ueber die geplante Aufgabe "Bussmann CRM Update".
# Von Hand:  powershell -ExecutionPolicy Bypass -File C:\BussmannCRM\scripts\update.ps1 -Force
param([switch]$Force)
. (Join-Path $PSScriptRoot 'common.ps1')

$lock = Join-Path $Root 'update.lock'
if ((Test-Path $lock) -and (((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 30)) { exit 0 }
Set-Content $lock 'x'
try {
  $h = Get-GitHubHeaders
  $c = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/main" -Headers $h -TimeoutSec 30
  $sha = $c.sha
  $shaFile = Join-Path $Root 'installierte-version.txt'
  $current = if (Test-Path $shaFile) { (Get-Content $shaFile -Raw).Trim() } else { '' }
  if (-not $Force -and $current -eq $sha -and (Test-Path (Join-Path $AppDir 'server.js'))) { exit 0 }

  Write-Log 'update.log' ('Neue Version gefunden: ' + $sha.Substring(0, 7) + ' - ' + ($c.commit.message -split "`n")[0])
  $tmp = Join-Path $Root 'update-tmp'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory $tmp | Out-Null
  $zip = Join-Path $tmp 'app.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/zipball/$sha" -Headers $h -OutFile $zip -TimeoutSec 300
  Expand-Zip $zip (Join-Path $tmp 'x')
  $new = Get-ChildItem (Join-Path $tmp 'x') -Directory | Select-Object -First 1
  if (-not $new -or -not (Test-Path (Join-Path $new.FullName 'server.js'))) { throw 'Download unvollstaendig' }

  # Abhaengigkeiten: vom alten Stand uebernehmen, wenn unveraendert, sonst neu installieren
  $oldLock = Join-Path $AppDir 'package-lock.json'
  $newLock = Join-Path $new.FullName 'package-lock.json'
  $same = (Test-Path $oldLock) -and (Test-Path (Join-Path $AppDir 'node_modules')) -and ((Get-FileHash $oldLock).Hash -eq (Get-FileHash $newLock).Hash)
  if ($same) {
    Copy-Item (Join-Path $AppDir 'node_modules') (Join-Path $new.FullName 'node_modules') -Recurse -Force
  } else {
    Write-Log 'update.log' 'Installiere Programmbausteine (npm) ...'
    $env:PATH = $NodeDir + ';' + $env:PATH
    $np = Start-Process -FilePath (Join-Path $NodeDir 'npm.cmd') -ArgumentList 'ci', '--omit=dev', '--no-audit', '--no-fund' `
      -WorkingDirectory $new.FullName -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput (Join-Path $LogDir 'npm.log') -RedirectStandardError (Join-Path $LogDir 'npm-fehler.log')
    $ok = $np.ExitCode -eq 0
    if (-not $ok) { throw 'npm ci fehlgeschlagen (siehe logs\npm.log)' }
  }

  # CRM kurz anhalten, Programmordner austauschen, wieder starten
  Set-Content $UpdateFlag 'x'
  Stop-CrmNode
  Start-Sleep -Seconds 2
  $old = Join-Path $Root 'app-alt'
  if (Test-Path $old) { Remove-Item $old -Recurse -Force }
  if (Test-Path $AppDir) { Rename-Item $AppDir 'app-alt' }
  Move-Item $new.FullName $AppDir

  # Skripte aktualisieren (falls die neue Version welche mitbringt)
  $ws = Join-Path $AppDir 'deploy\windows'
  if (Test-Path (Join-Path $ws 'common.ps1')) {
    Get-ChildItem $ws -File | Where-Object { $_.Extension -in '.ps1', '.js', '.bat' } | Copy-Item -Destination $ScriptDir -Force
  }

  # Versionsinfo fuer die App (Einstellungen + Hinweis "Neue Version" im Browser)
  $date = ([DateTime]$c.commit.committer.date).ToLocalTime().ToString('dd.MM.yyyy HH:mm')
  $info = [ordered]@{ commit = $sha.Substring(0, 7); subject = ($c.commit.message -split "`n")[0]; date = $date; installed = (Get-Date -Format 'dd.MM.yyyy HH:mm') }
  [IO.File]::WriteAllText((Join-Path $DataDir 'version.json'), ($info | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  Set-Content $shaFile $sha -NoNewline
  Write-Log 'update.log' 'Update eingespielt.'
} catch {
  Write-Log 'update.log' ('FEHLER beim Update: ' + $_.Exception.Message)
  # falls der Austausch mittendrin gescheitert ist: alten Stand zurueckholen
  if (-not (Test-Path (Join-Path $AppDir 'server.js')) -and (Test-Path (Join-Path $Root 'app-alt\server.js'))) {
    if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
    Rename-Item (Join-Path $Root 'app-alt') 'app'
    Write-Log 'update.log' 'Alter Stand wiederhergestellt.'
  }
  $failed = $true
} finally {
  Remove-Item $UpdateFlag -Force -ErrorAction SilentlyContinue
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $Root 'update-tmp') -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
