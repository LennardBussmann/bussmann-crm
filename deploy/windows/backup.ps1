# Taegliche Datensicherung: C:\BussmannCRM\backups (30 Tage) und optional ein zweiter Ordner
. (Join-Path $PSScriptRoot 'common.ps1')
try {
  $name = 'crm-' + (Get-Date -Format 'yyyy-MM-dd') + '.tar.gz'
  & $NodeExe --disable-warning=ExperimentalWarning (Join-Path $ScriptDir 'backup-db.js') $DataDir
  if ($LASTEXITCODE -ne 0) { throw 'Datenbank-Kopie fehlgeschlagen' }
  $target = Join-Path $BackupDir $name
  # Datenbank-Kopie plus alle Dateien (Anhaenge, Fotos, Logo, Briefpapier), ohne die laufende Datenbank
  $parts = @('backup.sqlite')
  Get-ChildItem $DataDir | Where-Object { $_.Name -notmatch '^crm\.sqlite' -and $_.Name -ne 'backup.sqlite' } | ForEach-Object { $parts += $_.Name }
  & (Join-Path $env:WINDIR 'System32\tar.exe') -czf $target -C $DataDir @parts
  if ($LASTEXITCODE -ne 0) { throw 'Packen fehlgeschlagen' }
  Remove-Item (Join-Path $DataDir 'backup.sqlite') -Force -ErrorAction SilentlyContinue
  Get-ChildItem $BackupDir -Filter 'crm-*.tar.gz' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
  $size = [math]::Round((Get-Item $target).Length / 1MB, 1)
  Write-Log 'sicherung.log' "Sicherung erstellt: $name ($size MB)"

  $cfg = Get-Config
  if ($cfg -and $cfg.backup_copy_dir) {
    if (Test-Path $cfg.backup_copy_dir) {
      Copy-Item $target (Join-Path $cfg.backup_copy_dir $name) -Force
      Get-ChildItem $cfg.backup_copy_dir -Filter 'crm-*.tar.gz' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
      Write-Log 'sicherung.log' ('Kopie abgelegt in ' + $cfg.backup_copy_dir)
    } else {
      Write-Log 'sicherung.log' ('ACHTUNG: Zweiter Sicherungsordner nicht erreichbar: ' + $cfg.backup_copy_dir)
    }
  }
} catch {
  Write-Log 'sicherung.log' ('FEHLER bei der Sicherung: ' + $_.Exception.Message)
  exit 1
}
