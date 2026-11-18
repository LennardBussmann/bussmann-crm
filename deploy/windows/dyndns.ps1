# Meldet die aktuelle Internet-Adresse des Bueros an Strato (DynDNS),
# damit crm.bussmann-maschinen.de immer auf diesen PC zeigt.
param([switch]$Force)
. (Join-Path $PSScriptRoot 'common.ps1')
$cfg = Get-Config
if (-not $cfg -or -not $cfg.dyndns_password -or -not $cfg.dyndns_hosts) { exit 0 }
try {
  $ip = (Invoke-WebRequest -UseBasicParsing -Uri 'https://api.ipify.org' -TimeoutSec 20).Content.Trim()
  if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "Unerwartete Antwort: $ip" }
  $stateFile = Join-Path $Root 'dyndns-letzte-ip.txt'
  $hosts = ($cfg.dyndns_hosts -join ',')
  $state = "$ip|$hosts"
  $old = if (Test-Path $stateFile) { Get-Content $stateFile -Raw } else { '' }
  $fresh = (Test-Path $stateFile) -and (((Get-Date) - (Get-Item $stateFile).LastWriteTime).TotalHours -lt 24)
  if (-not $Force -and $old.Trim() -eq $state -and $fresh) { exit 0 }

  $pair = $cfg.dyndns_user + ':' + $cfg.dyndns_password
  $auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
  $url = 'https://dyndns.strato.com/nic/update?hostname=' + [Uri]::EscapeDataString($hosts) + '&myip=' + $ip
  $res = (Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ Authorization = $auth; 'User-Agent' = 'bussmann-crm-windows' } -TimeoutSec 30).Content.Trim()
  Write-Log 'dyndns.log' "Strato-Antwort fuer $hosts ($ip): $res"
  if ($res -match 'good|nochg') { Set-Content -Path $stateFile -Value $state -NoNewline } else { exit 1 }
} catch {
  Write-Log 'dyndns.log' ('FEHLER: ' + $_.Exception.Message)
  exit 1
}
