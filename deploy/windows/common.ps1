# Gemeinsame Einstellungen fuer alle Windows-Skripte des Bussmann CRM
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$Root      = 'C:\BussmannCRM'
$AppDir    = Join-Path $Root 'app'
$DataDir   = Join-Path $Root 'data'
$ToolsDir  = Join-Path $Root 'tools'
$NodeDir   = Join-Path $ToolsDir 'node'
$NodeExe   = Join-Path $NodeDir 'node.exe'
$CaddyExe  = Join-Path $ToolsDir 'caddy\caddy.exe'
$LogDir    = Join-Path $Root 'logs'
$BackupDir = Join-Path $Root 'backups'
$ScriptDir = Join-Path $Root 'scripts'
$ConfigFile = Join-Path $Root 'config.json'
$UpdateFlag = Join-Path $Root 'update-laeuft.flag'
$Repo = 'lennardbussmann/bussmann-crm'

foreach ($d in @($Root, $DataDir, $ToolsDir, $LogDir, $BackupDir, $ScriptDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

function Write-Log([string]$File, [string]$Text) {
  $line = '[' + (Get-Date -Format 'dd.MM.yyyy HH:mm:ss') + '] ' + $Text
  Add-Content -Path (Join-Path $LogDir $File) -Value $line -Encoding UTF8
  Write-Host $line
}

function Get-Config {
  if (Test-Path $ConfigFile) { return Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json }
  return $null
}

function Save-Config($cfg) {
  # ohne BOM speichern, damit auch Node die Datei lesen kann
  [IO.File]::WriteAllText($ConfigFile, ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
}

function Get-GitHubHeaders {
  $h = @{ 'User-Agent' = 'bussmann-crm-windows'; 'Accept' = 'application/vnd.github+json' }
  $cfg = Get-Config
  if ($cfg -and $cfg.github_token) { $h['Authorization'] = 'Bearer ' + $cfg.github_token }
  return $h
}

function Get-PopplerBin {
  $p = Get-ChildItem -Path (Join-Path $ToolsDir 'poppler') -Recurse -Filter 'pdftotext.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { return $p.DirectoryName }
  return $null
}

function Stop-CrmNode {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($NodeDir, [StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like '*server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Expand-Zip([string]$Zip, [string]$Dest) {
  if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
  New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  # tar.exe (ab Windows 10) entpackt ZIP deutlich schneller als Expand-Archive
  $tar = Join-Path $env:WINDIR 'System32\tar.exe'
  if (Test-Path $tar) {
    & $tar -xf $Zip -C $Dest
    if ($LASTEXITCODE -eq 0) { return }
  }
  Expand-Archive -Path $Zip -DestinationPath $Dest -Force
}

# Caddyfile nur fuer die Adressen schreiben, die wirklich schon auf diesen PC zeigen
function Write-Caddyfile($cfg) {
  $hosts = @($cfg.dyndns_hosts | Where-Object { $_ })
  if ($hosts.Count -eq 0 -and $cfg.test_domain) { $hosts = @($cfg.test_domain) }
  $mail = if ($cfg.acme_email) { "{`r`n  email " + $cfg.acme_email + "`r`n}`r`n`r`n" } else { '' }
  $text = $mail + ($hosts -join ', ') + " {`r`n  encode gzip`r`n  reverse_proxy 127.0.0.1:3000`r`n}`r`n"
  [IO.File]::WriteAllText((Join-Path $Root 'Caddyfile'), $text, (New-Object Text.UTF8Encoding $false))
}

function Restart-Caddy {
  Get-Process caddy -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($ToolsDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
}
